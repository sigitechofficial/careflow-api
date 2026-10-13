import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { employeeIdsForLocation } from '../billing/billing-location-scope.util';
import { assertDifferentUser } from '../billing/financial-controls.util';
import {
  SalaryEntryPeriod,
  annualSalaryFromEntry,
  carriesSalary,
} from './salary.util';
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

  async listEmployeeSetup(locationId?: string) {
    let scopedEmployeeIds: string[] | undefined;
    if (locationId) {
      scopedEmployeeIds = await employeeIdsForLocation(this.prisma, locationId);
      if (!scopedEmployeeIds.length) {
        return { message: 'Employee payroll setup', data: [] };
      }
    }

    const [employees, profiles, agreements] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          deletedAt: null,
          ...(scopedEmployeeIds ? { id: { in: scopedEmployeeIds } } : {}),
        },
        select: this.employeeIdentitySelect,
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.employeePayrollProfile.findMany({
        where: { deletedAt: null },
      }),
      // The agreement in force today: a later-dated one may already be approved and waiting.
      this.prisma.employeePayAgreement.findMany({
        where: { deletedAt: null, status: 'ACTIVE', effectiveFrom: { lte: new Date() } },
        orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
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
      apprenticeshipStartDate:
        dto.apprenticeshipStartDate === undefined
          ? undefined
          : dto.apprenticeshipStartDate
            ? parsePayrollDateOnly(dto.apprenticeshipStartDate)
            : null,
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

    // The profile and its audit entry are saved together or not at all.
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.employeePayrollProfile.update({
            where: { id: existing.id },
            data,
          })
        : await tx.employeePayrollProfile.create({
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
              apprenticeshipStartDate: dto.apprenticeshipStartDate
                ? parsePayrollDateOnly(dto.apprenticeshipStartDate)
                : null,
              bankSortCode: dto.bankSortCode?.trim() || null,
              bankAccountNumber: dto.bankAccountNumber?.trim() || null,
              bankAccountName: dto.bankAccountName?.trim() || null,
              notes: dto.notes?.trim() || null,
              createdById: userId,
              updatedById: userId,
            },
          });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.PAYROLL,
        action: existing
          ? AuditAction.PAYROLL_EMPLOYEE_PROFILE_UPDATED
          : AuditAction.PAYROLL_EMPLOYEE_PROFILE_CREATED,
        recordType: 'EmployeePayrollProfile',
        recordId: saved.id,
        oldValues: existing ? mapProfile(existing) : undefined,
        newValues: mapProfile(saved),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return saved;
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
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const ids = [...new Set(rows.flatMap((r) => [r.createdById, r.approvedById]).filter((v): v is string => !!v))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const names = new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]),
    );
    const salaryInEffect = rows.some((r) => r.status !== 'DRAFT' && this.rowCarriesSalary(r));
    return {
      message: 'Pay agreements',
      data: rows.map((r) => ({
        ...mapAgreement(r),
        createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
        approvedByName: r.approvedById ? (names.get(r.approvedById) ?? null) : null,
        // A draft that carries a salary, or replaces one, takes effect only when a second person approves it.
        awaitingApproval: r.status === 'DRAFT' && (this.rowCarriesSalary(r) || salaryInEffect),
      })),
    };
  }

  /** Pay terms that only a second person can put into effect: a salary, or a paid guarantee of hours. */
  private rowCarriesSalary(row: {
    basis: string;
    annualSalary: Prisma.Decimal | number | null;
    guaranteeTopUp?: string | null;
  }) {
    return (
      carriesSalary({
        basis: row.basis,
        annualSalary: row.annualSalary == null ? null : Number(row.annualSalary),
      }) || row.guaranteeTopUp === 'PAY_SHORTFALL'
    );
  }

  /**
   * The pay terms of an agreement, checked. A salary may be entered per year, per month or per
   * week; the yearly figure is what is stored and calculated from. A salary states how a part
   * period is paid and what work it already pays for: neither is assumed.
   */
  private agreementTermsFrom(input: {
    basis: string;
    annualSalary: number | null;
    salaryEntryPeriod: string | null;
    salaryEntryAmount: number | null;
    contractedHours: number | null;
    salaryProrationMethod: string | null;
    salaryCoverage: string | null;
    guaranteedWeeklyHours: number | null;
    guaranteeTopUp: string | null;
    guaranteeQualifyingTime: string | null;
    guaranteeLeaveTreatment: string | null;
  }) {
    const entryPeriod = (input.salaryEntryPeriod ?? 'ANNUAL') as SalaryEntryPeriod;
    const entryAmount = input.salaryEntryAmount ?? (entryPeriod === 'ANNUAL' ? input.annualSalary : null);
    const annualSalary = entryAmount == null ? input.annualSalary : annualSalaryFromEntry(entryPeriod, entryAmount);
    const salaried = input.basis === 'SALARIED' || input.basis === 'HYBRID';

    // A guarantee of hours is stated, never assumed: with no top-up chosen it is recorded only.
    const guaranteePaid = input.guaranteeTopUp === 'PAY_SHORTFALL';
    if (guaranteePaid && salaried) {
      throw new BadRequestException(
        'A guaranteed hours top-up applies to hourly pay. A salary already pays for the hours it covers.',
      );
    }
    if (guaranteePaid && !((input.guaranteedWeeklyHours ?? 0) > 0)) {
      throw new BadRequestException('Enter the guaranteed weekly hours before choosing to pay the shortfall.');
    }
    if (guaranteePaid && !input.guaranteeQualifyingTime) {
      throw new BadRequestException('Choose what counts towards the guaranteed hours.');
    }
    const guarantee = {
      guaranteedWeeklyHours:
        input.guaranteedWeeklyHours == null ? null : new Prisma.Decimal(input.guaranteedWeeklyHours),
      guaranteeTopUp: guaranteePaid ? 'PAY_SHORTFALL' : null,
      guaranteeQualifyingTime: guaranteePaid ? input.guaranteeQualifyingTime : null,
      guaranteeLeaveTreatment: guaranteePaid ? input.guaranteeLeaveTreatment : null,
    };

    if (!salaried) {
      if ((annualSalary ?? 0) > 0) {
        throw new BadRequestException(
          'An hourly agreement does not carry a salary. Choose Salaried, or Hybrid for a salary with separately paid visit work.',
        );
      }
      return {
        annualSalary: null,
        salaryEntryPeriod: null,
        salaryEntryAmount: null,
        salaryProrationMethod: null,
        salaryCoverage: null,
        ...guarantee,
      };
    }
    if (!((annualSalary ?? 0) > 0)) {
      throw new BadRequestException('Enter the salary: an amount per year, per month or per week.');
    }
    if (!input.salaryProrationMethod) {
      throw new BadRequestException(
        'Choose how a part period is paid (a starter, a leaver or a change part way through a pay period).',
      );
    }
    if (!input.salaryCoverage) {
      throw new BadRequestException(
        'Choose what work the salary already pays for, so visit wages are not paid again on top of it.',
      );
    }
    if (input.salaryCoverage === 'CONTRACTED_HOURS' && !((input.contractedHours ?? 0) > 0)) {
      throw new BadRequestException(
        'Enter the contracted weekly hours: the salary pays for visit work up to them, and work beyond them is paid separately.',
      );
    }
    return {
      annualSalary: new Prisma.Decimal(annualSalary as number),
      salaryEntryPeriod: entryPeriod,
      salaryEntryAmount: new Prisma.Decimal(entryAmount as number),
      salaryProrationMethod: input.salaryProrationMethod,
      salaryCoverage: input.salaryCoverage,
      ...guarantee,
    };
  }

  /** An agreement that carries a salary, or replaces one in effect, needs a second person. */
  private async needsApproval(employeeId: string, salaried: boolean, exceptId?: string) {
    if (salaried) return true;
    const others = await this.prisma.employeePayAgreement.findMany({
      where: { employeeId, deletedAt: null, status: { not: 'DRAFT' }, id: exceptId ? { not: exceptId } : undefined },
      select: { basis: true, annualSalary: true, guaranteeTopUp: true },
    });
    return others.some((r) => this.rowCarriesSalary(r));
  }

  /** Agreements this one replaces from its start date. A later-dated one stays as it is. */
  private supersedeEarlier(
    tx: Prisma.TransactionClient,
    input: { employeeId: string; effectiveFrom: Date; userId: string; exceptId?: string },
  ) {
    return tx.employeePayAgreement.updateMany({
      where: {
        employeeId: input.employeeId,
        deletedAt: null,
        status: 'ACTIVE',
        effectiveFrom: { lte: input.effectiveFrom },
        id: input.exceptId ? { not: input.exceptId } : undefined,
      },
      data: { status: 'SUPERSEDED', updatedById: input.userId },
    });
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

    const terms = this.agreementTermsFrom({
      basis: dto.basis,
      annualSalary: dto.annualSalary ?? null,
      salaryEntryPeriod: dto.salaryEntryPeriod ?? null,
      salaryEntryAmount: dto.salaryEntryAmount ?? null,
      contractedHours: dto.contractedHours ?? null,
      salaryProrationMethod: dto.salaryProrationMethod ?? null,
      salaryCoverage: dto.salaryCoverage ?? null,
      guaranteedWeeklyHours: dto.guaranteedWeeklyHours ?? null,
      guaranteeTopUp: dto.guaranteeTopUp ?? null,
      guaranteeQualifyingTime: dto.guaranteeQualifyingTime ?? null,
      guaranteeLeaveTreatment: dto.guaranteeLeaveTreatment ?? null,
    });
    const awaitingApproval = await this.needsApproval(
      employeeId,
      terms.annualSalary != null || terms.guaranteeTopUp != null,
    );
    // A salary, or the end of one, takes effect only when a second person approves the agreement.
    const status = awaitingApproval ? 'DRAFT' : (dto.status ?? 'DRAFT');
    const row = await this.prisma.$transaction(async (tx) => {
      if (status === 'ACTIVE') {
        await this.supersedeEarlier(tx, { employeeId, effectiveFrom, userId });
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
          ...terms,
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

    return {
      message: awaitingApproval
        ? 'Pay agreement saved. It takes effect when a second person approves it.'
        : 'Pay agreement created',
      data: { ...mapAgreement(row), awaitingApproval },
    };
  }

  /**
   * A second person puts an agreement into effect. It then applies from its start date, replacing
   * the agreements that started on or before that date; they stay as history.
   */
  async approveAgreement(userId: string, agreementId: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.employeePayAgreement.findFirst({
      where: { id: agreementId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Pay agreement not found');
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only an agreement that is not yet in effect can be approved.');
    }
    const message = 'A pay agreement is approved by a different person from the one who entered or last changed it.';
    assertDifferentUser(existing.createdById, userId, message);
    assertDifferentUser(existing.updatedById, userId, message);

    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const approved = await tx.employeePayAgreement.updateMany({
        where: { id: agreementId, status: 'DRAFT', deletedAt: null },
        data: { status: 'ACTIVE', approvedById: userId, approvedAt: now, termsChangedAt: now },
      });
      if (approved.count !== 1) {
        throw new ConflictException('This agreement was changed by someone else. Reload and try again.');
      }
      await this.supersedeEarlier(tx, {
        employeeId: existing.employeeId,
        effectiveFrom: existing.effectiveFrom,
        userId,
        exceptId: agreementId,
      });
      return tx.employeePayAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_PAY_AGREEMENT_APPROVED,
      recordType: 'EmployeePayAgreement',
      recordId: row.id,
      oldValues: mapAgreement(existing),
      newValues: mapAgreement(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Pay agreement approved. It applies from its start date.', data: mapAgreement(row) };
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

    const num = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));
    const pick = <T,>(next: T | undefined, current: T) => (next === undefined ? current : next);
    const basis = dto.basis ?? existing.basis;
    // A salary entered again in one form replaces the other form.
    const entryGiven = dto.salaryEntryAmount !== undefined || dto.salaryEntryPeriod !== undefined;
    const annualGiven = dto.annualSalary !== undefined;
    const terms = this.agreementTermsFrom({
      basis,
      annualSalary: annualGiven ? (dto.annualSalary ?? null) : entryGiven ? null : num(existing.annualSalary),
      salaryEntryPeriod: entryGiven
        ? (dto.salaryEntryPeriod ?? existing.salaryEntryPeriod)
        : annualGiven
          ? 'ANNUAL'
          : existing.salaryEntryPeriod,
      salaryEntryAmount: entryGiven
        ? pick(dto.salaryEntryAmount, num(existing.salaryEntryAmount))
        : annualGiven
          ? null
          : num(existing.salaryEntryAmount),
      contractedHours: pick(dto.contractedHours, num(existing.contractedHours)),
      salaryProrationMethod: pick(dto.salaryProrationMethod, existing.salaryProrationMethod),
      salaryCoverage: pick(dto.salaryCoverage, existing.salaryCoverage),
      guaranteedWeeklyHours: pick(dto.guaranteedWeeklyHours, num(existing.guaranteedWeeklyHours)),
      guaranteeTopUp: pick(dto.guaranteeTopUp, existing.guaranteeTopUp),
      guaranteeQualifyingTime: pick(dto.guaranteeQualifyingTime, existing.guaranteeQualifyingTime),
      guaranteeLeaveTreatment: pick(dto.guaranteeLeaveTreatment, existing.guaranteeLeaveTreatment),
    });
    const approvedTerms = terms.annualSalary != null || terms.guaranteeTopUp != null;

    const inEffect = existing.status !== 'DRAFT';
    const salaryInvolved = this.rowCarriesSalary(existing) || approvedTerms;
    let termsChangedAt: Date | undefined;
    if (inEffect && salaryInvolved) {
      // Pay terms in effect are history: they are not rewritten. Only the end of the agreement
      // (and a note) can be recorded on it; a different salary is a new agreement.
      const termKeys = [
        'basis',
        'effectiveFrom',
        'annualSalary',
        'salaryEntryPeriod',
        'salaryEntryAmount',
        'contractedHours',
        'salaryProrationMethod',
        'salaryCoverage',
        'guaranteedWeeklyHours',
        'guaranteeTopUp',
        'guaranteeQualifyingTime',
        'guaranteeLeaveTreatment',
        'hourlyRateOverride',
        'payCardId',
        'scheduleId',
      ] as const;
      if (termKeys.some((k) => dto[k] !== undefined)) {
        throw new BadRequestException(
          'The pay terms of an agreement in effect are not edited. Add a new agreement from the date the change applies; this one stays as history.',
        );
      }
      if (dto.status !== undefined && dto.status !== existing.status && dto.status !== 'TERMINATED') {
        throw new BadRequestException('An agreement in effect can only be ended.');
      }
      if (dto.status === 'TERMINATED' && !effectiveTo) {
        throw new BadRequestException('Enter the last day the agreement applies to before ending it.');
      }
      const endChanged = (effectiveTo?.getTime() ?? null) !== (existing.effectiveTo?.getTime() ?? null);
      if (endChanged || (dto.status === 'TERMINATED' && existing.status !== 'TERMINATED')) {
        termsChangedAt = new Date();
      }
    } else if (
      !inEffect &&
      dto.status !== undefined &&
      dto.status !== 'DRAFT' &&
      (await this.needsApproval(existing.employeeId, approvedTerms, agreementId))
    ) {
      throw new BadRequestException(
        'This agreement carries a salary or a paid guarantee of hours, or replaces one. A second person approves it; it cannot be put into effect by editing it.',
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.status === 'ACTIVE' && existing.status !== 'ACTIVE') {
        await this.supersedeEarlier(tx, {
          employeeId: existing.employeeId,
          effectiveFrom,
          userId,
          exceptId: agreementId,
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
          ...(inEffect && salaryInvolved ? {} : terms),
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
          termsChangedAt,
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
