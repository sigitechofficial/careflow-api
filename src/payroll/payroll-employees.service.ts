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
import { mapAgreement, mapProfile } from './payroll-mapper.util';
import { parsePayrollDateOnly } from './payroll-period.util';
import {
  loanFlagsFromElections,
  sanitizeDeductionElections,
} from './uk-deduction-elections.util';

@Injectable()
export class PayrollEmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async listEmployeeSetup() {
    const [employees, profiles, agreements] = await Promise.all([
      this.prisma.employee.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          personalDetail: {
            select: { firstName: true, lastName: true },
          },
          employment: {
            select: {
              payrollNumber: true,
              nationalInsuranceNo: true,
              defaultPayCardId: true,
            },
          },
        },
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

    const data = employees.map((e) => {
      const profile = profileByEmployee.get(e.id);
      const agreement = agreementByEmployee.get(e.id);
      const first = e.personalDetail?.firstName ?? '';
      const last = e.personalDetail?.lastName ?? '';
      return {
        employeeId: e.id,
        displayName: `${first} ${last}`.trim() || 'Unnamed employee',
        payrollNumber: e.employment?.payrollNumber ?? null,
        nationalInsuranceNo: e.employment?.nationalInsuranceNo ?? null,
        defaultPayCardId: e.employment?.defaultPayCardId ?? null,
        profile: profile ? mapProfile(profile) : null,
        activeAgreement: agreement ? mapAgreement(agreement) : null,
      };
    });

    return { message: 'Employee payroll setup', data };
  }

  async getProfile(employeeId: string) {
    await this.requireEmployee(employeeId);
    const profile = await this.prisma.employeePayrollProfile.findFirst({
      where: { employeeId, deletedAt: null },
    });
    return {
      message: 'Employee payroll profile',
      data: profile ? mapProfile(profile) : null,
    };
  }

  async upsertProfile(
    userId: string,
    employeeId: string,
    dto: UpsertEmployeePayrollProfileDto,
    meta?: RequestAuditMeta,
  ) {
    await this.requireEmployee(employeeId);
    if (dto.scheduleId) await this.requireSchedule(dto.scheduleId);

    const existing = await this.prisma.employeePayrollProfile.findFirst({
      where: { employeeId, deletedAt: null },
    });

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

    return {
      message: existing ? 'Payroll profile updated' : 'Payroll profile created',
      data: mapProfile(row),
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
