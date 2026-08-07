import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateEmployeePayAgreementDto,
  UpdateEmployeePayAgreementDto,
  UpsertEmployeePayrollProfileDto,
} from './dto/payroll.dto';
import { dateToIsoDate, mapAgreement, mapProfile } from './payroll-mapper.util';
import { parsePayrollDateOnly } from './payroll-period.util';
import {
  loanFlagsFromElections,
  sanitizeDeductionElections,
} from './uk-deduction-elections.util';
import {
  assessRtiIdentityCompleteness,
  formatRtiIdentityBlockMessage,
  type RtiIdentityAssessment,
} from './payroll-rti-identity.util';
import { isPayrollHoursNormallyWorked } from './payroll-hours-normally-worked.util';
import { mapYtdLedger } from './payroll-ytd.util';

type EmployeeIdentityRow = {
  id: string
  personalDetail: {
    firstName: string | null
    lastName: string | null
    dateOfBirth: Date | null
    addressLine1: string | null
    town: string | null
    postcode: string | null
    gender: { name: string } | null
  } | null
  employment: {
    payrollNumber: string | null
    nationalInsuranceNo: string | null
    defaultPayCardId: string | null
    startDate: Date | null
    endDate: Date | null
  } | null
}

function assessEmployeeRti(
  employee: EmployeeIdentityRow,
  profile: { taxCode?: string | null; niCategory?: string | null },
): RtiIdentityAssessment {
  return assessRtiIdentityCompleteness({
    firstName: employee.personalDetail?.firstName,
    lastName: employee.personalDetail?.lastName,
    dateOfBirth: employee.personalDetail?.dateOfBirth,
    genderName: employee.personalDetail?.gender?.name,
    addressLine1: employee.personalDetail?.addressLine1,
    town: employee.personalDetail?.town,
    postcode: employee.personalDetail?.postcode,
    nationalInsuranceNo: employee.employment?.nationalInsuranceNo,
    payrollNumber: employee.employment?.payrollNumber,
    taxCode: profile.taxCode,
    niCategory: profile.niCategory,
  })
}

function mapRtiIdentityPayload(employee: EmployeeIdentityRow, assessment: RtiIdentityAssessment) {
  const pd = employee.personalDetail
  const addressParts = [pd?.addressLine1, pd?.town, pd?.postcode].filter((p) =>
    Boolean(p && String(p).trim()),
  )
  return {
    isComplete: assessment.isComplete,
    issues: assessment.issues,
    genderHmrc: assessment.genderHmrc,
    dateOfBirth: dateToIsoDate(pd?.dateOfBirth ?? null),
    addressSummary: addressParts.length ? addressParts.join(', ') : null,
  }
}

@Injectable()
export class PayrollEmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private employeeIdentitySelect = {
    id: true,
    personalDetail: {
      select: {
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        addressLine1: true,
        town: true,
        postcode: true,
        gender: { select: { name: true } },
      },
    },
    employment: {
      select: {
        payrollNumber: true,
        nationalInsuranceNo: true,
        defaultPayCardId: true,
        startDate: true,
        endDate: true,
      },
    },
  } as const

  async listEmployeeSetup() {
    const [employees, profiles, agreements] = await Promise.all([
      this.prisma.employee.findMany({
        where: { deletedAt: null },
        select: this.employeeIdentitySelect,
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.employeePayrollProfile.findMany({
        where: { deletedAt: null },
      }),
      this.prisma.employeePayAgreement.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
      }),
    ]);

    const profileByEmployee = new Map(profiles.map((p) => [p.employeeId, p]));
    const agreementByEmployee = new Map(agreements.map((a) => [a.employeeId, a]));

    const currentTaxYear = await this.prisma.payrollTaxYear.findFirst({
      where: { deletedAt: null, isCurrent: true },
      select: { id: true, code: true },
    });
    const ytdRows = currentTaxYear
      ? await this.prisma.employeePayrollYtdLedger.findMany({
          where: {
            taxYearId: currentTaxYear.id,
            employeeId: { in: employees.map((e) => e.id) },
          },
        })
      : [];
    const ytdByEmployee = new Map(ytdRows.map((y) => [y.employeeId, y]));

    const data = employees.map((e) => {
      const profile = profileByEmployee.get(e.id);
      const agreement = agreementByEmployee.get(e.id);
      const first = e.personalDetail?.firstName ?? '';
      const last = e.personalDetail?.lastName ?? '';
      const assessment = assessEmployeeRti(e, {
        taxCode: profile?.taxCode,
        niCategory: profile?.niCategory,
      });
      const ytd = ytdByEmployee.get(e.id);
      return {
        employeeId: e.id,
        displayName: `${first} ${last}`.trim() || 'Unnamed employee',
        payrollNumber: e.employment?.payrollNumber ?? null,
        nationalInsuranceNo: e.employment?.nationalInsuranceNo ?? null,
        defaultPayCardId: e.employment?.defaultPayCardId ?? null,
        employmentStartDate: dateToIsoDate(e.employment?.startDate ?? null),
        employmentEndDate: dateToIsoDate(e.employment?.endDate ?? null),
        profile: profile ? mapProfile(profile) : null,
        activeAgreement: agreement ? mapAgreement(agreement) : null,
        rtiIdentity: mapRtiIdentityPayload(e, assessment),
        ytd: ytd
          ? {
              ...mapYtdLedger(ytd),
              taxYearCode: currentTaxYear?.code ?? null,
            }
          : currentTaxYear
            ? {
                employeeId: e.id,
                taxYearId: currentTaxYear.id,
                taxYearCode: currentTaxYear.code,
                grossPayYtd: 0,
                taxablePayYtd: 0,
                incomeTaxYtd: 0,
                employeeNiYtd: 0,
                employerNiYtd: 0,
                netPayYtd: 0,
                lastClosedRunId: null,
                updatedAt: new Date(0).toISOString(),
              }
            : null,
      };
    });

    return { message: 'Employee payroll setup', data };
  }

  async getEmployeeYtd(employeeId: string, taxYearId?: string) {
    await this.requireEmployee(employeeId);
    let yearId = taxYearId;
    if (!yearId) {
      const current = await this.prisma.payrollTaxYear.findFirst({
        where: { deletedAt: null, isCurrent: true },
        select: { id: true },
      });
      if (!current) {
        throw new BadRequestException('No current tax year — create/activate one under Tax years');
      }
      yearId = current.id;
    } else {
      const year = await this.prisma.payrollTaxYear.findFirst({
        where: { id: yearId, deletedAt: null },
        select: { id: true },
      });
      if (!year) throw new NotFoundException('Tax year not found');
    }

    const year = await this.prisma.payrollTaxYear.findFirst({
      where: { id: yearId },
      select: { id: true, code: true, label: true },
    });
    const ledger = await this.prisma.employeePayrollYtdLedger.findUnique({
      where: {
        employeeId_taxYearId: { employeeId, taxYearId: yearId },
      },
    });

    return {
      message: 'Employee payroll YTD',
      data: ledger
        ? { ...mapYtdLedger(ledger), taxYearCode: year?.code ?? null, taxYearLabel: year?.label ?? null }
        : {
            employeeId,
            taxYearId: yearId,
            taxYearCode: year?.code ?? null,
            taxYearLabel: year?.label ?? null,
            grossPayYtd: 0,
            taxablePayYtd: 0,
            incomeTaxYtd: 0,
            employeeNiYtd: 0,
            employerNiYtd: 0,
            netPayYtd: 0,
            lastClosedRunId: null,
            updatedAt: new Date(0).toISOString(),
          },
    };
  }

  async getProfile(employeeId: string) {
    const employee = await this.requireEmployeeWithIdentity(employeeId);
    const profile = await this.prisma.employeePayrollProfile.findFirst({
      where: { employeeId, deletedAt: null },
    });
    const assessment = assessEmployeeRti(employee, {
      taxCode: profile?.taxCode,
      niCategory: profile?.niCategory,
    });
    return {
      message: 'Employee payroll profile',
      data: profile ? mapProfile(profile) : null,
      rtiIdentity: mapRtiIdentityPayload(employee, assessment),
    };
  }

  async upsertProfile(
    userId: string,
    employeeId: string,
    dto: UpsertEmployeePayrollProfileDto,
    meta?: RequestAuditMeta,
  ) {
    const employee = await this.requireEmployeeWithIdentity(employeeId);
    if (dto.scheduleId) await this.requireSchedule(dto.scheduleId);

    const existing = await this.prisma.employeePayrollProfile.findFirst({
      where: { employeeId, deletedAt: null },
    });

    const nextTaxCode =
      dto.taxCode === undefined ? existing?.taxCode ?? null : dto.taxCode?.trim() || null;
    const nextNiCategory =
      dto.niCategory === undefined ? existing?.niCategory ?? null : dto.niCategory;
    const nextHours =
      dto.hoursNormallyWorked === undefined
        ? existing?.hoursNormallyWorked ?? null
        : dto.hoursNormallyWorked;
    const nextStatus = dto.status ?? existing?.status ?? 'DRAFT';

    if (nextStatus === 'READY') {
      const assessment = assessEmployeeRti(employee, {
        taxCode: nextTaxCode,
        niCategory: nextNiCategory,
      });
      const readyIssues = [...assessment.issues];
      if (!isPayrollHoursNormallyWorked(nextHours)) {
        readyIssues.push(
          'Hours normally worked band (A–E) must be set on the payroll profile for FPS',
        );
      }
      if (readyIssues.length > 0) {
        throw new BadRequestException(formatRtiIdentityBlockMessage(readyIssues));
      }
    }

    if (
      dto.hoursNormallyWorked !== undefined &&
      dto.hoursNormallyWorked !== null &&
      !isPayrollHoursNormallyWorked(dto.hoursNormallyWorked)
    ) {
      throw new BadRequestException('hoursNormallyWorked must be A, B, C, D, or E');
    }

    const hasElections = dto.deductionElections !== undefined;
    const sanitizedElections = hasElections
      ? sanitizeDeductionElections(dto.deductionElections)
      : undefined;
    const syncedFlags = sanitizedElections
      ? loanFlagsFromElections(sanitizedElections)
      : null;

    const data = {
      scheduleId: dto.scheduleId === undefined ? undefined : dto.scheduleId,
      status: dto.status,
      taxCode: dto.taxCode === undefined ? undefined : dto.taxCode?.trim() || null,
      taxCodeWeek1Month1: dto.taxCodeWeek1Month1,
      niCategory: dto.niCategory === undefined ? undefined : dto.niCategory,
      starterDeclaration: dto.starterDeclaration,
      hoursNormallyWorked:
        dto.hoursNormallyWorked === undefined
          ? undefined
          : dto.hoursNormallyWorked === null
            ? null
            : dto.hoursNormallyWorked,
      p45Received: dto.p45Received,
      studentLoanPlan1: syncedFlags?.studentLoanPlan1 ?? dto.studentLoanPlan1,
      studentLoanPlan2: syncedFlags?.studentLoanPlan2 ?? dto.studentLoanPlan2,
      studentLoanPlan4: syncedFlags?.studentLoanPlan4 ?? dto.studentLoanPlan4,
      studentLoanPlan5: syncedFlags?.studentLoanPlan5 ?? dto.studentLoanPlan5,
      postgraduateLoan: syncedFlags?.postgraduateLoan ?? dto.postgraduateLoan,
      pensionOptedIn: syncedFlags?.pensionOptedIn ?? dto.pensionOptedIn,
      deductionElections: sanitizedElections === undefined ? undefined : sanitizedElections,
      pensionSchemeRef:
        dto.pensionSchemeRef === undefined ? undefined : dto.pensionSchemeRef?.trim() || null,
      bankSortCode: dto.bankSortCode === undefined ? undefined : dto.bankSortCode?.trim() || null,
      bankAccountNumber:
        dto.bankAccountNumber === undefined ? undefined : dto.bankAccountNumber?.trim() || null,
      bankAccountName:
        dto.bankAccountName === undefined ? undefined : dto.bankAccountName?.trim() || null,
      notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
      updatedById: userId,
    };

    const createElections = sanitizedElections ?? [];
    const createFlags = loanFlagsFromElections(createElections);

    const row = existing
      ? await this.prisma.employeePayrollProfile.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.employeePayrollProfile.create({
          data: {
            employeeId,
            scheduleId: dto.scheduleId ?? null,
            status: dto.status ?? 'DRAFT',
            taxCode: dto.taxCode?.trim() || null,
            taxCodeWeek1Month1: dto.taxCodeWeek1Month1 ?? false,
            niCategory: dto.niCategory ?? null,
            starterDeclaration: dto.starterDeclaration ?? 'UNKNOWN',
            hoursNormallyWorked: dto.hoursNormallyWorked ?? null,
            p45Received: dto.p45Received ?? false,
            studentLoanPlan1: createFlags.studentLoanPlan1 || (dto.studentLoanPlan1 ?? false),
            studentLoanPlan2: createFlags.studentLoanPlan2 || (dto.studentLoanPlan2 ?? false),
            studentLoanPlan4: createFlags.studentLoanPlan4 || (dto.studentLoanPlan4 ?? false),
            studentLoanPlan5: createFlags.studentLoanPlan5 || (dto.studentLoanPlan5 ?? false),
            postgraduateLoan: createFlags.postgraduateLoan || (dto.postgraduateLoan ?? false),
            pensionOptedIn: createFlags.pensionOptedIn || (dto.pensionOptedIn ?? false),
            deductionElections: createElections,
            pensionSchemeRef: dto.pensionSchemeRef?.trim() || null,
            bankSortCode: dto.bankSortCode?.trim() || null,
            bankAccountNumber: dto.bankAccountNumber?.trim() || null,
            bankAccountName: dto.bankAccountName?.trim() || null,
            notes: dto.notes?.trim() || null,
            createdById: userId,
            updatedById: userId,
          },
        });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: existing
        ? AuditAction.PAYROLL_EMPLOYEE_PROFILE_UPDATED
        : AuditAction.PAYROLL_EMPLOYEE_PROFILE_CREATED,
      recordType: 'EmployeePayrollProfile',
      recordId: row.id,
      oldValues: existing ? mapProfile(existing) : undefined,
      newValues: mapProfile(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    const assessment = assessEmployeeRti(employee, {
      taxCode: row.taxCode,
      niCategory: row.niCategory,
    });

    return {
      message: existing ? 'Payroll profile updated' : 'Payroll profile created',
      data: mapProfile(row),
      rtiIdentity: mapRtiIdentityPayload(employee, assessment),
    };
  }

  async listAgreements(employeeId: string) {
    await this.requireEmployee(employeeId);
    const rows = await this.prisma.employeePayAgreement.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: { effectiveFrom: 'desc' },
    });
    return { message: 'Pay agreements', data: rows.map(mapAgreement) };
  }

  async createAgreement(
    userId: string,
    employeeId: string,
    dto: CreateEmployeePayAgreementDto,
    meta?: RequestAuditMeta,
  ) {
    await this.requireEmployee(employeeId);
    if (dto.scheduleId) await this.requireSchedule(dto.scheduleId);
    if (dto.payCardId) await this.requirePayCard(dto.payCardId);

    const effectiveFrom = parsePayrollDateOnly(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? parsePayrollDateOnly(dto.effectiveTo) : null;
    if (effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }

    const status = dto.status ?? 'DRAFT';
    const row = await this.prisma.$transaction(async (tx) => {
      if (status === 'ACTIVE') {
        await tx.employeePayAgreement.updateMany({
          where: { employeeId, deletedAt: null, status: 'ACTIVE' },
          data: { status: 'SUPERSEDED', updatedById: userId },
        });
      }
      return tx.employeePayAgreement.create({
        data: {
          employeeId,
          scheduleId: dto.scheduleId ?? null,
          basis: dto.basis,
          status,
          effectiveFrom,
          effectiveTo,
          payCardId: dto.payCardId ?? null,
          annualSalary:
            dto.annualSalary == null ? null : new Prisma.Decimal(dto.annualSalary),
          contractedHours:
            dto.contractedHours == null ? null : new Prisma.Decimal(dto.contractedHours),
          hourlyRateOverride:
            dto.hourlyRateOverride == null
              ? null
              : new Prisma.Decimal(dto.hourlyRateOverride),
          notes: dto.notes?.trim() || null,
          createdById: userId,
          updatedById: userId,
        },
      });
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_PAY_AGREEMENT_CREATED,
      recordType: 'EmployeePayAgreement',
      recordId: row.id,
      newValues: mapAgreement(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Pay agreement created', data: mapAgreement(row) };
  }

  async updateAgreement(
    userId: string,
    agreementId: string,
    dto: UpdateEmployeePayAgreementDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.employeePayAgreement.findFirst({
      where: { id: agreementId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Pay agreement not found');

    if (dto.scheduleId) await this.requireSchedule(dto.scheduleId);
    if (dto.payCardId) await this.requirePayCard(dto.payCardId);

    const effectiveFrom = dto.effectiveFrom
      ? parsePayrollDateOnly(dto.effectiveFrom)
      : existing.effectiveFrom;
    const effectiveTo =
      dto.effectiveTo === undefined
        ? existing.effectiveTo
        : dto.effectiveTo
          ? parsePayrollDateOnly(dto.effectiveTo)
          : null;
    if (effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.status === 'ACTIVE') {
        await tx.employeePayAgreement.updateMany({
          where: {
            employeeId: existing.employeeId,
            deletedAt: null,
            status: 'ACTIVE',
            id: { not: agreementId },
          },
          data: { status: 'SUPERSEDED', updatedById: userId },
        });
      }
      return tx.employeePayAgreement.update({
        where: { id: agreementId },
        data: {
          scheduleId: dto.scheduleId === undefined ? undefined : dto.scheduleId,
          basis: dto.basis,
          status: dto.status,
          effectiveFrom: dto.effectiveFrom ? effectiveFrom : undefined,
          effectiveTo: dto.effectiveTo === undefined ? undefined : effectiveTo,
          payCardId: dto.payCardId === undefined ? undefined : dto.payCardId,
          annualSalary:
            dto.annualSalary === undefined
              ? undefined
              : dto.annualSalary == null
                ? null
                : new Prisma.Decimal(dto.annualSalary),
          contractedHours:
            dto.contractedHours === undefined
              ? undefined
              : dto.contractedHours == null
                ? null
                : new Prisma.Decimal(dto.contractedHours),
          hourlyRateOverride:
            dto.hourlyRateOverride === undefined
              ? undefined
              : dto.hourlyRateOverride == null
                ? null
                : new Prisma.Decimal(dto.hourlyRateOverride),
          notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
          updatedById: userId,
        },
      });
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_PAY_AGREEMENT_UPDATED,
      recordType: 'EmployeePayAgreement',
      recordId: row.id,
      oldValues: mapAgreement(existing),
      newValues: mapAgreement(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Pay agreement updated', data: mapAgreement(row) };
  }

  private async requireEmployee(employeeId: string) {
    const row = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Employee not found');
    return row;
  }

  private async requireEmployeeWithIdentity(employeeId: string): Promise<EmployeeIdentityRow> {
    const row = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: this.employeeIdentitySelect,
    });
    if (!row) throw new NotFoundException('Employee not found');
    return row;
  }

  private async requireSchedule(id: string) {
    const row = await this.prisma.payrollSchedule.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Pay schedule not found');
  }

  private async requirePayCard(id: string) {
    const row = await this.prisma.payCard.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Pay card not found');
  }
}
