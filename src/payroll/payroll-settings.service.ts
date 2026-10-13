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
  allowFinancialResetInTransaction,
  assertDifferentUser,
  assertFinancialResetEnvironment,
} from '../billing/financial-controls.util';
import {
  CreatePayrollScheduleDto,
  CreatePayrollTaxCodeDto,
  CreatePayrollTaxYearDto,
  DeletePayrollPeriodsDto,
  EnterSalariedHoursMethodDto,
  GeneratePayrollPeriodsDto,
  PayrollPeriodsQueryDto,
  PurgePayrollDataDto,
  PreviewEpsQueryDto,
  UpdatePayrollEmployerSettingsDto,
  UpdatePayrollScheduleDto,
  UpdatePayrollStatutoryRatesDto,
  UpdatePayrollTaxCodeDto,
  UpdatePayrollTaxYearDto,
} from './dto/payroll.dto';
import { generatePayrollPeriods, listUkTaxYearsAroundDate, parsePayrollDateOnly } from './payroll-period.util';
import {
  dateToIsoDate,
  mapEmployerSettings,
  mapPeriod,
  mapSchedule,
  mapStatutoryRateSet,
  mapTaxCode,
  mapTaxYear,
} from './payroll-mapper.util';
import { ensureEnglandStatutoryRateSet } from './payroll-statutory-rates.seed';
import {
  encryptGatewayPassword,
  normalizeHmrcEnvironment,
} from './payroll-gateway-credentials.util';
import { buildCareEpsPayload } from './payroll-eps.util';

/** Fixed singleton id for org HMRC employer identity (survives purge). */
export const PAYROLL_EMPLOYER_SETTINGS_ID = '00000000-0000-4000-8000-000000000010';

@Injectable()
export class PayrollSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async getOverview() {
    const [taxYears, schedules, periods, profilesReady, runsOpen, employerSettings] =
      await Promise.all([
        this.prisma.payrollTaxYear.count({ where: { deletedAt: null } }),
        this.prisma.payrollSchedule.count({ where: { deletedAt: null } }),
        this.prisma.payrollPeriod.count({ where: { deletedAt: null } }),
        this.prisma.employeePayrollProfile
          .findMany({
            where: { deletedAt: null, status: 'READY' },
            select: { employeeId: true },
          })
          .then(async (rows) => {
            if (!rows.length) return 0;
            return this.prisma.employee.count({
              where: { id: { in: rows.map((r) => r.employeeId) }, deletedAt: null },
            });
          }),
        this.prisma.ukPayrollRun.count({
          where: {
            deletedAt: null,
            status: {
              in: ['DRAFT', 'EMPLOYEES_ENROLLED', 'GROSS_CALCULATED', 'STATUTORY_CALCULATED'],
            },
          },
        }),
        this.getOrCreateEmployerSettings(),
      ]);
    const currentTaxYear = await this.prisma.payrollTaxYear.findFirst({
      where: { deletedAt: null, isCurrent: true },
    });
    const mappedEmployer = mapEmployerSettings(employerSettings);
    return {
      message: 'UK payroll overview',
      data: {
        taxYearCount: taxYears,
        scheduleCount: schedules,
        periodCount: periods,
        readyEmployeeProfiles: profilesReady,
        openRuns: runsOpen,
        currentTaxYear: currentTaxYear ? mapTaxYear(currentTaxYear) : null,
        employerSettingsComplete: mappedEmployer.isComplete,
        employerFullPayeReference: mappedEmployer.fullPayeReference,
        phaseNote:
          'Cumulative PAYE by default (YTD ledgers). Week 1/Month 1 when profile flag or BR/D0/D1. Close posts YTD. FPS not included.',
      },
    };
  }

  private async getOrCreateEmployerSettings(userId?: string) {
    const existing = await this.prisma.payrollEmployerSettings.findUnique({
      where: { id: PAYROLL_EMPLOYER_SETTINGS_ID },
    });
    if (existing) return existing;
    return this.prisma.payrollEmployerSettings.create({
      data: {
        id: PAYROLL_EMPLOYER_SETTINGS_ID,
        createdById: userId ?? null,
        updatedById: userId ?? null,
      },
    });
  }

  async getEmployerSettings() {
    const row = await this.getOrCreateEmployerSettings();
    return {
      message: 'Employer PAYE settings',
      data: mapEmployerSettings(row),
    };
  }

  async updateEmployerSettings(
    userId: string,
    dto: UpdatePayrollEmployerSettingsDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.getOrCreateEmployerSettings(userId);
    const norm = (v: string | null | undefined) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const t = v.trim();
      return t.length ? t : null;
    };
    const payeRaw = norm(dto.employerPayeReference);
    const paye =
      payeRaw === undefined
        ? undefined
        : payeRaw === null
          ? null
          : payeRaw.replace(/\s+/g, '').toUpperCase();

    const accountsRaw = norm(dto.accountsOfficeReference);
    const accounts =
      accountsRaw === undefined
        ? undefined
        : accountsRaw === null
          ? null
          : accountsRaw.replace(/\s+/g, '').toUpperCase();

    const testPasswordPlain =
      typeof dto.gatewayTestPassword === 'string' ? dto.gatewayTestPassword.trim() : '';
    const livePasswordPlain =
      typeof dto.gatewayLivePassword === 'string' ? dto.gatewayLivePassword.trim() : '';
    const clearTest = dto.clearTestPassword === true;
    const clearLive = dto.clearLivePassword === true;
    if (clearTest && testPasswordPlain) {
      throw new BadRequestException('Cannot clear and set the test Gateway password in one request');
    }
    if (clearLive && livePasswordPlain) {
      throw new BadRequestException('Cannot clear and set the live Gateway password in one request');
    }

    let gatewayTestPasswordEnc: string | null | undefined = undefined;
    let gatewayLivePasswordEnc: string | null | undefined = undefined;
    let testPasswordChanged = false;
    let livePasswordChanged = false;

    if (clearTest) {
      gatewayTestPasswordEnc = null;
      testPasswordChanged = true;
    } else if (testPasswordPlain) {
      gatewayTestPasswordEnc = encryptGatewayPassword(testPasswordPlain);
      testPasswordChanged = true;
    }

    if (clearLive) {
      gatewayLivePasswordEnc = null;
      livePasswordChanged = true;
    } else if (livePasswordPlain) {
      gatewayLivePasswordEnc = encryptGatewayPassword(livePasswordPlain);
      livePasswordChanged = true;
    }

    const envChanged =
      dto.activeHmrcEnvironment !== undefined &&
      normalizeHmrcEnvironment(dto.activeHmrcEnvironment) !==
        normalizeHmrcEnvironment(existing.activeHmrcEnvironment);
    const testUserChanged =
      dto.gatewayTestUserId !== undefined &&
      (norm(dto.gatewayTestUserId) ?? null) !== (existing.gatewayTestUserId?.trim() || null);
    const liveUserChanged =
      dto.gatewayLiveUserId !== undefined &&
      (norm(dto.gatewayLiveUserId) ?? null) !== (existing.gatewayLiveUserId?.trim() || null);
    const gatewayTouched =
      envChanged ||
      testUserChanged ||
      liveUserChanged ||
      testPasswordChanged ||
      livePasswordChanged;

    const identityTouched =
      dto.hmrcOfficeNumber !== undefined ||
      dto.employerPayeReference !== undefined ||
      dto.accountsOfficeReference !== undefined ||
      dto.taxDistrict !== undefined ||
      dto.employerTradingName !== undefined ||
      dto.notes !== undefined ||
      dto.employmentAllowanceClaimed !== undefined;

    const row = await this.prisma.payrollEmployerSettings.update({
      where: { id: existing.id },
      data: {
        hmrcOfficeNumber: norm(dto.hmrcOfficeNumber),
        employerPayeReference: paye,
        accountsOfficeReference: accounts,
        taxDistrict: norm(dto.taxDistrict),
        employerTradingName: norm(dto.employerTradingName),
        notes: norm(dto.notes),
        employmentAllowanceClaimed:
          dto.employmentAllowanceClaimed !== undefined
            ? Boolean(dto.employmentAllowanceClaimed)
            : undefined,
        activeHmrcEnvironment:
          dto.activeHmrcEnvironment !== undefined
            ? normalizeHmrcEnvironment(dto.activeHmrcEnvironment)
            : undefined,
        gatewayTestUserId: norm(dto.gatewayTestUserId),
        gatewayLiveUserId: norm(dto.gatewayLiveUserId),
        gatewayTestPasswordEnc,
        gatewayLivePasswordEnc,
        gatewayCredentialsUpdatedAt: gatewayTouched ? new Date() : undefined,
        updatedById: userId,
      },
    });

    if (identityTouched) {
      await this.audit.logAudit({
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_EMPLOYER_SETTINGS_UPDATED,
        recordType: 'PayrollEmployerSettings',
        recordId: row.id,
        oldValues: mapEmployerSettings(existing),
        newValues: mapEmployerSettings(row),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    }

    if (gatewayTouched) {
      await this.audit.logAudit({
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_GATEWAY_CREDENTIALS_UPDATED,
        recordType: 'PayrollEmployerSettings',
        recordId: row.id,
        oldValues: {
          activeHmrcEnvironment: normalizeHmrcEnvironment(existing.activeHmrcEnvironment),
          hasTestPassword: Boolean(existing.gatewayTestPasswordEnc),
          hasLivePassword: Boolean(existing.gatewayLivePasswordEnc),
          gatewayTestUserId: existing.gatewayTestUserId,
          gatewayLiveUserId: existing.gatewayLiveUserId,
        },
        newValues: {
          activeHmrcEnvironment: normalizeHmrcEnvironment(row.activeHmrcEnvironment),
          hasTestPassword: Boolean(row.gatewayTestPasswordEnc),
          hasLivePassword: Boolean(row.gatewayLivePasswordEnc),
          gatewayTestUserId: row.gatewayTestUserId,
          gatewayLiveUserId: row.gatewayLiveUserId,
          testPasswordChanged,
          livePasswordChanged,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    }

    return {
      message: 'Employer PAYE settings updated',
      data: mapEmployerSettings(row),
    };
  }

  /**
   * Build a Care-owned EPS preview for a UK tax month (T14). Not GovTalk / not submitted.
   */
  async buildEpsPreview(query: PreviewEpsQueryDto) {
    const taxYear = query.taxYearId
      ? await this.prisma.payrollTaxYear.findFirst({
          where: { id: query.taxYearId, deletedAt: null },
        })
      : await this.prisma.payrollTaxYear.findFirst({
          where: { deletedAt: null, isCurrent: true },
        });
    if (!taxYear) {
      throw new NotFoundException(
        query.taxYearId
          ? 'Tax year not found'
          : 'No current tax year — create/activate one under Payroll → Tax years',
      );
    }

    const employerRow = await this.getOrCreateEmployerSettings();
    const employer = mapEmployerSettings(employerRow);

    const periods = await this.prisma.payrollPeriod.findMany({
      where: {
        taxYearId: taxYear.id,
        sequence: query.taxMonth,
        deletedAt: null,
      },
      select: { id: true },
    });
    const periodIds = periods.map((p) => p.id);
    const closedRuns = periodIds.length
      ? await this.prisma.ukPayrollRun.findMany({
          where: {
            periodId: { in: periodIds },
            status: 'CLOSED',
            deletedAt: null,
          },
          select: { employeeCount: true },
        })
      : [];

    const payload = buildCareEpsPayload({
      taxYearCode: taxYear.code,
      taxMonth: query.taxMonth,
      employer: {
        hmrcOfficeNumber: employer.hmrcOfficeNumber,
        employerPayeReference: employer.employerPayeReference,
        accountsOfficeReference: employer.accountsOfficeReference,
        employerTradingName: employer.employerTradingName,
        fullPayeReference: employer.fullPayeReference,
        isComplete: employer.isComplete,
        employmentAllowanceClaimed: employer.employmentAllowanceClaimed,
      },
      noPaymentThisPeriod: query.noPaymentThisPeriod,
      employmentAllowanceClaimed: query.employmentAllowanceClaimed,
      recoveries: {
        smpRecovered: query.smpRecovered,
        sppRecovered: query.sppRecovered,
        sapRecovered: query.sapRecovered,
        shppRecovered: query.shppRecovered,
        spbpRecovered: query.spbpRecovered,
        nicCompensationOnStatutory: query.nicCompensationOnStatutory,
      },
      context: {
        closedRunsInTaxMonth: closedRuns.length,
        employeesPaidInTaxMonth: closedRuns.reduce((sum, r) => sum + (r.employeeCount ?? 0), 0),
      },
    });

    return {
      message: 'EPS preview payload (Care schema — not submitted to HMRC)',
      data: payload,
    };
  }

  /**
   * Hard-deletes transactional payroll schema rows.
   * Does not touch employer HMRC settings, billing visit-pay, employees, or permissions.
   */
  async purgeAllPayrollData(
    userId: string,
    dto: PurgePayrollDataDto,
    meta?: RequestAuditMeta,
  ) {
    // Test reset only: refused in production and unless the server opts in (SI-06).
    assertFinancialResetEnvironment();
    if (dto.confirm !== 'DELETE ALL PAYROLL') {
      throw new BadRequestException('Confirmation phrase is required');
    }

    const counts = await this.prisma.$transaction(async (tx) => {
      await allowFinancialResetInTransaction(tx);
      await tx.visitReconciliation.updateMany({
        where: { paidByUkPayrollRunId: { not: null } },
        data: { paidByUkPayrollRunId: null, lockedAt: null },
      });
      const ytdContributions = await tx.employeePayrollYtdContribution.deleteMany({});
      const ytdLedgers = await tx.employeePayrollYtdLedger.deleteMany({});
      const hmrcSubmissions = await tx.payrollHmrcSubmission.deleteMany({});
      const inputLines = await tx.ukPayrollInputLine.deleteMany({});
      const runEmployees = await tx.ukPayrollRunEmployee.deleteMany({});
      const runs = await tx.ukPayrollRun.deleteMany({});
      const agreements = await tx.employeePayAgreement.deleteMany({});
      const profiles = await tx.employeePayrollProfile.deleteMany({});
      const periods = await tx.payrollPeriod.deleteMany({});
      const schedules = await tx.payrollSchedule.deleteMany({});
      const statutoryRateSets = await tx.payrollStatutoryRateSet.deleteMany({});
      const taxCodes = await tx.payrollTaxCode.deleteMany({});
      const taxYears = await tx.payrollTaxYear.deleteMany({});
      return {
        ytdContributions: ytdContributions.count,
        ytdLedgers: ytdLedgers.count,
        hmrcSubmissions: hmrcSubmissions.count,
        inputLines: inputLines.count,
        runEmployees: runEmployees.count,
        runs: runs.count,
        agreements: agreements.count,
        profiles: profiles.count,
        periods: periods.count,
        schedules: schedules.count,
        statutoryRateSets: statutoryRateSets.count,
        taxCodes: taxCodes.count,
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

  async listTaxCodes(options?: { includeInactive?: boolean }) {
    const rows = await this.prisma.payrollTaxCode.findMany({
      where: {
        deletedAt: null,
        ...(options?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return { message: 'Tax codes', data: rows.map(mapTaxCode) };
  }

  async createTaxCode(
    userId: string,
    dto: CreatePayrollTaxCodeDto,
    meta?: RequestAuditMeta,
  ) {
    const code = dto.code.trim().toUpperCase().replace(/\s+/g, '');
    if (!code) throw new BadRequestException('Tax code is required');

    try {
      const row = await this.prisma.payrollTaxCode.create({
        data: {
          code,
          label: dto.label.trim(),
          description: dto.description?.trim() || null,
          group: dto.group ?? 'STANDARD',
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
          createdById: userId,
          updatedById: userId,
        },
      });
      await this.audit.logAudit({
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_TAX_CODE_CREATED,
        recordType: 'PayrollTaxCode',
        recordId: row.id,
        newValues: mapTaxCode(row),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Tax code created', data: mapTaxCode(row) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Tax code ${code} already exists`);
      }
      throw err;
    }
  }

  async updateTaxCode(
    userId: string,
    id: string,
    dto: UpdatePayrollTaxCodeDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.payrollTaxCode.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Tax code not found');

    const nextCode =
      dto.code === undefined
        ? undefined
        : dto.code.trim().toUpperCase().replace(/\s+/g, '');
    if (dto.code !== undefined && !nextCode) {
      throw new BadRequestException('Tax code is required');
    }

    try {
      const row = await this.prisma.payrollTaxCode.update({
        where: { id },
        data: {
          code: nextCode,
          label: dto.label === undefined ? undefined : dto.label.trim(),
          description:
            dto.description === undefined
              ? undefined
              : dto.description?.trim() || null,
          group: dto.group,
          sortOrder: dto.sortOrder,
          isActive: dto.isActive,
          updatedById: userId,
        },
      });
      await this.audit.logAudit({
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_TAX_CODE_UPDATED,
        recordType: 'PayrollTaxCode',
        recordId: row.id,
        oldValues: mapTaxCode(existing),
        newValues: mapTaxCode(row),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Tax code updated', data: mapTaxCode(row) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Tax code ${nextCode} already exists`);
      }
      throw err;
    }
  }

  async deleteTaxCode(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.payrollTaxCode.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Tax code not found');

    const row = await this.prisma.payrollTaxCode.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        updatedById: userId,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_TAX_CODE_DELETED,
      recordType: 'PayrollTaxCode',
      recordId: row.id,
      oldValues: mapTaxCode(existing),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Tax code deleted', data: { id: row.id } };
  }

  async listStatutoryRates(query?: { taxYearId?: string }) {
    // Ensure current / requested tax year has an England rate set.
    if (query?.taxYearId) {
      await this.requireTaxYear(query.taxYearId);
      await ensureEnglandStatutoryRateSet(this.prisma, query.taxYearId);
    } else {
      const current = await this.prisma.payrollTaxYear.findFirst({
        where: { deletedAt: null, isCurrent: true },
      });
      if (current) {
        await ensureEnglandStatutoryRateSet(this.prisma, current.id);
      }
    }

    const rows = await this.prisma.payrollStatutoryRateSet.findMany({
      where: {
        isActive: true,
        ...(query?.taxYearId ? { taxYearId: query.taxYearId } : {}),
      },
      include: {
        taxYear: { select: { id: true, code: true, label: true, isCurrent: true } },
      },
      orderBy: [{ taxYear: { startDate: 'desc' } }, { nation: 'asc' }, { version: 'desc' }],
    });
    return { message: 'Statutory rates', data: rows.map(mapStatutoryRateSet) };
  }

  async updateStatutoryRates(
    userId: string,
    id: string,
    dto: UpdatePayrollStatutoryRatesDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.payrollStatutoryRateSet.findFirst({
      where: { id },
      include: {
        taxYear: { select: { id: true, code: true, label: true, isCurrent: true } },
      },
    });
    if (!existing) throw new NotFoundException('Statutory rate set not found');

    const num = (v: number | undefined) =>
      v === undefined ? undefined : new Prisma.Decimal(v);

    const row = await this.prisma.payrollStatutoryRateSet.update({
      where: { id },
      data: {
        personalAllowanceAnnual: num(dto.personalAllowanceAnnual),
        basicRateBandAnnual: num(dto.basicRateBandAnnual),
        higherRateThresholdAnnual: num(dto.higherRateThresholdAnnual),
        additionalRateThresholdAnnual: num(dto.additionalRateThresholdAnnual),
        basicRatePercent: num(dto.basicRatePercent),
        higherRatePercent: num(dto.higherRatePercent),
        additionalRatePercent: num(dto.additionalRatePercent),
        niEmployeeRateMainPercent: num(dto.niEmployeeRateMainPercent),
        niEmployeeRateUpperPercent: num(dto.niEmployeeRateUpperPercent),
        niEmployerRatePercent: num(dto.niEmployerRatePercent),
        niLelWeekly: num(dto.niLelWeekly),
        niPtWeekly: num(dto.niPtWeekly),
        niStWeekly: num(dto.niStWeekly),
        niUelWeekly: num(dto.niUelWeekly),
        niLelMonthly: num(dto.niLelMonthly),
        niPtMonthly: num(dto.niPtMonthly),
        niStMonthly: num(dto.niStMonthly),
        niUelMonthly: num(dto.niUelMonthly),
        sourceNote:
          dto.sourceNote === undefined
            ? undefined
            : dto.sourceNote?.trim() || null,
      },
      include: {
        taxYear: { select: { id: true, code: true, label: true, isCurrent: true } },
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_STATUTORY_RATES_UPDATED,
      recordType: 'PayrollStatutoryRateSet',
      recordId: row.id,
      oldValues: mapStatutoryRateSet(existing),
      newValues: mapStatutoryRateSet(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Statutory rates updated', data: mapStatutoryRateSet(row) };
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
          anchorDay: dto.anchorDay ?? 31,
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

    const existing = await this.prisma.payrollPeriod.findMany({
      where: { scheduleId, taxYearId: taxYear.id, deletedAt: null },
      include: { _count: { select: { runs: true } } },
    });
    if (existing.length > 0) {
      if (!dto.replaceExisting) {
        throw new ConflictException(
          'Periods already exist for this schedule and tax year. Regenerate with replace, or remove runs first.',
        );
      }
      const blocked = existing.filter((p) => p._count.runs > 0);
      if (blocked.length > 0) {
        throw new ConflictException(
          `Cannot replace periods: ${blocked.length} period(s) still have UK payroll runs. Delete those runs first.`,
        );
      }
      // Hard-delete so unique (scheduleId, taxYearId, sequence) can be reused.
      await this.prisma.payrollPeriod.deleteMany({
        where: { scheduleId, taxYearId: taxYear.id },
      });
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

  async deletePeriod(userId: string, periodId: string, meta?: RequestAuditMeta) {
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { id: periodId, deletedAt: null },
      include: { _count: { select: { runs: true } } },
    });
    if (!period) throw new NotFoundException('Pay period not found');
    if (period._count.runs > 0) {
      throw new ConflictException(
        'Cannot delete this period: it has UK payroll runs linked. Delete those runs first.',
      );
    }

    await this.prisma.payrollPeriod.delete({ where: { id: period.id } });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_PERIODS_DELETED,
      recordType: 'PayrollPeriod',
      recordId: period.id,
      oldValues: {
        scheduleId: period.scheduleId,
        taxYearId: period.taxYearId,
        sequence: period.sequence,
        label: period.label,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Pay period deleted', data: { id: period.id } };
  }

  async deletePeriods(
    userId: string,
    dto: DeletePayrollPeriodsDto,
    meta?: RequestAuditMeta,
  ) {
    await this.requireSchedule(dto.scheduleId);
    await this.requireTaxYear(dto.taxYearId);

    const existing = await this.prisma.payrollPeriod.findMany({
      where: {
        scheduleId: dto.scheduleId,
        taxYearId: dto.taxYearId,
        deletedAt: null,
      },
      include: { _count: { select: { runs: true } } },
    });
    if (existing.length === 0) {
      throw new NotFoundException('No pay periods found for this schedule and tax year');
    }

    const blocked = existing.filter((p) => p._count.runs > 0);
    if (blocked.length > 0) {
      throw new ConflictException(
        `Cannot delete periods: ${blocked.length} period(s) still have UK payroll runs. Delete those runs first.`,
      );
    }

    const result = await this.prisma.payrollPeriod.deleteMany({
      where: {
        scheduleId: dto.scheduleId,
        taxYearId: dto.taxYearId,
        deletedAt: null,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_PERIODS_DELETED,
      recordType: 'PayrollPeriod',
      recordId: dto.scheduleId,
      oldValues: {
        scheduleId: dto.scheduleId,
        taxYearId: dto.taxYearId,
        count: result.count,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      message: `Deleted ${result.count} pay period${result.count === 1 ? '' : 's'}`,
      data: { deleted: result.count },
    };
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

  // ------------------------------------------------------------------ salaried hours: annual basic hours (Sprint B4B)

  private mapSalariedHoursMethod(row: {
    id: string;
    weeksPerYear: Prisma.Decimal;
    basis: string;
    effectiveFrom: Date;
    status: string;
    isSynthetic: boolean;
    createdById: string | null;
    createdAt: Date;
    approvedById: string | null;
    approvedAt: Date | null;
    withdrawnAt: Date | null;
    withdrawnNote: string | null;
  }) {
    return {
      id: row.id,
      weeksPerYear: Number(row.weeksPerYear),
      basis: row.basis,
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      status: row.status,
      isSynthetic: row.isSynthetic,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      approvedById: row.approvedById,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      withdrawnNote: row.withdrawnNote,
    };
  }

  /**
   * The employer's method for turning contracted weekly hours into the basic hours of a year
   * (minimum wage, salaried hours work). With no approved method in force, UK payroll does not
   * assess salaried staff against the minimum wage: it reports that the policy is missing.
   */
  async listSalariedHoursMethods() {
    const rows = await this.prisma.salariedHoursAnnualisation.findMany({ orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const today = new Date();
    const inForce = rows.find((r) => r.status === 'APPROVED' && r.effectiveFrom <= today) ?? null;
    const userIds = [...new Set(rows.flatMap((r) => [r.createdById, r.approvedById, r.withdrawnById]).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
      : [];
    const name = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]));
    const withNames = (r: (typeof rows)[number]) => ({
      ...this.mapSalariedHoursMethod(r),
      createdByName: r.createdById ? (name.get(r.createdById) ?? null) : null,
      approvedByName: r.approvedById ? (name.get(r.approvedById) ?? null) : null,
      withdrawnByName: r.withdrawnById ? (name.get(r.withdrawnById) ?? null) : null,
    });
    return {
      message: 'Salaried hours annualisation methods',
      data: {
        inForce: inForce ? withNames(inForce) : null,
        methods: rows.map(withNames),
      },
    };
  }

  async enterSalariedHoursMethod(userId: string, dto: EnterSalariedHoursMethodDto, meta?: RequestAuditMeta) {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.salariedHoursAnnualisation.create({
        data: {
          weeksPerYear: dto.weeksPerYear,
          basis: dto.basis.trim(),
          effectiveFrom: new Date(`${dto.effectiveFrom.slice(0, 10)}T00:00:00.000Z`),
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.SALARIED_HOURS_METHOD_ENTERED,
        recordType: 'SalariedHoursAnnualisation',
        recordId: created.id,
        description: dto.basis.trim(),
        newValues: { weeksPerYear: dto.weeksPerYear, effectiveFrom: dto.effectiveFrom.slice(0, 10) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return created;
    });
    return { message: 'Method entered. It is used once a second person approves it.', data: this.mapSalariedHoursMethod(row) };
  }

  async approveSalariedHoursMethod(userId: string, id: string, meta?: RequestAuditMeta) {
    const row = await this.prisma.salariedHoursAnnualisation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Method not found');
    if (row.status !== 'DRAFT') throw new BadRequestException('Only a method that is not yet in use can be approved.');
    assertDifferentUser(row.createdById, userId, 'The annualisation method is approved by a different user from the one who entered it.');
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.salariedHoursAnnualisation.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException('This method was changed by someone else. Reload and check.');
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.SALARIED_HOURS_METHOD_APPROVED,
        recordType: 'SalariedHoursAnnualisation',
        recordId: id,
        description: row.basis,
        oldValues: { status: 'DRAFT' },
        newValues: { status: 'APPROVED', weeksPerYear: Number(row.weeksPerYear) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return {
      message: 'Method approved. Calculate gross again on open UK payroll runs from its start date.',
      data: { id, status: 'APPROVED' },
    };
  }

  async withdrawSalariedHoursMethod(userId: string, id: string, note: string, meta?: RequestAuditMeta) {
    const row = await this.prisma.salariedHoursAnnualisation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Method not found');
    if (row.status === 'WITHDRAWN') throw new BadRequestException('This method is already withdrawn.');
    await this.prisma.$transaction(async (tx) => {
      await tx.salariedHoursAnnualisation.update({
        where: { id },
        data: { status: 'WITHDRAWN', withdrawnById: userId, withdrawnAt: new Date(), withdrawnNote: note.trim() },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.SALARIED_HOURS_METHOD_WITHDRAWN,
        recordType: 'SalariedHoursAnnualisation',
        recordId: id,
        description: note.trim(),
        oldValues: { status: row.status },
        newValues: { status: 'WITHDRAWN' },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return { message: 'Method withdrawn. Closed payroll is not changed.', data: { id, status: 'WITHDRAWN' } };
  }
}
