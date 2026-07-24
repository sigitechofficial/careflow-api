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
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  CreatePayrollScheduleDto,
  CreatePayrollTaxYearDto,
  GeneratePayrollPeriodsDto,
  PayrollPeriodsQueryDto,
  PurgePayrollDataDto,
  UpdatePayrollScheduleDto,
  UpdatePayrollTaxYearDto,
} from './dto/payroll.dto';
import { generatePayrollPeriods, listUkTaxYearsAroundDate, parsePayrollDateOnly } from './payroll-period.util';
import { dateToIsoDate, mapPeriod, mapSchedule, mapTaxYear } from './payroll-mapper.util';
import { ensureEnglandStatutoryRateSet } from './payroll-statutory-rates.seed';

@Injectable()
export class PayrollSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async getOverview() {
    const [taxYears, schedules, periods, profilesReady, runsOpen] = await Promise.all([
      this.prisma.payrollTaxYear.count({ where: { deletedAt: null } }),
      this.prisma.payrollSchedule.count({ where: { deletedAt: null } }),
      this.prisma.payrollPeriod.count({ where: { deletedAt: null } }),
      this.prisma.employeePayrollProfile.count({
        where: { deletedAt: null, status: 'READY' },
      }),
      this.prisma.ukPayrollRun.count({
        where: {
          deletedAt: null,
          status: { in: ['DRAFT', 'EMPLOYEES_ENROLLED', 'GROSS_CALCULATED', 'STATUTORY_CALCULATED'] },
        },
      }),
    ]);
    const currentTaxYear = await this.prisma.payrollTaxYear.findFirst({
      where: { deletedAt: null, isCurrent: true },
    });
    return {
      message: 'UK payroll overview',
      data: {
        taxYearCount: taxYears,
        scheduleCount: schedules,
        periodCount: periods,
        readyEmployeeProfiles: profilesReady,
        openRuns: runsOpen,
        currentTaxYear: currentTaxYear ? mapTaxYear(currentTaxYear) : null,
        phaseNote:
          'Phase 3: gross + Week 1/Month 1 PAYE and Class 1 NI (England/NI/Wales). Cumulative YTD, Scotland, student loans, pensions, and FPS are not included.',
      },
    };
  }

  /**
   * Hard-deletes all rows in the payroll schema only.
   * Does not touch billing visit-pay, employees, pay cards, or permissions.
   */
  async purgeAllPayrollData(
    userId: string,
    dto: PurgePayrollDataDto,
    meta?: RequestAuditMeta,
  ) {
    if (dto.confirm !== 'DELETE ALL PAYROLL') {
      throw new BadRequestException('Confirmation phrase is required');
    }

    const counts = await this.prisma.$transaction(async (tx) => {
      const inputLines = await tx.ukPayrollInputLine.deleteMany({});
      const runEmployees = await tx.ukPayrollRunEmployee.deleteMany({});
      const runs = await tx.ukPayrollRun.deleteMany({});
      const agreements = await tx.employeePayAgreement.deleteMany({});
      const profiles = await tx.employeePayrollProfile.deleteMany({});
      const periods = await tx.payrollPeriod.deleteMany({});
      const schedules = await tx.payrollSchedule.deleteMany({});
      const statutoryRateSets = await tx.payrollStatutoryRateSet.deleteMany({});
      const taxYears = await tx.payrollTaxYear.deleteMany({});
      return {
        inputLines: inputLines.count,
        runEmployees: runEmployees.count,
        runs: runs.count,
        agreements: agreements.count,
        profiles: profiles.count,
        periods: periods.count,
        schedules: schedules.count,
        statutoryRateSets: statutoryRateSets.count,
        taxYears: taxYears.count,
      };
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_DATA_PURGED,
      recordType: 'PayrollSchema',
      recordId: 'all',
      newValues: counts,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      message: 'All UK payroll foundation data deleted',
      data: counts,
    };
  }

  async listTaxYears() {
    const rows = await this.prisma.payrollTaxYear.findMany({
      where: { deletedAt: null },
      orderBy: { startDate: 'desc' },
    });
    return { message: 'Tax years', data: rows.map(mapTaxYear) };
  }

  /**
   * Upsert standard UK tax years (6 Apr → 5 Apr) around today.
   * Activates the current UK tax year if none is marked current.
   */
  async ensureUkTaxYears(userId: string, meta?: RequestAuditMeta) {
    const today = new Date().toISOString().slice(0, 10);
    const definitions = listUkTaxYearsAroundDate(today, { yearsBefore: 2, yearsAfter: 1 });
    const created: string[] = [];
    const existing: string[] = [];
    const rateSetsCreated: string[] = [];

    for (const def of definitions) {
      let taxYearId: string | null = null;
      const found = await this.prisma.payrollTaxYear.findFirst({
        where: { code: def.code, deletedAt: null },
      });
      if (found) {
        existing.push(def.code);
        taxYearId = found.id;
      } else {
        const row = await this.prisma.payrollTaxYear.create({
          data: {
            code: def.code,
            label: def.label,
            startDate: parsePayrollDateOnly(def.startDate),
            endDate: parsePayrollDateOnly(def.endDate),
            status: 'DRAFT',
            isCurrent: false,
            notes: 'Auto-created UK tax year (6 April – 5 April)',
            createdById: userId,
            updatedById: userId,
          },
        });
        created.push(def.code);
        taxYearId = row.id;
      }
      const rate = await ensureEnglandStatutoryRateSet(this.prisma, taxYearId);
      if (rate.created) rateSetsCreated.push(def.code);
    }

    const currentDef = definitions.find((d) => d.isCurrent);
    const anyCurrent = await this.prisma.payrollTaxYear.findFirst({
      where: { deletedAt: null, isCurrent: true },
    });
    let activated: string | null = null;
    if (!anyCurrent && currentDef) {
      const row = await this.prisma.payrollTaxYear.findFirst({
        where: { code: currentDef.code, deletedAt: null },
      });
      if (row) {
        await this.prisma.$transaction(async (tx) => {
          await tx.payrollTaxYear.updateMany({
            where: { deletedAt: null, isCurrent: true },
            data: { isCurrent: false, updatedById: userId },
          });
          await tx.payrollTaxYear.update({
            where: { id: row.id },
            data: { isCurrent: true, status: 'ACTIVE', updatedById: userId },
          });
        });
        activated = currentDef.code;
      }
    }

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_TAX_YEARS_ENSURED,
      recordType: 'PayrollTaxYear',
      recordId: 'ensure-uk',
      newValues: { created, existing, activated, rateSetsCreated },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    const rows = await this.prisma.payrollTaxYear.findMany({
      where: { deletedAt: null },
      orderBy: { startDate: 'desc' },
    });

    return {
      message:
        created.length > 0
          ? `Added ${created.length} UK tax year(s)`
          : 'UK tax years already present',
      data: {
        created,
        existing,
        activated,
        rateSetsCreated,
        taxYears: rows.map(mapTaxYear),
      },
    };
  }

  async createTaxYear(userId: string, dto: CreatePayrollTaxYearDto, meta?: RequestAuditMeta) {
    const start = parsePayrollDateOnly(dto.startDate);
    const end = parsePayrollDateOnly(dto.endDate);
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException('startDate must be on or before endDate');
    }

    try {
      const row = await this.prisma.payrollTaxYear.create({
        data: {
          code: dto.code.trim(),
          label: dto.label.trim(),
          startDate: start,
          endDate: end,
          notes: dto.notes?.trim() || null,
          createdById: userId,
          updatedById: userId,
        },
      });
      await this.audit.logAudit({
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_TAX_YEAR_CREATED,
        recordType: 'PayrollTaxYear',
        recordId: row.id,
        newValues: mapTaxYear(row),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Tax year created', data: mapTaxYear(row) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A tax year with this code already exists');
      }
      throw err;
    }
  }

  async updateTaxYear(
    userId: string,
    id: string,
    dto: UpdatePayrollTaxYearDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.requireTaxYear(id);
    const start = dto.startDate ? parsePayrollDateOnly(dto.startDate) : existing.startDate;
    const end = dto.endDate ? parsePayrollDateOnly(dto.endDate) : existing.endDate;
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException('startDate must be on or before endDate');
    }

    const row = await this.prisma.payrollTaxYear.update({
      where: { id },
      data: {
        code: dto.code?.trim(),
        label: dto.label?.trim(),
        startDate: dto.startDate ? start : undefined,
        endDate: dto.endDate ? end : undefined,
        status: dto.status,
        notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
        updatedById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_TAX_YEAR_UPDATED,
      recordType: 'PayrollTaxYear',
      recordId: row.id,
      oldValues: mapTaxYear(existing),
      newValues: mapTaxYear(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Tax year updated', data: mapTaxYear(row) };
  }

  async activateTaxYear(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.requireTaxYear(id);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.payrollTaxYear.updateMany({
        where: { deletedAt: null, isCurrent: true, id: { not: id } },
        data: { isCurrent: false, status: 'CLOSED', updatedById: userId },
      });
      return tx.payrollTaxYear.update({
        where: { id },
        data: { isCurrent: true, status: 'ACTIVE', updatedById: userId },
      });
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_TAX_YEAR_ACTIVATED,
      recordType: 'PayrollTaxYear',
      recordId: row.id,
      oldValues: mapTaxYear(existing),
      newValues: mapTaxYear(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Tax year activated', data: mapTaxYear(row) };
  }

  async listSchedules() {
    const rows = await this.prisma.payrollSchedule.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return { message: 'Pay schedules', data: rows.map(mapSchedule) };
  }

  async createSchedule(userId: string, dto: CreatePayrollScheduleDto, meta?: RequestAuditMeta) {
    try {
      const row = await this.prisma.payrollSchedule.create({
        data: {
          name: dto.name.trim(),
          code: dto.code.trim().toUpperCase(),
          frequency: dto.frequency,
          anchorDay: dto.anchorDay ?? 1,
          description: dto.description?.trim() || null,
          status: 'ACTIVE',
          createdById: userId,
          updatedById: userId,
        },
      });
      await this.audit.logAudit({
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_SCHEDULE_CREATED,
        recordType: 'PayrollSchedule',
        recordId: row.id,
        newValues: mapSchedule(row),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Pay schedule created', data: mapSchedule(row) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A pay schedule with this code already exists');
      }
      throw err;
    }
  }

  async updateSchedule(
    userId: string,
    id: string,
    dto: UpdatePayrollScheduleDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.requireSchedule(id);
    const row = await this.prisma.payrollSchedule.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        code: dto.code?.trim().toUpperCase(),
        frequency: dto.frequency,
        anchorDay: dto.anchorDay,
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        status: dto.status,
        updatedById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_SCHEDULE_UPDATED,
      recordType: 'PayrollSchedule',
      recordId: row.id,
      oldValues: mapSchedule(existing),
      newValues: mapSchedule(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Pay schedule updated', data: mapSchedule(row) };
  }

  async generatePeriods(
    userId: string,
    scheduleId: string,
    dto: GeneratePayrollPeriodsDto,
    meta?: RequestAuditMeta,
  ) {
    const schedule = await this.requireSchedule(scheduleId);
    if (schedule.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot generate periods for an archived pay schedule');
    }
    const taxYear = await this.requireTaxYear(dto.taxYearId);

    const existingCount = await this.prisma.payrollPeriod.count({
      where: { scheduleId, taxYearId: taxYear.id, deletedAt: null },
    });
    if (existingCount > 0) {
      throw new ConflictException(
        'Periods already exist for this schedule and tax year. Soft-delete them before regenerating.',
      );
    }

    const generated = generatePayrollPeriods({
      frequency: schedule.frequency,
      anchorDay: schedule.anchorDay,
      taxYearStart: dateToIsoDate(taxYear.startDate)!,
      taxYearEnd: dateToIsoDate(taxYear.endDate)!,
    });

    const created = await this.prisma.$transaction(
      generated.map((p) =>
        this.prisma.payrollPeriod.create({
          data: {
            scheduleId: schedule.id,
            taxYearId: taxYear.id,
            sequence: p.sequence,
            label: p.label,
            periodStart: parsePayrollDateOnly(p.periodStart),
            periodEnd: parsePayrollDateOnly(p.periodEnd),
            paymentDate: parsePayrollDateOnly(p.paymentDate),
            createdById: userId,
            updatedById: userId,
          },
        }),
      ),
    );

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_PERIODS_GENERATED,
      recordType: 'PayrollPeriod',
      recordId: schedule.id,
      newValues: {
        scheduleId: schedule.id,
        taxYearId: taxYear.id,
        count: created.length,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      message: `Generated ${created.length} pay periods`,
      data: created.map(mapPeriod),
    };
  }

  async listPeriods(query: PayrollPeriodsQueryDto) {
    const rows = await this.prisma.payrollPeriod.findMany({
      where: {
        deletedAt: null,
        scheduleId: query.scheduleId,
        taxYearId: query.taxYearId,
      },
      orderBy: [{ scheduleId: 'asc' }, { sequence: 'asc' }],
    });
    return { message: 'Pay periods', data: rows.map(mapPeriod) };
  }

  private async requireTaxYear(id: string) {
    const row = await this.prisma.payrollTaxYear.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Tax year not found');
    return row;
  }

  private async requireSchedule(id: string) {
    const row = await this.prisma.payrollSchedule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Pay schedule not found');
    return row;
  }
}
