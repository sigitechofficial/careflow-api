import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PayrollRunLineType,
  PayrollRunStatus,
  Prisma,
  SalaryDeductionType,
  VisitReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { EmployeePayoutsService } from './employee-payouts.service';
import {
  CreateBillingRunDto,
  CreateEmployeeSalaryDeductionDto,
  EmployeeEarningsQueryDto,
  BillingRunsQueryDto,
} from './dto/billing-runs.dto';
import {
  endOfBillingDate,
  formatMoney,
  formatPeriodLabel,
  parseBillingDateOnly,
} from './billing-run.util';
import {
  calculateMileageAmount,
  calculateTravelTimeAmount,
  calculateWaitingTimeAmount,
  formatMinutesAsHours,
  formatTimeRange,
} from './visit-reconciliation.util';
import { dayKeyInTimeZone, formatHmInTimeZone, operationalDayBounds } from '../common/utils/operational-day.util';
import { PayCardsService } from './billing-cards.service';
import { classifyEvaluationFailure } from './pay-evaluation-failure.util';
import { DEFAULT_BANK_HOLIDAY_REGION } from './bank-holiday-regions.util';
import { calendarHoldForPay } from './holiday-calendar.store';
import { MILEAGE_CORRECTION, mileageJourneysInTaxYear } from './mileage-ledger.store';
import {
  PAY_ITEM_CONFIG,
  cardBaseHourlyRate,
  cardRuleOfType,
  isPayItemWageType,
  overtimePremiumPerHour,
  payItemConfigOf,
  payItemAmount,
  rolledUpHolidayPay,
  roundPence,
  weekKeyInTimeZone,
  weeklyOvertime,
} from './pay-items.util';
import {
  calculateUkMileage,
  type MileageVehicleType,
  pickMileageRates,
  ukTaxYearStartKey,
} from './pay-mileage.util';
import { loadPayCardRulesForVersion } from './pay-card-version.util';
import {
  detectInterVisitTravel,
  summariseTravelForDestination,
} from './pay-inter-visit-travel.util';
import {
  estimateEmployerCost,
  nmwHourlyRate,
} from './pay-compliance.util';
import {
  derivePeriodKeyFromRange,
} from './employee-payout-period.util';
import {
  buildPayrollRunVisitLogCsv,
  formatPayAmount,
  formatTimeHhMmSs,
  formatTimeHhMmSsOrZero,
  formatVisitDateMmDdYy,
  minutesToDecimalHours,
  payrollRunExportFilename,
  resolveCareTypeExportCode,
  resolveCarerAddress,
  resolveCarerId,
  resolveEmonitored,
  type PayrollVisitExportRow,
} from './payroll-run-export-csv.util';
import { serviceUserIdsForLocation, employeeIdsForLocation } from './billing-location-scope.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { assertDifferentUser, assertFinancialResetEnvironment } from './financial-controls.util';
import {
  earningCorrectionState,
  earningPhase,
  earningStage,
  earningStageLabel,
  furthestPayoutState,
} from './earning-status.util';
import { agreementTermsOf, carriesSalary, governingAgreement, guaranteeForWeek } from '../payroll/salary.util';
import {
  NMW_PERIOD_SOURCE,
  PayReferencePeriod,
  assessPayReferencePeriod,
  nmwCategoryForPeriod,
  nmwTreatment,
  payReferencePeriodFor,
} from './nmw-period.util';
import { DecidedTravel, decidedTravelForVisit } from './travel-interval.util';
import { rolledUpAllowedFor } from '../payroll/leave.util';
import { isPaySettled } from './pay-settlement.util';
import {
  activityClaimKey,
  isClaimConflict,
  GUARANTEED_HOURS_SOURCE,
  weekEarningParts,
  weekEarningRef,
  HELD_EARNING_SOURCE,
  heldEarningRef,
  heldEarningSubject,
  payItemClaimKey,
  payrollLineClaimKey,
  visitPayClaimKey,
} from './payroll-claim.util';

const MUTABLE_STATUSES: PayrollRunStatus[] = [
  PayrollRunStatus.DRAFT,
  PayrollRunStatus.EXCEPTION_FOUND,
  PayrollRunStatus.READY_FOR_REVIEW,
];

/** An approved run may be recalculated; that withdraws the approval. A locked run never can. */
const CALCULABLE_STATUSES: PayrollRunStatus[] = [...MUTABLE_STATUSES, PayrollRunStatus.APPROVED];

/** Times a calculation reselects its sources when another run claims some of them mid-flight. */
const CLAIM_RETRIES = 3;

const PAYROLL_ELIGIBLE_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.APPROVED_FOR_PAY,
  VisitReconciliationStatus.APPROVED_FOR_BOTH,
];

/** Visits that may still be pending review but already have a calculated payable amount. */
const PRICED_PENDING_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.PENDING_REVIEW,
  VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
];

/**
 * Time a pay line stands for in the export. Only the visit pay line stands for the time of the
 * visit; a top-up, mileage or premium line attached to the same visit has its own minutes or none.
 * Overtime minutes are already inside the visit minutes (premium-only line).
 */
function exportLineMinutes(line: {
  lineType: PayrollRunLineType;
  sourceType?: string | null;
  minutes: number | null;
  visitReconciliation?: { payableMinutes: number | null } | null;
}): number {
  if (line.sourceType === 'OVERTIME') return 0;
  if (line.minutes != null) return line.minutes;
  return line.lineType === PayrollRunLineType.VISIT_PAY ? (line.visitReconciliation?.payableMinutes ?? 0) : 0;
}

function earningsRemainingWhere(
  base: Prisma.VisitReconciliationWhereInput,
): Prisma.VisitReconciliationWhereInput {
  return {
    ...base,
    includedInPayrollRunId: null,
    OR: [
      { status: { in: PAYROLL_ELIGIBLE_RECON } },
      {
        status: { in: PRICED_PENDING_RECON },
        payableAmount: { not: null },
      },
    ],
  };
}

function isEarningsRemainingStatus(
  status: VisitReconciliationStatus,
  payableAmount: unknown,
): boolean {
  if (
    status === VisitReconciliationStatus.APPROVED_FOR_PAY ||
    status === VisitReconciliationStatus.APPROVED_FOR_BOTH ||
    status === VisitReconciliationStatus.LOCKED
  ) {
    return true;
  }
  return (
    (status === VisitReconciliationStatus.PENDING_REVIEW ||
      status === VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL) &&
    payableAmount != null
  );
}

/** Period keys (YYYY-MM or YYYY-Www) covered by an earnings date filter; null = all. */
function salaryMonthsForEarningsQuery(dateFrom?: string, dateTo?: string): string[] | null {
  if (!dateFrom && !dateTo) return null;
  const fromStr = (dateFrom ?? dateTo)!;
  const toStr = (dateTo ?? dateFrom)!;
  const from = parseUtcDateOnly(fromStr);
  const to = parseUtcDateOnly(toStr);
  if (from && to) {
    const daySpan = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    const weekFrom = isoWeekPeriodKey(from);
    const weekTo = isoWeekPeriodKey(to);
    if (daySpan >= 0 && daySpan <= 6 && weekFrom === weekTo) {
      return [weekFrom];
    }
  }
  const start = fromStr.slice(0, 7);
  const end = toStr.slice(0, 7);
  if (start === end) return [start];
  const months: string[] = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (months.length > 36) break;
  }
  return months;
}

function parseUtcDateOnly(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO week period key YYYY-Www (UTC, week starts Monday). */
function isoWeekPeriodKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday in current week decides the year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export type PayrollRunRow = {
  id: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollRunStatus;
  carers: number;
  visitLines: number;
  grossPay: string;
  nmwTopUp: string;
  exceptions: number;
};

@Injectable()
export class PayrollRunsService {
  private readonly logger = new Logger(PayrollRunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employeePayouts: EmployeePayoutsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly payCards: PayCardsService,
    private readonly audit: AuditLogsService,
  ) {}

  private auditRun(
    action: AuditAction,
    userId: string | null,
    runId: string,
    values: { oldValues?: Record<string, unknown>; newValues?: Record<string, unknown> },
    meta?: RequestAuditMeta,
    tx?: Prisma.TransactionClient,
  ) {
    return this.audit.logAudit({
      tx,
      userId: userId ?? undefined,
      module: AuditModule.BILLING,
      action,
      recordType: 'PayrollRun',
      recordId: runId,
      oldValues: values.oldValues,
      newValues: values.newValues,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
  }

  /**
   * Convert YYYY-MM-DD salary/earnings filters into UTC instants for the
   * organisation operational timezone (not raw Z midnight).
   */
  private async operationalVisitDateFilter(
    dateFrom?: string,
    dateTo?: string,
  ): Promise<Prisma.DateTimeFilter | undefined> {
    if (!dateFrom && !dateTo) return undefined;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const out: Prisma.DateTimeFilter = {};
    if (dateFrom) {
      out.gte = operationalDayBounds(dateFrom.slice(0, 10), timeZone).start;
    }
    if (dateTo) {
      out.lte = operationalDayBounds(dateTo.slice(0, 10), timeZone).end;
    }
    return out;
  }

  async list(query?: BillingRunsQueryDto) {
    const where: Prisma.PayrollRunWhereInput = {};
    if (query?.locationId) {
      const suIds = await serviceUserIdsForLocation(this.prisma, query.locationId);
      where.OR = [
        { lines: { none: {} } },
        ...(suIds.length
          ? [
              {
                lines: {
                  some: {
                    visitReconciliation: { serviceUserId: { in: suIds } },
                  },
                },
              },
            ]
          : []),
      ];
    }
    const rows = await this.prisma.payrollRun.findMany({
      where,
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
    return { data: rows.map((r) => this.mapRow(r)) };
  }

  async getSummary(locationId?: string) {
    const where: Prisma.PayrollRunWhereInput = {
      status: {
        in: [
          PayrollRunStatus.DRAFT,
          PayrollRunStatus.CALCULATING,
          PayrollRunStatus.EXCEPTION_FOUND,
          PayrollRunStatus.READY_FOR_REVIEW,
        ],
      },
    };
    if (locationId) {
      const suIds = await serviceUserIdsForLocation(this.prisma, locationId);
      where.OR = [
        { lines: { none: {} } },
        ...(suIds.length
          ? [
              {
                lines: {
                  some: {
                    visitReconciliation: { serviceUserId: { in: suIds } },
                  },
                },
              },
            ]
          : []),
      ];
    }
    const drafts = await this.prisma.payrollRun.count({ where });
    return { data: { payrollDrafts: drafts } };
  }

  /**
   * R-22 / R-27: earnings a pay run could not work out, with what has happened to each since.
   * OPEN: still not paid. PAID: paid by the run named. WITHDRAWN: no longer marked as payable.
   * IN_OPEN_RUN: the run is not locked yet, so recalculating it is the retry.
   */
  async listHeldEarnings() {
    const lines = await this.prisma.payrollRunLine.findMany({
      where: { sourceType: HELD_EARNING_SOURCE },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { payrollRun: { select: { id: true, periodLabel: true, status: true } } },
    });
    const subjects = lines.map((l) => heldEarningSubject(l.sourceRef ?? ''));
    const idsOf = (prefix: string) =>
      [...new Set(subjects.filter((s) => s.startsWith(prefix)).map((s) => s.slice(prefix.length)))];
    const activityIds = idsOf('ACTIVITY:');
    const payItemIds = idsOf('PAY_ITEM:');
    const reconIds = idsOf('VISIT:');
    const [paidLines, activities, payItems, recons, employees] = await Promise.all([
      this.prisma.payrollRunLine.findMany({
        where: {
          claimKey: {
            in: [
              ...activityIds.map(activityClaimKey),
              ...payItemIds.map(payItemClaimKey),
              ...reconIds.map(visitPayClaimKey),
            ],
          },
          exceptionMessage: null,
          payrollRun: { status: { in: [PayrollRunStatus.LOCKED, PayrollRunStatus.EXPORTED] } },
        },
        select: { claimKey: true, payrollRun: { select: { id: true, periodLabel: true } } },
      }),
      this.prisma.employeeNonCoreActivity.findMany({
        where: { id: { in: activityIds } },
        select: { id: true, includeInPayroll: true, isActive: true, deletedAt: true },
      }),
      this.prisma.employeePayItem.findMany({
        where: { id: { in: payItemIds } },
        select: { id: true, status: true },
      }),
      this.prisma.visitReconciliation.findMany({
        where: { id: { in: reconIds } },
        select: { id: true, status: true },
      }),
      this.prisma.employee.findMany({
        where: { id: { in: [...new Set(lines.map((l) => l.employeeId).filter((v): v is string => !!v))] } },
        select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
      }),
    ]);
    const paidBy = new Map(paidLines.map((l) => [l.claimKey, l.payrollRun]));
    const activityById = new Map(activities.map((a) => [a.id, a]));
    const payItemById = new Map(payItems.map((i) => [i.id, i]));
    const reconById = new Map(recons.map((r) => [r.id, r]));
    const nameOf = new Map(
      employees.map((e) => [
        e.id,
        [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ').trim() || null,
      ]),
    );
    const data = lines.map((line) => {
      const subject = heldEarningSubject(line.sourceRef ?? '');
      const [kind, subjectId] = [subject.slice(0, subject.indexOf(':')), subject.slice(subject.indexOf(':') + 1)];
      const claim =
        kind === 'ACTIVITY'
          ? activityClaimKey(subjectId)
          : kind === 'PAY_ITEM'
            ? payItemClaimKey(subjectId)
            : kind === 'VISIT'
              ? visitPayClaimKey(subjectId)
              : null;
      const paid = claim ? paidBy.get(claim) : undefined;
      const locked =
        line.payrollRun.status === PayrollRunStatus.LOCKED || line.payrollRun.status === PayrollRunStatus.EXPORTED;
      const activity = kind === 'ACTIVITY' ? activityById.get(subjectId) : null;
      const withdrawn =
        (kind === 'ACTIVITY' && (!activity || !activity.includeInPayroll || !activity.isActive || !!activity.deletedAt)) ||
        (kind === 'PAY_ITEM' && payItemById.get(subjectId)?.status !== 'APPROVED') ||
        (kind === 'VISIT' && !reconById.get(subjectId));
      return {
        id: line.id,
        payrollRunId: line.payrollRun.id,
        periodLabel: line.payrollRun.periodLabel,
        runStatus: line.payrollRun.status,
        employeeId: line.employeeId,
        employeeName: line.employeeId ? (nameOf.get(line.employeeId) ?? null) : null,
        kind,
        subjectId,
        description: line.description,
        reason: line.exceptionMessage,
        heldAt: line.createdAt,
        state: paid ? 'PAID' : !locked ? 'IN_OPEN_RUN' : withdrawn ? 'WITHDRAWN' : 'OPEN',
        paidByRunId: paid?.id ?? null,
        paidByPeriodLabel: paid?.periodLabel ?? null,
      };
    });
    return { data, meta: { open: data.filter((d) => d.state === 'OPEN').length } };
  }

  async getById(id: string) {
    const row = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: [{ visitRef: 'asc' }],
          take: 500,
          include: {
            visitReconciliation: {
              select: {
                serviceUserId: true,
                approvedPayStart: true,
                approvedPayEnd: true,
                payableMinutes: true,
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Payroll run not found');

    const employeeIds = [
      ...new Set(row.lines.map((l) => l.employeeId).filter(Boolean)),
    ] as string[];
    const serviceUserIds = [
      ...new Set(
        row.lines
          .map((l) => l.visitReconciliation?.serviceUserId)
          .filter(Boolean),
      ),
    ] as string[];

    const [employees, serviceUsers] = await Promise.all([
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true } },
            },
          })
        : [],
      serviceUserIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: serviceUserIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
            },
          })
        : [],
    ]);

    const empMap = new Map(
      employees.map((e) => [
        e.id,
        [e.personalDetail?.firstName, e.personalDetail?.lastName]
          .filter(Boolean)
          .join(' ') || 'Unknown carer',
      ]),
    );
    const suMap = new Map(
      serviceUsers.map((su) => [
        su.id,
        su.preferredName?.trim() ||
          `${su.firstName} ${su.lastName}`.trim() ||
          'Unknown',
      ]),
    );

    const lines = row.lines.map((l) => {
      const recon = l.visitReconciliation;
      const amount = Number(l.amount);
      const lineType = l.lineType;
      const isVisitPay = lineType === PayrollRunLineType.VISIT_PAY;
      const minutes = isVisitPay
        ? (l.minutes ?? recon?.payableMinutes ?? 0)
        : (l.minutes ?? 0);
      const hoursLabel = minutes > 0 ? formatMinutesAsHours(minutes) : null;
      const payableTime =
        isVisitPay && recon?.approvedPayStart && recon?.approvedPayEnd
          ? formatTimeRange(recon.approvedPayStart, recon.approvedPayEnd)
          : lineType === PayrollRunLineType.MILEAGE
            ? 'Mileage'
            : lineType === PayrollRunLineType.TRAVEL_TIME
              ? 'Travel time'
              : '—';

      let unitRate: string | null = null;
      let formula: string | null = null;
      const storedUnit = l.unitAmount != null ? Number(l.unitAmount) : null;

      if (lineType === PayrollRunLineType.MILEAGE && storedUnit != null && storedUnit > 0 && amount > 0) {
        const miles = Math.round((amount / storedUnit) * 100) / 100;
        unitRate = `${formatMoney(storedUnit)}/mile`;
        formula = `${miles.toFixed(2)} mi × ${formatMoney(storedUnit)}/mile = ${formatMoney(amount)}`;
        return {
          id: l.id,
          lineType,
          visitRef: l.visitRef,
          employeeId: l.employeeId,
          carerName: l.employeeId ? (empMap.get(l.employeeId) ?? 'Unknown carer') : '—',
          serviceUserName: recon?.serviceUserId
            ? (suMap.get(recon.serviceUserId) ?? 'Unknown')
            : '—',
          payableTime: 'Mileage',
          hoursLabel: `${miles.toFixed(2)} mi`,
          minutes: 0,
          unitRate,
          formula,
          amount: formatMoney(amount),
          description: l.description,
          exceptionMessage: l.exceptionMessage,
        };
      }

      if (lineType === PayrollRunLineType.TRAVEL_TIME && storedUnit != null && minutes > 0) {
        unitRate = `${formatMoney(storedUnit)}/hr`;
        formula = `${hoursLabel} × ${formatMoney(storedUnit)}/hr = ${formatMoney(amount)}`;
      } else if (isVisitPay && minutes > 0 && amount > 0) {
        const hourly = amount / (minutes / 60);
        unitRate = `${formatMoney(hourly)}/hr`;
        formula = `${hoursLabel} × ${formatMoney(hourly)}/hr = ${formatMoney(amount)}`;
      } else if (l.sourceType && l.sourceType !== 'VISIT') {
        // Non-visit earnings carry their own calculation in the description.
        formula = `${l.description} = ${formatMoney(amount)}`;
      } else if (amount > 0) {
        formula = formatMoney(amount);
      }

      return {
        id: l.id,
        lineType,
        visitRef: l.visitRef,
        employeeId: l.employeeId,
        carerName: l.employeeId ? (empMap.get(l.employeeId) ?? 'Unknown carer') : '—',
        serviceUserName: recon?.serviceUserId
          ? (suMap.get(recon.serviceUserId) ?? 'Unknown')
          : '—',
        payableTime,
        hoursLabel: isVisitPay || lineType === PayrollRunLineType.TRAVEL_TIME ? hoursLabel : null,
        minutes: isVisitPay || lineType === PayrollRunLineType.TRAVEL_TIME ? minutes : 0,
        unitRate,
        formula,
        amount: formatMoney(amount),
        description: l.description,
        exceptionMessage: l.exceptionMessage,
      };
    });

    const carerTotals = new Map<
      string,
      { name: string; minutes: number; amount: number; visits: Set<string> }
    >();
    for (const l of row.lines) {
      if (!l.employeeId) continue;
      const amount = Number(l.amount);
      const name = empMap.get(l.employeeId) ?? 'Unknown carer';
      const existing = carerTotals.get(l.employeeId) ?? {
        name,
        minutes: 0,
        amount: 0,
        visits: new Set<string>(),
      };
      existing.amount += amount;
      if (l.lineType === PayrollRunLineType.VISIT_PAY) {
        const minutes = l.minutes ?? l.visitReconciliation?.payableMinutes ?? 0;
        existing.minutes += minutes;
        if (l.visitRef) existing.visits.add(l.visitRef);
        else existing.visits.add(l.id);
      }
      carerTotals.set(l.employeeId, existing);
    }

    const carerSummaries = [...carerTotals.entries()]
      .map(([employeeId, totals]) => ({
        employeeId,
        carerName: totals.name,
        visitCount: totals.visits.size,
        totalMinutes: totals.minutes,
        totalHours: formatMinutesAsHours(totals.minutes),
        grossPay: formatMoney(totals.amount),
      }))
      .sort((a, b) => a.carerName.localeCompare(b.carerName));

    const visitLineCount = row.lines.filter(
      (l) => l.lineType === PayrollRunLineType.VISIT_PAY,
    ).length;

    return {
      data: {
        ...this.mapRow({ ...row, visitLineCount }),
        notes: row.notes,
        carerSummaries,
        lines,
      },
    };
  }

  async create(userId: string, dto: CreateBillingRunDto) {
    const periodStart = parseBillingDateOnly(dto.periodStart);
    const periodEnd = parseBillingDateOnly(dto.periodEnd);
    if (periodEnd < periodStart) {
      throw new BadRequestException('Period end must be on or after period start');
    }

    const created = await this.prisma.payrollRun.create({
      data: {
        periodLabel: formatPeriodLabel(periodEnd),
        periodStart,
        periodEnd,
        notes: dto.notes?.trim() || null,
        createdById: userId,
      },
    });
    await this.auditRun(AuditAction.VISIT_PAY_RUN_CREATED, userId, created.id, {
      newValues: { periodStart: dto.periodStart, periodEnd: dto.periodEnd },
    });
    return { message: 'Payroll run created', data: this.mapRow(created) };
  }

  /**
   * Calculate (or recalculate) the pay lines of a run.
   *
   * Each original earning line carries a claim key that is unique across every run, and the lines
   * are written in one transaction. So a visit, pay item or activity can sit in one run only, even
   * when two runs calculate at the same moment: the second writer is refused by the database and
   * reselects without the sources the first one took. Recalculating releases this run's claims.
   */
  async calculate(id: string, userId?: string, meta?: RequestAuditMeta) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (!CALCULABLE_STATUSES.includes(run.status)) {
      throw new BadRequestException(`Cannot recalculate payroll run in status ${run.status}`);
    }

    // Take the run: one calculation of a run at a time.
    const taken = await this.prisma.payrollRun.updateMany({
      where: { id, status: run.status },
      data: { status: PayrollRunStatus.CALCULATING },
    });
    if (taken.count !== 1) {
      throw new ConflictException('This payroll run is already being calculated or was changed. Reload and try again.');
    }

    let heldByOtherRuns = 0;
    try {
      for (let attempt = 1; ; attempt += 1) {
        try {
          heldByOtherRuns = await this.calculateLines(run);
          break;
        } catch (err) {
          if (!isClaimConflict(err) || attempt >= CLAIM_RETRIES) throw err;
        }
      }
    } catch (err) {
      // Nothing was written (single transaction): put the run back so it is not stuck in CALCULATING.
      await this.prisma.payrollRun.updateMany({
        where: { id, status: PayrollRunStatus.CALCULATING },
        data: { status: run.status },
      });
      if (isClaimConflict(err)) {
        throw new ConflictException(
          'Another payroll run is claiming the same visits or pay items right now. Try again in a moment.',
        );
      }
      throw err;
    }

    const result = await this.getById(id);
    await this.auditRun(
      AuditAction.VISIT_PAY_RUN_CALCULATED,
      userId ?? null,
      id,
      {
        oldValues: { status: run.status },
        newValues: {
          status: result.data.status,
          grossPay: result.data.grossPay,
          visitLines: result.data.visitLines,
          heldByOtherRuns,
        },
      },
      meta,
    );
    return { ...result, data: { ...result.data, heldByOtherRuns } };
  }

  /** Builds and writes the lines of a run. Returns how many approved visits another run already holds. */
  private async calculateLines(run: {
    id: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<number> {
    const id = run.id;
    const periodEnd = endOfBillingDate(run.periodEnd);
    const candidates = await this.prisma.visitReconciliation.findMany({
      where: {
        status: { in: PAYROLL_ELIGIBLE_RECON },
        includedInPayrollRunId: null,
        paidByUkPayrollRunId: null,
        approvedPayStart: { gte: run.periodStart, lte: periodEnd },
      },
      orderBy: { approvedPayStart: 'asc' },
    });
    // Leave out visits whose pay another (open or locked) run has already claimed.
    const heldElsewhere = new Set(
      (
        await this.prisma.payrollRunLine.findMany({
          where: {
            payrollRunId: { not: id },
            claimKey: { in: candidates.map((r) => visitPayClaimKey(r.id)) },
          },
          select: { visitReconciliationId: true },
        })
      ).map((l) => l.visitReconciliationId),
    );
    const reconciliations = candidates.filter((r) => !heldElsewhere.has(r.id));

    // Auto inter-visit travel (HMRC: travel between assignments is NMW working time).
    const autoJourneys = detectInterVisitTravel(
      reconciliations
        .filter((r) => r.employeeId && r.approvedPayStart && r.approvedPayEnd)
        .map((r) => ({
          reconciliationId: r.id,
          employeeId: r.employeeId!,
          visitRef: r.visitRef,
          payStart: r.approvedPayStart!,
          payEnd: r.approvedPayEnd!,
          manualTravelMinutes: r.travelMinutes,
          manualUnpaidTravelMinutes:
            (r as { unpaidTravelMinutes?: number | null }).unpaidTravelMinutes ?? null,
          serviceUserId: r.serviceUserId,
        })),
    );
    const autoByDestination = new Map(
      [...new Set(autoJourneys.map((j) => j.toReconciliationId))].map((id) => [
        id,
        summariseTravelForDestination(autoJourneys, id),
      ]),
    );

    // TR-01 / TR-04 / TR-05 / TR-06: where a person has classified the time before a visit and a
    // second person approved it, that decides travel and waiting time for the visit. The estimate
    // made from the gap between visits is used only where nothing has been approved.
    const approvedIntervals = reconciliations.length
      ? await this.prisma.travelTimeInterval.findMany({
          where: { toVisitReconciliationId: { in: reconciliations.map((r) => r.id) }, status: 'APPROVED' },
          orderBy: { startAt: 'asc' },
        })
      : [];
    const decidedTravelByVisit = new Map<string, DecidedTravel>();
    for (const visitId of new Set(approvedIntervals.map((i) => i.toVisitReconciliationId))) {
      const decided = decidedTravelForVisit(approvedIntervals.filter((i) => i.toVisitReconciliationId === visitId));
      if (decided) decidedTravelByVisit.set(visitId, decided);
    }

    const lineData: Prisma.PayrollRunLineCreateManyInput[] = [];
    let exceptionCount = 0;
    const employeeIds = new Set<string>();
    // PC-19: travel, waiting and mileage rules are chosen by the organisation's local day.
    const timeZone = await this.orgSettings.getOperationalTimezone();
    /** Auto unpaid NMW travel minutes not covered by paid TRAVEL_TIME / WAITING_TIME lines. */
    const autoUnpaidNmwByEmployee = new Map<string, Array<{ at: Date; minutes: number }>>();
    const addUnpaidNmw = (employeeId: string, at: Date, minutes: number) =>
      autoUnpaidNmwByEmployee.set(employeeId, [...(autoUnpaidNmwByEmployee.get(employeeId) ?? []), { at, minutes }]);
    // TR-09: mileage rates in force on the day of each journey, and business miles so far in the
    // carer's tax year: journeys in other approved or locked runs, plus earlier ones in this run.
    const mileageRateRows = await this.prisma.mileageRate.findMany();
    const calendarCards = new Map<string, { region: string; rules: Array<{ dayType?: string | null }> }>();
    const mileageInOtherRuns = new Map<string, Array<{ at: Date; miles: number }>>();
    const mileageInThisRun = new Map<string, number>();

    for (const recon of reconciliations) {
      const issues: string[] = [];
      if (!recon.employeeId) issues.push('No carer assigned');
      if (recon.payableAmount == null) issues.push('Payable amount not calculated');
      if (!recon.approvedPayStart || !recon.approvedPayEnd) {
        issues.push('Approved payable time missing');
      }

      // R-27: a visit priced while the calendar had no entry for a day that is normally a bank
      // holiday (or approved before this check existed) is held here, not paid at an ordinary rate.
      if (!issues.length && recon.payCardId && recon.approvedPayStart && recon.approvedPayEnd) {
        const cardKey = `${recon.payCardId}|${recon.payCardVersion ?? ''}`;
        if (!calendarCards.has(cardKey)) {
          const [card, rules] = await Promise.all([
            this.prisma.payCard.findUnique({ where: { id: recon.payCardId }, select: { bankHolidayRegion: true } }),
            loadPayCardRulesForVersion(this.prisma, recon.payCardId, recon.payCardVersion),
          ]);
          calendarCards.set(cardKey, { region: card?.bankHolidayRegion || DEFAULT_BANK_HOLIDAY_REGION, rules });
        }
        const card = calendarCards.get(cardKey)!;
        const hold = await calendarHoldForPay(this.prisma, {
          region: card.region,
          rules: card.rules,
          start: recon.approvedPayStart,
          end: recon.approvedPayEnd,
          dayOf: (instant) => dayKeyInTimeZone(instant, timeZone),
        });
        if (hold) {
          // The visit is already approved, so evaluating it again keeps its amount.
          issues.push(
            hold.replace(
              'then evaluate the visit again.',
              'then use "Recalculate amounts" for the visit (it was approved at an ordinary-day rate) and recalculate this run.',
            ),
          );
        }
      }

      const amount = recon.payableAmount != null ? Number(recon.payableAmount) : 0;
      if (issues.length) exceptionCount += 1;

      if (recon.employeeId) employeeIds.add(recon.employeeId);

      lineData.push({
        payrollRunId: id,
        visitReconciliationId: recon.id,
        employeeId: recon.employeeId,
        lineType: PayrollRunLineType.VISIT_PAY,
        description: `Visit pay — ${recon.visitRef}`,
        minutes: recon.payableMinutes,
        amount: issues.length ? 0 : amount,
        payCardId: recon.payCardId,
        visitRef: recon.visitRef,
        exceptionMessage: issues.length ? issues.join('; ') : null,
        // A visit that cannot be paid is held, not claimed: locking this run must not mark it as
        // paid at nothing. It stays payable by a later run over the same period.
        ...(issues.length
          ? { sourceType: HELD_EARNING_SOURCE, sourceRef: heldEarningRef(`VISIT:${recon.id}`) }
          : {}),
      });

      const auto = autoByDestination.get(recon.id);
      if (auto?.requiresManagerReview && recon.employeeId && !issues.length) {
        exceptionCount += 1;
      }

      // Mileage / travel / waiting supplements.
      if (recon.payCardId && recon.employeeId && !issues.length) {
        const payCard = await this.prisma.payCard.findUnique({
          where: { id: recon.payCardId },
          select: {
            mileageVehicleType: true,
            useUkMileageRates: true,
            version: true,
          },
        });
        const payRules = await loadPayCardRulesForVersion(
          this.prisma,
          recon.payCardId,
          recon.payCardVersion,
        );
        const visitDate = recon.plannedStartDateTime;
        const miles = recon.travelMiles != null ? Number(recon.travelMiles) : 0;
        const manualTravelMins = recon.travelMinutes ?? 0;
        const autoTravelMins = auto?.payableTravelMinutes ?? 0;
        const autoWaitingMins = auto?.payableWaitingMinutes ?? 0;
        // Approved intervals decide; otherwise explicit manual minutes; otherwise the estimate.
        const decidedTravel = decidedTravelByVisit.get(recon.id) ?? null;
        const travelMins = decidedTravel
          ? decidedTravel.travelMinutes
          : manualTravelMins > 0
            ? manualTravelMins
            : autoTravelMins;
        const waitingMins = decidedTravel ? decidedTravel.waitingMinutes : manualTravelMins > 0 ? 0 : autoWaitingMins;
        const passengerMiles =
          (recon as { passengerMiles?: unknown }).passengerMiles != null
            ? Number((recon as { passengerMiles?: unknown }).passengerMiles)
            : 0;

        const dayKey = dayKeyInTimeZone(visitDate, timeZone);
        const taxYearKey = ukTaxYearStartKey(dayKey);
        const ytdKey = `${recon.employeeId}|${taxYearKey}`;
        if (miles > 0 && !mileageInOtherRuns.has(ytdKey)) {
          mileageInOtherRuns.set(
            ytdKey,
            await mileageJourneysInTaxYear(this.prisma, {
              employeeId: recon.employeeId,
              taxYearStartKey: taxYearKey,
              timeZone,
              excludeRunId: id,
            }),
          );
        }
        // Miles before this journey, by the date of the journey (not by the date of the run).
        const ytdBusinessMiles =
          (mileageInOtherRuns.get(ytdKey) ?? [])
            .filter((journey) => journey.at < visitDate)
            .reduce((sum, journey) => sum + journey.miles, 0) + (mileageInThisRun.get(ytdKey) ?? 0);

        const vehicleType = (payCard?.mileageVehicleType as MileageVehicleType) ?? 'CAR_VAN';
        const mileageRates = pickMileageRates(mileageRateRows, vehicleType, dayKey);
        const cardMileage = calculateMileageAmount(payRules, visitDate, miles, false, timeZone);
        const ukMileage =
          miles > 0
            ? calculateUkMileage({
                miles,
                vehicleType,
                cardRatePerMile: cardMileage?.unitRate ?? null,
                useUkApprovedRates: payCard?.useUkMileageRates ?? true,
                ytdBusinessMiles,
                passengerMiles,
                rates: mileageRates,
              })
            : null;

        if (ukMileage) {
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: recon.id,
            employeeId: recon.employeeId,
            lineType: PayrollRunLineType.MILEAGE,
            description: `Mileage — ${recon.visitRef} (${miles.toFixed(2)} mi): ${ukMileage.explanation.replace(/ \+ passenger £[0-9.]+$/, '')}`,
            minutes: null,
            quantity: miles,
            unitAmount: ukMileage.unitRate,
            amount: ukMileage.amount,
            taxTreatment: ukMileage.taxTreatment,
            taxFreeAmount: ukMileage.taxFreeAmount,
            taxableAmount: ukMileage.taxableAmount,
            payCardId: recon.payCardId,
            visitRef: recon.visitRef,
            exceptionMessage: null,
          });
          if (ukMileage.passengerAmount > 0) {
            lineData.push({
              payrollRunId: id,
              visitReconciliationId: recon.id,
              employeeId: recon.employeeId,
              lineType: 'PASSENGER_MILEAGE' as PayrollRunLineType,
              description: `Passenger mileage — ${recon.visitRef}`,
              minutes: null,
              quantity: Math.min(passengerMiles, miles),
              unitAmount: mileageRates?.passengerRate ?? null,
              amount: ukMileage.passengerAmount,
              taxTreatment: ukMileage.taxTreatment,
              taxFreeAmount: ukMileage.passengerTaxFreeAmount,
              taxableAmount: ukMileage.passengerTaxableAmount,
              payCardId: recon.payCardId,
              visitRef: recon.visitRef,
              exceptionMessage: null,
            });
          }
        } else if (cardMileage) {
          // A per-mile rate with no approved amount to compare it with (e.g. public transport).
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: recon.id,
            employeeId: recon.employeeId,
            lineType: PayrollRunLineType.MILEAGE,
            description: `Mileage — ${recon.visitRef} (${miles.toFixed(2)} mi)`,
            minutes: null,
            quantity: miles,
            unitAmount: cardMileage.unitRate,
            amount: cardMileage.amount,
            taxTreatment: 'NOT_VERIFIED',
            payCardId: recon.payCardId,
            visitRef: recon.visitRef,
            exceptionMessage: null,
          });
        } else if (miles > 0) {
          // Miles recorded and nothing to price them with: said, not dropped.
          exceptionCount += 1;
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: recon.id,
            employeeId: recon.employeeId,
            lineType: PayrollRunLineType.MILEAGE,
            description: `Mileage — ${recon.visitRef} (${miles.toFixed(2)} mi)`,
            minutes: null,
            quantity: miles,
            unitAmount: null,
            amount: 0,
            payCardId: recon.payCardId,
            visitRef: recon.visitRef,
            exceptionMessage: `No mileage rate is recorded for ${dayKey} (${vehicleType.replace(/_/g, ' ').toLowerCase()}), and the pay card has no mileage rate.`,
          });
        }
        if (miles > 0 && (ukMileage || cardMileage)) {
          mileageInThisRun.set(ytdKey, (mileageInThisRun.get(ytdKey) ?? 0) + miles);
        }

        let paidTravelMins = 0;
        const travel = calculateTravelTimeAmount(payRules, visitDate, travelMins, false, timeZone);
        if (travel) {
          paidTravelMins = travelMins;
          const autoNote = decidedTravel
            ? ` [approved: ${decidedTravel.summary}]`
            : manualTravelMins <= 0 && autoTravelMins > 0
              ? ` [estimated from the gap between visits, not verified: ${(auto?.explanations ?? []).join('; ')}]`
              : '';
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: recon.id,
            employeeId: recon.employeeId,
            lineType: PayrollRunLineType.TRAVEL_TIME,
            description: `Travel time — ${recon.visitRef} (${travelMins} min)${autoNote}`,
            minutes: travelMins,
            unitAmount: travel.unitRate,
            amount: travel.amount,
            payCardId: recon.payCardId,
            visitRef: recon.visitRef,
            exceptionMessage: null,
          });
        }

        let paidWaitingMins = 0;
        const waiting = calculateWaitingTimeAmount(payRules, visitDate, waitingMins, false, timeZone);
        if (waiting) {
          paidWaitingMins = waitingMins;
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: recon.id,
            employeeId: recon.employeeId,
            lineType: 'WAITING_TIME' as PayrollRunLineType,
            description: `Waiting time — ${recon.visitRef} (${waitingMins} min) ${
              decidedTravel ? `[approved: ${decidedTravel.summary}]` : '[estimated from the gap between visits, not verified]'
            }`,
            minutes: waitingMins,
            unitAmount: waiting.unitRate,
            amount: waiting.amount,
            payCardId: recon.payCardId,
            visitRef: recon.visitRef,
            exceptionMessage: null,
          });
        }

        // NMW: remaining auto travel/wait hours that were not paid as wages still count as hours.
        const manualUnpaid =
          (recon as { unpaidTravelMinutes?: number | null }).unpaidTravelMinutes ?? 0;
        // Approved travel and waiting are working time; a rest break or commute is not.
        const autoNmw = decidedTravel
          ? decidedTravel.travelMinutes + decidedTravel.waitingMinutes
          : (auto?.nmwMinutes ?? 0);
        const unpaidForNmw = Math.max(
          manualUnpaid,
          Math.max(0, autoNmw - paidTravelMins - paidWaitingMins),
        );
        if (unpaidForNmw > 0) addUnpaidNmw(recon.employeeId, visitDate, unpaidForNmw);
      } else if (recon.employeeId && !issues.length) {
        // No pay card — still surface auto travel as unpaid NMW hours.
        const auto = autoByDestination.get(recon.id);
        const decided = decidedTravelByVisit.get(recon.id);
        const unpaid =
          Math.max(
            (recon as { unpaidTravelMinutes?: number | null }).unpaidTravelMinutes ?? 0,
            decided ? decided.travelMinutes + decided.waitingMinutes : (auto?.nmwMinutes ?? 0),
          );
        if (unpaid > 0) addUnpaidNmw(recon.employeeId, recon.approvedPayStart ?? recon.plannedStartDateTime, unpaid);
      }
    }

    // Non-visit earnings: approved pay items, training / on-call activity, overtime premium and
    // rolled-up holiday pay. Each only appears when configured, so existing runs are unchanged.
    const nonVisit = await this.buildNonVisitLines(run, reconciliations, lineData);
    lineData.push(...nonVisit.lines);
    for (const employeeId of nonVisit.employeeIds) employeeIds.add(employeeId);
    exceptionCount += nonVisit.problemCount;

    // Minimum wage (Q37–Q39). The check is made over each worker's pay reference period: the
    // period of their UK payroll schedule, not the dates this run happens to cover. Hours count in
    // the period they were worked. A period divided between runs is assessed as a whole — this
    // run's pay and hours with those of the locked runs before it — and topped up once.
    type NmwComponent = { at: Date; amount: number; minutes: number; pay: boolean; hours: boolean };
    const nmwByEmployee = new Map<string, NmwComponent[]>();
    const reconStart = new Map(reconciliations.map((r) => [r.id, r.approvedPayStart ?? r.plannedStartDateTime]));
    const payItemIds = lineData.map((l) => l.employeePayItemId).filter((v): v is string => !!v);
    const activityIds = lineData
      .filter((l) => l.sourceType === 'NON_CORE_ACTIVITY' && l.sourceRef)
      .map((l) => l.sourceRef as string);
    const [payItemDates, activityDates] = await Promise.all([
      payItemIds.length
        ? this.prisma.employeePayItem.findMany({ where: { id: { in: payItemIds } }, select: { id: true, workDate: true } })
        : [],
      activityIds.length
        ? this.prisma.employeeNonCoreActivity.findMany({ where: { id: { in: activityIds } }, select: { id: true, dateFrom: true } })
        : [],
    ]);
    const payItemDate = new Map(payItemDates.map((i) => [i.id, i.workDate]));
    const activityDate = new Map(activityDates.map((a) => [a.id, a.dateFrom]));
    const runEnd = new Date(`${run.periodEnd.toISOString().slice(0, 10)}T12:00:00.000Z`);
    /** The day the work of a line was done; a line with no day of its own belongs to the end of the run. */
    const lineWorkedAt = (line: Prisma.PayrollRunLineCreateManyInput): Date => {
      if (line.visitReconciliationId) return reconStart.get(line.visitReconciliationId) ?? runEnd;
      if (line.employeePayItemId) {
        const day = payItemDate.get(line.employeePayItemId);
        if (day) return new Date(`${day.toISOString().slice(0, 10)}T12:00:00.000Z`);
      }
      if (line.sourceType === 'NON_CORE_ACTIVITY' && line.sourceRef) return activityDate.get(line.sourceRef) ?? runEnd;
      return runEnd;
    };
    const addNmw = (employeeId: string, component: NmwComponent) =>
      nmwByEmployee.set(employeeId, [...(nmwByEmployee.get(employeeId) ?? []), component]);
    for (const line of lineData) {
      if (!line.employeeId) continue;
      // A held line is not paid in this run: its hours are not this run's working time either.
      // Counting them produced a minimum wage top-up for pay that was only being held.
      if (line.exceptionMessage) continue;
      const treatment = nmwTreatment(String(line.lineType));
      if (!treatment.pay && !treatment.hours) continue;
      addNmw(line.employeeId, {
        at: lineWorkedAt(line),
        amount: Number(line.amount),
        minutes: line.minutes ?? 0,
        pay: treatment.pay,
        hours: treatment.hours,
      });
    }
    // Working time that was not paid as travel or waiting still counts as hours.
    for (const [employeeId, unpaid] of autoUnpaidNmwByEmployee) {
      for (const entry of unpaid) {
        if (entry.minutes > 0) addNmw(employeeId, { at: entry.at, amount: 0, minutes: entry.minutes, pay: true, hours: true });
      }
    }

    let nmwTopUpTotal = 0;
    let nmwExceptionBump = 0;
    const nmwAssessments: Prisma.NmwPeriodAssessmentCreateManyInput[] = [];
    const nmwEmployeeIds = [...nmwByEmployee.keys()];
    if (nmwEmployeeIds.length) {
      const [employments, profiles, agreementRows, otherAssessments, otherTopUps] = await Promise.all([
        this.prisma.employeeEmployment.findMany({
          where: { employeeId: { in: nmwEmployeeIds }, deletedAt: null },
          select: {
            employeeId: true,
            contractType: { select: { name: true } },
            employee: { select: { personalDetail: { select: { dateOfBirth: true } } } },
          },
        }),
        this.prisma.employeePayrollProfile.findMany({
          where: { employeeId: { in: nmwEmployeeIds }, deletedAt: null },
          select: { employeeId: true, scheduleId: true, apprenticeshipStartDate: true },
        }),
        this.prisma.employeePayAgreement.findMany({
          where: { employeeId: { in: nmwEmployeeIds }, deletedAt: null, status: { not: 'DRAFT' } },
        }),
        // The same periods in runs that are locked: their pay and hours are part of the period.
        this.prisma.nmwPeriodAssessment.findMany({
          where: {
            employeeId: { in: nmwEmployeeIds },
            payrollRunId: { not: id },
            payrollRun: { status: { in: [PayrollRunStatus.LOCKED, PayrollRunStatus.EXPORTED] } },
          },
          select: { employeeId: true, periodStart: true, eligiblePay: true, minutes: true },
        }),
        this.prisma.payrollRunLine.findMany({
          where: { payrollRunId: { not: id }, sourceType: NMW_PERIOD_SOURCE, employeeId: { in: nmwEmployeeIds } },
          select: { employeeId: true, sourceRef: true, amount: true, payrollRun: { select: { status: true, periodLabel: true } } },
        }),
      ]);
      const scheduleIds = [...new Set(profiles.map((p) => p.scheduleId).filter((v): v is string => !!v))];
      const allTimes = [...nmwByEmployee.values()].flat().map((c) => c.at.getTime());
      const schedulePeriods = scheduleIds.length
        ? await this.prisma.payrollPeriod.findMany({
            where: {
              scheduleId: { in: scheduleIds },
              deletedAt: null,
              periodStart: { lte: new Date(Math.max(...allTimes)) },
              periodEnd: { gte: new Date(Math.min(...allTimes) - 24 * 60 * 60_000) },
            },
            select: { scheduleId: true, periodStart: true, periodEnd: true },
          })
        : [];
      const isoKey = (d: Date) => d.toISOString().slice(0, 10);
      const round2 = (n: number) => Math.round(n * 100) / 100;

      for (const [employeeId, components] of nmwByEmployee) {
        const employment = employments.find((e) => e.employeeId === employeeId);
        const profile = profiles.find((p) => p.employeeId === employeeId);
        const periodsOfWorker = schedulePeriods.filter((p) => p.scheduleId === profile?.scheduleId);
        const agreements = agreementRows.filter((a) => a.employeeId === employeeId).map(agreementTermsOf);

        // This run's components, by the pay reference period their day falls in.
        const byPeriod = new Map<string, { period: PayReferencePeriod; components: NmwComponent[] }>();
        for (const component of components) {
          const period = payReferencePeriodFor(dayKeyInTimeZone(component.at, timeZone), periodsOfWorker, run);
          const bucket = byPeriod.get(period.start) ?? { period, components: [] };
          bucket.components.push(component);
          byPeriod.set(period.start, bucket);
        }

        for (const { period, components: inPeriod } of byPeriod.values()) {
          const periodStart = new Date(`${period.start}T00:00:00.000Z`);
          const decision = nmwCategoryForPeriod({
            dateOfBirth: employment?.employee?.personalDetail?.dateOfBirth ?? null,
            periodStart,
            apprenticeContract: /apprentice/i.test(employment?.contractType?.name ?? ''),
            apprenticeshipStartDate: profile?.apprenticeshipStartDate ?? null,
          });
          const requiredHourly = nmwHourlyRate(decision.category, periodStart);
          const thisPay = round2(inPeriod.filter((c) => c.pay).reduce((sum, c) => sum + c.amount, 0));
          const thisMinutes = inPeriod.filter((c) => c.hours).reduce((sum, c) => sum + c.minutes, 0);
          const before = otherAssessments.filter((a) => a.employeeId === employeeId && isoKey(a.periodStart) === period.start);
          const settled = otherTopUps.filter(
            (l) => l.employeeId === employeeId && weekEarningParts(l.sourceRef).weekKey === period.start,
          );
          const topUpAlreadyPaid = round2(settled.reduce((sum, l) => sum + Number(l.amount), 0));
          const position = assessPayReferencePeriod({
            requiredHourly,
            thisPay,
            thisMinutes,
            otherPay: before.reduce((sum, a) => sum + Number(a.eligiblePay), 0),
            otherMinutes: before.reduce((sum, a) => sum + a.minutes, 0),
            topUpAlreadyPaid,
          });
          const assessment = {
            payrollRunId: id,
            employeeId,
            periodStart,
            periodEnd: new Date(`${period.end}T00:00:00.000Z`),
            periodSource: period.source,
            workType: 'TIME_WORK',
            category: decision.category,
            ageAtPeriodStart: decision.ageAtPeriodStart,
            requiredHourly,
            eligiblePay: thisPay,
            minutes: thisMinutes,
            periodPay: position.periodPay,
            periodMinutes: position.periodMinutes,
            topUpAlreadyPaid,
            topUpInRun: 0,
            compliant: position.compliant,
            note: decision.note,
          };
          // A salaried worker is paid for basic hours by the salary: this is not time work, so a
          // top-up worked out from visit lines would be wrong. The position is recorded, not paid.
          if (carriesSalary(governingAgreement(agreements, periodStart))) {
            nmwAssessments.push({
              ...assessment,
              workType: 'SALARIED_HOURS',
              compliant: true,
              note: 'Salaried hours work: not assessed from visit lines. The salary is checked against the basic hours it pays for.',
            });
            continue;
          }
          const openElsewhere = settled.find(
            (l) => l.payrollRun.status !== PayrollRunStatus.LOCKED && l.payrollRun.status !== PayrollRunStatus.EXPORTED,
          );
          if (openElsewhere) {
            // What the open run has topped up is not settled, so it cannot be netted off here.
            if (position.topUpDue > 0) {
              exceptionCount += 1;
              lineData.push({
                payrollRunId: id,
                visitReconciliationId: null,
                employeeId,
                lineType: PayrollRunLineType.NMW_TOP_UP,
                sourceType: HELD_EARNING_SOURCE,
                sourceRef: heldEarningRef(`WEEK:NMW:${employeeId}:${period.start}`),
                description: `Not worked out: minimum wage top-up for the pay reference period ${period.start} to ${period.end}`,
                minutes: null,
                amount: 0,
                payCardId: null,
                visitRef: null,
                exceptionMessage: `The minimum wage top-up of the pay reference period ${period.start} to ${period.end} is on pay run "${openElsewhere.payrollRun.periodLabel}", which is not locked yet. Lock or recalculate that run, then recalculate this one.`,
              });
            }
            nmwAssessments.push(assessment);
            continue;
          }
          if (position.topUpInRun !== 0) {
            const inPeriodDay = (visitId: string | null | undefined) => {
              const start = visitId ? reconStart.get(visitId) : null;
              if (!start) return false;
              const day = dayKeyInTimeZone(start, timeZone);
              return day >= period.start && day <= period.end;
            };
            const anchor =
              lineData.find(
                (l) =>
                  l.employeeId === employeeId &&
                  l.lineType === PayrollRunLineType.VISIT_PAY &&
                  !l.exceptionMessage &&
                  inPeriodDay(l.visitReconciliationId),
              ) ?? null;
            if (position.topUpInRun > 0) nmwExceptionBump += 1;
            nmwTopUpTotal += position.topUpInRun;
            assessment.topUpInRun = position.topUpInRun;
            const hours = (position.periodMinutes / 60).toFixed(2).replace(/\.00$/, '');
            lineData.push({
              payrollRunId: id,
              visitReconciliationId: anchor?.visitReconciliationId ?? null,
              employeeId,
              lineType: PayrollRunLineType.NMW_TOP_UP,
              sourceType: NMW_PERIOD_SOURCE,
              sourceRef: weekEarningRef(id, employeeId, period.start, settled.length + 1),
              description:
                `NMW top-up — pay reference period ${period.start} to ${period.end}` +
                (period.source === 'PAY_RUN_PERIOD' ? ' (the dates of this run: no payroll schedule period covers them)' : '') +
                `: £${position.periodPay.toFixed(2)} for ${hours}h = £${position.effectiveHourly.toFixed(4)}/hr, rate £${requiredHourly.toFixed(2)} (${decision.category})` +
                (topUpAlreadyPaid ? `; £${topUpAlreadyPaid.toFixed(2)} already topped up by an earlier run` : ''),
              minutes: null,
              amount: position.topUpInRun,
              payCardId: anchor?.payCardId ?? null,
              visitRef: anchor?.visitRef ?? null,
              exceptionMessage: null,
            });
          }
          nmwAssessments.push(assessment);
        }
      }
    }

    const grossPay = lineData
      .filter(
        (l) =>
          l.lineType !== PayrollRunLineType.MILEAGE &&
          l.lineType !== ('PASSENGER_MILEAGE' as PayrollRunLineType) &&
          l.lineType !== ('EXPENSE' as PayrollRunLineType),
      )
      .reduce((sum, l) => sum + Number(l.amount), 0);
    const expenseTotal = lineData
      .filter(
        (l) =>
          l.lineType === PayrollRunLineType.MILEAGE ||
          l.lineType === ('PASSENGER_MILEAGE' as PayrollRunLineType) ||
          l.lineType === ('EXPENSE' as PayrollRunLineType),
      )
      .reduce((sum, l) => sum + Number(l.amount), 0);

    const employer = estimateEmployerCost({
      grossPay,
      mileageAndExpenses: expenseTotal,
      payFrequency: 'WEEKLY',
    });

    const totalExceptions = exceptionCount + nmwExceptionBump;

    for (const line of lineData) {
      line.claimKey = payrollLineClaimKey({ ...line, lineType: String(line.lineType) });
    }

    const componentRows = lineData
      .filter((l) => l.employeeId && Number(l.amount) !== 0)
      .map((l) => ({
        workerId: l.employeeId!,
        visitReconciliationId: l.visitReconciliationId,
        payrollRunId: id,
        componentType: String(l.lineType),
        sourceDurationMinutes: l.minutes ?? null,
        approvedDurationMinutes: l.minutes ?? null,
        appliedRate: l.unitAmount != null ? Number(l.unitAmount) : null,
        amount: Number(l.amount),
        taxable:
          l.lineType !== PayrollRunLineType.MILEAGE &&
          l.lineType !== ('PASSENGER_MILEAGE' as PayrollRunLineType),
        pensionable:
          l.lineType !== PayrollRunLineType.MILEAGE &&
          l.lineType !== ('PASSENGER_MILEAGE' as PayrollRunLineType),
        nmwInclusion:
          l.lineType !== PayrollRunLineType.MILEAGE &&
          l.lineType !== ('PASSENGER_MILEAGE' as PayrollRunLineType),
        approvalStatus: 'AUTO',
        calculationExplanation: l.description,
        rateCardId: l.payCardId ?? null,
        rateCardVersion: null as number | null,
      }));

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollRunLine.deleteMany({ where: { payrollRunId: id } });
      await tx.nmwPeriodAssessment.deleteMany({ where: { payrollRunId: id } });
      if (nmwAssessments.length) await tx.nmwPeriodAssessment.createMany({ data: nmwAssessments });
      try {
        await (tx as { payComponent?: { deleteMany: Function } }).payComponent?.deleteMany({
          where: { payrollRunId: id },
        });
      } catch {
        // PayComponent table may not exist until migrate.
      }
      if (lineData.length) {
        await tx.payrollRunLine.createMany({ data: lineData });
      }
      if (componentRows.length) {
        try {
          await (tx as { payComponent: { createMany: Function } }).payComponent.createMany({
            data: componentRows,
          });
        } catch {
          // Ignore if migration not applied yet.
        }
      }
      await tx.payrollRun.update({
        where: { id },
        data: {
          status:
            totalExceptions > 0
              ? PayrollRunStatus.EXCEPTION_FOUND
              : lineData.length
                ? PayrollRunStatus.READY_FOR_REVIEW
                : PayrollRunStatus.DRAFT,
          carerCount: employeeIds.size,
          visitLineCount: lineData.filter((l) => l.lineType === PayrollRunLineType.VISIT_PAY).length,
          // grossPay already includes the NMW top-up lines (EL-09: it used to be added a second time).
          grossPay,
          nmwTopUp: nmwTopUpTotal,
          expenseTotal,
          estimatedEmployerNi: employer.employerNi,
          estimatedEmployerPension: employer.employerPension,
          estimatedEmployerCost: employer.totalEmploymentCost,
          exceptionCount: totalExceptions,
          // A recalculation withdraws any earlier approval of the old figures.
          approvedAt: null,
          approvedById: null,
        } as Prisma.PayrollRunUpdateInput,
      });
    });

    return heldElsewhere.size;
  }

  /**
   * Non-visit earning lines for a visit pay run:
   *  1. approved pay items dated on/before the period end and not yet paid (backdated items sweep in);
   *  2. non-core activities marked "include in payroll" priced by the card's TRAINING / ON_CALL rate;
   *  3. weekly overtime premium when the card has an OVERTIME rate (premium only — base pay for those
   *     minutes is already in visit pay);
   *  4. rolled-up holiday pay (12.07%) when the card's holiday pay method is ROLLED_UP_12_07.
   */
  private async buildNonVisitLines(
    run: { id: string; periodStart: Date; periodEnd: Date },
    reconciliations: Array<{ id: string; approvedPayStart: Date | null }>,
    visitLines: Prisma.PayrollRunLineCreateManyInput[],
  ): Promise<{
    lines: Prisma.PayrollRunLineCreateManyInput[];
    employeeIds: Set<string>;
    problemCount: number;
  }> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const periodEnd = endOfBillingDate(run.periodEnd);
    const lines: Prisma.PayrollRunLineCreateManyInput[] = [];
    const employeeIds = new Set<string>();
    const cache = new Map<string, Awaited<ReturnType<PayCardsService['resolveRulesForEmployeeAt']>>>();
    // R-22: an earning that cannot be worked out is never left out without a word. Whatever stops
    // it (the pay card cannot be decided, no employment record, no rate on the card, an unexpected
    // error) becomes a held line on the run: the worker, the source, the reason. Recalculating the
    // run is the retry; a held training or on-call activity is picked up again by later runs.
    const cardProblems = new Map<string, { message: string; category: string }>();
    const rulesAt = async (employeeId: string, at: Date) => {
      const key = `${employeeId}|${dayKeyInTimeZone(at, timeZone)}`;
      if (!cache.has(key)) {
        cache.set(
          key,
          await this.payCards.resolveRulesForEmployeeAt(employeeId, at).catch((err) => {
            const failure = classifyEvaluationFailure(err);
            if (failure.kind === 'TECHNICAL') {
              this.logger.error(
                `Non-visit pay: pay card of ${employeeId} could not be read (${failure.category})`,
                err instanceof Error ? err.stack : undefined,
              );
            }
            cardProblems.set(key, { message: failure.message, category: failure.category });
            return null;
          }),
        );
      }
      return cache.get(key) ?? null;
    };
    /**
     * True when the carer's card could not be decided or read that day. A carer with no employment
     * record simply has no card, so no card rule (overtime, rolled-up holiday) can apply to them.
     */
    const cardFailed = (employeeId: string, at: Date) => {
      const problem = cardProblems.get(`${employeeId}|${dayKeyInTimeZone(at, timeZone)}`);
      return !!problem && problem.category !== 'EMPLOYMENT_RECORD_MISSING';
    };
    /** Why no card was returned for the carer that day: the recorded problem, or simply none applies. */
    const noCardReason = (employeeId: string, at: Date) => {
      const day = dayKeyInTimeZone(at, timeZone);
      return cardProblems.get(`${employeeId}|${day}`)?.message ?? `No pay card applies to this carer on ${day}.`;
    };
    let problemCount = 0;
    const held = new Set<string>();
    const hold = (input: {
      employeeId: string;
      subject: string;
      lineType: PayrollRunLineType;
      description: string;
      reason: string;
    }) => {
      const sourceRef = heldEarningRef(input.subject);
      if (held.has(sourceRef)) return;
      held.add(sourceRef);
      problemCount += 1;
      employeeIds.add(input.employeeId);
      lines.push({
        payrollRunId: run.id,
        visitReconciliationId: null,
        employeeId: input.employeeId,
        lineType: input.lineType,
        sourceType: HELD_EARNING_SOURCE,
        sourceRef,
        description: input.description,
        minutes: null,
        unitAmount: null,
        amount: 0,
        payCardId: null,
        visitRef: null,
        exceptionMessage: input.reason,
      });
    };
    const wageTypeNames = new Map(
      (await this.prisma.wageType.findMany({ select: { code: true, name: true } })).map((w) => [w.code, w.name]),
    );
    const hours = (m: number) => `${(m / 60).toFixed(2).replace(/\.00$/, '')}h`;

    // 1) Pay items
    const items = await this.prisma.employeePayItem.findMany({
      where: { status: 'APPROVED', includedInPayrollRunId: null, workDate: { lte: run.periodEnd } },
      orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
    });
    const itemsHeldElsewhere = new Set(
      (
        await this.prisma.payrollRunLine.findMany({
          where: { payrollRunId: { not: run.id }, claimKey: { in: items.map((i) => payItemClaimKey(i.id)) } },
          select: { employeePayItemId: true },
        })
      ).map((l) => l.employeePayItemId),
    );
    for (const item of items) {
      if (itemsHeldElsewhere.has(item.id)) continue;
      const config = payItemConfigOf(item.wageTypeCode);
      if (!config) {
        hold({
          employeeId: item.employeeId,
          subject: `PAY_ITEM:${item.id}`,
          lineType: PayrollRunLineType.ADJUSTMENT,
          description: `Not paid: approved pay item of ${item.workDate.toISOString().slice(0, 10)} — ${item.reason}`,
          reason: `Pay item type "${item.wageTypeCode}" is not one the pay run can pay. Cancel the item and enter it under a supported type.`,
        });
        continue;
      }
      employeeIds.add(item.employeeId);
      lines.push({
        payrollRunId: run.id,
        visitReconciliationId: null,
        employeeId: item.employeeId,
        lineType: config.lineType,
        sourceType: 'PAY_ITEM',
        sourceRef: item.id,
        employeePayItemId: item.id,
        description: `${wageTypeNames.get(item.wageTypeCode) ?? config.label ?? item.wageTypeCode} (${item.workDate.toISOString().slice(0, 10)}) — ${item.reason}`,
        // A mileage correction is a reimbursement: its miles and tax treatment travel with it.
        ...(item.wageTypeCode === MILEAGE_CORRECTION
          ? {
              quantity: item.quantity,
              taxTreatment: item.taxTreatment ?? 'NOT_VERIFIED',
              taxFreeAmount: item.taxFreeAmount,
              taxableAmount: item.taxableAmount,
            }
          : {}),
        minutes:
          config.countsAsNmwHours && item.unit === 'HOUR' && item.quantity != null
            ? Math.round(Number(item.quantity) * 60)
            : null,
        unitAmount: item.rate,
        amount: item.amount,
        payCardId: item.payCardId,
        visitRef: null,
        exceptionMessage: null,
      });
    }

    // 2) Training / on-call activity
    // Activities of this period, and earlier ones that a locked run could not price and held.
    const carriedActivityIds = (
      await this.prisma.payrollRunLine.findMany({
        where: {
          sourceType: HELD_EARNING_SOURCE,
          sourceRef: { startsWith: heldEarningRef('ACTIVITY:') },
          payrollRunId: { not: run.id },
          payrollRun: { status: { in: [PayrollRunStatus.LOCKED, PayrollRunStatus.EXPORTED] } },
        },
        select: { sourceRef: true },
      })
    ).map((l) => heldEarningSubject(l.sourceRef!).slice('ACTIVITY:'.length));
    const activities = await this.prisma.employeeNonCoreActivity.findMany({
      where: {
        includeInPayroll: true,
        isActive: true,
        deletedAt: null,
        OR: [
          { dateFrom: { gte: run.periodStart, lte: periodEnd } },
          { id: { in: carriedActivityIds }, dateFrom: { lt: run.periodStart } },
        ],
      },
      include: { reason: { select: { name: true } } },
      orderBy: { dateFrom: 'asc' },
    });
    // Activity already claimed by another run (open or locked), plus lines locked before claims existed.
    const paidActivity = await this.prisma.payrollRunLine.findMany({
      where: {
        payrollRunId: { not: run.id },
        OR: [
          { claimKey: { in: activities.map((a) => activityClaimKey(a.id)) } },
          {
            sourceType: 'NON_CORE_ACTIVITY',
            payrollRun: { status: { in: [PayrollRunStatus.LOCKED, PayrollRunStatus.EXPORTED] } },
          },
        ],
      },
      select: { sourceRef: true },
    });
    const paidActivityRefs = new Set(paidActivity.map((r) => r.sourceRef));
    for (const activity of activities) {
      if (paidActivityRefs.has(activity.id)) continue;
      const resolved = await rulesAt(activity.employeeId, activity.dateFrom);
      const day = dayKeyInTimeZone(activity.dateFrom, timeZone);
      const what = activity.reason?.name ?? 'Activity';
      const holdActivity = (reason: string) =>
        hold({
          employeeId: activity.employeeId,
          subject: `ACTIVITY:${activity.id}`,
          lineType: activity.onCallForPeriod
            ? PayrollRunLineType.ON_CALL_STANDBY
            : PayrollRunLineType.NON_VISIT_ACTIVITY,
          description: `Not paid: ${activity.onCallForPeriod ? 'on-call' : 'training / activity'} — ${what} (${day})`,
          reason,
        });
      if (!resolved) {
        holdActivity(noCardReason(activity.employeeId, activity.dateFrom));
        continue;
      }
      if (activity.onCallForPeriod) {
        const rule = cardRuleOfType(resolved.rules, 'ON_CALL');
        if (!rule) {
          holdActivity(
            `Pay card ${resolved.card.code} has no on-call rate. Add one, enter a pay item for this on-call period, or untick "include in payroll" on the activity.`,
          );
          continue;
        }
        lines.push({
          payrollRunId: run.id,
          visitReconciliationId: null,
          employeeId: activity.employeeId,
          lineType: PayrollRunLineType.ON_CALL_STANDBY,
          sourceType: 'NON_CORE_ACTIVITY',
          sourceRef: activity.id,
          description: `On-call allowance — ${what} (${day})`,
          minutes: null,
          unitAmount: rule.amount,
          amount: roundPence(rule.amount),
          payCardId: resolved.card.id,
          visitRef: null,
          exceptionMessage: null,
        });
      } else {
        const rule = cardRuleOfType(resolved.rules, 'TRAINING');
        if (!rule) {
          holdActivity(
            `Pay card ${resolved.card.code} has no training rate. Add one, enter a pay item for this activity, or untick "include in payroll" on the activity.`,
          );
          continue;
        }
        const minutes = Math.max(0, Math.round((activity.dateTo.getTime() - activity.dateFrom.getTime()) / 60_000));
        if (!minutes) {
          holdActivity('The activity has no duration (its end is not after its start). Correct its times.');
          continue;
        }
        lines.push({
          payrollRunId: run.id,
          visitReconciliationId: null,
          employeeId: activity.employeeId,
          lineType: PayrollRunLineType.NON_VISIT_ACTIVITY,
          sourceType: 'NON_CORE_ACTIVITY',
          sourceRef: activity.id,
          description: `Training / activity — ${what} (${day}, ${hours(minutes)} × £${Number(rule.amount).toFixed(2)})`,
          minutes,
          unitAmount: rule.amount,
          amount: payItemAmount(new Prisma.Decimal(minutes).div(60), rule.amount),
          payCardId: resolved.card.id,
          visitRef: null,
          exceptionMessage: null,
        });
      }
      employeeIds.add(activity.employeeId);
    }

    // 3) Weekly overtime premium (WM-18). A Monday–Sunday week is one work period, whichever pay
    // runs its visits fall in. The hours of the week are every pay-approved visit of that week;
    // the premium due for them, less what locked runs already paid for that week, is paid here.
    // So a week split between two runs is counted once, calculating a run again adds nothing, and
    // a visit approved late is settled by the next run that touches its week.
    const startById = new Map(reconciliations.map((r) => [r.id, r.approvedPayStart]));
    const heldHere = new Set<string>();
    const weeksTouched = new Map<string, Set<string>>();
    for (const line of visitLines) {
      if (line.lineType !== PayrollRunLineType.VISIT_PAY || !line.employeeId) continue;
      if (line.exceptionMessage) {
        if (line.visitReconciliationId) heldHere.add(line.visitReconciliationId);
        continue;
      }
      const start = line.visitReconciliationId ? startById.get(line.visitReconciliationId) : null;
      if (!start || !line.minutes) continue;
      const touched = weeksTouched.get(line.employeeId) ?? new Set<string>();
      touched.add(weekKeyInTimeZone(start, timeZone));
      weeksTouched.set(line.employeeId, touched);
    }
    if (weeksTouched.size) {
      const overtimeEmployeeIds = [...weeksTouched.keys()];
      const touchedWeeks = [...weeksTouched.values()].flatMap((w) => [...w]).sort();
      // A day of margin each side for the timezone; the week of each visit is decided below.
      const from = new Date(`${touchedWeeks[0]}T00:00:00.000Z`);
      from.setUTCDate(from.getUTCDate() - 1);
      const to = new Date(`${touchedWeeks[touchedWeeks.length - 1]}T00:00:00.000Z`);
      to.setUTCDate(to.getUTCDate() + 8);
      const [weekVisits, weekLines] = await Promise.all([
        this.prisma.visitReconciliation.findMany({
          where: {
            employeeId: { in: overtimeEmployeeIds },
            status: { in: [...PAYROLL_ELIGIBLE_RECON, VisitReconciliationStatus.LOCKED] },
            approvedPayStart: { gte: from, lt: to },
            payableMinutes: { gt: 0 },
          },
          select: { id: true, employeeId: true, approvedPayStart: true, payableMinutes: true },
        }),
        this.prisma.payrollRunLine.findMany({
          where: {
            payrollRunId: { not: run.id },
            lineType: PayrollRunLineType.OVERTIME,
            sourceType: 'OVERTIME',
            employeeId: { in: overtimeEmployeeIds },
          },
          select: {
            employeeId: true,
            sourceRef: true,
            amount: true,
            minutes: true,
            payrollRun: { select: { status: true, periodLabel: true } },
          },
        }),
      ]);
      for (const [employeeId, touched] of weeksTouched) {
        for (const weekKey of [...touched].sort()) {
          const shifts = weekVisits
            .filter(
              (v) =>
                v.employeeId === employeeId &&
                v.approvedPayStart &&
                !heldHere.has(v.id) &&
                weekKeyInTimeZone(v.approvedPayStart, timeZone) === weekKey,
            )
            .map((v) => ({ start: v.approvedPayStart!, minutes: v.payableMinutes ?? 0 }));
          if (!shifts.length) continue;
          const lastStart = shifts.reduce((a, s) => (s.start > a ? s.start : a), shifts[0].start);
          const resolved = await rulesAt(employeeId, lastStart);
          // No card applying means no overtime rule to apply. A card that could not be read is different.
          if (!resolved && !cardFailed(employeeId, lastStart)) continue;
          if (!resolved) {
            hold({
              employeeId,
              subject: `CARD:${employeeId}`,
              lineType: PayrollRunLineType.NON_VISIT_ACTIVITY,
              description: 'Not worked out: overtime premium and rolled-up holiday pay',
              reason: noCardReason(employeeId, lastStart),
            });
            continue;
          }
          const rule = cardRuleOfType(resolved.rules, 'OVERTIME');
          if (!rule || !(rule.minimumMinutes && rule.minimumMinutes > 0)) continue;
          const [week] = weeklyOvertime(shifts, rule.minimumMinutes, timeZone);
          const premium = overtimePremiumPerHour(rule, cardBaseHourlyRate(resolved.rules));
          const due =
            week && week.overtimeMinutes > 0 && premium.gt(0)
              ? payItemAmount(new Prisma.Decimal(week.overtimeMinutes).div(60), premium)
              : new Prisma.Decimal(0);

          const settled = weekLines.filter((l) => {
            const ref = weekEarningParts(l.sourceRef);
            return l.employeeId === employeeId && ref.weekKey === weekKey;
          });
          const openElsewhere = settled.find(
            (l) =>
              l.payrollRun.status !== PayrollRunStatus.LOCKED && l.payrollRun.status !== PayrollRunStatus.EXPORTED,
          );
          if (openElsewhere) {
            // Two open runs must not both pay the same hours of one week.
            if (due.gt(0)) {
              hold({
                employeeId,
                subject: `WEEK:OVERTIME:${employeeId}:${weekKey}`,
                lineType: PayrollRunLineType.OVERTIME,
                description: `Not worked out: overtime premium for the week of ${weekKey}`,
                reason: `Overtime for the week of ${weekKey} is on pay run "${openElsewhere.payrollRun.periodLabel}", which is not locked yet. Lock or recalculate that run, then recalculate this one.`,
              });
            }
            continue;
          }
          const paid = settled.reduce((sum, l) => sum.add(l.amount), new Prisma.Decimal(0));
          const paidMinutes = settled.reduce((sum, l) => sum + (l.minutes ?? 0), 0);
          const amount = due.sub(paid);
          if (amount.isZero()) continue;
          const overtimeMinutes = week?.overtimeMinutes ?? 0;
          lines.push({
            payrollRunId: run.id,
            visitReconciliationId: null,
            employeeId,
            lineType: PayrollRunLineType.OVERTIME,
            sourceType: 'OVERTIME',
            sourceRef: weekEarningRef(run.id, employeeId, weekKey, settled.length + 1),
            description:
              `Overtime premium — week of ${weekKey}: ${hours(week?.workedMinutes ?? 0)} worked, threshold ${hours(rule.minimumMinutes)}, ${hours(overtimeMinutes)} × £${premium.toFixed(2)} (base pay already in visit pay)` +
              (settled.length ? `; £${paid.toFixed(2)} of it already paid by an earlier run` : ''),
            minutes: overtimeMinutes - paidMinutes,
            unitAmount: premium,
            amount,
            payCardId: resolved.card.id,
            visitRef: null,
            exceptionMessage: null,
          });
          employeeIds.add(employeeId);
        }
      }
    }

    // 3b) Guaranteed hours top-up (WM-07 / EL-01). Only under a pay agreement that states a
    // guarantee and that the shortfall is paid, approved by a second person. The week is the
    // guarantee period: it is settled by the run in which it ends, once, from every pay-approved
    // visit of that week whichever run paid it. Base pay and top-up are never both paid for the
    // same hours: a visit approved after the top-up was paid reduces it in the next run.
    const guaranteeEmployeeIds = [
      ...new Set(
        (
          await this.prisma.employeePayAgreement.findMany({
            where: { deletedAt: null, status: { not: 'DRAFT' }, guaranteeTopUp: 'PAY_SHORTFALL' },
            select: { employeeId: true },
          })
        ).map((a) => a.employeeId),
      ),
    ];
    if (guaranteeEmployeeIds.length) {
      const isoDay = (d: Date) => d.toISOString().slice(0, 10);
      const addDays = (key: string, days: number) => {
        const d = new Date(`${key}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return isoDay(d);
      };
      // Weeks that end inside this run's period, and earlier weeks this run pays a visit of.
      const startKey = isoDay(run.periodStart);
      const endKey = isoDay(run.periodEnd);
      const weeksEnded = new Set<string>();
      for (let day = startKey; day <= endKey; day = addDays(day, 1)) {
        if (new Date(`${day}T00:00:00.000Z`).getUTCDay() === 0) weeksEnded.add(addDays(day, -6));
      }
      const weeksOf = (employeeId: string) =>
        [...new Set([...weeksEnded, ...[...(weeksTouched.get(employeeId) ?? [])].filter((w) => addDays(w, 6) <= endKey)])].sort();
      const allWeeks = [...new Set(guaranteeEmployeeIds.flatMap(weeksOf))].sort();
      if (allWeeks.length) {
        const from = new Date(`${addDays(allWeeks[0], -1)}T00:00:00.000Z`);
        const to = new Date(`${addDays(allWeeks[allWeeks.length - 1], 8)}T00:00:00.000Z`);
        const [agreementRows, employments, weekVisits, leaveItems, absences, settledLines] = await Promise.all([
          this.prisma.employeePayAgreement.findMany({
            where: { employeeId: { in: guaranteeEmployeeIds }, deletedAt: null, status: { not: 'DRAFT' } },
          }),
          this.prisma.employeeEmployment.findMany({
            where: { employeeId: { in: guaranteeEmployeeIds } },
            select: { employeeId: true, startDate: true, endDate: true },
          }),
          this.prisma.visitReconciliation.findMany({
            where: { employeeId: { in: guaranteeEmployeeIds }, approvedPayStart: { gte: from, lt: to } },
            select: { id: true, employeeId: true, approvedPayStart: true, payableMinutes: true, status: true },
          }),
          this.prisma.employeePayItem.findMany({
            where: {
              employeeId: { in: guaranteeEmployeeIds },
              wageTypeCode: { in: ['HOLIDAY_PAY', 'SICK_PAY'] },
              status: 'APPROVED',
              unit: 'HOURS',
              workDate: { gte: from, lt: to },
            },
            select: { employeeId: true, workDate: true, quantity: true },
          }),
          this.prisma.employeeAbsenceRecord.findMany({
            where: { employeeId: { in: guaranteeEmployeeIds }, fromDateTime: { lt: to }, toDateTime: { gte: from } },
            select: { employeeId: true, fromDateTime: true, toDateTime: true },
          }),
          this.prisma.payrollRunLine.findMany({
            where: {
              payrollRunId: { not: run.id },
              sourceType: GUARANTEED_HOURS_SOURCE,
              employeeId: { in: guaranteeEmployeeIds },
            },
            select: {
              employeeId: true,
              sourceRef: true,
              amount: true,
              minutes: true,
              payrollRun: { select: { status: true, periodLabel: true } },
            },
          }),
        ]);
        const visitIds = weekVisits.map((v) => v.id);
        // Travel and waiting time paid with those visits: by other runs, and by this one.
        const travelElsewhere = visitIds.length
          ? await this.prisma.payrollRunLine.findMany({
              where: {
                payrollRunId: { not: run.id },
                visitReconciliationId: { in: visitIds },
                lineType: { in: [PayrollRunLineType.TRAVEL_TIME, PayrollRunLineType.WAITING_TIME] },
                exceptionMessage: null,
              },
              select: { visitReconciliationId: true, minutes: true },
            })
          : [];
        const travelMinutes = new Map<string, number>();
        const addTravel = (visitId: string | null | undefined, minutes: number | null | undefined) => {
          if (visitId && minutes) travelMinutes.set(visitId, (travelMinutes.get(visitId) ?? 0) + minutes);
        };
        for (const l of travelElsewhere) addTravel(l.visitReconciliationId, l.minutes);
        for (const l of visitLines) {
          const type = String(l.lineType);
          if ((type === 'TRAVEL_TIME' || type === 'WAITING_TIME') && !l.exceptionMessage) {
            addTravel(l.visitReconciliationId, l.minutes);
          }
        }
        const eligible = new Set<string>([...PAYROLL_ELIGIBLE_RECON, VisitReconciliationStatus.LOCKED]);
        const undecided = new Set<string>([
          VisitReconciliationStatus.PENDING_REVIEW,
          VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
        ]);

        for (const employeeId of guaranteeEmployeeIds) {
          const agreements = agreementRows.filter((a) => a.employeeId === employeeId).map(agreementTermsOf);
          const employment = employments.find((e) => e.employeeId === employeeId);
          const absentDays = new Set<string>();
          for (const absence of absences.filter((a) => a.employeeId === employeeId)) {
            for (let t = absence.fromDateTime.getTime(); t <= absence.toDateTime.getTime(); t += 6 * 60 * 60_000) {
              absentDays.add(dayKeyInTimeZone(new Date(t), timeZone));
            }
            absentDays.add(dayKeyInTimeZone(absence.toDateTime, timeZone));
          }
          for (const weekKey of weeksOf(employeeId)) {
            const settled = settledLines.filter(
              (l) => l.employeeId === employeeId && weekEarningParts(l.sourceRef).weekKey === weekKey,
            );
            const week = guaranteeForWeek(agreements, weekKey, employment, absentDays);
            if (!week.agreement && !settled.length) continue;
            const subject = `GUARANTEE:${employeeId}:${weekKey}`;
            const holdWeek = (reason: string, blocksLock = false) =>
              hold({
                employeeId,
                subject: blocksLock ? `WEEK:${subject}` : subject,
                lineType: 'GUARANTEED_HOURS' as PayrollRunLineType,
                description: `Not worked out: guaranteed hours top-up for the week of ${weekKey}`,
                reason,
              });
            const inWeek = weekVisits.filter(
              (v) =>
                v.employeeId === employeeId &&
                v.approvedPayStart &&
                weekKeyInTimeZone(v.approvedPayStart, timeZone) === weekKey,
            );
            const notDecided = inWeek.filter((v) => undecided.has(v.status)).length;
            if (notDecided) {
              holdWeek(
                `${notDecided} visit(s) of that week are not yet approved or rejected for pay, so the hours worked are not known. Decide them, then recalculate.`,
              );
              continue;
            }
            const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekKey, i));
            const absentInWeek = weekDays.filter((d) => absentDays.has(d)).length;
            const treatment = week.agreement?.guaranteeLeaveTreatment ?? null;
            if (absentInWeek && week.agreement && !treatment) {
              holdWeek(
                `An absence is recorded on ${absentInWeek} day(s) of that week and the pay agreement does not say how absence affects the guarantee. Nothing is paid automatically: if a top-up is due, enter it as a pay item.`,
              );
              continue;
            }
            // Only work on the days the guarantee was in force counts towards it.
            const inForce = new Set(week.dayKeysInForce);
            const worked = inWeek.filter(
              (v) => eligible.has(v.status) && inForce.has(dayKeyInTimeZone(v.approvedPayStart!, timeZone)),
            );
            const visitMinutes = worked.reduce((sum, v) => sum + (v.payableMinutes ?? 0), 0);
            const travel =
              week.agreement?.guaranteeQualifyingTime === 'VISITS_AND_TRAVEL'
                ? worked.reduce((sum, v) => sum + (travelMinutes.get(v.id) ?? 0), 0)
                : 0;
            const leaveMinutes =
              treatment === 'COUNT_PAID_LEAVE_HOURS'
                ? Math.round(
                    leaveItems
                      .filter((i) => i.employeeId === employeeId && inForce.has(isoDay(i.workDate)))
                      .reduce((sum, i) => sum + Number(i.quantity ?? 0), 0) * 60,
                  )
                : 0;
            const qualifying = visitMinutes + travel + leaveMinutes;
            const shortfall = Math.max(0, week.guaranteedMinutes - qualifying);

            const openElsewhere = settled.find(
              (l) =>
                l.payrollRun.status !== PayrollRunStatus.LOCKED && l.payrollRun.status !== PayrollRunStatus.EXPORTED,
            );
            if (openElsewhere) {
              holdWeek(
                `The guaranteed hours of the week of ${weekKey} are on pay run "${openElsewhere.payrollRun.periodLabel}", which is not locked yet. Lock or recalculate that run, then recalculate this one.`,
                true,
              );
              continue;
            }
            const paid = settled.reduce((sum, l) => sum.add(l.amount), new Prisma.Decimal(0));
            const paidMinutes = settled.reduce((sum, l) => sum + (l.minutes ?? 0), 0);
            if (shortfall === 0 && paid.isZero()) continue;

            const weekEnd = new Date(`${addDays(weekKey, 6)}T12:00:00.000Z`);
            const resolved = await rulesAt(employeeId, weekEnd);
            const baseRate = resolved ? cardBaseHourlyRate(resolved.rules) : 0;
            if (!(baseRate > 0)) {
              holdWeek(
                resolved
                  ? `Pay card ${resolved.card.name} has no hourly rate to pay the guaranteed hours at.`
                  : noCardReason(employeeId, weekEnd),
              );
              continue;
            }
            const due = payItemAmount(new Prisma.Decimal(shortfall).div(60), baseRate);
            const amount = due.sub(paid);
            if (amount.isZero()) continue;
            const counted = [
              `${hours(visitMinutes)} visits`,
              ...(travel ? [`${hours(travel)} travel and waiting`] : []),
              ...(leaveMinutes ? [`${hours(leaveMinutes)} paid leave`] : []),
            ].join(', ');
            lines.push({
              payrollRunId: run.id,
              visitReconciliationId: null,
              employeeId,
              lineType: 'GUARANTEED_HOURS' as PayrollRunLineType,
              sourceType: GUARANTEED_HOURS_SOURCE,
              sourceRef: weekEarningRef(run.id, employeeId, weekKey, settled.length + 1),
              description:
                `Guaranteed hours top-up — week of ${weekKey}: ${hours(week.guaranteedMinutes)} guaranteed` +
                (week.daysInForce < 7 ? ` (${week.daysInForce} of 7 days)` : '') +
                (week.daysReducedForAbsence ? `, reduced for ${week.daysReducedForAbsence} day(s) of absence` : '') +
                `, ${counted} counted, ${hours(shortfall)} short × £${baseRate.toFixed(2)}` +
                (settled.length ? `; £${paid.toFixed(2)} already paid by an earlier run` : ''),
              minutes: shortfall - paidMinutes,
              unitAmount: new Prisma.Decimal(baseRate),
              amount,
              payCardId: resolved!.card.id,
              visitRef: null,
              exceptionMessage: null,
            });
            employeeIds.add(employeeId);
          }
        }
      }
    }

    // 4) Rolled-up holiday pay
    const workedTypes = new Set<string>([
      PayrollRunLineType.VISIT_PAY,
      PayrollRunLineType.TRAVEL_TIME,
      'WAITING_TIME',
      PayrollRunLineType.OVERTIME,
      PayrollRunLineType.NON_VISIT_ACTIVITY,
    ]);
    const workedPay = new Map<string, Prisma.Decimal>();
    for (const line of [...visitLines, ...lines]) {
      if (!line.employeeId || line.exceptionMessage || !workedTypes.has(String(line.lineType))) continue;
      workedPay.set(line.employeeId, (workedPay.get(line.employeeId) ?? new Prisma.Decimal(0)).add(line.amount as Prisma.Decimal.Value));
    }
    for (const [employeeId, pay] of workedPay) {
      if (pay.lte(0)) continue;
      const resolved = await rulesAt(employeeId, run.periodEnd);
      if (!resolved && !cardFailed(employeeId, run.periodEnd)) continue;
      if (!resolved) {
        hold({
          employeeId,
          subject: `CARD:${employeeId}`,
          lineType: PayrollRunLineType.NON_VISIT_ACTIVITY,
          description: 'Not worked out: overtime premium and rolled-up holiday pay',
          reason: noCardReason(employeeId, run.periodEnd),
        });
        continue;
      }
      if ((resolved.card as { holidayPayMethod?: string | null }).holidayPayMethod !== 'ROLLED_UP_12_07') continue;
      // Q35: rolled-up holiday pay is lawful only for a worker with irregular hours or who works
      // part of the year. The card says how the pay is worked out; the employee's own leave terms
      // say whether it may be used for them. It is not applied to everyone on the card by default.
      const leaveTerms = await this.prisma.employeeLeaveTerms.findFirst({
        where: {
          employeeId,
          status: { in: ['ACTIVE', 'SUPERSEDED'] },
          effectiveFrom: { lte: run.periodEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.periodEnd } }],
        },
        orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }],
        select: { workerCategory: true, payMethod: true },
      });
      if (leaveTerms && (!rolledUpAllowedFor(leaveTerms.workerCategory) || leaveTerms.payMethod !== 'ROLLED_UP_12_07')) {
        hold({
          employeeId,
          subject: `HOLIDAY:${employeeId}`,
          lineType: PayrollRunLineType.HOLIDAY_PAY,
          description: 'Not paid: rolled-up holiday pay',
          reason: rolledUpAllowedFor(leaveTerms.workerCategory)
            ? `Pay card ${resolved.card.name} adds rolled-up holiday pay, but this employee's leave terms say holiday is paid when it is taken. Correct the card or the leave terms.`
            : `Pay card ${resolved.card.name} adds rolled-up holiday pay, but this employee's leave terms record regular hours: rolled-up holiday pay cannot be used for them. Their holiday is paid when it is taken.`,
        });
        continue;
      }
      const eligibilityNote = leaveTerms
        ? ''
        : ' (no leave terms recorded for this employee: whether rolled-up holiday pay may be used for them is not verified)';
      lines.push({
        payrollRunId: run.id,
        visitReconciliationId: null,
        employeeId,
        lineType: PayrollRunLineType.HOLIDAY_PAY,
        sourceType: 'HOLIDAY_ROLLED_UP',
        sourceRef: `${run.id}:${employeeId}`,
        description: `Rolled-up holiday pay — 12.07% of £${roundPence(pay).toFixed(2)} worked pay${eligibilityNote}`,
        minutes: null,
        unitAmount: null,
        amount: rolledUpHolidayPay(pay),
        payCardId: resolved!.card.id,
        visitRef: null,
        exceptionMessage: null,
      });
    }

    return { lines, employeeIds, problemCount };
  }

  async approve(userId: string, id: string, meta?: RequestAuditMeta) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (
      run.status !== PayrollRunStatus.READY_FOR_REVIEW &&
      run.status !== PayrollRunStatus.EXCEPTION_FOUND
    ) {
      throw new BadRequestException('Only runs ready for review can be approved');
    }
    assertDifferentUser(
      run.createdById,
      userId,
      'A payroll run must be approved by a different user from the one who created it.',
    );

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.payrollRun.updateMany({
        where: { id, status: run.status },
        data: { status: PayrollRunStatus.APPROVED, approvedAt: new Date(), approvedById: userId },
      });
      if (changed.count !== 1) {
        throw new ConflictException('This payroll run was changed by someone else. Reload and try again.');
      }
      await this.auditRun(
        AuditAction.VISIT_PAY_RUN_APPROVED,
        userId,
        id,
        {
          oldValues: { status: run.status },
          newValues: { status: PayrollRunStatus.APPROVED, grossPay: run.grossPay.toString() },
        },
        meta,
        tx,
      );
    });
    return this.getById(id);
  }

  /** Remove a run that has not been locked. Its lines go with it, which releases their claims. */
  async discard(userId: string, id: string, meta?: RequestAuditMeta) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (!CALCULABLE_STATUSES.includes(run.status)) {
      throw new BadRequestException('Only a payroll run that has not been locked can be discarded');
    }
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.payrollRun.deleteMany({ where: { id, status: run.status } });
      if (removed.count !== 1) {
        throw new ConflictException('This payroll run was changed by someone else. Reload and try again.');
      }
      await this.auditRun(
        AuditAction.VISIT_PAY_RUN_DISCARDED,
        userId,
        id,
        {
          oldValues: {
            status: run.status,
            periodStart: run.periodStart.toISOString().slice(0, 10),
            periodEnd: run.periodEnd.toISOString().slice(0, 10),
            grossPay: run.grossPay.toString(),
          },
        },
        meta,
        tx,
      );
    });
    return { message: 'Payroll run discarded', data: { id } };
  }

  /**
   * Lock an approved run. From here its lines and the pay of its visits are history: the service
   * and the database both refuse changes, and corrections go through pay corrections instead.
   */
  async lock(userId: string, id: string, meta?: RequestAuditMeta) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        lines: {
          select: {
            visitReconciliationId: true,
            employeePayItemId: true,
            sourceType: true,
            sourceRef: true,
            lineType: true,
            amount: true,
            employeeId: true,
            claimKey: true,
            exceptionMessage: true,
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.APPROVED) {
      throw new BadRequestException('Approve the payroll run before locking');
    }

    // Visits whose line is held (it could not be paid) are not settled by this run.
    const reconIds = [
      ...new Set(
        run.lines
          .filter((l) => l.sourceType !== HELD_EARNING_SOURCE)
          .map((l) => l.visitReconciliationId)
          .filter((v): v is string => !!v),
      ),
    ];

    // R-22: overtime premium and rolled-up holiday pay are worked out from this run's own lines.
    // If they could not be worked out for a carer, locking would lose them for good.
    const heldSubjects = run.lines
      .filter((l) => l.sourceType === HELD_EARNING_SOURCE)
      .map((l) => heldEarningSubject(l.sourceRef ?? ''));
    // WM-18: earnings of a week that another open run is settling would be skipped by locking now.
    const weekHeld = heldSubjects.filter((subject) => subject.startsWith('WEEK:'));
    if (weekHeld.length) {
      throw new BadRequestException(
        `${weekHeld.length} earning(s) of this run are waiting for another pay run that covers part of the same week or pay reference period. Lock or recalculate that run, then recalculate this one before locking.`,
      );
    }
    const lostIfLocked = run.lines.filter(
      (l) => l.sourceType === HELD_EARNING_SOURCE && heldEarningSubject(l.sourceRef ?? '').startsWith('CARD:'),
    );
    if (lostIfLocked.length) {
      throw new BadRequestException(
        `Overtime premium and rolled-up holiday pay could not be worked out for ${lostIfLocked.length} carer(s) because their pay card could not be read. Resolve the reason shown on the run and recalculate before locking.`,
      );
    }

    // Lines written before claims existed hold no claim: they must be recalculated first.
    const unclaimed = run.lines.filter(
      (l) => !l.claimKey && payrollLineClaimKey({ ...l, lineType: String(l.lineType) }) != null,
    );
    if (unclaimed.length) {
      throw new BadRequestException(
        `${unclaimed.length} line(s) in this run were calculated before duplicate-payment protection was added. Recalculate this run first.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.payrollRun.updateMany({
        where: { id, status: PayrollRunStatus.APPROVED },
        data: {
          status: PayrollRunStatus.LOCKED,
          lockedAt: new Date(),
          approvedById: run.approvedById ?? userId,
        },
      });
      if (locked.count !== 1) {
        throw new ConflictException('This payroll run was changed by someone else. Reload and try again.');
      }
      if (reconIds.length) {
        // The figures being locked must still be the approved figures of each visit.
        const visits = await tx.visitReconciliation.findMany({
          where: { id: { in: reconIds } },
          select: {
            id: true,
            status: true,
            employeeId: true,
            payableAmount: true,
            includedInPayrollRunId: true,
            paidByUkPayrollRunId: true,
          },
        });
        const visitById = new Map(visits.map((v) => [v.id, v]));
        const stale = run.lines.filter((l) => {
          if (l.lineType !== PayrollRunLineType.VISIT_PAY || !l.visitReconciliationId) return false;
          if (l.sourceType === HELD_EARNING_SOURCE) return false; // held: not settled by this run
          const visit = visitById.get(l.visitReconciliationId);
          if (!visit) return true;
          if (visit.includedInPayrollRunId || visit.paidByUkPayrollRunId) return true;
          if (l.exceptionMessage) return false;
          return (
            !PAYROLL_ELIGIBLE_RECON.includes(visit.status) ||
            visit.employeeId !== l.employeeId ||
            visit.payableAmount == null ||
            !new Prisma.Decimal(visit.payableAmount).equals(l.amount)
          );
        });
        if (stale.length) {
          throw new BadRequestException(
            `${stale.length} visit(s) changed since this run was calculated (amount, carer, approval or already paid). Recalculate the run and approve it again.`,
          );
        }
        const claimed = await tx.visitReconciliation.updateMany({
          where: { id: { in: reconIds }, includedInPayrollRunId: null, paidByUkPayrollRunId: null },
          data: { includedInPayrollRunId: id, lockedAt: new Date() },
        });
        if (claimed.count !== reconIds.length) {
          throw new ConflictException(
            'Some visits in this run were paid by another run in the meantime. Recalculate this run first.',
          );
        }
      }
      // Freeze pay items with this run; refuse if another locked run already paid any of them.
      const payItemIds = run.lines.map((l) => l.employeePayItemId).filter((v): v is string => !!v);
      if (payItemIds.length) {
        const alreadyPaid = await tx.employeePayItem.count({
          where: { id: { in: payItemIds }, includedInPayrollRunId: { not: null } },
        });
        if (alreadyPaid) {
          throw new BadRequestException(
            'Some pay items in this run were already paid by another locked run. Recalculate this run first.',
          );
        }
        await tx.employeePayItem.updateMany({
          where: { id: { in: payItemIds } },
          data: { includedInPayrollRunId: id },
        });
      }
      const activityRefs = run.lines
        .filter((l) => l.sourceType === 'NON_CORE_ACTIVITY' && l.sourceRef)
        .map((l) => l.sourceRef!) ;
      if (activityRefs.length) {
        const paidElsewhere = await tx.payrollRunLine.count({
          where: {
            sourceType: 'NON_CORE_ACTIVITY',
            sourceRef: { in: activityRefs },
            payrollRunId: { not: id },
            payrollRun: { status: { in: [PayrollRunStatus.LOCKED, PayrollRunStatus.EXPORTED] } },
          },
        });
        if (paidElsewhere) {
          throw new BadRequestException(
            'Some training / on-call activity in this run was already paid by another locked run. Recalculate this run first.',
          );
        }
      }
      await this.auditRun(
        AuditAction.VISIT_PAY_RUN_LOCKED,
        userId,
        id,
        {
          oldValues: { status: PayrollRunStatus.APPROVED },
          newValues: {
            status: PayrollRunStatus.LOCKED,
            grossPay: run.grossPay.toString(),
            visits: reconIds.length,
            lines: run.lines.length,
          },
        },
        meta,
        tx,
      );
    });

    return this.getById(id);
  }

  async getExportCsv(id: string) {
    const row = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Payroll run not found');
    if (
      row.status !== PayrollRunStatus.LOCKED &&
      row.status !== PayrollRunStatus.EXPORTED
    ) {
      throw new BadRequestException(
        'Only locked or exported payroll runs can be downloaded',
      );
    }

    const visitRows = await this.loadVisitExportRows(id);
    const csv = buildPayrollRunVisitLogCsv(visitRows);
    return {
      csv,
      filename: payrollRunExportFilename(
        row.periodStart.toISOString().slice(0, 10),
        row.periodEnd.toISOString().slice(0, 10),
      ),
    };
  }

  async exportAndMark(id: string, userId?: string, meta?: RequestAuditMeta) {
    const row = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Payroll run not found');
    if (row.status === PayrollRunStatus.EXPORTED) {
      throw new BadRequestException('Payroll run has already been exported');
    }
    if (row.status !== PayrollRunStatus.LOCKED) {
      throw new BadRequestException('Approve and lock the payroll run before exporting');
    }

    const exportedAt = new Date();

    await this.prisma.payrollRun.update({
      where: { id },
      data: { status: PayrollRunStatus.EXPORTED, exportedAt },
    });
    await this.auditRun(
      AuditAction.VISIT_PAY_RUN_EXPORTED,
      userId ?? null,
      id,
      {
        oldValues: { status: PayrollRunStatus.LOCKED },
        newValues: { status: PayrollRunStatus.EXPORTED, grossPay: row.grossPay.toString() },
      },
      meta,
    );

    const visitRows = await this.loadVisitExportRows(id);
    const csv = buildPayrollRunVisitLogCsv(visitRows);
    return {
      csv,
      filename: payrollRunExportFilename(
        row.periodStart.toISOString().slice(0, 10),
        row.periodEnd.toISOString().slice(0, 10),
      ),
    };
  }

  private async loadVisitExportRows(payrollRunId: string): Promise<PayrollVisitExportRow[]> {
    const allLines = await this.prisma.payrollRunLine.findMany({
      where: { payrollRunId },
      include: { visitReconciliation: true },
      orderBy: [{ visitRef: 'asc' }],
      take: 5000,
    });
    // Rows are per visit; non-visit earnings (pay items, overtime…) still count in each carer's totals.
    const lines = allLines.filter(
      (line): line is typeof line & { visitReconciliation: NonNullable<typeof line.visitReconciliation> } =>
        line.visitReconciliation != null,
    );

    if (!lines.length) return [];

    const employeeIds = [
      ...new Set(
        lines
          .map((line) => line.employeeId ?? line.visitReconciliation.employeeId)
          .filter(Boolean),
      ),
    ] as string[];
    const serviceUserIds = [
      ...new Set(lines.map((line) => line.visitReconciliation.serviceUserId)),
    ];

    const [employees, serviceUsers] = await Promise.all([
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: {
              id: true,
              personalDetail: {
                select: {
                  firstName: true,
                  lastName: true,
                  addressLine1: true,
                  addressLine2: true,
                  postcode: true,
                },
              },
              employment: {
                select: {
                  employeeNumber: true,
                  payrollNumber: true,
                },
              },
            },
          })
        : [],
      this.prisma.serviceUser.findMany({
        where: { id: { in: serviceUserIds } },
        select: {
          id: true,
          careType: { select: { code: true } },
        },
      }),
    ]);

    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
    const serviceUserMap = new Map(serviceUsers.map((su) => [su.id, su]));

    const carerTotals = new Map<string, { minutes: number; pay: number }>();
    for (const line of allLines) {
      const employeeId = line.employeeId ?? line.visitReconciliation?.employeeId;
      if (!employeeId) continue;
      const minutes = exportLineMinutes(line);
      const pay = Number(line.amount);
      const existing = carerTotals.get(employeeId);
      if (existing) {
        existing.minutes += minutes;
        existing.pay += pay;
      } else {
        carerTotals.set(employeeId, { minutes, pay });
      }
    }

    const sorted = [...lines].sort((a, b) => {
      const employeeIdA = a.employeeId ?? a.visitReconciliation.employeeId ?? '';
      const employeeIdB = b.employeeId ?? b.visitReconciliation.employeeId ?? '';
      const employeeA = employeeMap.get(employeeIdA);
      const employeeB = employeeMap.get(employeeIdB);
      const nameA = [
        employeeA?.personalDetail?.lastName,
        employeeA?.personalDetail?.firstName,
      ]
        .filter(Boolean)
        .join(' ');
      const nameB = [
        employeeB?.personalDetail?.lastName,
        employeeB?.personalDetail?.firstName,
      ]
        .filter(Boolean)
        .join(' ');
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return (
        a.visitReconciliation.plannedStartDateTime.getTime() -
        b.visitReconciliation.plannedStartDateTime.getTime()
      );
    });

    return sorted.map((line) => {
      const recon = line.visitReconciliation;
      const employeeId = line.employeeId ?? recon.employeeId;
      const employee = employeeId ? employeeMap.get(employeeId) : undefined;
      const su = serviceUserMap.get(recon.serviceUserId);
      const emonitored = resolveEmonitored(
        recon.actualStartDateTime,
        recon.actualEndDateTime,
      );
      const visitMinutes = exportLineMinutes(line);
      const visitPay = Number(line.amount);
      const totals = employeeId ? carerTotals.get(employeeId) : undefined;

      return {
        emonitored,
        carerId: resolveCarerId({
          payrollNumber: employee?.employment?.payrollNumber,
          employeeNumber: employee?.employment?.employeeNumber,
        }),
        carerFirstName: employee?.personalDetail?.firstName ?? '',
        carerSecondName: employee?.personalDetail?.lastName ?? '',
        carerAddress: resolveCarerAddress({
          addressLine1: employee?.personalDetail?.addressLine1,
          addressLine2: employee?.personalDetail?.addressLine2,
        }),
        carerPostCode: employee?.personalDetail?.postcode ?? '',
        visitDate: formatVisitDateMmDdYy(recon.plannedStartDateTime),
        careType: resolveCareTypeExportCode(su?.careType?.code),
        plannedArrival: formatTimeHhMmSs(recon.plannedStartDateTime),
        plannedDeparture: formatTimeHhMmSsOrZero(recon.plannedEndDateTime),
        actualArrival:
          emonitored === 'LOGGED'
            ? formatTimeHhMmSs(recon.actualStartDateTime!)
            : '00:00:00',
        actualDeparture:
          emonitored === 'LOGGED'
            ? formatTimeHhMmSs(recon.actualEndDateTime!)
            : '00:00:00',
        visitHours: minutesToDecimalHours(visitMinutes),
        visitPay: formatPayAmount(visitPay),
        totalHoursWorked: minutesToDecimalHours(totals?.minutes ?? 0),
        grossPay: formatPayAmount(totals?.pay ?? 0),
      };
    });
  }

  /**
   * Employee earnings summary for the HR profile Earnings tab.
   * Paid = included in a LOCKED/EXPORTED payroll run.
   * Remaining = approved for pay but not yet in a locked payroll run.
   */
  /**
   * Org-wide salary overview for a period (visit pay, paid, rejected, fines, penalties, net).
   */
  async listEmployeeSalaries(query: EmployeeEarningsQueryDto) {
    const plannedDateFilter = await this.operationalVisitDateFilter(
      query.dateFrom,
      query.dateTo,
    );

    const paidStatuses: PayrollRunStatus[] = [
      PayrollRunStatus.LOCKED,
      PayrollRunStatus.EXPORTED,
    ];

    const dateOnVisit: Prisma.VisitReconciliationWhereInput = plannedDateFilter
      ? { plannedStartDateTime: plannedDateFilter }
      : {};

    const scopedLocationId = query.locationId?.trim() || undefined;
    let locationEmployeeFilter: Prisma.StringFilter | undefined;
    if (scopedLocationId) {
      const locationEmployeeIds = await employeeIdsForLocation(
        this.prisma,
        scopedLocationId,
      );
      if (!locationEmployeeIds.length) {
        return {
          data: {
            dateFrom: query.dateFrom ?? null,
            dateTo: query.dateTo ?? null,
            periodKey: derivePeriodKeyFromRange(query.dateFrom, query.dateTo),
            hasEligibleUkRun: false,
            currency: 'GBP',
            employeeCount: 0,
            rows: [],
          },
        };
      }
      locationEmployeeFilter = { in: locationEmployeeIds };
    }

    // Visits already enrolled in a UK payroll run are not "remaining" (same as
    // getEmployeeEarnings) — bank payout / UK net tracks those separately.
    const ukCoveredInputs = await this.prisma.ukPayrollInputLine.findMany({
      where: { sourceVisitReconciliationId: { not: null }, run: { status: { not: 'CANCELLED' } } },
      select: { sourceVisitReconciliationId: true },
      distinct: ['sourceVisitReconciliationId'],
    });
    const ukCoveredReconIds = ukCoveredInputs
      .map((l) => l.sourceVisitReconciliationId)
      .filter((id): id is string => Boolean(id));

    const remainingWhere: Prisma.VisitReconciliationWhereInput = {
      ...earningsRemainingWhere(dateOnVisit),
      ...(locationEmployeeFilter ? { employeeId: locationEmployeeFilter } : {}),
      ...(ukCoveredReconIds.length
        ? { id: { notIn: ukCoveredReconIds } }
        : {}),
    };

    const [
      salaryGroups,
      paidGroups,
      remainingGroups,
      rejectedGroups,
      pendingGroups,
    ] = await Promise.all([
      this.prisma.visitReconciliation.groupBy({
        by: ['employeeId'],
        where: {
          ...dateOnVisit,
          ...(locationEmployeeFilter ? { employeeId: locationEmployeeFilter } : {}),
          OR: [
            { includedInPayrollRunId: { not: null } },
            { status: { in: PAYROLL_ELIGIBLE_RECON } },
            { status: VisitReconciliationStatus.LOCKED },
            {
              status: { in: PRICED_PENDING_RECON },
              payableAmount: { not: null },
            },
          ],
        },
        _sum: { payableAmount: true },
        _count: { _all: true },
      }),
      this.prisma.payrollRunLine.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: locationEmployeeFilter ?? { not: null },
          payrollRun: { status: { in: paidStatuses } },
          ...(plannedDateFilter
            ? { visitReconciliation: { plannedStartDateTime: plannedDateFilter } }
            : {}),
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.visitReconciliation.groupBy({
        by: ['employeeId'],
        where: remainingWhere,
        _sum: { payableAmount: true },
        _count: { _all: true },
      }),
      this.prisma.visitReconciliation.groupBy({
        by: ['employeeId'],
        where: {
          ...dateOnVisit,
          ...(locationEmployeeFilter ? { employeeId: locationEmployeeFilter } : {}),
          status: VisitReconciliationStatus.REJECTED_FOR_PAY,
        },
        _sum: { payableAmount: true },
        _count: { _all: true },
      }),
      this.prisma.visitReconciliation.groupBy({
        by: ['employeeId'],
        where: {
          ...dateOnVisit,
          ...(locationEmployeeFilter ? { employeeId: locationEmployeeFilter } : {}),
          includedInPayrollRunId: null,
          status: {
            in: [
              VisitReconciliationStatus.PENDING_REVIEW,
              VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
            ],
          },
        },
        _count: { _all: true },
      }),
    ]);

    // Settled by a closed UK run directly (no visit pay run): counted with the locked earnings.
    const ukSettledGroups = await this.prisma.visitReconciliation.groupBy({
      by: ['employeeId'],
      where: {
        ...dateOnVisit,
        ...(locationEmployeeFilter ? { employeeId: locationEmployeeFilter } : {}),
        includedInPayrollRunId: null,
        paidByUkPayrollRunId: { not: null },
      },
      _sum: { payableAmount: true },
      _count: { _all: true },
    });

    const salaryMonths = salaryMonthsForEarningsQuery(query.dateFrom, query.dateTo);
    const deductions = await this.prisma.employeeSalaryDeduction.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(locationEmployeeFilter ? { employeeId: locationEmployeeFilter } : {}),
        ...(salaryMonths ? { salaryMonth: { in: salaryMonths } } : {}),
      },
      select: {
        employeeId: true,
        type: true,
        amount: true,
      },
    });

    type Acc = {
      salaryAmount: number;
      salaryVisitCount: number;
      paidAmount: number;
      paidLineCount: number;
      remainingAmount: number;
      remainingVisitCount: number;
      rejectedAmount: number;
      rejectedVisitCount: number;
      pendingReviewCount: number;
      fineTotal: number;
      penaltyTotal: number;
    };

    const byEmployee = new Map<string, Acc>();
    const ensure = (id: string): Acc => {
      let row = byEmployee.get(id);
      if (!row) {
        row = {
          salaryAmount: 0,
          salaryVisitCount: 0,
          paidAmount: 0,
          paidLineCount: 0,
          remainingAmount: 0,
          remainingVisitCount: 0,
          rejectedAmount: 0,
          rejectedVisitCount: 0,
          pendingReviewCount: 0,
          fineTotal: 0,
          penaltyTotal: 0,
        };
        byEmployee.set(id, row);
      }
      return row;
    };

    for (const g of salaryGroups) {
      if (!g.employeeId) continue;
      const row = ensure(g.employeeId);
      row.salaryAmount = Number(g._sum.payableAmount ?? 0);
      row.salaryVisitCount = g._count._all;
    }
    for (const g of paidGroups) {
      if (!g.employeeId) continue;
      const row = ensure(g.employeeId);
      row.paidAmount = Number(g._sum.amount ?? 0);
      row.paidLineCount = g._count._all;
    }
    for (const g of ukSettledGroups) {
      if (!g.employeeId) continue;
      const row = ensure(g.employeeId);
      row.paidAmount += Number(g._sum.payableAmount ?? 0);
      row.paidLineCount += g._count._all;
    }
    for (const g of remainingGroups) {
      if (!g.employeeId) continue;
      const row = ensure(g.employeeId);
      row.remainingAmount = Number(g._sum.payableAmount ?? 0);
      row.remainingVisitCount = g._count._all;
    }
    for (const g of rejectedGroups) {
      if (!g.employeeId) continue;
      const row = ensure(g.employeeId);
      row.rejectedAmount = Number(g._sum.payableAmount ?? 0);
      row.rejectedVisitCount = g._count._all;
    }
    for (const g of pendingGroups) {
      if (!g.employeeId) continue;
      const row = ensure(g.employeeId);
      row.pendingReviewCount = g._count._all;
    }
    for (const d of deductions) {
      const row = ensure(d.employeeId);
      const amount = Number(d.amount);
      if (d.type === SalaryDeductionType.FINE) row.fineTotal += amount;
      else row.penaltyTotal += amount;
    }

    const employeeIds = [...byEmployee.keys()];
    const employees = employeeIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: employeeIds }, deletedAt: null },
          select: {
            id: true,
            isActive: true,
            personalDetail: { select: { firstName: true, lastName: true } },
            employment: { select: { employeeNumber: true } },
          },
        })
      : [];

    const empMeta = new Map(
      employees.map((e) => {
        const name =
          [e.personalDetail?.firstName, e.personalDetail?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || 'Unknown';
        return [
          e.id,
          {
            name,
            employeeNumber: e.employment?.employeeNumber ?? null,
            isActive: e.isActive,
          },
        ] as const;
      }),
    );

    const periodKey = derivePeriodKeyFromRange(query.dateFrom, query.dateTo);
    const {
      ukNetByEmployee,
      paidOutByEmployee,
      committedByEmployee,
      hasEligibleUkRun,
    } = await this.employeePayouts.ukNetAndPaidOutForDateRange(
      query.dateFrom,
      query.dateTo,
    );

    const round2 = (n: number) => Math.round(n * 100) / 100;

    const rows = employeeIds
      .map((id) => {
        const meta = empMeta.get(id);
        if (!meta) return null;
        const a = byEmployee.get(id)!;
        const fineTotal = round2(a.fineTotal);
        const penaltyTotal = round2(a.penaltyTotal);
        const deductionsTotal = round2(fineTotal + penaltyTotal);
        const salaryAmount = round2(a.salaryAmount);
        const netSalary = round2(salaryAmount - deductionsTotal);
        const paidAmount = round2(a.paidAmount);
        const remainingAmount = round2(a.remainingAmount);
        const rejectedAmount = round2(a.rejectedAmount);
        const ukNetPay = round2(ukNetByEmployee.get(id) ?? 0);
        const paidOutAmount = round2(paidOutByEmployee.get(id) ?? 0);
        const committed = round2(committedByEmployee.get(id) ?? 0);
        const outstandingPayoutAmount = hasEligibleUkRun
          ? round2(Math.max(0, ukNetPay - committed))
          : 0;
        return {
          employeeId: id,
          employeeName: meta.name,
          employeeNumber: meta.employeeNumber,
          isActive: meta.isActive,
          salaryAmount: formatMoney(salaryAmount),
          salaryAmountValue: salaryAmount,
          salaryVisitCount: a.salaryVisitCount,
          paidAmount: formatMoney(paidAmount),
          paidAmountValue: paidAmount,
          paidLineCount: a.paidLineCount,
          remainingAmount: formatMoney(remainingAmount),
          remainingAmountValue: remainingAmount,
          remainingVisitCount: a.remainingVisitCount,
          rejectedAmount: formatMoney(rejectedAmount),
          rejectedAmountValue: rejectedAmount,
          rejectedVisitCount: a.rejectedVisitCount,
          pendingReviewCount: a.pendingReviewCount,
          fineTotal: formatMoney(fineTotal),
          fineTotalValue: fineTotal,
          penaltyTotal: formatMoney(penaltyTotal),
          penaltyTotalValue: penaltyTotal,
          deductionsTotal: formatMoney(deductionsTotal),
          deductionsTotalValue: deductionsTotal,
          netSalaryAmount: formatMoney(netSalary),
          netSalaryAmountValue: netSalary,
          ukNetPayAmount: formatMoney(ukNetPay),
          ukNetPayAmountValue: ukNetPay,
          hasEligibleUkRun,
          paidOutAmount: formatMoney(paidOutAmount),
          paidOutAmountValue: paidOutAmount,
          outstandingPayoutAmount: formatMoney(outstandingPayoutAmount),
          outstandingPayoutAmountValue: outstandingPayoutAmount,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    return {
      data: {
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        periodKey,
        hasEligibleUkRun,
        currency: 'GBP',
        employeeCount: rows.length,
        rows,
      },
    };
  }

  async getEmployeeEarnings(employeeId: string, query: EmployeeEarningsQueryDto) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const timeZone = await this.orgSettings.getOperationalTimezone();
    const plannedDateFilter = await this.operationalVisitDateFilter(
      query.dateFrom,
      query.dateTo,
    );

    const visitDateWhere: Prisma.VisitReconciliationWhereInput = {
      employeeId,
      ...(plannedDateFilter ? { plannedStartDateTime: plannedDateFilter } : {}),
    };

    const paidStatuses: PayrollRunStatus[] = [
      PayrollRunStatus.LOCKED,
      PayrollRunStatus.EXPORTED,
    ];

    const paidLineWhere: Prisma.PayrollRunLineWhereInput = {
      employeeId,
      payrollRun: { status: { in: paidStatuses } },
      ...(plannedDateFilter
        ? { visitReconciliation: { plannedStartDateTime: plannedDateFilter } }
        : {}),
    };

    const remainingWhereBase = earningsRemainingWhere(visitDateWhere);

    const ukInputsForEmployee = await this.prisma.ukPayrollInputLine.findMany({
      where: {
        employeeId,
        sourceVisitReconciliationId: { not: null },
        // A cancelled run has released its earnings; its lines are kept only as a snapshot.
        run: { status: { not: 'CANCELLED' } },
      },
      select: {
        sourceVisitReconciliationId: true,
        runEmployeeId: true,
        runId: true,
        run: { select: { id: true, label: true, status: true } },
      },
    });
    const ukCoveredReconIds = [
      ...new Set(
        ukInputsForEmployee
          .map((l) => l.sourceVisitReconciliationId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const remainingWhere: Prisma.VisitReconciliationWhereInput = {
      ...remainingWhereBase,
      ...(ukCoveredReconIds.length ? { id: { notIn: ukCoveredReconIds } } : {}),
    };

    const pendingWhere: Prisma.VisitReconciliationWhereInput = {
      ...visitDateWhere,
      includedInPayrollRunId: null,
      status: {
        in: PRICED_PENDING_RECON,
      },
      payableAmount: null,
    };

    const [
      paidAggregate,
      paidVisitGroups,
      remainingAmountAgg,
      remainingVisitCount,
      pendingCount,
      visitRows,
    ] = await Promise.all([
      this.prisma.payrollRunLine.aggregate({
        where: paidLineWhere,
        _sum: { amount: true },
      }),
      this.prisma.payrollRunLine.groupBy({
        by: ['visitReconciliationId'],
        where: {
          ...paidLineWhere,
          lineType: PayrollRunLineType.VISIT_PAY,
        },
      }),
      this.prisma.visitReconciliation.aggregate({
        where: remainingWhere,
        _sum: { payableAmount: true },
      }),
      this.prisma.visitReconciliation.count({ where: remainingWhere }),
      this.prisma.visitReconciliation.count({ where: pendingWhere }),
      this.prisma.visitReconciliation.findMany({
        where: {
          employeeId,
          ...(plannedDateFilter ? { plannedStartDateTime: plannedDateFilter } : {}),
          OR: [
            { includedInPayrollRunId: { not: null } },
            { status: { in: PAYROLL_ELIGIBLE_RECON } },
            {
              status: {
                in: [
                  VisitReconciliationStatus.PENDING_REVIEW,
                  VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
                  VisitReconciliationStatus.REJECTED_FOR_PAY,
                ],
              },
            },
          ],
        },
        select: {
          id: true,
          visitRef: true,
          scheduledVisitId: true,
          serviceUserId: true,
          plannedStartDateTime: true,
          plannedEndDateTime: true,
          actualStartDateTime: true,
          actualEndDateTime: true,
          approvedPayStart: true,
          approvedPayEnd: true,
          payableAmount: true,
          payableMinutes: true,
          status: true,
          includedInPayrollRunId: true,
          paidByUkPayrollRunId: true,
          includedInPayrollRun: {
            select: {
              id: true,
              periodLabel: true,
              periodStart: true,
              periodEnd: true,
              status: true,
            },
          },
        },
        orderBy: { plannedStartDateTime: 'desc' },
        take: plannedDateFilter ? 500 : 100,
      }),
    ]);

    const visitIdSet = new Set(visitRows.map((r) => r.id));
    const ukByReconId = new Map<
      string,
      { runId: string; runLabel: string; runStatus: string; runEmployeeId: string }
    >();
    for (const line of ukInputsForEmployee) {
      if (!line.sourceVisitReconciliationId || !visitIdSet.has(line.sourceVisitReconciliationId)) {
        continue;
      }
      ukByReconId.set(line.sourceVisitReconciliationId, {
        runId: line.runId,
        runLabel: line.run.label,
        runStatus: line.run.status,
        runEmployeeId: line.runEmployeeId,
      });
    }

    const ukRunEmployeeIds = [
      ...new Set([...ukByReconId.values()].map((v) => v.runEmployeeId)),
    ];
    const payoutLinesByRunEmployee = new Map<string, { batchStatus: string; lineStatus: string }[]>();
    if (ukRunEmployeeIds.length) {
      const payoutLines = await this.prisma.employeePayoutLine.findMany({
        where: { employeeId, ukPayrollRunEmployeeId: { in: ukRunEmployeeIds } },
        select: { ukPayrollRunEmployeeId: true, status: true, batch: { select: { status: true } } },
      });
      for (const line of payoutLines) {
        const list = payoutLinesByRunEmployee.get(line.ukPayrollRunEmployeeId) ?? [];
        list.push({ batchStatus: line.batch.status, lineStatus: line.status });
        payoutLinesByRunEmployee.set(line.ukPayrollRunEmployeeId, list);
      }
    }

    const visitIds = [...visitIdSet];
    const [openRunClaims, correctionItems] = visitIds.length
      ? await Promise.all([
          this.prisma.payrollRunLine.findMany({
            where: {
              visitReconciliationId: { in: visitIds },
              lineType: PayrollRunLineType.VISIT_PAY,
              payrollRun: { status: { notIn: paidStatuses } },
            },
            select: { visitReconciliationId: true },
          }),
          this.prisma.employeePayItem.findMany({
            where: { sourceId: { in: visitIds }, sourceType: { in: ['VISIT_CORRECTION', 'REVERSAL'] } },
            select: { sourceId: true, status: true, amount: true },
          }),
        ])
      : [[], []];
    const openRunVisitIds = new Set(openRunClaims.map((l) => l.visitReconciliationId));
    const correctionsByVisit = new Map<string, { status: string; amount: Prisma.Decimal }[]>();
    for (const item of correctionItems) {
      if (!item.sourceId) continue;
      const list = correctionsByVisit.get(item.sourceId) ?? [];
      list.push({ status: item.status, amount: item.amount });
      correctionsByVisit.set(item.sourceId, list);
    }

    const salaryWhere: Prisma.VisitReconciliationWhereInput = {
      ...visitDateWhere,
      OR: [
        { includedInPayrollRunId: { not: null } },
        { status: { in: PAYROLL_ELIGIBLE_RECON } },
        { status: VisitReconciliationStatus.LOCKED },
        {
          status: { in: PRICED_PENDING_RECON },
          payableAmount: { not: null },
        },
      ],
    };
    const [salaryAmountAgg, salaryVisitCount] = await Promise.all([
      this.prisma.visitReconciliation.aggregate({
        where: salaryWhere,
        _sum: { payableAmount: true },
      }),
      this.prisma.visitReconciliation.count({ where: salaryWhere }),
    ]);
    const salaryAmount = Number(salaryAmountAgg._sum.payableAmount ?? 0);

    // Settled by a closed UK run directly (no visit pay run): counted with the locked earnings.
    const ukSettledAgg = await this.prisma.visitReconciliation.aggregate({
      where: { ...visitDateWhere, includedInPayrollRunId: null, paidByUkPayrollRunId: { not: null } },
      _sum: { payableAmount: true },
      _count: { _all: true },
    });
    const totalEarned =
      Number(paidAggregate._sum.amount ?? 0) + Number(ukSettledAgg._sum.payableAmount ?? 0);
    const remainingAmount = Number(remainingAmountAgg._sum.payableAmount ?? 0);

    const serviceUserIds = [...new Set(visitRows.map((r) => r.serviceUserId))];
    const serviceUsers = serviceUserIds.length
      ? await this.prisma.serviceUser.findMany({
          where: { id: { in: serviceUserIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            serviceUserNumber: true,
          },
        })
      : [];
    const suMap = new Map(
      serviceUsers.map((su) => {
        const name =
          su.preferredName?.trim() ||
          `${su.firstName} ${su.lastName}`.trim() ||
          'Unknown';
        const label = su.serviceUserNumber ? `${name} (${su.serviceUserNumber})` : name;
        return [su.id, label] as const;
      }),
    );

    const formatHm = (d: Date | null | undefined) => {
      if (!d) return null;
      return formatHmInTimeZone(d, timeZone);
    };

    const visits = visitRows.map((row) => {
      const inVisitPayRun = Boolean(row.includedInPayrollRunId);
      const rejected = row.status === VisitReconciliationStatus.REJECTED_FOR_PAY;
      const uk = ukByReconId.get(row.id);
      const stage = earningStage({
        status: row.status,
        priced: row.payableAmount != null,
        inOpenPayRun: openRunVisitIds.has(row.id),
        inLockedPayRun: inVisitPayRun,
        ukRunStatus: uk?.runStatus,
        payout: uk ? furthestPayoutState(payoutLinesByRunEmployee.get(uk.runEmployeeId) ?? []) : null,
      });
      const corrections = correctionsByVisit.get(row.id) ?? [];
      const correctionAdjustment = corrections
        .filter((c) => c.status === 'APPROVED')
        .reduce((sum, c) => sum + Number(c.amount), 0);
      // `paymentState` is kept for existing clients (carer app); BANK_PAID means "a payout was recorded".
      const bankPaid = stage === 'PAYMENT_RECORDED';
      const inUkPayroll = Boolean(uk);
      const remaining =
        !inVisitPayRun &&
        !inUkPayroll &&
        !rejected &&
        isEarningsRemainingStatus(row.status, row.payableAmount);
      const paymentState = bankPaid
        ? 'BANK_PAID'
        : inVisitPayRun
          ? 'PAID'
          : inUkPayroll
            ? 'IN_UK_PAYROLL'
            : remaining
              ? 'REMAINING'
              : rejected
                ? 'REJECTED'
                : 'PENDING';
      const hours =
        row.payableMinutes != null
          ? formatMinutesAsHours(row.payableMinutes)
          : null;

      return {
        id: row.id,
        visitRef: row.visitRef,
        serviceUserName: suMap.get(row.serviceUserId) ?? 'Unknown',
        plannedStart: row.plannedStartDateTime.toISOString(),
        plannedEnd: row.plannedEndDateTime?.toISOString() ?? null,
        plannedTime:
          row.plannedEndDateTime
            ? `${formatHm(row.plannedStartDateTime)}–${formatHm(row.plannedEndDateTime)}`
            : formatHm(row.plannedStartDateTime),
        actualStart: row.actualStartDateTime?.toISOString() ?? null,
        actualEnd: row.actualEndDateTime?.toISOString() ?? null,
        actualTime:
          row.actualStartDateTime && row.actualEndDateTime
            ? `${formatHm(row.actualStartDateTime)}–${formatHm(row.actualEndDateTime)}`
            : row.actualStartDateTime
              ? formatHm(row.actualStartDateTime)
              : null,
        approvedPayStart: row.approvedPayStart?.toISOString() ?? null,
        approvedPayEnd: row.approvedPayEnd?.toISOString() ?? null,
        approvedPayTime:
          row.approvedPayStart && row.approvedPayEnd
            ? `${formatHm(row.approvedPayStart)}–${formatHm(row.approvedPayEnd)}`
            : row.approvedPayStart
              ? formatHm(row.approvedPayStart)
              : null,
        payableAmount: formatMoney(Number(row.payableAmount ?? 0)),
        payableAmountValue: Math.round(Number(row.payableAmount ?? 0) * 100) / 100,
        payableMinutes: row.payableMinutes,
        payableHours: hours,
        status: row.status,
        paymentState,
        earningStage: stage,
        earningStageLabel: earningStageLabel(stage),
        earningPhase: earningPhase(stage),
        correctionState: earningCorrectionState(corrections),
        correctionAdjustmentValue: Math.round(correctionAdjustment * 100) / 100,
        // Settled pay is changed through a pay correction, not by editing the visit.
        paySettled: isPaySettled(row),
        paid: inVisitPayRun || bankPaid,
        countsTowardSalary: inVisitPayRun || remaining || inUkPayroll,
        payrollRunId: row.includedInPayrollRun?.id ?? uk?.runId ?? null,
        payrollPeriod: uk?.runLabel ?? row.includedInPayrollRun?.periodLabel ?? null,
        payrollRunStatus: uk?.runStatus ?? row.includedInPayrollRun?.status ?? null,
        ukPayrollRunId: uk?.runId ?? null,
        ukPayrollRunLabel: uk?.runLabel ?? null,
      };
    });

    const salaryMonths = salaryMonthsForEarningsQuery(query.dateFrom, query.dateTo);
    const deductions = await this.prisma.employeeSalaryDeduction.findMany({
      where: {
        employeeId,
        deletedAt: null,
        isActive: true,
        ...(salaryMonths ? { salaryMonth: { in: salaryMonths } } : {}),
      },
      orderBy: [{ salaryMonth: 'desc' }, { createdAt: 'desc' }],
    });

    let fineTotal = 0;
    let penaltyTotal = 0;
    const mappedDeductions = deductions.map((d) => {
      const amount = Number(d.amount);
      if (d.type === SalaryDeductionType.FINE) fineTotal += amount;
      else penaltyTotal += amount;
      return {
        id: d.id,
        type: d.type,
        amount: formatMoney(amount),
        amountValue: Math.round(amount * 100) / 100,
        reason: d.reason,
        notes: d.notes,
        salaryMonth: d.salaryMonth,
        createdAt: d.createdAt.toISOString(),
      };
    });
    fineTotal = Math.round(fineTotal * 100) / 100;
    penaltyTotal = Math.round(penaltyTotal * 100) / 100;
    const deductionsTotal = Math.round((fineTotal + penaltyTotal) * 100) / 100;
    const visitSalary = Math.round(salaryAmount * 100) / 100;
    const netSalary = Math.round((visitSalary - deductionsTotal) * 100) / 100;

    const {
      ukNetByEmployee,
      paidOutByEmployee,
      committedByEmployee,
      hasEligibleUkRun,
    } = await this.employeePayouts.ukNetAndPaidOutForDateRange(
      query.dateFrom,
      query.dateTo,
    );
    const ukNetPay = Math.round((ukNetByEmployee.get(employeeId) ?? 0) * 100) / 100;
    const paidOutAmount = Math.round((paidOutByEmployee.get(employeeId) ?? 0) * 100) / 100;
    const committed = Math.round((committedByEmployee.get(employeeId) ?? 0) * 100) / 100;
    const outstandingPayoutAmount = hasEligibleUkRun
      ? Math.round(Math.max(0, ukNetPay - committed) * 100) / 100
      : 0;

    return {
      data: {
        employeeId,
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        organisationTimezone: timeZone,
        currency: 'GBP',
        /** Gross monthly salary from accepted visits (before fines/penalties). */
        salaryAmount: formatMoney(visitSalary),
        salaryAmountValue: visitSalary,
        salaryVisitCount,
        /** Net = visit salary − fines − penalties. */
        netSalaryAmount: formatMoney(netSalary),
        netSalaryAmountValue: netSalary,
        fineTotal: formatMoney(fineTotal),
        fineTotalValue: fineTotal,
        penaltyTotal: formatMoney(penaltyTotal),
        penaltyTotalValue: penaltyTotal,
        deductionsTotal: formatMoney(deductionsTotal),
        deductionsTotalValue: deductionsTotal,
        deductions: mappedDeductions,
        totalEarned: formatMoney(totalEarned),
        totalEarnedAmount: Math.round(totalEarned * 100) / 100,
        paidVisitCount: paidVisitGroups.length + ukSettledAgg._count._all,
        remainingVisitCount,
        remainingAmount: formatMoney(remainingAmount),
        remainingAmountValue: Math.round(remainingAmount * 100) / 100,
        pendingReviewCount: pendingCount,
        ukNetPayAmount: formatMoney(ukNetPay),
        ukNetPayAmountValue: ukNetPay,
        hasEligibleUkRun,
        /** Bank payout of UK net (PAID batches). */
        paidOutAmount: formatMoney(paidOutAmount),
        paidOutAmountValue: paidOutAmount,
        outstandingPayoutAmount: formatMoney(outstandingPayoutAmount),
        outstandingPayoutAmountValue: outstandingPayoutAmount,
        visits,
      },
    };
  }

  async listEmployeeSalaryDeductions(employeeId: string, salaryMonth?: string) {
    await this.ensureEmployee(employeeId);
    const rows = await this.prisma.employeeSalaryDeduction.findMany({
      where: {
        employeeId,
        deletedAt: null,
        isActive: true,
        ...(salaryMonth ? { salaryMonth } : {}),
      },
      orderBy: [{ salaryMonth: 'desc' }, { createdAt: 'desc' }],
    });
    return {
      data: rows.map((d) => ({
        id: d.id,
        type: d.type,
        amount: formatMoney(Number(d.amount)),
        amountValue: Math.round(Number(d.amount) * 100) / 100,
        reason: d.reason,
        notes: d.notes,
        salaryMonth: d.salaryMonth,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  async createEmployeeSalaryDeduction(
    userId: string,
    employeeId: string,
    dto: CreateEmployeeSalaryDeductionDto,
  ) {
    await this.ensureEmployee(employeeId);
    const amount = Math.round(Number(dto.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Deduction amount must be greater than zero');
    }
    const created = await this.prisma.employeeSalaryDeduction.create({
      data: {
        employeeId,
        type: dto.type as SalaryDeductionType,
        amount,
        reason: dto.reason.trim(),
        notes: dto.notes?.trim() || null,
        salaryMonth: dto.salaryMonth,
        createdById: userId,
        updatedById: userId,
      },
    });
    return {
      data: {
        id: created.id,
        type: created.type,
        amount: formatMoney(Number(created.amount)),
        amountValue: Math.round(Number(created.amount) * 100) / 100,
        reason: created.reason,
        notes: created.notes,
        salaryMonth: created.salaryMonth,
        createdAt: created.createdAt.toISOString(),
      },
    };
  }

  async deleteEmployeeSalaryDeduction(userId: string, employeeId: string, deductionId: string) {
    await this.ensureEmployee(employeeId);
    const row = await this.prisma.employeeSalaryDeduction.findFirst({
      where: { id: deductionId, employeeId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Salary deduction not found');
    await this.prisma.employeeSalaryDeduction.update({
      where: { id: row.id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        updatedById: userId,
      },
    });
    return { data: { id: row.id, deleted: true } };
  }

  /**
   * Test/ops helper: wipe this employee’s earnings display to £0.
   * - Deletes payout lines (Bank paid → £0)
   * - Clears fines/penalties
   * - Zeros payable amounts on visits not yet in a locked visit-pay run (Ready → £0)
   * - Removes them from UK payroll runs and retotals those runs (UK net / Outstanding → £0)
   * Does not delete locked/exported visit-pay run history lines.
   */
  /** Test reset only: refused in production and unless the server opts in (SI-06). */
  async resetEmployeeEarnings(userId: string, employeeId: string, meta?: RequestAuditMeta) {
    assertFinancialResetEnvironment();
    await this.ensureEmployee(employeeId);
    await this.audit.logAudit({
      userId,
      module: AuditModule.BILLING,
      action: AuditAction.FINANCIAL_TEST_DATA_RESET,
      recordType: 'Employee',
      recordId: employeeId,
      newValues: { operation: 'reset employee earnings' },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });

    const payout = await this.employeePayouts.deleteLinesForEmployee(employeeId);

    const deductions = await this.prisma.employeeSalaryDeduction.updateMany({
      where: { employeeId, deletedAt: null, isActive: true },
      data: {
        deletedAt: new Date(),
        isActive: false,
        updatedById: userId,
      },
    });

    const readyVisits = await this.prisma.visitReconciliation.updateMany({
      where: {
        employeeId,
        includedInPayrollRunId: null,
        paidByUkPayrollRunId: null,
        payableAmount: { not: null },
      },
      data: {
        payableAmount: 0,
        updatedAt: new Date(),
      },
    });

    const ukRunEmployees = await this.prisma.ukPayrollRunEmployee.findMany({
      where: { employeeId },
      select: {
        id: true,
        runId: true,
        netPay: true,
        totalGross: true,
        incomeTax: true,
        employeeNi: true,
        employerNi: true,
        expenseTotal: true,
      },
    });

    const affectedRunIds = [...new Set(ukRunEmployees.map((e) => e.runId))];

    if (ukRunEmployees.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.ukPayrollInputLine.deleteMany({ where: { employeeId } });
        await tx.ukPayrollRunEmployee.deleteMany({ where: { employeeId } });

        for (const runId of affectedRunIds) {
          const remaining = await tx.ukPayrollRunEmployee.findMany({
            where: { runId },
            select: {
              totalGross: true,
              expenseTotal: true,
              incomeTax: true,
              employeeNi: true,
              employerNi: true,
              netPay: true,
            },
          });

          const sum = (pick: (r: (typeof remaining)[number]) => unknown) =>
            Math.round(
              remaining.reduce((s, r) => s + Number(pick(r) ?? 0), 0) * 100,
            ) / 100;

          await tx.ukPayrollRun.update({
            where: { id: runId },
            data: {
              employeeCount: remaining.length,
              totalGross: sum((r) => r.totalGross),
              totalExpenses: sum((r) => r.expenseTotal),
              totalIncomeTax: sum((r) => r.incomeTax),
              totalEmployeeNi: sum((r) => r.employeeNi),
              totalEmployerNi: sum((r) => r.employerNi),
              totalNetPay: sum((r) => r.netPay),
              updatedById: userId,
            },
          });
        }
      });
    }

    return {
      data: {
        deletedPayoutLines: payout.deletedLines,
        deletedPayoutBatches: payout.deletedBatches,
        updatedPayoutBatches: payout.updatedBatches,
        clearedDeductions: deductions.count,
        zeroedReadyVisits: readyVisits.count,
        removedUkRunEmployees: ukRunEmployees.length,
        updatedUkRuns: affectedRunIds.length,
      },
    };
  }

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  private mapRow(row: {
    id: string;
    periodLabel: string;
    periodStart: Date;
    periodEnd: Date;
    status: PayrollRunStatus;
    carerCount: number;
    visitLineCount: number;
    grossPay: Prisma.Decimal;
    nmwTopUp: Prisma.Decimal;
    exceptionCount: number;
  }): PayrollRunRow {
    return {
      id: row.id,
      period: row.periodLabel,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      status: row.status,
      carers: row.carerCount,
      visitLines: row.visitLineCount,
      grossPay: formatMoney(Number(row.grossPay)),
      nmwTopUp: formatMoney(Number(row.nmwTopUp)),
      exceptions: row.exceptionCount,
    };
  }
}
