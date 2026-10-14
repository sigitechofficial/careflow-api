import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AllocationStatus,
  FinanceExceptionCode,
  InvoiceRunStatus,
  Prisma,
  ScheduledVisitStatus,
  VisitOverrunDecision,
  VisitOverrunTimeBasis,
  VisitPlanNightDuty,
  VisitReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { PayCardsService, ChargeCardsService } from './billing-cards.service';
import {
  loadPayCardRulesForDate,
  loadPayCardRulesForVersion,
} from './pay-card-version.util';
import { DEFAULT_BANK_HOLIDAY_REGION } from './bank-holiday-regions.util';
import { calendarHoldForPay, loadPayCalendar } from './holiday-calendar.store';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { attendanceReviewState } from '../visit-attendance/visit-attendance-verification.store';
import {
  approvalAfterEvidenceChange,
  describeEvidenceChange,
  evidenceFingerprint,
  inferApprovalSource,
} from './approval-evidence.util';
import {
  classifyEvaluationFailure,
  payEvaluationSubjectKey,
  type PayEvaluationOperation,
} from './pay-evaluation-failure.util';
import { PayItemsService } from './pay-items.service';
import {
  allowFinancialResetInTransaction,
  assertFinancialResetEnvironment,
} from './financial-controls.util';
import {
  PAY_SETTLED_MESSAGE,
  isPaySettled,
  withoutPaySnapshotFields,
  type PaySettlementRef,
} from './pay-settlement.util';
import {
  ApproveVisitReconciliationDto,
  BackfillVisitReconciliationsDto,
  BulkApproveVisitReconciliationsDto,
  DecideVisitOverrunDto,
  RecalculateVisitReconciliationsDto,
  RejectVisitReconciliationDto,
  SetVisitPayableAmountDto,
  SetVisitBillableAmountDto,
  UpdateVisitReconciliationDto,
  VisitReconciliationsQueryDto,
} from './dto/visit-reconciliations.dto';
import { serviceUserIdsForLocation } from './billing-location-scope.util';
import { buildFundingSplits, buildFunderSplitPreview, formatMoney } from './billing-run.util';
import {
  loadPerFunderChargeCalculation,
} from './multi-funder-charge.util';
import {
  calculateBillableAmount,
  calculatePayableAmount,
  buildChargeRateBreakdown,
  buildPayRateBreakdown,
  deriveReconciliationStatus,
  detectVisitExceptions,
  formatDateOnly,
  formatTimeRange,
  formatMinutesAsHours,
  alignRateBreakdownVisitSliceLabels,
  hasUnresolvedBlockingExceptions,
  listUnresolvedBlockingCodes,
  hasPayBlockingExceptions,
  isAbsentCoCarer,
  ABSENT_CO_CARER_EXCEPTION_MESSAGE,
  listPayBlockingCodes,
  isCanonicalVisitRef,
  minutesBetween,
  isInvertedDateWindow,
  isDurationShortfallWithinTolerance,
  isLegacyMismatchedBillWindow,
  resolveDefaultApprovedWindows,
} from './visit-reconciliation.util';
import { resolveVisitDeliveryToleranceMinutes } from '../scheduling/visit-delivery-assessment.util';
import {
  formatTimeHhMmSs,
  formatTimeHhMmSsOrZero,
  formatVisitDateMmDdYy,
  resolveCareTypeExportCode,
  resolveEmonitored,
} from './payroll-run-export-csv.util';
import {
  detectInterVisitTravel,
  summariseTravelForDestination,
} from './pay-inter-visit-travel.util';
import { resolveAllocationWindow, resolveAllocationActualWindow } from '../job-allocations/allocation-window.util';
import {
  nightDutyAppLabel,
  resolveStoredNightDuty,
} from '../service-user-visit-plans/visit-plan-night-duty.util';
import { ensureScheduledVisitRef } from '../scheduling/visit-ref-allocate.util';
import {
  dayKeyInTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import { payFunderOn } from './funding-at-date.util';
import { effectiveEmployeeFunderPayAssignments } from './pay-card-assignment.util';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const COMPLETED_VISIT_STATUSES: ScheduledVisitStatus[] = [
  ScheduledVisitStatus.COMPLETED,
  ScheduledVisitStatus.PARTIALLY_COMPLETED,
];

/**
 * Invoice-run statuses at or past approval: once a visit's invoice reaches these,
 * its charge is frozen (the run can no longer be recalculated), so the visit's
 * billable amount must not be edited or a mismatch appears between the
 * reconciliation and the issued invoice. `includedInInvoiceRunId` is only set at
 * LOCK, so APPROVED runs are otherwise unguarded.
 */
const APPROVED_INVOICE_RUN_STATUSES: InvoiceRunStatus[] = [
  InvoiceRunStatus.APPROVED,
  InvoiceRunStatus.LOCKED,
  InvoiceRunStatus.SENT,
  InvoiceRunStatus.PART_PAID,
  InvoiceRunStatus.PAID,
  InvoiceRunStatus.DISPUTED,
];

function isBillingEligibleVisit(visit: {
  status: ScheduledVisitStatus;
  actualStartDateTime: Date | null;
  actualEndDateTime: Date | null;
}): boolean {
  if (COMPLETED_VISIT_STATUSES.includes(visit.status)) return true;
  return Boolean(visit.actualStartDateTime && visit.actualEndDateTime);
}

function parseMoneyAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value === 'string') {
    const n = Number(value.replace(/[£,\s]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  return null;
}

function snapshotRecord(snapshot: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (snapshot == null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  return snapshot as Record<string, unknown>;
}

function snapshotSideManualAmount(
  snapshot: Prisma.JsonValue | null | undefined,
  side: 'carerPay' | 'clientCharge',
): number | null {
  const snap = snapshotRecord(snapshot);
  if (!snap) return null;
  const sideObj = snap[side];
  if (!sideObj || typeof sideObj !== 'object' || Array.isArray(sideObj)) return null;
  const rec = sideObj as Record<string, unknown>;
  if (rec.manualOverride !== true) return null;
  return parseMoneyAmount(rec.amount);
}

function approvalNotesManualAmount(
  notes: string | null | undefined,
  side: 'pay' | 'bill',
): number | null {
  if (!notes?.trim()) return null;
  const label = side === 'pay' ? 'Payable amount set to' : 'Billable amount set to';
  const match = notes.match(new RegExp(`${label}\\s*£\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'));
  return match ? parseMoneyAmount(match[1]) : null;
}

/** Manual carer-pay override from snapshot or approval notes (survives evaluate wipes). */
function resolveManualPayableAmount(row: {
  payableAmount?: unknown;
  pricingSnapshot?: Prisma.JsonValue | null;
  approvalNotes?: string | null;
}): number | null {
  return (
    snapshotSideManualAmount(row.pricingSnapshot, 'carerPay') ??
    approvalNotesManualAmount(row.approvalNotes, 'pay')
  );
}

/** Manual client-charge override from snapshot or approval notes. */
function resolveManualBillableAmount(row: {
  billableAmount?: unknown;
  pricingSnapshot?: Prisma.JsonValue | null;
  approvalNotes?: string | null;
}): number | null {
  return (
    snapshotSideManualAmount(row.pricingSnapshot, 'clientCharge') ??
    approvalNotesManualAmount(row.approvalNotes, 'bill')
  );
}

function hasManualPayableOverride(row: {
  pricingSnapshot?: Prisma.JsonValue | null;
  approvalNotes?: string | null;
}): boolean {
  return resolveManualPayableAmount(row) != null;
}

function hasManualBillableOverride(row: {
  pricingSnapshot?: Prisma.JsonValue | null;
  approvalNotes?: string | null;
}): boolean {
  return resolveManualBillableAmount(row) != null;
}

function billingEligibleVisitWhere(): Prisma.ScheduledVisitWhereInput {
  return {
    deletedAt: null,
    isActive: true,
    OR: [
      { status: { in: COMPLETED_VISIT_STATUSES } },
      {
        actualStartDateTime: { not: null },
        actualEndDateTime: { not: null },
      },
    ],
  };
}

const reconciliationInclude = {
  exceptions: { orderBy: { createdAt: 'asc' as const } },
} as const;

type ReconciliationRow = Prisma.VisitReconciliationGetPayload<{
  include: typeof reconciliationInclude;
}>;

export type VisitReconciliationListRow = {
  id: string;
  visitRef: string;
  scheduledVisitId: string;
  scheduledJobId: string;
  serviceUserId: string;
  serviceUserName: string;
  employeeId: string | null;
  carerName: string | null;
  date: string;
  planned: string;
  actual: string;
  approvedPayable: string;
  approvedBillable: string;
  payableAmount: string | null;
  billableAmount: string | null;
  travelMiles: number | null;
  travelMinutes: number | null;
  currency: string;
  status: VisitReconciliationStatus;
  exceptions: Array<{ code: FinanceExceptionCode; message: string }>;
  overrunMinutes: number | null;
  overrunReason: string | null;
  overrunDecision: VisitOverrunDecision | null;
  overrunPayBasis: VisitOverrunTimeBasis | null;
  overrunBillBasis: VisitOverrunTimeBasis | null;
  approvalNotes: string | null;
  /** Visit-log style columns (client-centric export format). */
  emonitored: 'LOGGED' | 'NOT LOG';
  clientId: string;
  clientFirstName: string;
  clientSecondName: string;
  clientAddress: string;
  clientPostCode: string;
  visitDate: string;
  careType: string;
  plannedArrival: string;
  plannedDeparture: string;
  actualArrival: string;
  actualDeparture: string;
  createdAt: string;
  nightDuty: 'NONE' | 'SLEEPING_NIGHT' | 'WAKING_NIGHT';
  nightDutyLabel: string;
};

type DbClient = PrismaService | Prisma.TransactionClient;

/** Starts the evidence-changed reason of a visit whose corrected times have not reached its pay yet. */
const PAY_STEP_FAILED = 'Attendance times were corrected but carer pay could not be recalculated';

/** A pay decision is repriced inside its transaction: allow for that rather than the 5 second default. */
const DECISION_TRANSACTION = { timeout: 20_000, maxWait: 10_000 };

async function isVisitOnBankHoliday(
  db: DbClient,
  date: Date,
  timeZone: string,
  region: string = DEFAULT_BANK_HOLIDAY_REGION,
): Promise<boolean> {
  const set = await loadBankHolidayDateSet(db, date, date, timeZone, region);
  return set.has(dayKeyInTimeZone(date, timeZone));
}

/** Calendar day key for a stored bank-holiday Date (date-only column → UTC Y-M-D). */
function bankHolidayCalendarKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Load active bank-holiday calendar keys covering [from, to] (expanded for TZ edges).
 * Visit matching must use dayKeyInTimeZone(instant, orgTz) against this set.
 */
async function loadBankHolidayDateSet(
  db: DbClient,
  from: Date,
  to: Date,
  _timeZone?: string,
  /** Calendar region; `UK` (England & Wales) is the default used for charges and legacy pay cards. */
  region: string = DEFAULT_BANK_HOLIDAY_REGION,
): Promise<Set<string>> {
  const padMs = 36 * 60 * 60 * 1000; // ±36h so ops-day edges never miss a holiday row
  const start = new Date(from.getTime() - padMs);
  const end = new Date(to.getTime() + padMs);
  const rows = await db.bankHoliday.findMany({
    where: {
      isActive: true,
      region,
      holidayDate: { gte: start, lte: end },
    },
    select: { holidayDate: true },
  });
  return new Set(rows.map((r) => bankHolidayCalendarKey(r.holidayDate)));
}

@Injectable()
export class VisitReconciliationsService {
  private readonly logger = new Logger(VisitReconciliationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payCardsService: PayCardsService,
    private readonly chargeCardsService: ChargeCardsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly auditLogs: AuditLogsService,
    private readonly payItems: PayItemsService,
  ) {}

  /** The open transaction behind a client, to pass on to an audit entry; none for the plain client. */
  private txOf(db: DbClient): Prisma.TransactionClient | undefined {
    return db === this.prisma ? undefined : (db as Prisma.TransactionClient);
  }

  /** Runs work in the transaction that is already open, or in one of its own. */
  private atomic<T>(db: DbClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const open = this.txOf(db);
    return open ? work(open) : this.prisma.$transaction(work, DECISION_TRANSACTION);
  }

  private client(tx?: Prisma.TransactionClient): DbClient {
    return tx ?? this.prisma;
  }

  /** Refuse a change to carer pay once the visit is in a locked visit pay run or a closed UK run. */
  private assertPayNotSettled(row: PaySettlementRef) {
    if (isPaySettled(row)) throw new BadRequestException(PAY_SETTLED_MESSAGE);
  }

  /** Audit a decision on one visit (approval, rejection, overrun, manual amount, time edit). */
  private auditVisit(
    action: AuditAction,
    userId: string | undefined,
    row: { id: string; visitRef?: string | null; employeeId?: string | null },
    values: { oldValues?: Record<string, unknown>; newValues?: Record<string, unknown>; reason?: string | null },
    meta?: RequestAuditMeta,
    tx?: Prisma.TransactionClient,
  ) {
    return this.auditLogs.logAudit({
      tx,
      userId,
      module: AuditModule.BILLING,
      action,
      recordType: 'VisitReconciliation',
      recordId: row.id,
      description: values.reason?.trim() || undefined,
      oldValues: values.oldValues,
      newValues: values.newValues,
      metadata: { visitRef: row.visitRef ?? null, employeeId: row.employeeId ?? null },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
  }

  private static paySnapshotOf(row: {
    status: unknown;
    payableAmount: unknown;
    payableMinutes: number | null;
    approvedPayStart: Date | null;
    approvedPayEnd: Date | null;
  }) {
    return {
      status: String(row.status),
      payableAmount: row.payableAmount != null ? String(row.payableAmount) : null,
      payableMinutes: row.payableMinutes,
      approvedPayStart: row.approvedPayStart?.toISOString() ?? null,
      approvedPayEnd: row.approvedPayEnd?.toISOString() ?? null,
    };
  }

  /**
   * Convert YYYY-MM-DD filter bounds into UTC instants for the organisation
   * operational timezone (not raw Z midnight).
   */
  private async operationalDateTimeFilter(
    dateFrom?: string,
    dateTo?: string,
  ): Promise<{ gte?: Date; lte?: Date } | undefined> {
    if (!dateFrom && !dateTo) return undefined;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const out: { gte?: Date; lte?: Date } = {};
    if (dateFrom) {
      out.gte = operationalDayBounds(dateFrom.slice(0, 10), timeZone).start;
    }
    if (dateTo) {
      out.lte = operationalDayBounds(dateTo.slice(0, 10), timeZone).end;
    }
    return out;
  }

  /** Same hierarchy as punctuality: time-critical slot → late alert → global → 15. */
  private async resolveDurationToleranceMinutes(
    db: DbClient,
    scheduledVisitId: string,
  ): Promise<number> {
    const [org, visit] = await Promise.all([
      db.organisationGeneralSettings.findFirst({
        select: {
          domLateVisitAlertMinutes: true,
          domGlobalToleranceMinutes: true,
        },
      }),
      db.scheduledVisit.findUnique({
        where: { id: scheduledVisitId },
        select: {
          visitPlanSlot: {
            select: { timeCritical: true, timeToleranceMinutes: true },
          },
        },
      }),
    ]);

    return resolveVisitDeliveryToleranceMinutes({
      timeCritical: visit?.visitPlanSlot?.timeCritical,
      timeToleranceMinutes: visit?.visitPlanSlot?.timeToleranceMinutes,
      orgLateAlertMinutes: org?.domLateVisitAlertMinutes,
      orgGlobalToleranceMinutes: org?.domGlobalToleranceMinutes,
    });
  }

  async ensureForCompletedJob(
    jobId: string,
    tx?: Prisma.TransactionClient,
    options?: { overrunReason?: string | null },
  ) {
    const db = this.client(tx);
    const visits = await db.scheduledVisit.findMany({
      where: {
        scheduledJobId: jobId,
        ...billingEligibleVisitWhere(),
      },
      orderBy: { scheduledStartDateTime: 'asc' },
    });

    const results: string[] = [];
    for (const visit of visits) {
      const id = await this.ensureForVisit(visit.id, tx, options);
      if (id) results.push(id);
    }
    return results;
  }

  /**
   * Issue the immutable EMONITORED visitRef even before the visit is billable.
   * Creates (or reuses) reconciliation row(s) so employee-app / admin share
   * the same VIS-[BRANCH]-[YYYYMMDD]-[NNNN]. Does not evaluate pay/bill.
   */
  async issueVisitRef(scheduledVisitId: string): Promise<string | null> {
    const id = await this.ensureForVisit(scheduledVisitId, undefined, {
      issueRefOnly: true,
    });
    if (!id) return null;
    const row = await this.prisma.visitReconciliation.findFirst({
      where: { scheduledVisitId },
      select: { visitRef: true },
      orderBy: { createdAt: 'asc' },
    });
    return row?.visitRef?.trim() || null;
  }

  async issueVisitRefsByScheduledVisitIds(
    scheduledVisitIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = [
      ...new Set(scheduledVisitIds.map((id) => id?.trim()).filter(Boolean)),
    ];
    for (const id of unique) {
      const ref = await this.issueVisitRef(id);
      if (ref) map.set(id, ref);
    }
    return map;
  }

  async ensureForVisit(
    scheduledVisitId: string,
    tx?: Prisma.TransactionClient,
    options?: { overrunReason?: string | null; issueRefOnly?: boolean },
  ): Promise<string | null> {
    const db = this.client(tx);
    const visit = await db.scheduledVisit.findFirst({
      where: {
        id: scheduledVisitId,
        deletedAt: null,
        isActive: true,
      },
    });
    if (!visit) return null;
    if (!options?.issueRefOnly && !isBillingEligibleVisit(visit)) return null;

    let overrunReason = options?.overrunReason?.trim() || null;
    if (overrunReason == null) {
      const job = await db.scheduledJob.findFirst({
        where: { id: visit.scheduledJobId },
        select: { metadata: true },
      });
      const meta = (job?.metadata ?? null) as Record<string, unknown> | null;
      if (typeof meta?.overrunReason === 'string' && meta.overrunReason.trim()) {
        overrunReason = meta.overrunReason.trim();
      }
    }

    const allocations = await this.resolveAllAllocations(db, visit.scheduledJobId, visit.id);
    const targets =
      allocations.length > 0
        ? allocations
        : [
            {
              id: null as string | null,
              employeeId: null as string | null,
              scheduledStartDateTime: null as Date | null,
              scheduledEndDateTime: null as Date | null,
              durationMinutes: null as number | null,
              actualStartDateTime: null as Date | null,
              actualEndDateTime: null as Date | null,
            },
          ];

    // Same scheduled visit → same immutable visitRef for every carer.
    // VIS-[BRANCH]-[YYYYMMDD]-[NNNN]; never reallocated after first creation.
    const sharedVisitRef = await this.resolveOrAllocateVisitRef(db, visit);

    const activeCarerCount = allocations.length;
    const clockedInAllocationIds = new Set(
      allocations.filter((a) => a.actualStartDateTime != null).map((a) => a.id),
    );

    let firstId: string | null = null;
    for (const allocation of targets) {
      // Absent co-carer: no visit-time fallback — pay line held for review instead.
      const absentCoCarer =
        allocation.id != null &&
        isAbsentCoCarer({
          requiredCarers: visit.requiredCarers ?? 1,
          activeCarerCount,
          myActualStartDateTime: allocation.actualStartDateTime,
          anyCoCarerClockedIn: [...clockedInAllocationIds].some((aid) => aid !== allocation.id),
        });
      const planned = resolveAllocationWindow(
        {
          scheduledStartDateTime: allocation.scheduledStartDateTime,
          scheduledEndDateTime: allocation.scheduledEndDateTime,
          durationMinutes: allocation.durationMinutes,
        },
        {
          scheduledStartDateTime: visit.scheduledStartDateTime,
          scheduledEndDateTime: visit.scheduledEndDateTime,
        },
      );
      const actual = absentCoCarer
        ? { start: null, end: null }
        : resolveAllocationActualWindow(
            {
              actualStartDateTime: allocation.actualStartDateTime ?? null,
              actualEndDateTime: allocation.actualEndDateTime ?? null,
            },
            {
              actualStartDateTime: visit.actualStartDateTime,
              actualEndDateTime: visit.actualEndDateTime,
            },
          );

      const existing = allocation.id
        ? await db.visitReconciliation.findFirst({
            where: { scheduledVisitId: visit.id, jobAllocationId: allocation.id },
          })
        : await db.visitReconciliation.findFirst({
            where: { scheduledVisitId: visit.id, jobAllocationId: null },
          });

      if (existing) {
        // Canonical visitRef is immutable (call-off / reschedule keep the same ref).
        // Legacy / non-canonical refs may be repaired once to VIS-[BRANCH]-… format.
        const existingRef = existing.visitRef?.trim() || '';
        const canRepairRef =
          sharedVisitRef !== existingRef &&
          (!isCanonicalVisitRef(existingRef) || /^VIS-GEN-\d{8}-\d{4}$/.test(existingRef));
        const updated = await db.visitReconciliation.update({
          where: { id: existing.id },
          data: {
            plannedStartDateTime: planned.start,
            plannedEndDateTime: planned.end,
            actualStartDateTime: actual.start,
            actualEndDateTime: actual.end,
            // The carer who was paid stays on a settled row; a change of carer is a pay correction.
            employeeId: isPaySettled(existing)
              ? existing.employeeId
              : (allocation.employeeId ?? existing.employeeId),
            jobAllocationId: allocation.id ?? existing.jobAllocationId,
            ...(overrunReason != null ? { overrunReason } : {}),
            ...(canRepairRef ? { visitRef: sharedVisitRef } : {}),
          },
        });
        if (!options?.issueRefOnly) {
          await this.safeEvaluate(db, updated.id);
        }
        firstId ??= updated.id;
        continue;
      }

      const created = await db.visitReconciliation.create({
        data: {
          scheduledVisitId: visit.id,
          scheduledJobId: visit.scheduledJobId,
          serviceUserId: visit.serviceUserId,
          employeeId: allocation.employeeId,
          jobAllocationId: allocation.id,
          visitRef: sharedVisitRef,
          plannedStartDateTime: planned.start,
          plannedEndDateTime: planned.end,
          actualStartDateTime: actual.start,
          actualEndDateTime: actual.end,
          overrunReason,
        },
      });
      if (!options?.issueRefOnly) {
        await this.safeEvaluate(db, created.id);
      }
      firstId ??= created.id;
    }

    if (!options?.issueRefOnly) {
      await this.supersedeRowsOfRemovedCarers(db, visit.id);
    }

    return firstId;
  }

  /** Rows of this visit split by whether their allocation is still live (not removed or cancelled). */
  private async rowsByAllocationState(db: DbClient, scheduledVisitId: string) {
    const rows = await db.visitReconciliation.findMany({
      where: { scheduledVisitId, jobAllocationId: { not: null } },
      select: {
        id: true,
        visitRef: true,
        employeeId: true,
        status: true,
        jobAllocationId: true,
        approvalNotes: true,
        includedInPayrollRunId: true,
        paidByUkPayrollRunId: true,
        includedInInvoiceRunId: true,
      },
    });
    if (rows.length < 2) return { live: rows, removed: [] as typeof rows };
    const allocations = await db.jobAllocation.findMany({
      where: { id: { in: rows.map((r) => r.jobAllocationId!) } },
      select: { id: true, status: true, isActive: true, deletedAt: true },
    });
    const liveIds = new Set(
      allocations
        .filter(
          (a) =>
            !a.deletedAt &&
            a.isActive &&
            a.status !== AllocationStatus.CANCELLED &&
            a.status !== AllocationStatus.UNALLOCATED,
        )
        .map((a) => a.id),
    );
    return {
      live: rows.filter((r) => liveIds.has(r.jobAllocationId!)),
      removed: rows.filter((r) => !liveIds.has(r.jobAllocationId!)),
    };
  }

  /**
   * A carer taken off a visit after it was completed leaves a reconciliation row behind while the
   * replacement carer gets a new one: two payable rows for one piece of work (VW-11).
   * The row of the removed carer is withdrawn from pay and charge. A row that is already paid or
   * invoiced is history and stays; the replacement row is then held for a manager
   * (see evaluateInternal), because paying it means the first payment has to be recovered.
   */
  private async supersedeRowsOfRemovedCarers(db: DbClient, scheduledVisitId: string) {
    const { live, removed } = await this.rowsByAllocationState(db, scheduledVisitId);
    if (!live.length) return;
    for (const row of removed) {
      if (
        row.status === VisitReconciliationStatus.REJECTED_FOR_PAY ||
        row.status === VisitReconciliationStatus.REJECTED_FOR_INVOICE ||
        isPaySettled(row) ||
        row.includedInInvoiceRunId
      ) {
        continue;
      }
      const note = 'Superseded: this carer was removed from the visit after it was completed.';
      await this.atomic(db, async (tx) => {
        await tx.visitReconciliation.update({
          where: { id: row.id },
          data: {
            status: VisitReconciliationStatus.REJECTED_FOR_PAY,
            approvedAt: null,
            approvedById: null,
            approvalNotes: [row.approvalNotes, note].filter(Boolean).join('\n').slice(0, 2000),
          },
        });
        await this.auditVisit(
          AuditAction.VISIT_RECONCILIATION_REJECTED,
          undefined,
          row,
          {
            oldValues: { status: String(row.status) },
            newValues: { status: VisitReconciliationStatus.REJECTED_FOR_PAY },
            reason: note,
          },
          undefined,
          tx,
        );
      });
    }
  }

  /**
   * Reuse the visit reference already issued for this scheduled visit.
   * Otherwise allocate VIS-[BRANCH]-[YYYYMMDD]-[NNNN] once (immutable thereafter).
   * BRANCH = service user’s branch ScheduleArea.visitRefCode (3 chars).
   * YYYYMMDD = original planned visit date at first issuance.
   * NNNN = daily sequence per branch (resets each day).
   * Called-off / rescheduled visits keep the same reference.
   * Legacy VIS-GEN-* / non-canonical refs are repaired once when a real branch exists.
   */
  private async resolveOrAllocateVisitRef(
    db: DbClient,
    visit: {
      id: string
      scheduledJobId: string
      serviceUserId: string
      scheduledStartDateTime: Date
      visitRef?: string | null
    },
  ): Promise<string> {
    return ensureScheduledVisitRef(db, visit);
  }

  /**
   * Evaluates without letting a failure stop the caller (a visit must complete even when its pay
   * cannot be worked out yet). R-17: the failure is not dropped. It is kept as an open pay
   * evaluation failure that the office sees and can retry, and it is closed when a later
   * evaluation succeeds. Returns false when evaluation failed.
   */
  private async safeEvaluate(
    db: DbClient,
    id: string,
    options?: { forceRecalculateAmounts?: boolean },
  ): Promise<boolean> {
    try {
      await this.evaluateInternal(db, id, options);
      await this.closeEvaluationFailure('EVALUATE', id, 'SUCCEEDED_LATER');
      return true;
    } catch (err) {
      await this.recordEvaluationFailure('EVALUATE', id, err);
      return false;
    }
  }

  /**
   * Creates or refreshes the pay records of a completed job without letting a failure stop the
   * caller. A failure is kept as an open pay evaluation failure for the job (R-17).
   */
  async ensureForCompletedJobSafe(
    jobId: string,
    options?: { overrunReason?: string | null },
  ): Promise<boolean> {
    try {
      await this.ensureForCompletedJob(jobId, undefined, options);
      await this.closeEvaluationFailure('ENSURE_JOB', jobId, 'SUCCEEDED_LATER');
      return true;
    } catch (err) {
      await this.recordEvaluationFailure('ENSURE_JOB', jobId, err);
      return false;
    }
  }

  /** As ensureForCompletedJobSafe, for one visit. */
  async ensureForVisitSafe(scheduledVisitId: string): Promise<boolean> {
    try {
      await this.ensureForVisit(scheduledVisitId);
      await this.closeEvaluationFailure('ENSURE_VISIT', scheduledVisitId, 'SUCCEEDED_LATER');
      return true;
    } catch (err) {
      await this.recordEvaluationFailure('ENSURE_VISIT', scheduledVisitId, err);
      return false;
    }
  }

  /** Who and what a failure is about, from whatever already exists for the subject. */
  private async evaluationFailureSubject(operation: PayEvaluationOperation, id: string) {
    if (operation === 'EVALUATE') {
      const row = await this.prisma.visitReconciliation.findUnique({
        where: { id },
        select: {
          scheduledJobId: true,
          scheduledVisitId: true,
          serviceUserId: true,
          employeeId: true,
          visitRef: true,
        },
      });
      return { visitReconciliationId: id, ...(row ?? {}) };
    }
    const visit =
      operation === 'ENSURE_VISIT' || operation === 'ATTENDANCE_CORRECTION'
        ? await this.prisma.scheduledVisit.findUnique({
            where: { id },
            select: { id: true, scheduledJobId: true, serviceUserId: true },
          })
        : await this.prisma.scheduledVisit.findFirst({
            where: { scheduledJobId: id },
            select: { id: true, scheduledJobId: true, serviceUserId: true },
            orderBy: { scheduledStartDateTime: 'asc' },
          });
    return {
      scheduledJobId: visit?.scheduledJobId ?? (operation === 'ENSURE_JOB' ? id : null),
      scheduledVisitId: visit?.id ?? (operation === 'ENSURE_VISIT' || operation === 'ATTENDANCE_CORRECTION' ? id : null),
      serviceUserId: visit?.serviceUserId ?? null,
    };
  }

  /**
   * Keeps a failed pay calculation where a person will see it. Never throws: recording a failure
   * must not become a second failure. Written outside any caller transaction, which may be aborted.
   */
  private async recordEvaluationFailure(
    operation: PayEvaluationOperation,
    id: string,
    err: unknown,
    retriedByUserId?: string,
    /** What a retry needs to repeat the operation (an attendance correction's reason and carer). */
    retryInput?: Record<string, string | null>,
  ) {
    const failure = classifyEvaluationFailure(err);
    const subjectKey = payEvaluationSubjectKey(operation, id);
    // Ids, error class and code only: the error text of a database failure holds query values.
    const logLine = `Pay evaluation failed ${subjectKey} kind=${failure.kind} category=${failure.category} error=${failure.detail.errorName}${
      failure.detail.errorCode ? ` code=${failure.detail.errorCode}` : ''
    }`;
    if (failure.kind === 'TECHNICAL') this.logger.error(logLine);
    else this.logger.warn(`${logLine}: ${failure.message}`);

    try {
      const now = new Date();
      const subject = await this.evaluationFailureSubject(operation, id);
      const existing = await this.prisma.payEvaluationFailure.findUnique({ where: { subjectKey } });
      const entry = {
        at: now.toISOString(),
        action: retriedByUserId ? 'RETRIED' : existing ? 'FAILED_AGAIN' : 'FAILED',
        byUserId: retriedByUserId ?? null,
        outcome: failure.category,
      };
      const state = {
        kind: failure.kind,
        category: failure.category,
        message: failure.message,
        context: (retryInput ? { ...failure.detail, retryInput } : failure.detail) as Prisma.InputJsonValue,
        retryable: failure.retryable,
        status: 'OPEN',
        lastOccurredAt: now,
        resolvedAt: null,
        resolvedById: null,
        resolution: null,
      };
      if (existing) {
        const history = Array.isArray(existing.history) ? existing.history : [];
        await this.prisma.payEvaluationFailure.update({
          where: { id: existing.id },
          data: {
            ...state,
            ...subject,
            occurrences: { increment: 1 },
            history: [...history, entry] as Prisma.InputJsonValue,
          },
        });
      } else {
        await this.prisma.payEvaluationFailure.create({
          data: { subjectKey, operation, ...subject, ...state, history: [entry] },
        });
      }
    } catch (recordErr) {
      this.logger.error(
        `Could not record pay evaluation failure ${subjectKey}: ${
          recordErr instanceof Error ? recordErr.constructor.name : 'unknown error'
        }`,
      );
    }
  }

  /** Closes an open failure once the same calculation has succeeded. Never throws. */
  private async closeEvaluationFailure(
    operation: PayEvaluationOperation,
    id: string,
    resolution: 'SUCCEEDED_ON_RETRY' | 'SUCCEEDED_LATER',
    userId?: string,
  ) {
    try {
      const subjectKey = payEvaluationSubjectKey(operation, id);
      const open = await this.prisma.payEvaluationFailure.findFirst({
        where: { subjectKey, status: 'OPEN' },
      });
      if (!open) return;
      const now = new Date();
      const history = Array.isArray(open.history) ? open.history : [];
      await this.prisma.payEvaluationFailure.update({
        where: { id: open.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: now,
          resolvedById: userId ?? null,
          resolution,
          history: [
            ...history,
            { at: now.toISOString(), action: userId ? 'RETRIED' : 'SUCCEEDED', byUserId: userId ?? null, outcome: resolution },
          ] as Prisma.InputJsonValue,
        },
      });
    } catch (closeErr) {
      this.logger.error(
        `Could not close pay evaluation failure for ${id}: ${
          closeErr instanceof Error ? closeErr.constructor.name : 'unknown error'
        }`,
      );
    }
  }

  /**
   * Pay calculations that failed and still need attention (or, with `status`, the history).
   * `locationId` limits the list to service users of that branch.
   */
  async listEvaluationFailures(query: { status?: string; locationId?: string }) {
    const status = query.status?.trim().toUpperCase() || 'OPEN';
    const serviceUserIds = query.locationId
      ? await serviceUserIdsForLocation(this.prisma, query.locationId)
      : null;
    const rows = await this.prisma.payEvaluationFailure.findMany({
      where: {
        ...(status === 'ALL' ? {} : { status }),
        ...(serviceUserIds ? { serviceUserId: { in: serviceUserIds } } : {}),
      },
      orderBy: { lastOccurredAt: 'desc' },
      take: 200,
    });
    const employeeIds = [...new Set(rows.map((r) => r.employeeId).filter((v): v is string => !!v))];
    const suIds = [...new Set(rows.map((r) => r.serviceUserId).filter((v): v is string => !!v))];
    const [employees, serviceUsers] = await Promise.all([
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
          })
        : [],
      suIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: suIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
    ]);
    const employeeName = new Map(
      employees.map((e) => [
        e.id,
        [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ') || 'Carer',
      ]),
    );
    const serviceUserName = new Map(
      serviceUsers.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ')]),
    );
    return {
      data: rows.map((r) => ({
        ...r,
        reference: r.id.slice(0, 8),
        employeeName: r.employeeId ? (employeeName.get(r.employeeId) ?? null) : null,
        serviceUserName: r.serviceUserId ? (serviceUserName.get(r.serviceUserId) ?? null) : null,
      })),
    };
  }

  /** Runs the failed calculation again. Success closes the failure; another failure is recorded on it. */
  async retryEvaluationFailure(userId: string, id: string, meta?: RequestAuditMeta) {
    const failure = await this.prisma.payEvaluationFailure.findUnique({ where: { id } });
    if (!failure) throw new NotFoundException('Pay calculation failure not found');
    if (failure.status !== 'OPEN') {
      throw new BadRequestException('This pay calculation failure is already closed.');
    }
    if (!failure.retryable) {
      throw new BadRequestException(failure.message);
    }
    const operation = failure.operation as PayEvaluationOperation;
    const subjectId =
      operation === 'EVALUATE'
        ? failure.visitReconciliationId
        : operation === 'ENSURE_VISIT' || operation === 'ATTENDANCE_CORRECTION'
          ? failure.scheduledVisitId
          : failure.scheduledJobId;
    if (!subjectId) throw new BadRequestException('This failure has nothing left to retry. Dismiss it instead.');

    let succeeded = true;
    try {
      if (operation === 'EVALUATE') await this.evaluateInternal(this.prisma, subjectId);
      else if (operation === 'ATTENDANCE_CORRECTION') {
        // The same correction again, on the times now on record (they were kept when pay failed).
        const input = (failure.context as { retryInput?: { reason?: string; jobAllocationId?: string | null } } | null)?.retryInput;
        await this.carryAttendanceIntoPay(
          subjectId,
          { userId, reason: input?.reason ?? 'Retry of an attendance correction', jobAllocationId: input?.jobAllocationId ?? null },
          meta,
        );
      } else if (operation === 'ENSURE_VISIT') await this.ensureForVisit(subjectId);
      else await this.ensureForCompletedJob(subjectId);
      await this.closeEvaluationFailure(operation, subjectId, 'SUCCEEDED_ON_RETRY', userId);
    } catch (err) {
      succeeded = false;
      await this.recordEvaluationFailure(operation, subjectId, err, userId);
      if (operation === 'ATTENDANCE_CORRECTION') await this.flagPayStepFailed(subjectId, failure, userId, meta);
    }
    const after = await this.prisma.payEvaluationFailure.findUniqueOrThrow({ where: { id } });
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.BILLING,
      action: AuditAction.PAY_EVALUATION_FAILURE_RETRIED,
      recordType: 'PayEvaluationFailure',
      recordId: id,
      oldValues: { status: failure.status, category: failure.category },
      newValues: { status: after.status, category: after.category, succeeded },
      metadata: { subjectKey: failure.subjectKey, employeeId: failure.employeeId, visitRef: failure.visitRef },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
    return {
      message: succeeded
        ? 'The pay calculation succeeded. The visit is back in the normal review list.'
        : `The pay calculation failed again: ${after.message}`,
      data: { ...after, reference: after.id.slice(0, 8), succeeded },
    };
  }

  /** Closes a failure that needs no pay calculation any more (for example a visit entered in error). */
  async dismissEvaluationFailure(userId: string, id: string, reason: string, meta?: RequestAuditMeta) {
    const failure = await this.prisma.payEvaluationFailure.findUnique({ where: { id } });
    if (!failure) throw new NotFoundException('Pay calculation failure not found');
    if (failure.status !== 'OPEN') {
      throw new BadRequestException('This pay calculation failure is already closed.');
    }
    const now = new Date();
    const history = Array.isArray(failure.history) ? failure.history : [];
    const updated = await this.prisma.payEvaluationFailure.update({
      where: { id },
      data: {
        status: 'DISMISSED',
        resolvedAt: now,
        resolvedById: userId,
        resolution: 'DISMISSED',
        history: [
          ...history,
          { at: now.toISOString(), action: 'DISMISSED', byUserId: userId, outcome: 'DISMISSED', note: reason.trim() },
        ] as Prisma.InputJsonValue,
      },
    });
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.BILLING,
      action: AuditAction.PAY_EVALUATION_FAILURE_DISMISSED,
      recordType: 'PayEvaluationFailure',
      recordId: id,
      description: reason.trim(),
      oldValues: { status: failure.status },
      newValues: { status: updated.status },
      metadata: { subjectKey: failure.subjectKey, employeeId: failure.employeeId, visitRef: failure.visitRef },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
    return { message: 'Pay calculation failure dismissed', data: { ...updated, reference: updated.id.slice(0, 8) } };
  }

  private async resolveAllAllocations(
    db: DbClient,
    jobId: string,
    visitId: string,
  ): Promise<
    Array<{
      id: string;
      employeeId: string;
      scheduledStartDateTime: Date | null;
      scheduledEndDateTime: Date | null;
      durationMinutes: number | null;
      actualStartDateTime: Date | null;
      actualEndDateTime: Date | null;
    }>
  > {
    const select = {
      id: true,
      employeeId: true,
      scheduledStartDateTime: true,
      scheduledEndDateTime: true,
      durationMinutes: true,
      actualStartDateTime: true,
      actualEndDateTime: true,
    } as const;
    const visitAllocations = await db.jobAllocation.findMany({
      where: {
        scheduledVisitId: visitId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
      },
      orderBy: [{ isLeadCarer: 'desc' }, { allocatedAt: 'asc' }],
      select,
    });
    if (visitAllocations.length) return visitAllocations;

    const jobAllocations = await db.jobAllocation.findMany({
      where: {
        scheduledJobId: jobId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
      },
      orderBy: [{ isLeadCarer: 'desc' }, { allocatedAt: 'asc' }],
      select,
    });
    if (jobAllocations.length) return jobAllocations;

    // Last resort: any non-cancelled allocation on the job (completed visits must still pay).
    return db.jobAllocation.findMany({
      where: {
        scheduledJobId: jobId,
        deletedAt: null,
        isActive: true,
        status: { notIn: [AllocationStatus.CANCELLED, AllocationStatus.UNALLOCATED] },
      },
      orderBy: [{ isLeadCarer: 'desc' }, { allocatedAt: 'asc' }],
      select,
    });
  }

  private async resolveLeadAllocation(
    db: DbClient,
    jobId: string,
    visitId: string,
  ): Promise<{ id: string; employeeId: string } | null> {
    const all = await this.resolveAllAllocations(db, jobId, visitId);
    return all[0] ?? null;
  }

  async list(query: VisitReconciliationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.VisitReconciliationWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.serviceUserId) where.serviceUserId = query.serviceUserId;
    if (query.employeeId) where.employeeId = query.employeeId;

    if (query.locationId) {
      const locationSuIds = await serviceUserIdsForLocation(this.prisma, query.locationId);
      if (query.serviceUserId) {
        if (!locationSuIds.includes(query.serviceUserId)) {
          return {
            data: [],
            meta: buildPaginationMeta({ total: 0, page, limit }),
          };
        }
      } else if (!locationSuIds.length) {
        return {
          data: [],
          meta: buildPaginationMeta({ total: 0, page, limit }),
        };
      } else {
        where.serviceUserId = { in: locationSuIds };
      }
    }

    if (query.dateFrom || query.dateTo) {
      const range = await this.operationalDateTimeFilter(query.dateFrom, query.dateTo);
      if (range) where.plannedStartDateTime = range;
    }

    if (query.hasExceptions === true) {
      where.exceptions = { some: { resolvedAt: null } };
    } else if (query.hasExceptions === false) {
      where.exceptions = { none: { resolvedAt: null } };
    }

    const nightDutyVisitFilter = await this.scheduledVisitIdsForNightDutyFilter(query.nightDuty);
    if (nightDutyVisitFilter.mode === 'empty') {
      return {
        data: [],
        meta: buildPaginationMeta({ total: 0, page, limit }),
      };
    }
    if (nightDutyVisitFilter.mode === 'in') {
      where.scheduledVisitId = { in: nightDutyVisitFilter.ids };
    } else if (nightDutyVisitFilter.mode === 'notIn' && nightDutyVisitFilter.ids.length) {
      where.scheduledVisitId = { notIn: nightDutyVisitFilter.ids };
    }

    if (query.search?.trim()) {
      const s = query.search.trim();
      const serviceUsers = await this.prisma.serviceUser.findMany({
        where: {
          deletedAt: null,
          OR: [
            { firstName: { contains: s, mode: 'insensitive' } },
            { lastName: { contains: s, mode: 'insensitive' } },
            { preferredName: { contains: s, mode: 'insensitive' } },
            { serviceUserNumber: { contains: s, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 100,
      });
      const suIds = serviceUsers.map((r) => r.id);
      const looksLikeUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
      where.OR = [
        { visitRef: { contains: s, mode: 'insensitive' } },
        ...(looksLikeUuid ? [{ scheduledVisitId: s }] : []),
        ...(suIds.length ? [{ serviceUserId: { in: suIds } }] : []),
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.visitReconciliation.count({ where }),
      this.prisma.visitReconciliation.findMany({
        where,
        include: reconciliationInclude,
        // Newest reconciliation entries first (just completed/synced), then visit time.
        orderBy: [{ createdAt: 'desc' }, { plannedStartDateTime: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const enriched = await this.enrichRows(rows);
    return {
      data: enriched,
      meta: buildPaginationMeta({ total, page, limit }),
    };
  }

  async getById(id: string) {
    const existing = await this.prisma.visitReconciliation.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) throw new NotFoundException('Visit reconciliation not found');
    // Refresh pay/bill figures (e.g. after multi-carer funder charge mode change).
    if (existing.status !== VisitReconciliationStatus.LOCKED) {
      await this.safeEvaluate(this.prisma, id);
    }

    const row = await this.prisma.visitReconciliation.findUnique({
      where: { id },
      include: reconciliationInclude,
    });
    if (!row) throw new NotFoundException('Visit reconciliation not found');
    const [enriched] = await this.enrichRows([row]);
    // Completed visits replay the pricing breakdown captured at completion, so later
    // pay/charge card rule edits do not retro-change how the visit was priced.
    // Re-label visit-slice times into the org timezone (legacy snapshots used UTC).
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const preview =
      row.pricingSnapshot != null
        ? this.alignFrozenPricingSnapshot(row.pricingSnapshot, row, timeZone)
        : await this.buildCalculationPreview(row);
    // Who or what approved, and on which evidence (R-18).
    const approved =
      row.status === VisitReconciliationStatus.APPROVED_FOR_PAY ||
      row.status === VisitReconciliationStatus.APPROVED_FOR_BOTH ||
      row.status === VisitReconciliationStatus.APPROVED_FOR_INVOICE ||
      row.status === VisitReconciliationStatus.LOCKED;
    const approval = {
      source: approved || row.evidenceChangedReason ? inferApprovalSource(row) : null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      approvedByPerson: Boolean(row.approvedById),
      evidenceChangedReason: row.evidenceChangedReason,
      evidenceChangedAt: row.evidenceChangedAt?.toISOString() ?? null,
    };
    // Settled pay is changed through a pay correction, not on this record.
    return {
      data: { ...enriched, paySettled: isPaySettled(row), approval, calculationPreview: preview },
    };
  }

  private alignFrozenPricingSnapshot(
    snapshot: Prisma.JsonValue,
    row: ReconciliationRow,
    timeZone: string,
  ) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return snapshot;
    }
    const preview = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
    const timeWindows =
      preview.timeWindows && typeof preview.timeWindows === 'object'
        ? (preview.timeWindows as Record<string, unknown>)
        : {};
    preview.timeWindows = {
      ...timeWindows,
      planned: formatTimeRange(row.plannedStartDateTime, row.plannedEndDateTime, timeZone),
      actual: formatTimeRange(row.actualStartDateTime, row.actualEndDateTime, timeZone),
      approvedPayable: formatTimeRange(row.approvedPayStart, row.approvedPayEnd, timeZone),
      approvedBillable: formatTimeRange(row.approvedBillStart, row.approvedBillEnd, timeZone),
    };
    preview.carerPay = alignRateBreakdownVisitSliceLabels(
      preview.carerPay as never,
      row.approvedPayStart,
      row.approvedPayEnd,
      timeZone,
    );
    preview.clientCharge = alignRateBreakdownVisitSliceLabels(
      preview.clientCharge as never,
      row.approvedBillStart,
      row.approvedBillEnd,
      timeZone,
    );
    if (Array.isArray(preview.funderClientCharges)) {
      preview.funderClientCharges = preview.funderClientCharges.map((line) => {
        if (!line || typeof line !== 'object') return line;
        const funder = line as Record<string, unknown>;
        return {
          ...funder,
          breakdown: alignRateBreakdownVisitSliceLabels(
            funder.breakdown as never,
            row.approvedBillStart,
            row.approvedBillEnd,
            timeZone,
          ),
        };
      });
    }
    return preview;
  }

  async evaluate(id: string) {
    await this.evaluateInternal(this.prisma, id);
    return this.getById(id);
  }

  /**
   * Re-run exception detection for unlocked reconciliations of a service user.
   * Call after funding / charge-card setup changes so stale exceptions clear without a full sync.
   */
  async reEvaluateForServiceUser(serviceUserId: string): Promise<{ reEvaluated: number }> {
    const pending = await this.prisma.visitReconciliation.findMany({
      where: {
        serviceUserId,
        status: { not: VisitReconciliationStatus.LOCKED },
      },
      select: { id: true },
      take: 1000,
    });
    for (const row of pending) {
      await this.safeEvaluate(this.prisma, row.id);
    }
    return { reEvaluated: pending.length };
  }

  async update(id: string, dto: UpdateVisitReconciliationDto, userId?: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.visitReconciliation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Visit reconciliation not found');
    if (existing.status === VisitReconciliationStatus.LOCKED) {
      throw new BadRequestException('Reconciliation is locked');
    }
    const touchesPay =
      dto.approvedPayStart !== undefined ||
      dto.approvedPayEnd !== undefined ||
      dto.travelMiles !== undefined ||
      dto.travelMinutes !== undefined ||
      dto.unpaidTravelMinutes !== undefined ||
      dto.passengerMiles !== undefined;
    if (touchesPay) this.assertPayNotSettled(existing);

    const data: Prisma.VisitReconciliationUpdateInput = {};
    if (dto.approvedPayStart !== undefined) {
      data.approvedPayStart = dto.approvedPayStart ? new Date(dto.approvedPayStart) : null;
    }
    if (dto.approvedPayEnd !== undefined) {
      data.approvedPayEnd = dto.approvedPayEnd ? new Date(dto.approvedPayEnd) : null;
    }
    if (dto.approvedBillStart !== undefined) {
      data.approvedBillStart = dto.approvedBillStart ? new Date(dto.approvedBillStart) : null;
    }
    if (dto.approvedBillEnd !== undefined) {
      data.approvedBillEnd = dto.approvedBillEnd ? new Date(dto.approvedBillEnd) : null;
    }
    if (dto.approvalNotes !== undefined) {
      data.approvalNotes = dto.approvalNotes.trim() || null;
    }
    if (dto.travelMiles !== undefined) {
      data.travelMiles = dto.travelMiles != null ? dto.travelMiles : null;
    }
    if (dto.travelMinutes !== undefined) {
      data.travelMinutes = dto.travelMinutes != null ? dto.travelMinutes : null;
    }
    if (dto.unpaidTravelMinutes !== undefined) {
      (data as Record<string, unknown>).unpaidTravelMinutes =
        dto.unpaidTravelMinutes != null ? dto.unpaidTravelMinutes : null;
    }
    if (dto.passengerMiles !== undefined) {
      (data as Record<string, unknown>).passengerMiles =
        dto.passengerMiles != null ? dto.passengerMiles : null;
    }

    const requestsPayTime = dto.approvedPayStart !== undefined || dto.approvedPayEnd !== undefined;
    const requested = {
      start: dto.approvedPayStart === undefined ? existing.approvedPayStart : dto.approvedPayStart ? new Date(dto.approvedPayStart) : null,
      end: dto.approvedPayEnd === undefined ? existing.approvedPayEnd : dto.approvedPayEnd ? new Date(dto.approvedPayEnd) : null,
    };
    const travelOf = (r: typeof existing) =>
      [r.travelMiles?.toString() ?? null, r.travelMinutes, r.unpaidTravelMinutes, r.passengerMiles?.toString() ?? null].join('|');

    // The change, the amounts it produces and its audit entry are saved together or not at all.
    // A payable time named by hand is priced like a corrected attendance time: the amount follows
    // the minutes, unless finance entered the amount by hand.
    const reprice = requestsPayTime && !hasManualPayableOverride(existing);
    const payTimeEdit = await this.prisma.$transaction(async (tx) => {
      await tx.visitReconciliation.update({ where: { id }, data });
      await this.evaluateInternal(tx, id, reprice ? { forceRecalculatePay: true } : undefined);
      if (!touchesPay) return null;
      const after = await tx.visitReconciliation.findUniqueOrThrow({ where: { id } });
      const edit = requestsPayTime ? await this.describePayTimeEdit(tx, existing, after, requested, !reprice) : null;
      const payChanged =
        JSON.stringify(VisitReconciliationsService.paySnapshotOf(existing)) !==
          JSON.stringify(VisitReconciliationsService.paySnapshotOf(after)) || travelOf(existing) !== travelOf(after);
      if (payChanged) {
        await this.auditVisit(
          AuditAction.VISIT_RECONCILIATION_UPDATED,
          userId,
          existing,
          {
            oldValues: {
              ...VisitReconciliationsService.paySnapshotOf(existing),
              travelMiles: existing.travelMiles?.toString() ?? null,
              travelMinutes: existing.travelMinutes,
            },
            newValues: {
              ...VisitReconciliationsService.paySnapshotOf(after),
              travelMiles: after.travelMiles?.toString() ?? null,
              travelMinutes: after.travelMinutes,
              ...(edit ? { payTimeOutcome: edit.outcome } : {}),
            },
            reason: dto.approvalNotes,
          },
          meta,
          tx,
        );
      } else if (edit?.outcome === 'PAY_TIME_NOT_APPLIED') {
        // Not a change to pay: a record that it was asked for, and why it had no effect.
        await this.auditVisit(
          AuditAction.VISIT_PAY_TIME_EDIT_NOT_APPLIED,
          userId,
          existing,
          {
            oldValues: VisitReconciliationsService.paySnapshotOf(existing),
            newValues: { requested: edit.requested, effective: edit.effective, rule: edit.rule },
            reason: edit.reason,
          },
          meta,
          tx,
        );
      }
      return edit;
    }, DECISION_TRANSACTION);
    const detail = await this.getById(id);
    // Only a request that names a payable time carries the outcome; other callers see no change.
    return payTimeEdit ? { message: payTimeEdit.message, data: { ...detail, payTimeEdit } } : detail;
  }

  /** The payable window of a visit in words, in the organisation's time zone. */
  private async payWindowText(row: { approvedPayStart: Date | null; approvedPayEnd: Date | null; payableMinutes: number | null }) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const hm = (d: Date | null) =>
      d ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : '—';
    return `${hm(row.approvedPayStart)}–${hm(row.approvedPayEnd)} (${row.payableMinutes ?? 0} min)`;
  }

  /**
   * Why the pay rules set a visit's payable time from its attendance times rather than from a
   * window entered by hand. Read from the same tests the evaluation uses; nothing is decided here.
   */
  private async payTimeRule(
    db: DbClient,
    row: {
      scheduledVisitId: string;
      plannedStartDateTime: Date;
      plannedEndDateTime: Date | null;
      actualStartDateTime: Date | null;
      actualEndDateTime: Date | null;
      overrunMinutes: number | null;
    },
  ): Promise<{ rule: 'DURATION_TOLERANCE' | 'OVERRUN_DECISION' | 'PAY_RULE'; reason: string }> {
    const tolerance = await this.resolveDurationToleranceMinutes(db, row.scheduledVisitId);
    const within = isDurationShortfallWithinTolerance({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: row.plannedEndDateTime ?? new Date(row.plannedStartDateTime.getTime() + 30 * 60_000),
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      durationToleranceMinutes: tolerance,
    });
    if (within) {
      return {
        rule: 'DURATION_TOLERANCE',
        reason: `The visit is within the duration tolerance of ${tolerance} minutes, so it is paid its planned time.`,
      };
    }
    if ((row.overrunMinutes ?? 0) > 0) {
      return {
        rule: 'OVERRUN_DECISION',
        reason: 'The visit overran, so its payable time follows the overrun decision. Approve or reject the overrun to change it.',
      };
    }
    return { rule: 'PAY_RULE', reason: 'A pay rule sets the payable time of this visit from its attendance times.' };
  }

  /** What a request to change the payable time did, after the visit was evaluated again. */
  private async describePayTimeEdit(
    db: DbClient,
    before: { approvedPayStart: Date | null; approvedPayEnd: Date | null },
    after: Parameters<VisitReconciliationsService['payTimeRule']>[1] & {
      approvedPayStart: Date | null;
      approvedPayEnd: Date | null;
      payableMinutes: number | null;
      payableAmount: Prisma.Decimal | null;
    },
    requested: { start: Date | null; end: Date | null },
    manualAmount = false,
  ) {
    const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
    const kept = same(after.approvedPayStart, requested.start) && same(after.approvedPayEnd, requested.end);
    const moved = !same(after.approvedPayStart, before.approvedPayStart) || !same(after.approvedPayEnd, before.approvedPayEnd);
    const window = await this.payWindowText(after);
    const shown = {
      requested: { start: requested.start?.toISOString() ?? null, end: requested.end?.toISOString() ?? null },
      effective: {
        start: after.approvedPayStart?.toISOString() ?? null,
        end: after.approvedPayEnd?.toISOString() ?? null,
        payableMinutes: after.payableMinutes,
      },
    };
    if (kept && moved) {
      const pay = `£${Number(after.payableAmount ?? 0).toFixed(2)}`;
      const amount = manualAmount ? `The payable amount was entered by hand and stays ${pay}.` : `Carer pay is now ${pay}.`;
      return { outcome: 'PAY_TIME_CHANGED' as const, message: `Payable time changed to ${window}. ${amount}`, rule: null, reason: null, ...shown };
    }
    if (kept) {
      return { outcome: 'PAY_TIME_UNCHANGED' as const, message: `Payable time is already ${window}: nothing changed.`, rule: null, reason: null, ...shown };
    }
    const { rule, reason } = await this.payTimeRule(db, after);
    return {
      outcome: 'PAY_TIME_NOT_APPLIED' as const,
      message: `Payable time not changed. ${reason} It stays ${window}.`,
      rule,
      reason,
      ...shown,
    };
  }

  /**
   * Manually set payable amount for salary. Optionally accept the visit for pay
   * so the amount is included in employee salary totals.
   */
  async setPayableAmount(
    userId: string,
    id: string,
    dto: SetVisitPayableAmountDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.visitReconciliation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Visit reconciliation not found');
    if (existing.status === VisitReconciliationStatus.LOCKED) {
      throw new BadRequestException('Reconciliation is locked');
    }
    this.assertPayNotSettled(existing);

    const amount = Math.round(Number(dto.payableAmount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('Payable amount must be a valid non-negative number');
    }

    const approveForPay = dto.approveForPay !== false;
    const note = dto.notes?.trim() || null;
    const existingNote = existing.approvalNotes?.trim() || '';
    const amountNote = `Payable amount set to £${amount.toFixed(2)}`;
    const combinedNotes = [existingNote, note ? `${amountNote}: ${note}` : amountNote]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2000);

    const data: Prisma.VisitReconciliationUpdateInput = {
      payableAmount: amount,
      approvalNotes: combinedNotes || null,
      pricingSnapshot: this.patchManualAmountSnapshot(existing.pricingSnapshot, 'pay', amount),
    };

    if (approveForPay) {
      const payApproved =
        existing.status === VisitReconciliationStatus.APPROVED_FOR_PAY ||
        existing.status === VisitReconciliationStatus.APPROVED_FOR_BOTH;
      if (!payApproved) {
        data.status =
          existing.status === VisitReconciliationStatus.APPROVED_FOR_INVOICE
            ? VisitReconciliationStatus.APPROVED_FOR_BOTH
            : VisitReconciliationStatus.APPROVED_FOR_PAY;
        data.approvedById = userId;
        data.approvedAt = new Date();
        // Entering the amount by hand is a person's decision on the evidence as it stands (R-18).
        data.approvalSource = 'MANAGER_OVERRIDE';
        data.approvedEvidence = null;
        data.evidenceChangedReason = null;
        data.evidenceChangedAt = null;
      }
    }

    // The change, the amounts it produces and its audit entry are saved together or not at all.
    await this.prisma.$transaction(async (tx) => {
      await tx.visitReconciliation.update({ where: { id }, data });
      await this.auditVisit(
        AuditAction.VISIT_RECONCILIATION_PAYABLE_AMOUNT_SET,
        userId,
        existing,
        {
          oldValues: VisitReconciliationsService.paySnapshotOf(existing),
          newValues: { payableAmount: amount.toFixed(2), status: String(data.status ?? existing.status) },
          reason: note,
        },
        meta,
        tx,
      );
    }, DECISION_TRANSACTION);
    return this.getById(id);
  }

  /**
   * Block editing a visit's client charge once it sits on an approved-or-later
   * invoice run. `includedInInvoiceRunId` only covers LOCKED+ runs, so this catches
   * the APPROVED window where the invoice is frozen but the flag is not yet set.
   */
  private async assertBillableNotOnApprovedInvoice(reconciliationId: string) {
    const line = await this.prisma.invoiceRunLine.findFirst({
      where: {
        visitReconciliationId: reconciliationId,
        invoiceRun: { status: { in: APPROVED_INVOICE_RUN_STATUSES } },
      },
      select: {
        invoiceRun: { select: { status: true, invoiceNumber: true, periodLabel: true } },
      },
    });
    if (!line) return;

    const run = line.invoiceRun;
    const ref = run.invoiceNumber ? ` ${run.invoiceNumber}` : '';
    throw new BadRequestException(
      `This visit's charge is already on an approved invoice run${ref} (${run.periodLabel}). ` +
        'The invoice amount is locked and cannot be recalculated, so the client charge cannot be ' +
        'changed here — it would no longer match the issued invoice. Delete or re-run that invoice ' +
        'run first if the charge must change.',
    );
  }

  /**
   * Manually set billable (client/funder) amount. Optionally accept the visit for invoice.
   * Stores the visit total; multi-funder % splits continue from that total on invoice runs.
   */
  async setBillableAmount(userId: string, id: string, dto: SetVisitBillableAmountDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.visitReconciliation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Visit reconciliation not found');
    if (existing.status === VisitReconciliationStatus.LOCKED) {
      throw new BadRequestException('Reconciliation is locked');
    }
    if (existing.includedInInvoiceRunId) {
      throw new BadRequestException(
        'Visit is already included in an invoice run — unlock or remove it before changing the amount',
      );
    }

    // Approved (but not yet locked) invoice runs do not set includedInInvoiceRunId,
    // so guard against them here — the invoice charge is already frozen and cannot be
    // recalculated, so editing the amount would desync the reconciliation and invoice.
    await this.assertBillableNotOnApprovedInvoice(id);

    const amount = Math.round(Number(dto.billableAmount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('Billable amount must be a valid non-negative number');
    }

    const approveForInvoice = dto.approveForInvoice !== false;
    const note = dto.notes?.trim() || null;
    const existingNote = existing.approvalNotes?.trim() || '';
    const amountNote = `Billable amount set to £${amount.toFixed(2)}`;
    const combinedNotes = [existingNote, note ? `${amountNote}: ${note}` : amountNote]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2000);

    const data: Prisma.VisitReconciliationUpdateInput = {
      billableAmount: amount,
      approvalNotes: combinedNotes || null,
      pricingSnapshot: this.patchManualAmountSnapshot(existing.pricingSnapshot, 'bill', amount),
    };

    const invoiceApproved =
      existing.status === VisitReconciliationStatus.APPROVED_FOR_INVOICE ||
      existing.status === VisitReconciliationStatus.APPROVED_FOR_BOTH;
    if (approveForInvoice && !invoiceApproved) {
      data.status =
        existing.status === VisitReconciliationStatus.APPROVED_FOR_PAY
          ? VisitReconciliationStatus.APPROVED_FOR_BOTH
          : VisitReconciliationStatus.APPROVED_FOR_INVOICE;
      data.approvedById = userId;
      data.approvedAt = new Date();
    }

    // The same amount, already entered by hand, with nothing to approve: nothing is written or
    // audited, so sending the request again changes nothing.
    const previous = existing.billableAmount == null ? null : Number(existing.billableAmount).toFixed(2);
    if (previous === amount.toFixed(2) && hasManualBillableOverride(existing) && !data.status) {
      return this.getById(id);
    }

    // The charge (and the invoice approval it implies) and its audit entry are saved together or
    // not at all. Carer pay is not touched.
    await this.prisma.$transaction(async (tx) => {
      await tx.visitReconciliation.update({ where: { id }, data });
      await this.auditVisit(
        AuditAction.VISIT_RECONCILIATION_BILLABLE_AMOUNT_SET,
        userId,
        existing,
        {
          oldValues: { billableAmount: previous, status: String(existing.status) },
          newValues: {
            billableAmount: amount.toFixed(2),
            status: String(data.status ?? existing.status),
            approvedForInvoice: !!data.status,
            permission: 'billing.visit_reconciliations.manage',
          },
          reason: note,
        },
        meta,
        tx,
      );
    }, DECISION_TRANSACTION);
    return this.getById(id);
  }

  /** Keep frozen pricing preview totals in sync with a manual amount override. */
  private patchManualAmountSnapshot(
    snapshot: Prisma.JsonValue | null,
    side: 'pay' | 'bill',
    amount: number,
  ): Prisma.InputJsonValue {
    const snap =
      snapshot != null && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? (JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const money = formatMoney(amount);
    if (side === 'pay') {
      if (snap.carerPay && typeof snap.carerPay === 'object' && !Array.isArray(snap.carerPay)) {
        const carerPay = snap.carerPay as Record<string, unknown>;
        carerPay.amount = money;
        carerPay.manualOverride = true;
        carerPay.explanation = 'Manual payable amount override';
      } else {
        snap.carerPay = {
          amount: money,
          minutes: 0,
          hoursLabel: '—',
          rateType: 'MANUAL',
          unitRate: null,
          formula: 'Manual override',
          cardName: null,
          cardCode: null,
          cardSource: null,
          ruleLabel: 'Manual payable amount',
          manualOverride: true,
          explanation: 'Manual payable amount override',
          appliedRules: [],
          segments: [],
        };
      }
    } else {
      if (
        snap.clientCharge &&
        typeof snap.clientCharge === 'object' &&
        !Array.isArray(snap.clientCharge)
      ) {
        const clientCharge = snap.clientCharge as Record<string, unknown>;
        clientCharge.amount = money;
        clientCharge.manualOverride = true;
        clientCharge.explanation = 'Manual billable amount override';
      } else {
        snap.clientCharge = {
          amount: money,
          minutes: 0,
          hoursLabel: '—',
          rateType: 'MANUAL',
          unitRate: null,
          formula: 'Manual override',
          cardName: null,
          cardCode: null,
          cardSource: null,
          ruleLabel: 'Manual billable amount',
          manualOverride: true,
          explanation: 'Manual billable amount override',
          appliedRules: [],
          segments: [],
        };
      }
      // Total was set by hand — drop stale per-funder card breakdowns.
      snap.funderClientCharges = null;
      snap.funderChargeNote =
        'Client charge was set manually as a visit total. Multi-funder % splits still apply on invoice runs from this total.';
    }
    snap.pricingFrozen = true;
    snap.pricingFrozenNote =
      side === 'pay'
        ? 'Carer pay includes a manual amount override.'
        : 'Client charge includes a manual amount override.';
    return snap as Prisma.InputJsonValue;
  }

  async approve(
    userId: string,
    id: string,
    dto: ApproveVisitReconciliationDto,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.prisma.visitReconciliation.findUnique({
      where: { id },
      include: reconciliationInclude,
    });
    if (!row) throw new NotFoundException('Visit reconciliation not found');
    if (row.status === VisitReconciliationStatus.LOCKED) {
      throw new BadRequestException('Reconciliation is locked');
    }

    const exceptions = row.exceptions
      .filter((e) => !e.resolvedAt)
      .map((e) => ({ code: e.code, message: e.message ?? '' }));

    const scope = dto.scope;
    const payOnly = scope === 'PAY';
    const invoiceOnly = scope === 'INVOICE';

    if (!dto.managerOverride) {
      if (payOnly && hasPayBlockingExceptions(exceptions)) {
        throw new BadRequestException(
          `Pay cannot be approved until pay setup is fixed. Unresolved: ${listPayBlockingCodes(exceptions).join(', ')}`,
        );
      }
      if (!payOnly && hasUnresolvedBlockingExceptions(exceptions)) {
        const blocking = listUnresolvedBlockingCodes(exceptions);
        throw new BadRequestException(
          `Blocking exceptions must be resolved before approval, or use manager override. Unresolved: ${blocking.join(', ')}`,
        );
      }
    }

    if (
      !invoiceOnly &&
      row.overrunDecision === VisitOverrunDecision.PENDING &&
      (row.overrunMinutes ?? 0) > 0 &&
      !dto.managerOverride
    ) {
      throw new BadRequestException(
        'Review the overrun flag first (acknowledge or reject). Gross pay uses planned visit time.',
      );
    }

    const defaults = resolveDefaultApprovedWindows({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: row.plannedEndDateTime,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      exceptions,
      durationToleranceMinutes: await this.resolveDurationToleranceMinutes(
        this.prisma,
        row.scheduledVisitId,
      ),
    });

    const approvedPayStart = row.approvedPayStart ?? defaults.approvedPayStart;
    const approvedPayEnd = row.approvedPayEnd ?? defaults.approvedPayEnd;
    const approvedBillStart = row.approvedBillStart ?? defaults.approvedBillStart;
    const approvedBillEnd = row.approvedBillEnd ?? defaults.approvedBillEnd;

    let status = row.status;
    if (dto.scope === 'PAY') {
      status = VisitReconciliationStatus.APPROVED_FOR_PAY;
    } else if (dto.scope === 'INVOICE') {
      status = VisitReconciliationStatus.APPROVED_FOR_INVOICE;
    } else {
      status = VisitReconciliationStatus.APPROVED_FOR_BOTH;
    }

    // Additive default: approving one side when the other is already approved promotes
    // to BOTH. The three-choice buttons pass `exclusive` to set the decision definitively
    // (e.g. "Funders" always means bill-only / carer £0, even if pay was approved before).
    if (!dto.exclusive) {
      if (
        row.status === VisitReconciliationStatus.APPROVED_FOR_PAY &&
        dto.scope === 'INVOICE'
      ) {
        status = VisitReconciliationStatus.APPROVED_FOR_BOTH;
      } else if (
        row.status === VisitReconciliationStatus.APPROVED_FOR_INVOICE &&
        dto.scope === 'PAY'
      ) {
        status = VisitReconciliationStatus.APPROVED_FOR_BOTH;
      }
    }

    // A settled visit keeps its pay approval; only the charge side can still be decided.
    const paySettled = isPaySettled(row);
    if (
      paySettled &&
      status !== VisitReconciliationStatus.APPROVED_FOR_PAY &&
      status !== VisitReconciliationStatus.APPROVED_FOR_BOTH
    ) {
      throw new BadRequestException(PAY_SETTLED_MESSAGE);
    }

    // The decision, the amounts it produces and its audit entry are saved together or not at all.
    await this.prisma.$transaction(async (tx) => {
      await tx.visitReconciliation.update({
        where: { id },
        data: {
          ...(paySettled ? {} : { approvedPayStart, approvedPayEnd }),
          approvedBillStart,
          approvedBillEnd,
          approvalNotes: dto.approvalNotes?.trim() || row.approvalNotes,
          approvedById: userId,
          approvedAt: new Date(),
          status,
          // R-18: a person approved, on the evidence as it stands now (recorded by the evaluation
          // that follows). An earlier "evidence changed" flag is answered by this approval; on a
          // settled visit the flag is about its pay and stays until the times are verified.
          ...(paySettled
            ? {}
            : {
                approvalSource: dto.managerOverride ? 'MANAGER_OVERRIDE' : 'MANAGER_APPROVED',
                approvedEvidence: null,
                evidenceChangedReason: null,
                evidenceChangedAt: null,
              }),
        },
      });

      await this.evaluateInternal(tx, id);
      const after = await tx.visitReconciliation.findUniqueOrThrow({ where: { id } });
      await this.auditVisit(
        AuditAction.VISIT_RECONCILIATION_APPROVED,
        userId,
        row,
        {
          oldValues: VisitReconciliationsService.paySnapshotOf(row),
          newValues: {
            ...VisitReconciliationsService.paySnapshotOf(after),
            scope: dto.scope ?? 'BOTH',
            managerOverride: Boolean(dto.managerOverride),
          },
          reason: dto.approvalNotes,
        },
        meta,
        tx,
      );
    }, DECISION_TRANSACTION);
    return this.getById(id);
  }

  async reject(
    userId: string,
    id: string,
    dto: RejectVisitReconciliationDto,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.prisma.visitReconciliation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Visit reconciliation not found');
    if (row.status === VisitReconciliationStatus.LOCKED) {
      throw new BadRequestException('Reconciliation is locked');
    }

    let status = row.status;
    if (dto.scope === 'PAY') status = VisitReconciliationStatus.REJECTED_FOR_PAY;
    else if (dto.scope === 'INVOICE') status = VisitReconciliationStatus.REJECTED_FOR_INVOICE;
    else status = VisitReconciliationStatus.REJECTED_FOR_PAY;
    // Pay that is already settled cannot be rejected; the charge side still can.
    if (status === VisitReconciliationStatus.REJECTED_FOR_PAY) this.assertPayNotSettled(row);

    // The decision, the amounts it produces and its audit entry are saved together or not at all.
    await this.prisma.$transaction(async (tx) => {
      await tx.visitReconciliation.update({
        where: { id },
        data: {
          status,
          approvalNotes: dto.approvalNotes?.trim() || row.approvalNotes,
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
      await this.auditVisit(
        AuditAction.VISIT_RECONCILIATION_REJECTED,
        userId,
        row,
        {
          oldValues: { status: String(row.status) },
          newValues: { status: String(status), scope: dto.scope ?? 'PAY' },
          reason: dto.approvalNotes,
        },
        meta,
        tx,
      );
    }, DECISION_TRANSACTION);

    return this.getById(id);
  }

  async approveOverrun(
    userId: string,
    id: string,
    dto: DecideVisitOverrunDto,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.prisma.visitReconciliation.findUnique({
      where: { id },
      include: reconciliationInclude,
    });
    if (!row) throw new NotFoundException('Visit reconciliation not found');
    if (row.status === VisitReconciliationStatus.LOCKED) {
      throw new BadRequestException('Reconciliation is locked');
    }
    if (!row.overrunMinutes || row.overrunMinutes <= 0) {
      throw new BadRequestException('This visit has no overrun to approve');
    }
    if (isPaySettled(row)) {
      // Pay is history; the client charge has its own lifecycle and can still be decided (R-07).
      if (dto.applyTo !== 'CHARGE') {
        throw new BadRequestException(
          `${PAY_SETTLED_MESSAGE} The client charge can still be decided: choose "charge only".`,
        );
      }
      return this.decideChargeOverrunOnSettledVisit(userId, row, dto.timeBasis ?? 'ACTUAL', dto, meta);
    }

    // Admin choice: planned vs actual time, for carer pay, client charge or both.
    // The side that is not chosen stays on the planned slot (as while the overrun was pending).
    // Omitted (older callers) keeps the legacy rule: pay actual, charge from actual.
    const applyTo = dto.applyTo ?? (dto.timeBasis ? 'BOTH' : null);
    const timeBasis = dto.timeBasis ?? (applyTo ? 'ACTUAL' : null);
    const overrunPayBasis =
      applyTo && timeBasis
        ? applyTo === 'CHARGE'
          ? VisitOverrunTimeBasis.PLANNED
          : (timeBasis as VisitOverrunTimeBasis)
        : null;
    const overrunBillBasis =
      applyTo && timeBasis
        ? applyTo === 'PAY'
          ? VisitOverrunTimeBasis.PLANNED
          : (timeBasis as VisitOverrunTimeBasis)
        : null;

    const defaults = resolveDefaultApprovedWindows({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: row.plannedEndDateTime,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      exceptions: [{ code: FinanceExceptionCode.OVERRUN, message: '' }],
      overrunDecision: VisitOverrunDecision.APPROVED,
      overrunPayBasis,
      overrunBillBasis,
      durationToleranceMinutes: await this.resolveDurationToleranceMinutes(
        this.prisma,
        row.scheduledVisitId,
      ),
    });

    const notes = [row.approvalNotes, dto.notes?.trim()].filter(Boolean).join('\n') || null;

    // The decision, the amounts it produces and its audit entry are saved together or not at all.
    await this.prisma.$transaction(async (tx) => {
      await tx.visitReconciliation.update({
        where: { id },
        data: {
          overrunDecision: VisitOverrunDecision.APPROVED,
          overrunPayBasis,
          overrunBillBasis,
          approvedPayStart: defaults.approvedPayStart,
          approvedPayEnd: defaults.approvedPayEnd,
          approvedBillStart: defaults.approvedBillStart,
          approvedBillEnd: defaults.approvedBillEnd,
          approvalNotes: notes,
          approvedById: userId,
          approvedAt: new Date(),
          status: VisitReconciliationStatus.PENDING_REVIEW,
        },
      });

      // Reprice with the decided time windows (completed visits otherwise keep stored amounts).
      await this.evaluateInternal(tx, id, { forceRecalculateAmounts: true });
      await this.auditOverrunDecision(userId, row, 'APPROVED', dto, meta, tx);
    }, DECISION_TRANSACTION);
    return this.getById(id);
  }

  /**
   * Overrun decision for the client charge of a visit whose carer pay is already settled (R-07).
   * Only charge-side fields are written: the pay window, amount and approval stay exactly as paid,
   * and the basis the carer was paid on is carried forward so later pay corrections are worked out
   * on the same footing. A charge that sits on an approved invoice follows the invoice process.
   */
  private async decideChargeOverrunOnSettledVisit(
    userId: string,
    row: {
      id: string;
      visitRef: string;
      employeeId: string | null;
      scheduledVisitId: string;
      status: VisitReconciliationStatus;
      plannedStartDateTime: Date;
      plannedEndDateTime: Date | null;
      actualStartDateTime: Date | null;
      actualEndDateTime: Date | null;
      approvedPayStart: Date | null;
      approvedPayEnd: Date | null;
      payableAmount: Prisma.Decimal | null;
      payableMinutes: number | null;
      billableAmount: Prisma.Decimal | null;
      overrunMinutes: number | null;
      overrunDecision: VisitOverrunDecision | null;
      overrunPayBasis: VisitOverrunTimeBasis | null;
      approvalNotes: string | null;
    },
    billBasis: 'PLANNED' | 'ACTUAL',
    dto: DecideVisitOverrunDto,
    meta?: RequestAuditMeta,
  ) {
    await this.assertBillableNotOnApprovedInvoice(row.id);
    // What the carer was paid on: decided ACTUAL, the older "acknowledged = actual" rule, or planned.
    const payBasis: VisitOverrunTimeBasis =
      row.overrunDecision === VisitOverrunDecision.APPROVED
        ? (row.overrunPayBasis ?? VisitOverrunTimeBasis.ACTUAL)
        : VisitOverrunTimeBasis.PLANNED;
    const anyActual = payBasis === VisitOverrunTimeBasis.ACTUAL || billBasis === 'ACTUAL';
    const overrunDecision = anyActual ? VisitOverrunDecision.APPROVED : VisitOverrunDecision.REJECTED;
    const windows = resolveDefaultApprovedWindows({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: row.plannedEndDateTime,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      exceptions: [{ code: FinanceExceptionCode.OVERRUN, message: '' }],
      overrunDecision,
      overrunPayBasis: anyActual ? payBasis : null,
      overrunBillBasis: anyActual ? (billBasis as VisitOverrunTimeBasis) : null,
      durationToleranceMinutes: await this.resolveDurationToleranceMinutes(this.prisma, row.scheduledVisitId),
    });
    // The decision, the amounts it produces and its audit entry are saved together or not at all.
    await this.prisma.$transaction(async (tx) => {
      await tx.visitReconciliation.update({
        where: { id: row.id },
        data: {
          overrunDecision,
          overrunPayBasis: anyActual ? payBasis : null,
          overrunBillBasis: anyActual ? (billBasis as VisitOverrunTimeBasis) : null,
          approvedBillStart: windows.approvedBillStart,
          approvedBillEnd: windows.approvedBillEnd,
          approvalNotes: [row.approvalNotes, dto.notes?.trim()].filter(Boolean).join('\n') || null,
        },
      });
      // Reprices the charge; the pay snapshot of a settled visit is never written.
      await this.evaluateInternal(tx, row.id, { forceRecalculateAmounts: true });
      const after = await tx.visitReconciliation.findUniqueOrThrow({ where: { id: row.id } });
      await this.auditVisit(
        AuditAction.VISIT_RECONCILIATION_OVERRUN_DECIDED,
        userId,
        row,
        {
          oldValues: { billableAmount: row.billableAmount?.toString() ?? null, ...VisitReconciliationsService.paySnapshotOf(row) },
          newValues: {
            billableAmount: after.billableAmount?.toString() ?? null,
            ...VisitReconciliationsService.paySnapshotOf(after),
            decision: 'CHARGE_ONLY',
            chargeBasis: billBasis,
            overrunMinutes: row.overrunMinutes,
          },
          reason: dto.notes,
        },
        meta,
        tx,
      );
    }, DECISION_TRANSACTION);
    return this.getById(row.id);
  }

  private async auditOverrunDecision(
    userId: string,
    before: Parameters<typeof VisitReconciliationsService.paySnapshotOf>[0] & {
      id: string;
      visitRef?: string | null;
      employeeId?: string | null;
      overrunMinutes: number | null;
    },
    decision: 'APPROVED' | 'REJECTED',
    dto: DecideVisitOverrunDto,
    meta?: RequestAuditMeta,
    tx?: Prisma.TransactionClient,
  ) {
    const after = await this.client(tx).visitReconciliation.findUniqueOrThrow({ where: { id: before.id } });
    await this.auditVisit(
      AuditAction.VISIT_RECONCILIATION_OVERRUN_DECIDED,
      userId,
      before,
      {
        oldValues: VisitReconciliationsService.paySnapshotOf(before),
        newValues: {
          ...VisitReconciliationsService.paySnapshotOf(after),
          decision,
          overrunMinutes: before.overrunMinutes,
          timeBasis: dto.timeBasis ?? null,
          applyTo: dto.applyTo ?? null,
        },
        reason: dto.notes,
      },
      meta,
      tx,
    );
  }

  async rejectOverrun(
    userId: string,
    id: string,
    dto: DecideVisitOverrunDto,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.prisma.visitReconciliation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Visit reconciliation not found');
    if (row.status === VisitReconciliationStatus.LOCKED) {
      throw new BadRequestException('Reconciliation is locked');
    }
    if (!row.overrunMinutes || row.overrunMinutes <= 0) {
      throw new BadRequestException('This visit has no overrun to reject');
    }
    if (isPaySettled(row)) {
      // Rejecting the overrun of a paid visit can only mean "charge the planned time": pay stays.
      return this.decideChargeOverrunOnSettledVisit(userId, row, 'PLANNED', dto, meta);
    }

    const defaults = resolveDefaultApprovedWindows({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: row.plannedEndDateTime,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      exceptions: [{ code: FinanceExceptionCode.OVERRUN, message: '' }],
      overrunDecision: VisitOverrunDecision.REJECTED,
      durationToleranceMinutes: await this.resolveDurationToleranceMinutes(
        this.prisma,
        row.scheduledVisitId,
      ),
    });
    const notes = [row.approvalNotes, dto.notes?.trim()].filter(Boolean).join('\n') || null;

    // The decision, the amounts it produces and its audit entry are saved together or not at all.
    await this.prisma.$transaction(async (tx) => {
      await tx.visitReconciliation.update({
        where: { id },
        data: {
          overrunDecision: VisitOverrunDecision.REJECTED,
          overrunPayBasis: null,
          overrunBillBasis: null,
          approvedPayStart: defaults.approvedPayStart,
          approvedPayEnd: defaults.approvedPayEnd,
          approvedBillStart: defaults.approvedBillStart,
          approvedBillEnd: defaults.approvedBillEnd,
          approvalNotes: notes,
          approvedById: userId,
          approvedAt: new Date(),
          status: VisitReconciliationStatus.PENDING_REVIEW,
        },
      });

      // Reprice with the decided time windows (completed visits otherwise keep stored amounts).
      await this.evaluateInternal(tx, id, { forceRecalculateAmounts: true });
      await this.auditOverrunDecision(userId, row, 'REJECTED', dto, meta, tx);
    }, DECISION_TRANSACTION);
    return this.getById(id);
  }

  async bulkApprove(userId: string, dto: BulkApproveVisitReconciliationsDto) {
    const rows = await this.prisma.visitReconciliation.findMany({
      where: { id: { in: dto.ids } },
      include: reconciliationInclude,
    });

    const approved: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const row of rows) {
      const exceptions = row.exceptions
        .filter((e) => !e.resolvedAt)
        .map((e) => ({ code: e.code, message: e.message ?? '' }));

      if (row.status === VisitReconciliationStatus.LOCKED) {
        skipped.push({ id: row.id, reason: 'Already locked' });
        continue;
      }

      if (hasUnresolvedBlockingExceptions(exceptions)) {
        const blocking = listUnresolvedBlockingCodes(exceptions);
        skipped.push({
          id: row.id,
          reason: `Blocking exceptions present: ${blocking.join(', ')}`,
        });
        continue;
      }

      if (row.status === VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL) {
        skipped.push({ id: row.id, reason: 'Requires manager approval' });
        continue;
      }

      try {
        await this.approve(userId, row.id, {
          scope: dto.scope,
          exclusive: true,
          approvalNotes: dto.approvalNotes,
        });
        approved.push(row.id);
      } catch (e) {
        skipped.push({
          id: row.id,
          reason: e instanceof Error ? e.message : 'Approval failed',
        });
      }
    }

    return {
      message: `Approved ${approved.length} visit(s)`,
      data: { approved, skipped },
    };
  }

  async backfill(dto: BackfillVisitReconciliationsDto) {
    const where: Prisma.ScheduledVisitWhereInput = {
      ...billingEligibleVisitWhere(),
    };

    if (dto.dateFrom || dto.dateTo) {
      const range = await this.operationalDateTimeFilter(dto.dateFrom, dto.dateTo);
      if (range) where.scheduledStartDateTime = range;
    }

    const visits = await this.prisma.scheduledVisit.findMany({
      where,
      select: { id: true },
      orderBy: { scheduledStartDateTime: 'asc' },
      take: 500,
    });

    const created: string[] = [];
    for (const visit of visits) {
      const id = await this.ensureForVisit(visit.id);
      if (id) created.push(id);
    }

    // Re-evaluate unlocked rows so org billing policy changes (e.g. COMBINED vs FIXED
    // multi-carer funder charge) refresh stored pay/bill amounts.
    const recalculated = await this.recalculateAmounts({
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
    });

    return {
      message: `Processed ${visits.length} completed visit(s); re-evaluated ${recalculated.data.reEvaluated} reconciliation(s)`,
      data: {
        count: created.length,
        ids: created,
        reEvaluated: recalculated.data.reEvaluated,
      },
    };
  }

  /**
   * Re-run card resolution and payable/billable amount calculation for unlocked rows.
   * Does not create new reconciliations — use backfill/sync for that.
   * Manual carer/client amount overrides are preserved (only card-derived amounts reprice).
   */
  /** `reason` comes from the user-triggered action and is audited; internal re-runs omit it. */
  /**
   * Reprices one visit for a recalculation a person asked for. The new amounts and the audit entry
   * of the change are one transaction; a visit whose amounts do not change gets no entry, so asking
   * twice records nothing twice. A failure is kept as an open pay evaluation failure, as elsewhere.
   */
  private async recalculateAudited(
    row: {
      id: string;
      visitRef: string;
      employeeId: string | null;
      payableAmount: Prisma.Decimal | null;
      billableAmount: Prisma.Decimal | null;
    },
    reason: string,
    userId?: string,
    meta?: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<boolean> {
    const amount = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v).toFixed(2));
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.evaluateInternal(tx, row.id, { forceRecalculateAmounts: true });
        const next = await tx.visitReconciliation.findUnique({
          where: { id: row.id },
          select: { payableAmount: true, billableAmount: true },
        });
        if (!next) return;
        const before = { payableAmount: amount(row.payableAmount), billableAmount: amount(row.billableAmount) };
        const after = { payableAmount: amount(next.payableAmount), billableAmount: amount(next.billableAmount) };
        if (before.payableAmount === after.payableAmount && before.billableAmount === after.billableAmount) return;
        await this.auditVisit(
          AuditAction.VISIT_RECONCILIATION_AMOUNTS_RECALCULATED,
          userId,
          row,
          { oldValues: before, newValues: after, reason },
          meta ? { ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null } : undefined,
          tx,
        );
      }, DECISION_TRANSACTION);
      await this.closeEvaluationFailure('EVALUATE', row.id, 'SUCCEEDED_LATER');
      return true;
    } catch (err) {
      await this.recordEvaluationFailure('EVALUATE', row.id, err);
      return false;
    }
  }

  async recalculateAmounts(
    dto: Omit<RecalculateVisitReconciliationsDto, 'reason'> & { reason?: string },
    userId?: string,
    meta?: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    // Visits whose pay is settled stay in scope for their charge side only: evaluateInternal never
    // reprices or rewrites the pay snapshot of a settled visit, forced or not.
    const where: Prisma.VisitReconciliationWhereInput = {
      status: { not: VisitReconciliationStatus.LOCKED },
    };

    if (dto.ids?.length) {
      where.id = { in: dto.ids };
    }

    if (dto.dateFrom || dto.dateTo) {
      const range = await this.operationalDateTimeFilter(dto.dateFrom, dto.dateTo);
      if (range) where.plannedStartDateTime = range;
    }

    const RECALC_LIMIT = 1000;
    const amountSelect = { id: true, payableAmount: true, billableAmount: true } as const;
    const pending = await this.prisma.visitReconciliation.findMany({
      where,
      select: {
        ...amountSelect,
        visitRef: true,
        plannedStartDateTime: true,
        serviceUserId: true,
        employeeId: true,
      },
      orderBy: { plannedStartDateTime: 'asc' },
      take: RECALC_LIMIT,
    });

    const reason = dto.reason?.trim();
    const failedIds = new Set<string>();
    for (const row of pending) {
      // Asked for by a person (a reason is given): each visit whose amounts change gets its own
      // audit entry, saved with the change. Without a reason this is a system refresh, as before.
      const ok = reason
        ? await this.recalculateAudited(row, reason, userId, meta)
        : await this.safeEvaluate(this.prisma, row.id, { forceRecalculateAmounts: true });
      if (!ok) failedIds.add(row.id);
    }
    const failed = failedIds.size;

    // Before / after amounts for the summary shown after recalculating.
    const after = await this.prisma.visitReconciliation.findMany({
      where: { id: { in: pending.map((r) => r.id) } },
      select: amountSelect,
    });
    const afterById = new Map(after.map((r) => [r.id, r]));
    const num = (v: Prisma.Decimal | null | undefined) => (v == null ? 0 : Number(v));
    const same = (a: Prisma.Decimal | null | undefined, b: Prisma.Decimal | null | undefined) =>
      (a == null && b == null) || (a != null && b != null && num(a) === num(b));
    const round2 = (v: number) => Math.round(v * 100) / 100;

    // Names for the per-visit list in the summary.
    const suIds = [...new Set(pending.map((r) => r.serviceUserId))];
    const empIds = [...new Set(pending.map((r) => r.employeeId).filter((id): id is string => !!id))];
    const [serviceUsers, employees] = await Promise.all([
      suIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: suIds } },
            select: { id: true, firstName: true, lastName: true, preferredName: true },
          })
        : [],
      empIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: empIds } },
            select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
          })
        : [],
    ]);
    const suName = new Map(serviceUsers.map((su) => [su.id, formatPersonName(su)]));
    const empName = new Map(
      employees.map((e) => [
        e.id,
        [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ').trim(),
      ]),
    );

    let changed = 0;
    let payableBefore = 0;
    let payableAfter = 0;
    let billableBefore = 0;
    let billableAfter = 0;
    const visits = pending.map((row) => {
      const next = afterById.get(row.id);
      payableBefore += num(row.payableAmount);
      billableBefore += num(row.billableAmount);
      payableAfter += num(next?.payableAmount);
      billableAfter += num(next?.billableAmount);
      const rowChanged = Boolean(
        next &&
          (!same(row.payableAmount, next.payableAmount) ||
            !same(row.billableAmount, next.billableAmount)),
      );
      if (rowChanged) changed += 1;
      return {
        id: row.id,
        visitRef: row.visitRef,
        plannedStartDateTime: row.plannedStartDateTime.toISOString(),
        serviceUserName: suName.get(row.serviceUserId) ?? null,
        employeeName: (row.employeeId && empName.get(row.employeeId)) || null,
        payableBefore: row.payableAmount == null ? null : num(row.payableAmount),
        payableAfter: next?.payableAmount == null ? null : num(next.payableAmount),
        billableBefore: row.billableAmount == null ? null : num(row.billableAmount),
        billableAfter: next?.billableAmount == null ? null : num(next.billableAmount),
        changed: rowChanged,
        failed: failedIds.has(row.id),
      };
    });

    const requested = dto.ids?.length ?? null;
    const summary = {
      reEvaluated: pending.length,
      changed,
      unchanged: pending.length - changed - failed,
      failed,
      skippedLocked: requested != null ? Math.max(0, requested - pending.length) : 0,
      limitReached: pending.length >= RECALC_LIMIT,
      totals: {
        payableBefore: round2(payableBefore),
        payableAfter: round2(payableAfter),
        billableBefore: round2(billableBefore),
        billableAfter: round2(billableAfter),
      },
    };

    // The summary of the batch. Each changed visit already has its own entry, saved with its change.
    if (reason) {
      await this.auditLogs.logAudit({
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.VISIT_RECONCILIATION_AMOUNTS_RECALCULATED,
        recordType: 'VisitReconciliation',
        recordId: requested != null ? 'selected' : 'all',
        description: reason,
        newValues: summary,
        metadata: {
          reason,
          scope: requested != null ? 'selected' : 'all',
          dateFrom: dto.dateFrom ?? null,
          dateTo: dto.dateTo ?? null,
          changedVisitRefs: visits.filter((v) => v.changed).map((v) => v.visitRef).slice(0, 500),
        },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    }

    return {
      message: `Recalculated amounts for ${pending.length} reconciliation(s)`,
      data: { ...summary, visits, ids: pending.map((r) => r.id) },
    };
  }

  /**
   * Delete visit reconciliations (and dependent finance lines).
   * When `serviceUserId` is set, only that client's rows are removed.
   * Does not reset scheduled visits — use Sync completed visits to recreate.
   */
  async clearAll(serviceUserId?: string, userId?: string, meta?: RequestAuditMeta) {
    // Test reset only: refused in production and unless the server opts in (SI-06).
    assertFinancialResetEnvironment();
    const scopedWhere = serviceUserId?.trim()
      ? { serviceUserId: serviceUserId.trim() }
      : undefined;
    const before = await this.prisma.visitReconciliation.count({
      where: scopedWhere,
    });

    if (before === 0) {
      return {
        message: 'No visit reconciliations to delete',
        data: {
          before: 0,
          visitReconciliations: 0,
          payrollRunLines: 0,
          invoiceRunLines: 0,
          financeExceptions: 0,
        },
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await allowFinancialResetInTransaction(tx);
      const reconIds = scopedWhere
        ? (
            await tx.visitReconciliation.findMany({
              where: scopedWhere,
              select: { id: true },
            })
          ).map((r) => r.id)
        : null;

      const lineWhere = reconIds
        ? { visitReconciliationId: { in: reconIds } }
        : undefined;

      const payrollRunLines = await tx.payrollRunLine.deleteMany(
        lineWhere ? { where: lineWhere } : undefined,
      );
      const invoiceRunLines = await tx.invoiceRunLine.deleteMany(
        lineWhere ? { where: lineWhere } : undefined,
      );
      await tx.payComponent.deleteMany({
        where: reconIds
          ? { visitReconciliationId: { in: reconIds } }
          : { visitReconciliationId: { not: null } },
      });
      const financeExceptions = await tx.financeException.deleteMany(
        lineWhere ? { where: lineWhere } : undefined,
      );
      const visitReconciliations = await tx.visitReconciliation.deleteMany({
        where: scopedWhere,
      });
      return {
        payrollRunLines: payrollRunLines.count,
        invoiceRunLines: invoiceRunLines.count,
        financeExceptions: financeExceptions.count,
        visitReconciliations: visitReconciliations.count,
      };
    });
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.BILLING,
      action: AuditAction.FINANCIAL_TEST_DATA_RESET,
      recordType: 'VisitReconciliation',
      recordId: serviceUserId?.trim() || 'all',
      newValues: { operation: 'clear-all visit reconciliations', before, ...result },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });

    return {
      message:
        result.visitReconciliations === 0
          ? 'No visit reconciliations to delete'
          : serviceUserId
            ? `Deleted ${result.visitReconciliations} visit reconciliation(s) for this service user`
            : `Deleted ${result.visitReconciliations} visit reconciliation(s)`,
      data: { before, ...result },
    };
  }

  async getSummary(locationId?: string) {
    const locationScope: Prisma.VisitReconciliationWhereInput = {};
    if (locationId) {
      const locationSuIds = await serviceUserIdsForLocation(this.prisma, locationId);
      if (!locationSuIds.length) {
        return {
          data: {
            pendingReview: 0,
            visitsWithExceptions: 0,
            visitsReady: 0,
            requiresManagerApproval: 0,
          },
        };
      }
      locationScope.serviceUserId = { in: locationSuIds };
    }

    const [pending, withExceptions, approved, requiresManager] = await this.prisma.$transaction([
      this.prisma.visitReconciliation.count({
        where: {
          ...locationScope,
          status: {
            in: [
              VisitReconciliationStatus.PENDING_REVIEW,
              VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
            ],
          },
        },
      }),
      this.prisma.visitReconciliation.count({
        where: { ...locationScope, exceptions: { some: { resolvedAt: null } } },
      }),
      this.prisma.visitReconciliation.count({
        where: {
          ...locationScope,
          status: {
            in: [
              VisitReconciliationStatus.APPROVED_FOR_PAY,
              VisitReconciliationStatus.APPROVED_FOR_INVOICE,
              VisitReconciliationStatus.APPROVED_FOR_BOTH,
            ],
          },
        },
      }),
      this.prisma.visitReconciliation.count({
        where: {
          ...locationScope,
          status: VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
        },
      }),
    ]);

    return {
      data: {
        pendingReview: pending,
        visitsWithExceptions: withExceptions,
        visitsReady: approved,
        requiresManagerApproval: requiresManager,
      },
    };
  }

  /** `locationId` limits the queue to service users of that branch (R-13). */
  async getExceptionQueue(limit = 10, locationId?: string) {
    const branchServiceUserIds = locationId
      ? await serviceUserIdsForLocation(this.prisma, locationId)
      : null;
    const rows = await this.prisma.financeException.findMany({
      where: {
        resolvedAt: null,
        ...(branchServiceUserIds
          ? { visitReconciliation: { serviceUserId: { in: branchServiceUserIds } } }
          : {}),
      },
      include: {
        visitReconciliation: {
          select: {
            id: true,
            visitRef: true,
            serviceUserId: true,
            employeeId: true,
            scheduledJobId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const suIds = [...new Set(rows.map((r) => r.visitReconciliation.serviceUserId))];
    const serviceUsers = suIds.length
      ? await this.prisma.serviceUser.findMany({
          where: { id: { in: suIds } },
          select: { id: true, firstName: true, lastName: true, preferredName: true },
        })
      : [];
    const suMap = new Map(serviceUsers.map((su) => [su.id, formatPersonName(su)]));

    return {
      data: rows.map((row) => ({
        id: row.id,
        code: row.code,
        visitRef: row.visitReconciliation.visitRef,
        reconciliationId: row.visitReconciliation.id,
        serviceUserId: row.visitReconciliation.serviceUserId,
        serviceUser: suMap.get(row.visitReconciliation.serviceUserId) ?? 'Unknown',
        employeeId: row.visitReconciliation.employeeId,
        scheduledJobId: row.visitReconciliation.scheduledJobId,
        message: row.message ?? row.code,
      })),
    };
  }

  /**
   * Carer pay for a pay window on a given card: the rules of the card version in force on the visit
   * date, the card's bank holiday nation and its overlap policy. Returns no amount when a rate is
   * missing. Used to price a visit and to work out what a corrected visit should have paid.
   */
  private async priceCarerPay(
    db: DbClient,
    input: {
      payCard: { id: string; stackingPolicy?: string; bankHolidayRegion?: string | null };
      plannedStart: Date;
      payStart: Date;
      payEnd: Date;
      payMinutes: number;
      plannedMinutes: number;
      nightDuty: string | null | undefined;
      timeZone: string;
      /** Default (England & Wales) calendar for the window, when the caller already loaded it. */
      defaultHolidayDates?: Set<string>;
    },
  ): Promise<{ amount: number | null; version: number | null; hold?: string }> {
    const { payCard, plannedStart, payStart, payEnd, timeZone } = input;
    // Rules of the card version in force on the visit date (older versions stay priced by their own rates).
    const { version, rules } = await loadPayCardRulesForDate(db, payCard.id, plannedStart, timeZone);
    // Pay uses the card's bank holiday nation (charges keep the default England & Wales calendar).
    const payRegion = payCard.bankHolidayRegion || DEFAULT_BANK_HOLIDAY_REGION;
    // R-27: a day that is normally a bank holiday with no entry in the calendar is not priced as
    // an ordinary day. The pay is held with the reason until a person settles the calendar.
    const hold = await calendarHoldForPay(db, {
      region: payRegion,
      rules,
      start: payStart,
      end: payEnd ?? payStart,
      dayOf: (instant) => dayKeyInTimeZone(instant, timeZone),
    });
    if (hold) return { amount: null, version, hold };
    // PC-22 to PC-24: the shared calendar, with the organisation's special days and its policy
    // for holidays that fall on a weekend.
    const payCalendar = await loadPayCalendar(db, payStart, payEnd ?? payStart, payRegion);
    const payHolidayDates = payCalendar.bankHolidayKeys;
    const stackingPolicy =
      (payCard.stackingPolicy as 'PRIORITY' | 'HIGHEST' | 'STACK' | undefined) ?? 'PRIORITY';
    const calc = calculatePayableAmount(
      rules,
      plannedStart,
      input.payMinutes,
      payHolidayDates.has(dayKeyInTimeZone(plannedStart, timeZone)),
      {
        start: payStart,
        end: payEnd,
        stackingPolicy,
        isBankHolidayFn: (d) => payHolidayDates.has(dayKeyInTimeZone(d, timeZone)),
        timeZone,
        calendar: payCalendar.calendar,
      },
      input.nightDuty,
      input.plannedMinutes,
    );
    return { amount: calc?.amount ?? null, version };
  }

  /**
   * What the carer pay of a row would be on its current recorded times, priced on the pay card and
   * version the row was priced on. Null when there are no times, no card or no matching rate.
   * Nothing is written.
   */
  private async wouldBeCarerPay(row: {
    scheduledVisitId: string;
    plannedStartDateTime: Date;
    plannedEndDateTime: Date | null;
    actualStartDateTime: Date | null;
    actualEndDateTime: Date | null;
    overrunDecision: VisitOverrunDecision | null;
    overrunPayBasis: VisitOverrunTimeBasis | null;
    overrunBillBasis: VisitOverrunTimeBasis | null;
    payCardId: string | null;
  }): Promise<number | null> {
    if (!row.payCardId || !row.actualStartDateTime || !row.actualEndDateTime) return null;
    const [payCard, visit, timeZone, durationToleranceMinutes] = await Promise.all([
      this.prisma.payCard.findUnique({
        where: { id: row.payCardId },
        select: { id: true, stackingPolicy: true, bankHolidayRegion: true },
      }),
      this.prisma.scheduledVisit.findUnique({
        where: { id: row.scheduledVisitId },
        select: { visitPlanSlot: { select: { nightDuty: true } }, scheduledJob: { select: { metadata: true } } },
      }),
      this.orgSettings.getOperationalTimezone(),
      this.resolveDurationToleranceMinutes(this.prisma, row.scheduledVisitId),
    ]);
    if (!payCard) return null;
    const plannedMinutes = row.plannedEndDateTime
      ? minutesBetween(row.plannedStartDateTime, row.plannedEndDateTime)
      : 0;
    const actualMinutes = minutesBetween(row.actualStartDateTime, row.actualEndDateTime);
    const overrun = actualMinutes > plannedMinutes && plannedMinutes > 0;
    const windows = resolveDefaultApprovedWindows({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: row.plannedEndDateTime,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      exceptions: overrun ? [{ code: FinanceExceptionCode.OVERRUN, message: '' }] : [],
      // An overrun not yet decided is paid on planned time, as it is for an unsettled visit.
      overrunDecision: overrun ? (row.overrunDecision ?? VisitOverrunDecision.PENDING) : null,
      overrunPayBasis: row.overrunPayBasis,
      overrunBillBasis: row.overrunBillBasis,
      durationToleranceMinutes,
    });
    const payMinutes = minutesBetween(windows.approvedPayStart, windows.approvedPayEnd);
    if (payMinutes <= 0) return 0;
    const priced = await this.priceCarerPay(this.prisma, {
      payCard: {
        id: payCard.id,
        stackingPolicy: payCard.stackingPolicy ?? undefined,
        bankHolidayRegion: payCard.bankHolidayRegion,
      },
      plannedStart: row.plannedStartDateTime,
      payStart: windows.approvedPayStart,
      payEnd: windows.approvedPayEnd,
      payMinutes,
      plannedMinutes,
      nightDuty: resolveStoredNightDuty({
        slotNightDuty: visit?.visitPlanSlot?.nightDuty,
        jobMetadata: visit?.scheduledJob?.metadata,
      }),
      timeZone,
    });
    return priced.amount;
  }

  /**
   * The office has verified or corrected the attendance times of a completed visit (VW-15).
   *
   * The corrected times are already on the visit / allocation; this carries them into pay:
   *  - pay not settled: the approved pay window is re-derived and the draft pay is repriced;
   *  - pay settled (locked visit pay run or closed UK run): the paid record stays as it is and the
   *    difference is recorded as a pay correction, which a second person approves and the next run
   *    pays or recovers.
   * A manual payable amount entered by finance is kept in both cases.
   */
  async applyAttendanceCorrection(
    scheduledVisitId: string,
    input: { userId: string; reason: string; jobAllocationId?: string | null },
    meta?: RequestAuditMeta,
  ) {
    try {
      const result = await this.carryAttendanceIntoPay(scheduledVisitId, input, meta);
      // A pay step that failed before is done now: its failure is closed.
      await this.closeEvaluationFailure('ATTENDANCE_CORRECTION', scheduledVisitId, 'SUCCEEDED_LATER');
      return result;
    } catch (err) {
      // A user who no longer exists, or lacks the power, is answered as such: nothing is flagged.
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) throw err;
      // The corrected times are recorded (by the caller, before this); pay is not. Say so, keep the
      // failure for a retry, and hold the visit so that no pay run pays it on the old times.
      await this.recordEvaluationFailure('ATTENDANCE_CORRECTION', scheduledVisitId, err, undefined, {
        reason: input.reason,
        jobAllocationId: input.jobAllocationId ?? null,
      });
      const failure = await this.prisma.payEvaluationFailure.findUnique({
        where: { subjectKey: payEvaluationSubjectKey('ATTENDANCE_CORRECTION', scheduledVisitId) },
      });
      const flagged = await this.flagPayStepFailed(scheduledVisitId, failure, input.userId, meta, input.jobAllocationId);
      return { data: flagged };
    }
  }

  /**
   * Flags each carer's pay on a visit whose corrected times did not reach pay: an EVIDENCE_CHANGED
   * exception that says so, and pay that was approved and not yet settled goes back to review so
   * that it is held from pay runs. One transaction with its audit entries; settled pay is never
   * rewritten. Doing it again replaces the flag, it does not add one. Never throws.
   */
  private async flagPayStepFailed(
    scheduledVisitId: string,
    failure: { id: string; message: string } | null,
    userId: string,
    meta?: RequestAuditMeta,
    jobAllocationId?: string | null,
  ) {
    const reference = failure?.id.slice(0, 8) ?? null;
    const reason = `${PAY_STEP_FAILED}: ${failure?.message ?? 'unexpected error'} Retry it from Pay calculation failures${
      reference ? ` (reference ${reference})` : ''
    }.`;
    const rows = await this.prisma.visitReconciliation.findMany({
      where: {
        scheduledVisitId,
        ...(jobAllocationId ? { jobAllocationId } : {}),
        status: { notIn: [VisitReconciliationStatus.REJECTED_FOR_PAY, VisitReconciliationStatus.REJECTED_FOR_INVOICE] },
      },
    });
    let flagged = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        for (const row of rows) {
          const hold =
            !isPaySettled(row) &&
            (row.status === VisitReconciliationStatus.APPROVED_FOR_PAY || row.status === VisitReconciliationStatus.APPROVED_FOR_BOTH);
          await tx.visitReconciliation.update({
            where: { id: row.id },
            data: { evidenceChangedReason: reason, evidenceChangedAt: now, ...(hold ? { status: VisitReconciliationStatus.PENDING_REVIEW } : {}) },
          });
          await tx.financeException.deleteMany({ where: { visitReconciliationId: row.id, code: FinanceExceptionCode.EVIDENCE_CHANGED } });
          await tx.financeException.create({
            data: { visitReconciliationId: row.id, code: FinanceExceptionCode.EVIDENCE_CHANGED, message: reason },
          });
          await this.auditVisit(
            AuditAction.VISIT_ATTENDANCE_PAY_NOT_RECALCULATED,
            userId,
            row,
            {
              oldValues: VisitReconciliationsService.paySnapshotOf(row),
              newValues: { status: String(hold ? VisitReconciliationStatus.PENDING_REVIEW : row.status), held: hold, failureId: failure?.id ?? null },
              reason,
            },
            meta,
            tx,
          );
        }
      }, DECISION_TRANSACTION);
      flagged = true;
    } catch (flagErr) {
      // Nothing was changed without its audit entry; the failure itself is still listed.
      this.logger.error(
        `Could not flag visit ${scheduledVisitId} after a failed pay step: ${flagErr instanceof Error ? flagErr.constructor.name : 'unknown error'}`,
      );
    }
    return rows.map((row) => ({
      reconciliationId: row.id,
      visitRef: row.visitRef,
      outcome: 'PAY_NOT_RECALCULATED' as const,
      message: flagged
        ? `Times recorded, but carer pay could not be recalculated: ${failure?.message ?? 'unexpected error'} The visit is held for review; retry it from Pay calculation failures${reference ? ` (reference ${reference})` : ''}.`
        : `Times recorded, but carer pay could not be recalculated and the visit could not be flagged. It is listed under Pay calculation failures${reference ? ` (reference ${reference})` : ''}; retry it there.`,
      payableBefore: row.payableAmount != null ? String(row.payableAmount) : null,
      payableAfter: row.payableAmount != null ? String(row.payableAmount) : null,
      failureId: failure?.id ?? null,
    }));
  }

  /** The pay step of an attendance correction, in one transaction. Throws when it cannot be done. */
  private async carryAttendanceIntoPay(
    scheduledVisitId: string,
    input: { userId: string; reason: string; jobAllocationId?: string | null },
    meta?: RequestAuditMeta,
  ) {
    // What the pay was before the corrected times reached the record: refreshing the rows already
    // re-evaluates them on the new evidence (R-18).
    const payBefore = new Map(
      (
        await this.prisma.visitReconciliation.findMany({
          where: { scheduledVisitId },
          select: {
            id: true,
            status: true,
            payableAmount: true,
            payableMinutes: true,
            approvedPayStart: true,
            approvedPayEnd: true,
          },
        })
      ).map((r) => [r.id, VisitReconciliationsService.paySnapshotOf(r)]),
    );
    // One transaction for the visit: the refreshed rows, the repriced pay or the correction
    // recorded for settled pay, the answered flags and the audit entries are saved together or
    // not at all. The corrected attendance times themselves were recorded before this and stay.
    const result = await this.prisma.$transaction(async (tx) => {
      // The flag of an earlier failed pay step is answered by doing the pay step now.
      await tx.visitReconciliation.updateMany({
        where: { scheduledVisitId, evidenceChangedReason: { startsWith: PAY_STEP_FAILED } },
        data: { evidenceChangedReason: null, evidenceChangedAt: null },
      });
      await tx.financeException.deleteMany({
        where: { visitReconciliation: { scheduledVisitId }, code: FinanceExceptionCode.EVIDENCE_CHANGED, message: { startsWith: PAY_STEP_FAILED } },
      });
      await this.ensureForVisit(scheduledVisitId, tx);
      const rows = await tx.visitReconciliation.findMany({
        where: {
          scheduledVisitId,
          ...(input.jobAllocationId ? { jobAllocationId: input.jobAllocationId } : {}),
          status: {
            notIn: [VisitReconciliationStatus.REJECTED_FOR_PAY, VisitReconciliationStatus.REJECTED_FOR_INVOICE],
          },
        },
      });
      const results: Array<{
        reconciliationId: string;
        visitRef: string;
        outcome: 'REPRICED' | 'PAY_UNCHANGED' | 'MANUAL_AMOUNT_KEPT' | 'CORRECTION_RECORDED' | 'NO_CORRECTION' | 'REVIEW_NEEDED';
      failureId?: string | null;
        message: string;
        payableBefore: string | null;
        payableAfter: string | null;
      }> = [];

      for (const row of rows) {
        const before = payBefore.get(row.id) ?? VisitReconciliationsService.paySnapshotOf(row);
        let outcome: (typeof results)[number]['outcome'];
        let message: string;
        let payableAfter = before.payableAmount;

        if (!isPaySettled(row)) {
          if (hasManualPayableOverride(row)) {
            outcome = 'MANUAL_AMOUNT_KEPT';
            message = 'Times updated. The payable amount was entered by finance and was not changed.';
          } else {
            // Re-derive the pay window from the corrected times, then reprice carer pay only.
            await tx.visitReconciliation.update({
              where: { id: row.id },
              data: { approvedPayStart: null, approvedPayEnd: null },
            });
            await this.evaluateInternal(tx, row.id, { forceRecalculatePay: true });
            const after = await tx.visitReconciliation.findUniqueOrThrow({ where: { id: row.id } });
            payableAfter = after.payableAmount != null ? String(after.payableAmount) : null;
            if (
              Number(payableAfter ?? 0) === Number(before.payableAmount ?? 0) &&
              after.payableMinutes === before.payableMinutes
            ) {
              // The evidence changed; the pay it produces did not. Say which rule kept it.
              const { reason } = await this.payTimeRule(tx, after);
              outcome = 'PAY_UNCHANGED';
              message = `Times updated. Carer pay is unchanged: ${reason} Payable time stays ${await this.payWindowText(after)}.`;
            } else {
              outcome = 'REPRICED';
              message = 'Times updated and carer pay recalculated.';
            }
          }
        } else if (hasManualPayableOverride(row)) {
          outcome = 'NO_CORRECTION';
          message = 'This visit was paid on an amount entered by finance. Record a pay correction by hand if it should change.';
        } else {
          const corrected = await this.wouldBeCarerPay(row);
          if (corrected == null) {
            outcome = 'REVIEW_NEEDED';
            message = 'This visit is already paid and its corrected pay could not be priced. Record a pay correction by hand.';
          } else {
            try {
              const created = await this.payItems.recordVisitCorrection(
                input.userId,
                {
                  visitReconciliationId: row.id,
                  correctedAmount: corrected,
                  reason: `Attendance corrected: ${input.reason}`.slice(0, 400),
                },
                meta,
                tx,
              );
              payableAfter = corrected.toFixed(2);
              outcome = 'CORRECTION_RECORDED';
              message = created.message;
            } catch (err) {
              if (!(err instanceof BadRequestException)) throw err;
              outcome = 'NO_CORRECTION';
              message = err.message;
            }
          }
        }

        if (isPaySettled(row)) {
          // The office has looked at the changed times of a settled visit and the pay side is
          // dealt with above (correction recorded, or none needed): the flag is answered (R-18).
          const reviewed = await attendanceReviewState(tx, row.scheduledJobId, row.employeeId);
          await tx.visitReconciliation.update({
            where: { id: row.id },
            data: {
              approvedEvidence: evidenceFingerprint({
                actualStart: row.actualStartDateTime,
                actualEnd: row.actualEndDateTime,
                needsReview: reviewed.reasons.length > 0,
              }),
              evidenceChangedReason: null,
              evidenceChangedAt: null,
            },
          });
          await tx.financeException.deleteMany({
            where: { visitReconciliationId: row.id, code: FinanceExceptionCode.EVIDENCE_CHANGED },
          });
        }

        await this.auditVisit(
          AuditAction.VISIT_ATTENDANCE_TIMES_CORRECTED,
          input.userId,
          row,
          {
            oldValues: before,
            newValues: {
              outcome,
              payableAmount: payableAfter,
              actualStartDateTime: row.actualStartDateTime?.toISOString() ?? null,
              actualEndDateTime: row.actualEndDateTime?.toISOString() ?? null,
            },
            reason: input.reason,
          },
          meta,
          tx,
        );
        results.push({
          reconciliationId: row.id,
          visitRef: row.visitRef,
          outcome,
          message,
          payableBefore: before.payableAmount,
          payableAfter,
        });
      }
      return { data: results };
    }, DECISION_TRANSACTION);
    return result;
  }

  private async evaluateInternal(
    db: DbClient,
    id: string,
    options?: { forceRecalculateAmounts?: boolean; forceRecalculatePay?: boolean },
  ): Promise<void> {
    // Everything an evaluation writes (amounts, exceptions, an approval it withdraws and the audit
    // entry of that withdrawal) is saved together or not at all.
    if (db === this.prisma) {
      return this.prisma.$transaction((tx) => this.evaluateInternal(tx, id, options), DECISION_TRANSACTION);
    }
    let row = await db.visitReconciliation.findUnique({
      where: { id },
      include: reconciliationInclude,
    });
    if (!row) return;

    // LOCKED rows keep stored pricing unless finance explicitly force-recalculates.
    if (
      row.status === VisitReconciliationStatus.LOCKED &&
      !options?.forceRecalculateAmounts
    ) {
      return;
    }

    const visit = await db.scheduledVisit.findUnique({
      where: { id: row.scheduledVisitId },
      select: {
        status: true,
        requiredCarers: true,
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        actualStartDateTime: true,
        actualEndDateTime: true,
        visitPlanSlot: { select: { nightDuty: true } },
        scheduledJob: { select: { metadata: true } },
      },
    });
    if (!visit) return;
    const nightDuty = resolveStoredNightDuty({
      slotNightDuty: visit.visitPlanSlot?.nightDuty,
      jobMetadata: visit.scheduledJob?.metadata,
    });
    const timeZone = await this.orgSettings.getOperationalTimezone();

    // R-18: an approval stands for the attendance evidence it was given for. The carer's own
    // verification record (R-16) says whether their times still await review.
    const review = await attendanceReviewState(
      db,
      row.scheduledJobId,
      row.employeeId,
      visit.scheduledJob?.metadata,
    );
    const currentEvidence = evidenceFingerprint({
      actualStart: row.actualStartDateTime,
      actualEnd: row.actualEndDateTime,
      needsReview: review.reasons.length > 0,
    });
    const isApprovedStatus = (status: VisitReconciliationStatus) =>
      status === VisitReconciliationStatus.APPROVED_FOR_PAY ||
      status === VisitReconciliationStatus.APPROVED_FOR_BOTH ||
      status === VisitReconciliationStatus.APPROVED_FOR_INVOICE;
    const evidenceOutcome = approvalAfterEvidenceChange({
      approved: isApprovedStatus(row.status),
      paySettled: isPaySettled(row),
      approvalSource: row.approvalSource,
      approvedById: row.approvedById,
      approvedEvidence: row.approvedEvidence,
      currentEvidence,
    });
    if (
      evidenceOutcome === 'WITHDRAW_AUTO' ||
      evidenceOutcome === 'REQUIRE_REVIEW' ||
      evidenceOutcome === 'FLAG_SETTLED'
    ) {
      const change = describeEvidenceChange(row.approvedEvidence as string, currentEvidence);
      const before = row;
      if (evidenceOutcome === 'FLAG_SETTLED') {
        // Settled pay is history. Nothing about the pay is touched; the change is flagged so a
        // person can check it and, if the pay should differ, record a pay correction.
        if (!row.evidenceChangedReason) {
          await db.visitReconciliation.update({
            where: { id },
            data: {
              evidenceChangedReason: `Attendance evidence changed after the pay of this visit was settled (${change}). Check the times; if the pay should change, record a pay correction.`,
              evidenceChangedAt: new Date(),
            },
          });
        }
      } else {
        const byPerson = evidenceOutcome === 'REQUIRE_REVIEW';
        await db.visitReconciliation.update({
          where: { id },
          data: {
            // Back to review. A clean visit that was approved automatically is approved again
            // below, on the new evidence; anything else waits for a person.
            status: VisitReconciliationStatus.PENDING_REVIEW,
            approvedEvidence: null,
            ...(byPerson
              ? {
                  // The person's approval, its time and its notes stay on the record.
                  evidenceChangedReason: `Attendance evidence changed after this visit was approved (${change}). Review it and approve again.`,
                  evidenceChangedAt: new Date(),
                }
              : { approvalSource: null, approvedAt: null }),
            // The pay window follows the new times, unless finance entered the amount by hand.
            ...(hasManualPayableOverride(row) ? {} : { approvedPayStart: null, approvedPayEnd: null }),
          },
        });
        options = { ...options, forceRecalculatePay: true };
      }
      await this.auditVisit(AuditAction.VISIT_RECONCILIATION_APPROVAL_WITHDRAWN, undefined, before, {
        oldValues: {
          status: String(before.status),
          approvalSource: inferApprovalSource(before),
          approvedById: before.approvedById,
          approvedEvidence: before.approvedEvidence,
        },
        newValues: { outcome: evidenceOutcome, currentEvidence },
        reason: change,
      }, undefined, this.txOf(db));
      row = await db.visitReconciliation.findUnique({ where: { id }, include: reconciliationInclude });
      if (!row) return;
    }
    const wasApprovedBeforeEvaluation = isApprovedStatus(row.status);

    // After the visit is complete and amounts were priced once, keep those amounts
    // even if charge/pay cards change later (unless forceRecalculateAmounts).
    // Manual overrides always freeze — including during force recalculate — so
    // "Recalculate amounts" only reprices card-derived sides and never wipes
    // finance-entered carer/client amounts (list page reads these columns).
    const visitCompleted = isBillingEligibleVisit(visit);
    const legacyMismatchedBillWindow = isLegacyMismatchedBillWindow({
      plannedStartDateTime: row.plannedStartDateTime,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      approvedPayStart: row.approvedPayStart,
      approvedPayEnd: row.approvedPayEnd,
      approvedBillStart: row.approvedBillStart,
      approvedBillEnd: row.approvedBillEnd,
    });
    const manualPayableOverride = hasManualPayableOverride(row);
    const manualBillableOverride = hasManualBillableOverride(row);
    // Pay settled by a locked visit pay run or a closed UK run: the pay snapshot is history.
    // It is never repriced (forced or not) and none of its columns are written below.
    const paySettled = isPaySettled(row);
    const freezeBillable =
      manualBillableOverride ||
      (!options?.forceRecalculateAmounts &&
        !legacyMismatchedBillWindow &&
        visitCompleted &&
        row.billableAmount != null);
    const freezePayable =
      manualPayableOverride ||
      paySettled ||
      (!options?.forceRecalculateAmounts &&
        !options?.forceRecalculatePay &&
        visitCompleted &&
        row.payableAmount != null);

    // Multi-carer: a carer who never clocked in (while a co-carer did) gets no normal
    // pay line — MISSING_CHECK_IN (pay-blocking) and no payable amount until reviewed.
    let absentCoCarer = false;
    if (row.jobAllocationId && visitCompleted) {
      const carers = await db.jobAllocation.findMany({
        where: {
          scheduledJobId: row.scheduledJobId,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
        },
        select: { id: true, actualStartDateTime: true },
      });
      const mine = carers.find((c) => c.id === row.jobAllocationId);
      absentCoCarer =
        mine != null &&
        isAbsentCoCarer({
          requiredCarers: visit.requiredCarers ?? 1,
          activeCarerCount: carers.length,
          myActualStartDateTime: mine.actualStartDateTime,
          anyCoCarerClockedIn: carers.some(
            (c) => c.id !== row.jobAllocationId && c.actualStartDateTime != null,
          ),
        });
    }

    const tasksIncomplete = await this.hasIncompleteTasks(db, row.scheduledJobId);
    const funding = await this.loadFundingSnapshot(db, row.serviceUserId);

    let payCard: {
      id: string;
      status: string;
      rulesCount: number;
      stackingPolicy?: string;
      version?: number;
      bankHolidayRegion?: string | null;
    } | null = null;
    let payCardSource: string | null = null;
    // Why a card could not be resolved, in the resolver's words (R-17).
    let payCardProblem: string | null = null;
    let chargeCardProblem: string | null = null;
    if (freezePayable && row.payCardId) {
      const pinned = await db.payCard.findUnique({
        where: { id: row.payCardId },
        select: {
          id: true,
          status: true,
          stackingPolicy: true,
          version: true,
          bankHolidayRegion: true,
          rules: { where: { supersededAt: null }, select: { id: true } },
        },
      });
      payCardSource = row.payCardSource;
      if (pinned) {
        payCard = {
          id: pinned.id,
          status: pinned.status,
          rulesCount: pinned.rules.length,
          stackingPolicy: pinned.stackingPolicy ?? undefined,
          version: pinned.version ?? undefined,
          bankHolidayRegion: pinned.bankHolidayRegion,
        };
      }
    } else if (row.employeeId) {
      // R-17: a set-up gap the resolver reports (no employment record, …) is not a reason to stop
      // the whole evaluation and leave the visit unpriced without explanation. The carer's pay is
      // held with the resolver's reason; the client charge is still priced. Unexpected errors
      // still propagate and are kept as a pay evaluation failure by the caller.
      try {
        // PC-10: the funder that decides a funder pay override is the funder on the day of the
        // visit, not the client's funding as it is today.
        const payFunder = await this.payFunderForVisit(
          db,
          row.serviceUserId,
          row.employeeId,
          row.plannedStartDateTime,
        );
        payCardProblem = payFunder.problem;
        const resolved = payFunder.problem
          ? null
          : await this.payCardsService.resolveForEmployee(
              row.employeeId,
              row.plannedStartDateTime,
              { funderId: payFunder.funderId },
            );
        if (resolved) payCardSource = resolved.data.source;
        if (resolved?.data.payCard) {
          payCard = {
            id: resolved.data.payCard.id,
            status: resolved.data.payCard.status,
            rulesCount: resolved.data.payCard.rules?.length ?? 0,
            stackingPolicy: (resolved.data.payCard as { stackingPolicy?: string }).stackingPolicy,
            version: (resolved.data.payCard as { version?: number }).version,
            bankHolidayRegion: (resolved.data.payCard as { bankHolidayRegion?: string | null })
              .bankHolidayRegion,
          };
        }
      } catch (err) {
        if (!(err instanceof HttpException) || err.getStatus() >= 500) throw err;
        payCardProblem = err.message;
      }
    }

    let chargeCardSource: string | null = null;
    let chargeCard: { id: string; status: string; rulesCount: number } | null = null;
    if (freezeBillable && row.chargeCardId) {
      const pinned = await db.chargeCard.findUnique({
        where: { id: row.chargeCardId },
        select: { id: true, status: true },
      });
      chargeCardSource = row.chargeCardSource;
      if (pinned) {
        const rulesCount = await db.chargeCardRule.count({
          where: { chargeCardId: pinned.id },
        });
        chargeCard = {
          id: pinned.id,
          status: pinned.status,
          rulesCount,
        };
      }
    } else if (!freezeBillable) {
      try {
        const chargeResolved = await this.chargeCardsService.resolveForServiceUser(
          row.serviceUserId,
        );
        chargeCardSource = chargeResolved.data.source;
        if (chargeResolved.data.chargeCard) {
          chargeCard = {
            id: chargeResolved.data.chargeCard.id,
            status: chargeResolved.data.chargeCard.status,
            rulesCount: chargeResolved.data.chargeCard.rules?.length ?? 0,
          };
        }
      } catch (err) {
        if (!(err instanceof HttpException) || err.getStatus() >= 500) throw err;
        chargeCardProblem = err.message;
      }
    } else {
      chargeCardSource = row.chargeCardSource;
    }

    const exceptions = detectVisitExceptions({
      visit: {
        status: visit.status,
        plannedStartDateTime: row.plannedStartDateTime,
        plannedEndDateTime: row.plannedEndDateTime,
        actualStartDateTime: row.actualStartDateTime,
        actualEndDateTime: row.actualEndDateTime,
        overrunReason: row.overrunReason,
      },
      payCard: payCard
        ? {
            id: payCard.id,
            status: payCard.status as import('@prisma/client').BillingCardStatus,
            rulesCount: payCard.rulesCount,
          }
        : null,
      chargeCard: chargeCard
        ? {
            id: chargeCard.id,
            status: chargeCard.status as import('@prisma/client').BillingCardStatus,
            rulesCount: chargeCard.rulesCount,
          }
        : null,
      tasksIncomplete,
      funding,
    });
    // Say why the card is missing, so the person who sees the exception knows what to fix.
    for (const ex of exceptions) {
      if (ex.code === FinanceExceptionCode.PAY_CARD_MISSING && payCardProblem) {
        ex.message = `Carer pay cannot be priced: ${payCardProblem}`;
      }
      if (ex.code === FinanceExceptionCode.CHARGE_CARD_MISSING && chargeCardProblem) {
        ex.message = `The client charge cannot be priced: ${chargeCardProblem}`;
      }
    }

    // R-18: evidence that changed after a person's approval, or after the pay was settled.
    if (row.evidenceChangedReason) {
      exceptions.push({ code: FinanceExceptionCode.EVIDENCE_CHANGED, message: row.evidenceChangedReason });
    }

    // VW-02: a start or finish reported by the carer app that the server could not corroborate
    // holds the visit for a person to approve (until the office verifies or corrects the times).
    if (!paySettled) {
      // Per carer: on a double-up, one carer's unverified time does not hold the other's pay.
      // The carer's own verification record (R-16); older visits fall back to job metadata.
      const unverified = review.reasons;
      if (unverified.length) {
        exceptions.push({ code: FinanceExceptionCode.UNVERIFIED_TIMES, message: unverified.join(' ') });
      }
    }

    if (absentCoCarer) {
      for (let i = exceptions.length - 1; i >= 0; i -= 1) {
        if (exceptions[i]!.code === FinanceExceptionCode.MISSING_CHECK_IN) exceptions.splice(i, 1);
      }
      exceptions.unshift({
        code: FinanceExceptionCode.MISSING_CHECK_IN,
        message: ABSENT_CO_CARER_EXCEPTION_MESSAGE,
      });
    }

    const plannedMinutes = row.plannedEndDateTime
      ? minutesBetween(row.plannedStartDateTime, row.plannedEndDateTime)
      : 0;
    const actualMinutes =
      row.actualStartDateTime && row.actualEndDateTime
        ? minutesBetween(row.actualStartDateTime, row.actualEndDateTime)
        : 0;
    const computedOverrun =
      actualMinutes > plannedMinutes && plannedMinutes > 0
        ? actualMinutes - plannedMinutes
        : null;

    const overrunDecision =
      computedOverrun == null
        ? null
        : row.overrunDecision === VisitOverrunDecision.APPROVED ||
            row.overrunDecision === VisitOverrunDecision.REJECTED
          ? row.overrunDecision
          : VisitOverrunDecision.PENDING;

    const activeExceptions =
      overrunDecision === VisitOverrunDecision.APPROVED ||
      overrunDecision === VisitOverrunDecision.REJECTED
        ? exceptions.filter((e) => e.code !== FinanceExceptionCode.OVERRUN)
        : exceptions;

    // Already-priced completed visits must not be blocked by later card removal/changes.
    if (freezeBillable) {
      for (let i = activeExceptions.length - 1; i >= 0; i -= 1) {
        const ex = activeExceptions[i];
        if (
          ex.code === FinanceExceptionCode.CHARGE_CARD_MISSING ||
          (ex.code === FinanceExceptionCode.RATE_MISSING && /charge card/i.test(ex.message))
        ) {
          activeExceptions.splice(i, 1);
        }
      }
    }
    if (freezePayable) {
      for (let i = activeExceptions.length - 1; i >= 0; i -= 1) {
        const ex = activeExceptions[i];
        if (
          ex.code === FinanceExceptionCode.PAY_CARD_MISSING ||
          (ex.code === FinanceExceptionCode.RATE_MISSING && /pay card/i.test(ex.message))
        ) {
          activeExceptions.splice(i, 1);
        }
      }
    }

    // Default: clean visits → APPROVED_FOR_BOTH. Soft exceptions → PENDING_REVIEW until
    // finance clicks All / Pay / Bill; those human approvals are preserved on re-evaluate
    // unless a blocking setup exception appears.
    const status =
      row.status === VisitReconciliationStatus.LOCKED ||
      row.status === VisitReconciliationStatus.REJECTED_FOR_PAY ||
      row.status === VisitReconciliationStatus.REJECTED_FOR_INVOICE
        ? row.status
        : deriveReconciliationStatus(activeExceptions, row.status);

    // A bill-only approval (APPROVED_FOR_INVOICE) is an exclusive choice: charge the
    // client / funder, pay the carer £0. Do not auto-promote to BOTH.
    const promotedStatus = status;

    // Overrun pending/rejected → planned pay window; APPROVED → actual pay window.
    // Early leave within org/slot tolerance → full planned pay + charge (flags unchanged).
    const durationToleranceMinutes = await this.resolveDurationToleranceMinutes(
      db,
      row.scheduledVisitId,
    );
    const defaultWindows = resolveDefaultApprovedWindows({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: row.plannedEndDateTime,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      exceptions: computedOverrun
        ? [{ code: FinanceExceptionCode.OVERRUN, message: '' }]
        : activeExceptions,
      overrunDecision,
      overrunPayBasis: row.overrunPayBasis,
      overrunBillBasis: row.overrunBillBasis,
      durationToleranceMinutes,
    });

    const plannedEndForTol =
      row.plannedEndDateTime ??
      new Date(row.plannedStartDateTime.getTime() + 30 * 60_000);
    const withinDurationTolerance = isDurationShortfallWithinTolerance({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: plannedEndForTol,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      durationToleranceMinutes,
    });

    // Legacy bug: client charge used booked start → actual end (late inflate or early clip)
    // while carer pay correctly used actual. Re-snap those rows.
    const forceDefaultWindows =
      computedOverrun != null || withinDurationTolerance || legacyMismatchedBillWindow;

    const approvedPayStart = forceDefaultWindows
      ? defaultWindows.approvedPayStart
      : (row.approvedPayStart ?? defaultWindows.approvedPayStart);
    const approvedPayEnd = forceDefaultWindows
      ? defaultWindows.approvedPayEnd
      : (row.approvedPayEnd ?? defaultWindows.approvedPayEnd);

    const orgChargeMode = await db.organisationGeneralSettings.findFirst({
      select: { multiCarerFunderChargeMode: true },
    });
    const multiCarerMode =
      orgChargeMode?.multiCarerFunderChargeMode === 'FIXED' ? 'FIXED' : 'COMBINED';

    const siblingRecons = await db.visitReconciliation.findMany({
      where: { scheduledVisitId: row.scheduledVisitId },
      select: { id: true, jobAllocationId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    let isFunderBillingRow = true;
    if (multiCarerMode === 'FIXED' && siblingRecons.length > 1) {
      const allocationIds = siblingRecons
        .map((s) => s.jobAllocationId)
        .filter((aid): aid is string => Boolean(aid));
      let carrierAllocationId: string | null = null;
      if (allocationIds.length) {
        const leadFirst = await db.jobAllocation.findMany({
          where: { id: { in: allocationIds } },
          select: { id: true, isLeadCarer: true, allocatedAt: true },
          orderBy: [{ isLeadCarer: 'desc' }, { allocatedAt: 'asc' }],
        });
        carrierAllocationId = leadFirst[0]?.id ?? null;
      }
      const carrierRecon =
        (carrierAllocationId
          ? siblingRecons.find((s) => s.jobAllocationId === carrierAllocationId)
          : null) ?? siblingRecons[0];
      isFunderBillingRow = carrierRecon?.id === id;
    }

    let approvedBillStart: Date | null;
    let approvedBillEnd: Date | null;
    if (multiCarerMode === 'FIXED' && siblingRecons.length > 1 && !isFunderBillingRow) {
      approvedBillStart = null;
      approvedBillEnd = null;
    } else if (multiCarerMode === 'FIXED' && siblingRecons.length > 1 && isFunderBillingRow) {
      // Always use the visit envelope for FIXED — ignore stale per-carer approved bill windows.
      const visitBillWindows = resolveDefaultApprovedWindows({
        plannedStartDateTime: visit.scheduledStartDateTime,
        plannedEndDateTime: visit.scheduledEndDateTime,
        actualStartDateTime: visit.actualStartDateTime,
        actualEndDateTime: visit.actualEndDateTime,
        exceptions: computedOverrun
          ? [{ code: FinanceExceptionCode.OVERRUN, message: '' }]
          : activeExceptions,
        overrunDecision,
        overrunPayBasis: row.overrunPayBasis,
        overrunBillBasis: row.overrunBillBasis,
        durationToleranceMinutes,
      });
      approvedBillStart = visitBillWindows.approvedBillStart;
      approvedBillEnd = visitBillWindows.approvedBillEnd;
    } else {
      const storedBillInverted = isInvertedDateWindow(
        row.approvedBillStart,
        row.approvedBillEnd,
      );
      approvedBillStart =
        forceDefaultWindows || storedBillInverted
          ? defaultWindows.approvedBillStart
          : (row.approvedBillStart ?? defaultWindows.approvedBillStart);
      approvedBillEnd =
        forceDefaultWindows || storedBillInverted
          ? defaultWindows.approvedBillEnd
          : (row.approvedBillEnd ?? defaultWindows.approvedBillEnd);
    }

    const payMinutes = minutesBetween(approvedPayStart, approvedPayEnd);
    const billMinutes =
      approvedBillStart && approvedBillEnd
        ? minutesBetween(approvedBillStart, approvedBillEnd)
        : 0;

    let payableAmount: number | null = null;
    let billableAmount: number | null = null;

    const bankHolidayDates = await loadBankHolidayDateSet(
      db,
      approvedPayStart,
      approvedPayEnd ?? approvedPayStart,
      timeZone,
    );
    const isBankHoliday = bankHolidayDates.has(
      dayKeyInTimeZone(row.plannedStartDateTime, timeZone),
    );

    if (absentCoCarer && !manualPayableOverride && !paySettled) {
      // Held for review: no carer pay until finance decides (manual amount / override).
      payableAmount = null;
    } else if (freezePayable) {
      payableAmount =
        row.payableAmount != null
          ? Number(row.payableAmount)
          : resolveManualPayableAmount(row);
    } else if (payCard && payMinutes) {
      const priced = await this.priceCarerPay(db, {
        payCard,
        plannedStart: row.plannedStartDateTime,
        payStart: approvedPayStart,
        payEnd: approvedPayEnd,
        payMinutes,
        plannedMinutes,
        nightDuty,
        timeZone,
        defaultHolidayDates: bankHolidayDates,
      });
      if (priced.version != null) payCard.version = priced.version;
      payableAmount = priced.amount;
      if (priced.hold) {
        activeExceptions.push({ code: FinanceExceptionCode.RATE_MISSING, message: priced.hold });
      } else if (payableAmount == null && payMinutes > 0) {
        activeExceptions.push({
          code: FinanceExceptionCode.RATE_MISSING,
          message:
            nightDuty === 'SLEEPING_NIGHT'
              ? 'No sleeping night rate on this pay card. Add a Sleeping night (£/night) rule.'
              : nightDuty === 'WAKING_NIGHT'
                ? 'No waking night rate on this pay card. Add a Waking night (£/hour) rule.'
                : 'No pay card rate matches this visit’s day or time. Add a matching rule (e.g. weekday) or check Saturday/Sunday bands.',
        });
      }
    }
    const billRateAnchor =
      multiCarerMode === 'FIXED' && siblingRecons.length > 1 && isFunderBillingRow
        ? visit.scheduledStartDateTime
        : row.plannedStartDateTime;

    let perFunderCharges = null as Awaited<ReturnType<typeof loadPerFunderChargeCalculation>>;
    if (billMinutes > 0 && approvedBillStart && approvedBillEnd) {
      perFunderCharges = await loadPerFunderChargeCalculation(db, {
        serviceUserId: row.serviceUserId,
        billMinutes,
        rateBasisMinutes: plannedMinutes,
        billRateAnchor,
        approvedBillStart,
        approvedBillEnd,
        isBankHoliday,
        isBankHolidayFn: (d) =>
          bankHolidayDates.has(dayKeyInTimeZone(d, timeZone)),
        nightDuty,
        timeZone,
      });
    }

    /** When true, keep the previously stored billable amount (card changes must not rewrite it). */
    let keepFrozenBillable = freezeBillable;

    if (freezeBillable) {
      billableAmount =
        row.billableAmount != null
          ? Number(row.billableAmount)
          : resolveManualBillableAmount(row);
      const manualBillable = manualBillableOverride;
      // Repair visits that were priced on the primary card only while 2+ funders
      // with split % should have used per-funder charge cards.
      // Never rewrite a finance manual override.
      if (perFunderCharges && !manualBillable) {
        const primaryGross =
          perFunderCharges.lines.find((line) => line.isPrimary)?.cardGrossAmount ??
          perFunderCharges.lines.find((line) => line.chargeCardId === row.chargeCardId)
            ?.cardGrossAmount ??
          null;
        const stored = Number(row.billableAmount);
        const multiTotal = perFunderCharges.totalAmount;
        if (
          primaryGross != null &&
          Math.abs(stored - primaryGross) < 0.009 &&
          Math.abs(multiTotal - stored) > 0.009
        ) {
          billableAmount = multiTotal;
          keepFrozenBillable = false;
        }
      }
    }

    if (!keepFrozenBillable && perFunderCharges) {
      billableAmount = perFunderCharges.totalAmount;
      if (perFunderCharges.primaryChargeCardId) {
        const primaryCard = await db.chargeCard.findUnique({
          where: { id: perFunderCharges.primaryChargeCardId },
          select: { id: true, status: true },
        });
        const rulesCount = await db.chargeCardRule.count({
          where: { chargeCardId: perFunderCharges.primaryChargeCardId },
        });
        if (primaryCard) {
          chargeCard = {
            id: primaryCard.id,
            status: primaryCard.status,
            rulesCount,
          };
          chargeCardSource = 'EXPLICIT_FUNDING';
        }
      }
      for (const line of perFunderCharges.lines) {
        if (line.splitPercent != null && line.splitPercent > 0) {
          if (!line.chargeCardId) {
            activeExceptions.push({
              code: FinanceExceptionCode.CHARGE_CARD_MISSING,
              message: `No charge card on ${line.funderName ?? 'funder'} funding.`,
            });
          } else if (line.cardGrossAmount == null) {
            activeExceptions.push({
              code: FinanceExceptionCode.RATE_MISSING,
              message: `No charge rate on ${line.funderName ?? 'funder'}'s charge card for this visit.`,
            });
          }
        }
      }
    } else if (!keepFrozenBillable && chargeCard && billMinutes) {
      const chargeRules = await db.chargeCardRule.findMany({
        where: { chargeCardId: chargeCard.id },
      });
      const card = await db.chargeCard.findUnique({
        where: { id: chargeCard.id },
        select: { defaultChargeMethod: true },
      });
      const calc = calculateBillableAmount(
        chargeRules,
        billRateAnchor,
        billMinutes,
        card?.defaultChargeMethod ?? 'HOURLY_PRO_RATA',
        isBankHoliday,
        approvedBillStart && approvedBillEnd
          ? {
              start: approvedBillStart,
              end: approvedBillEnd,
              isBankHolidayFn: (d) =>
                bankHolidayDates.has(dayKeyInTimeZone(d, timeZone)),
              timeZone,
            }
          : undefined,
        nightDuty,
        plannedMinutes,
      );
      billableAmount = calc?.amount ?? null;
      if (
        billableAmount == null &&
        billMinutes > 0 &&
        (nightDuty === 'SLEEPING_NIGHT' || nightDuty === 'WAKING_NIGHT')
      ) {
        activeExceptions.push({
          code: FinanceExceptionCode.RATE_MISSING,
          message:
            nightDuty === 'SLEEPING_NIGHT'
              ? 'No sleeping night rate on this charge card. Add a Sleeping night (£/night) rule.'
              : 'No waking night rate on this charge card. Add a Waking night (£/hour) rule.',
        });
      }
    } else if (!keepFrozenBillable && multiCarerMode === 'FIXED' && siblingRecons.length > 1 && !isFunderBillingRow) {
      billableAmount = 0;
    }

    // Suggest inter-visit travel when not manually recorded (NMW working time between assignments).
    let suggestedTravelMinutes: number | null | undefined;
    let suggestedUnpaidTravelMinutes: number | null | undefined;
    if (
      row.employeeId &&
      approvedPayStart &&
      approvedPayEnd &&
      !(row.travelMinutes != null && row.travelMinutes > 0) &&
      !((row as { unpaidTravelMinutes?: number | null }).unpaidTravelMinutes != null &&
        ((row as { unpaidTravelMinutes?: number | null }).unpaidTravelMinutes ?? 0) > 0)
    ) {
      const prev = await db.visitReconciliation.findFirst({
        where: {
          employeeId: row.employeeId,
          id: { not: id },
          approvedPayEnd: { not: null, lte: approvedPayStart },
          approvedPayStart: { not: null },
        },
        orderBy: { approvedPayEnd: 'desc' },
        select: {
          id: true,
          visitRef: true,
          employeeId: true,
          serviceUserId: true,
          approvedPayStart: true,
          approvedPayEnd: true,
          travelMinutes: true,
        },
      });
      if (prev?.employeeId && prev.approvedPayStart && prev.approvedPayEnd) {
        const journeys = detectInterVisitTravel([
          {
            reconciliationId: prev.id,
            employeeId: prev.employeeId,
            visitRef: prev.visitRef,
            payStart: prev.approvedPayStart,
            payEnd: prev.approvedPayEnd,
            serviceUserId: prev.serviceUserId,
          },
          {
            reconciliationId: id,
            employeeId: row.employeeId,
            visitRef: row.visitRef,
            payStart: approvedPayStart,
            payEnd: approvedPayEnd,
            serviceUserId: row.serviceUserId,
            manualTravelMinutes: row.travelMinutes,
            manualUnpaidTravelMinutes:
              (row as { unpaidTravelMinutes?: number | null }).unpaidTravelMinutes ?? null,
          },
        ]);
        const auto = summariseTravelForDestination(journeys, id);
        if (auto.payableTravelMinutes > 0 || auto.payableWaitingMinutes > 0) {
          suggestedTravelMinutes =
            auto.payableTravelMinutes > 0
              ? auto.payableTravelMinutes
              : auto.payableWaitingMinutes;
        } else if (auto.nmwMinutes > 0) {
          suggestedUnpaidTravelMinutes = auto.nmwMinutes;
        }
      }
    }

    await db.financeException.deleteMany({ where: { visitReconciliationId: id } });
    if (activeExceptions.length) {
      await db.financeException.createMany({
        data: activeExceptions.map((ex) => ({
          visitReconciliationId: id,
          code: ex.code,
          message: ex.message,
        })),
      });
    }

    // Clean visits auto-approve BOTH; soft exceptions stay pending until human approve.
    // Manual All / Carer Pay / Funders are preserved on re-evaluate (soft flags stay).
    const lockedOrRejected =
      row.status === VisitReconciliationStatus.LOCKED ||
      row.status === VisitReconciliationStatus.REJECTED_FOR_PAY ||
      row.status === VisitReconciliationStatus.REJECTED_FOR_INVOICE;

    let finalStatus = promotedStatus;
    if (
      !lockedOrRejected &&
      payCard &&
      payMinutes > 0 &&
      payableAmount == null &&
      activeExceptions.some((e) => e.code === FinanceExceptionCode.RATE_MISSING)
    ) {
      // Clear a previously approved pay status when no matching rate applies.
      finalStatus = deriveReconciliationStatus(activeExceptions, undefined);
    }
    // A settled visit keeps the approval it was paid under; only explicit charge-side decisions move it.
    if (paySettled) finalStatus = row.status;

    // Replacement carer on a visit whose removed carer was already paid: never approve this row
    // automatically. A manager decides, since paying it means recovering the first payment (VW-11).
    if (!paySettled && !lockedOrRejected && siblingRecons.length > 1) {
      // Automatic approval leaves approvedById empty; a person's approval records who decided.
      const approvedByPerson =
        row.approvedById != null &&
        (row.status === VisitReconciliationStatus.APPROVED_FOR_PAY ||
          row.status === VisitReconciliationStatus.APPROVED_FOR_BOTH ||
          row.status === VisitReconciliationStatus.APPROVED_FOR_INVOICE);
      if (!approvedByPerson) {
        const { removed } = await this.rowsByAllocationState(db, row.scheduledVisitId);
        if (removed.some((r) => r.id !== id && isPaySettled(r))) {
          finalStatus = VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL;
        }
      }
    }

    const becamePendingFromApproval =
      finalStatus === VisitReconciliationStatus.PENDING_REVIEW &&
      (row.status === VisitReconciliationStatus.APPROVED_FOR_PAY ||
        row.status === VisitReconciliationStatus.APPROVED_FOR_BOTH ||
        row.status === VisitReconciliationStatus.APPROVED_FOR_INVOICE);

    const evaluated = {
        status: finalStatus,
        payCardId: freezePayable ? (payCard?.id ?? row.payCardId) : (payCard?.id ?? null),
        chargeCardId: keepFrozenBillable
          ? (chargeCard?.id ?? row.chargeCardId)
          : (chargeCard?.id ?? null),
        payCardSource: freezePayable ? (payCardSource ?? row.payCardSource) : payCardSource,
        chargeCardSource: keepFrozenBillable
          ? (chargeCardSource ?? row.chargeCardSource)
          : chargeCardSource,
        approvedPayStart,
        approvedPayEnd,
        approvedBillStart,
        approvedBillEnd,
        payableMinutes: payMinutes,
        billableMinutes: billMinutes,
        payableAmount: payableAmount != null ? payableAmount : null,
        billableAmount: billableAmount != null ? billableAmount : null,
        overrunMinutes: computedOverrun,
        overrunDecision,
        payCardVersion: payCard
          ? ((payCard as { version?: number }).version ?? null)
          : freezePayable
            ? row.payCardVersion
            : null,
        lastEvaluatedAt: new Date(),
        ...(becamePendingFromApproval
          ? { approvedAt: null, approvedById: null, approvalSource: null, approvedEvidence: null }
          : {}),
        // R-18: note what the approval stands for. A visit approved just now by this evaluation
        // is an automatic approval; an approval that carries no evidence yet adopts the current.
        ...(isApprovedStatus(finalStatus) && !wasApprovedBeforeEvaluation
          ? { approvalSource: 'AUTO_VERIFIED', approvedEvidence: currentEvidence, approvedAt: new Date() }
          : (isApprovedStatus(finalStatus) || paySettled) && !row.approvedEvidence
            ? { approvalSource: inferApprovalSource(row), approvedEvidence: currentEvidence }
            : {}),
        ...(suggestedTravelMinutes != null ? { travelMinutes: suggestedTravelMinutes } : {}),
        ...(suggestedUnpaidTravelMinutes != null
          ? { unpaidTravelMinutes: suggestedUnpaidTravelMinutes }
          : {}),
    };
    await db.visitReconciliation.update({
      where: { id },
      data: paySettled ? withoutPaySnapshotFields(evaluated) : evaluated,
    });

    // Freeze the pricing breakdown the moment a completed visit is priced (fresh or
    // force-recalculated). The detail view replays this snapshot, so later pay/charge
    // card rule edits do not retro-change how an already-completed visit was priced.
    const repriced = !freezeBillable || !freezePayable;
    if (visitCompleted && repriced && (billableAmount != null || payableAmount != null)) {
      const snapshotRow = await db.visitReconciliation.findUnique({
        where: { id },
        include: reconciliationInclude,
      });
      if (snapshotRow) {
        const snapshot = await this.buildCalculationPreview(snapshotRow, db);
        await db.visitReconciliation.update({
          where: { id },
          data: {
            pricingSnapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
            pricingSnapshotAt: new Date(),
          },
        });
      }
    }
  }

  private async hasIncompleteTasks(db: DbClient, jobId: string): Promise<boolean> {
    const incomplete = await db.scheduledVisitTaskCompletion.count({
      where: {
        scheduledJobId: jobId,
        isCompleted: false,
      },
    });
    return incomplete > 0;
  }

  /**
   * PC-10: who was funding the client's care on the day of the visit, for the carer's pay only.
   * Where the funding records cannot say and the carer is paid differently for one of the funders
   * it might have been, the pay is held for a person to settle instead of being priced on the
   * funder the client has today.
   */
  private async payFunderForVisit(
    db: DbClient,
    serviceUserId: string,
    employeeId: string,
    at: Date,
  ): Promise<{ funderId: string | null; problem: string | null }> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const dayOf = (instant: Date) => dayKeyInTimeZone(instant, timeZone);
    const dayKey = dayOf(at);
    const client = await db.serviceUser.findFirst({
      where: { id: serviceUserId },
      select: {
        currentFundingId: true,
        fundings: {
          where: { deletedAt: null },
          select: {
            id: true,
            funderId: true,
            startDate: true,
            endDate: true,
            isPrimary: true,
            isActive: true,
            splitPriority: true,
            createdAt: true,
          },
        },
      },
    });
    const found = payFunderOn(client?.fundings ?? [], client?.currentFundingId ?? null, dayKey, dayOf);
    if (found.basis !== 'UNCLEAR') return { funderId: found.funderId, problem: null };

    // Unclear only matters when the carer has a different pay card for one of those funders.
    const overrides = await db.employeeFunderPayAssignment.findMany({
      where: { employeeId, funderId: { in: found.uncertainFunderIds }, deletedAt: null },
    });
    const inForce = effectiveEmployeeFunderPayAssignments(
      overrides,
      new Date(`${dayKey}T00:00:00.000Z`),
    );
    if (!inForce.length) return { funderId: null, problem: null };
    const funders = await db.funder.findMany({
      where: { id: { in: [...new Set(inForce.map((o) => o.funderId))] } },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    const names = funders.map((f) => f.name).join(' or ') || 'a funder';
    return {
      funderId: null,
      problem: `The client's funding records do not show who was funding their care on ${dayKey}, and this carer has a different pay card for work funded by ${names}. Enter the start and end dates on the client's funding and evaluate the visit again, or approve the pay by hand.`,
    };
  }

  private async loadFundingSnapshot(db: DbClient, serviceUserId: string) {
    const su = await db.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: {
        currentFunding: {
          select: {
            status: true,
            isActive: true,
            funderId: true,
            isPrimary: true,
            defaultChargeCardId: true,
            purchaseOrderNumber: true,
            purchaseOrderExpiresAt: true,
            billingContactName: true,
            funder: { select: { defaultChargeCardId: true } },
          },
        },
        fundings: {
          where: { deletedAt: null, isActive: true },
          select: {
            funderId: true,
            isPrimary: true,
            splitPriority: true,
            status: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { splitPriority: 'asc' }],
          take: 20,
        },
      },
    });
    if (!su) return null;

    // Pay resolve uses one funder per visit (primary / current). Invoice split stays on charge side.
    const funding = su.currentFunding;
    const fallbackFunding =
      su.fundings.find((f) => f.isPrimary && f.funderId) ??
      su.fundings.find((f) => f.funderId) ??
      null;

    if (!funding && !fallbackFunding) return null;

    return {
      status: funding?.status ?? fallbackFunding?.status ?? 'UNKNOWN',
      isActive: funding?.isActive ?? true,
      funderId: funding?.funderId ?? fallbackFunding?.funderId ?? null,
      defaultChargeCardId: funding?.defaultChargeCardId ?? null,
      funderDefaultChargeCardId: funding?.funder?.defaultChargeCardId ?? null,
      purchaseOrderNumber: funding?.purchaseOrderNumber ?? null,
      purchaseOrderExpiresAt: funding?.purchaseOrderExpiresAt ?? null,
      billingContactName: funding?.billingContactName ?? null,
    };
  }

  private async scheduledVisitIdsForNightDutyFilter(
    raw?: string,
  ): Promise<
    | { mode: 'all' }
    | { mode: 'empty' }
    | { mode: 'in'; ids: string[] }
    | { mode: 'notIn'; ids: string[] }
  > {
    const filter = raw?.trim();
    if (!filter || filter === 'all') return { mode: 'all' };

    const overnightDuties: VisitPlanNightDuty[] = [
      VisitPlanNightDuty.SLEEPING_NIGHT,
      VisitPlanNightDuty.WAKING_NIGHT,
    ];
    const duties: VisitPlanNightDuty[] | null =
      filter === 'overnight'
        ? overnightDuties
        : filter === 'SLEEPING_NIGHT' || filter === 'WAKING_NIGHT'
          ? [filter]
          : filter === 'standard' || filter === 'NONE'
            ? overnightDuties
            : null;
    if (!duties) return { mode: 'all' };

    const [fromSlots, fromJobs] = await Promise.all([
      this.prisma.scheduledVisit.findMany({
        where: { deletedAt: null, visitPlanSlot: { nightDuty: { in: duties } } },
        select: { id: true },
      }),
      this.prisma.scheduledJob.findMany({
        where: {
          deletedAt: null,
          OR: duties.map((duty) => ({
            metadata: { path: ['nightDuty'], equals: duty },
          })),
        },
        select: { id: true },
      }),
    ]);
    const extraVisits = fromJobs.length
      ? await this.prisma.scheduledVisit.findMany({
          where: {
            deletedAt: null,
            scheduledJobId: { in: fromJobs.map((job) => job.id) },
          },
          select: { id: true },
        })
      : [];
    const ids = [...new Set([...fromSlots, ...extraVisits].map((row) => row.id))];
    if (filter === 'standard' || filter === 'NONE') {
      return { mode: 'notIn', ids };
    }
    if (!ids.length) return { mode: 'empty' };
    return { mode: 'in', ids };
  }

  private async enrichRows(rows: ReconciliationRow[]): Promise<VisitReconciliationListRow[]> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const suIds = [...new Set(rows.map((r) => r.serviceUserId))];
    const empIds = [...new Set(rows.map((r) => r.employeeId).filter(Boolean))] as string[];

    const visitIds = [...new Set(rows.map((r) => r.scheduledVisitId))];
    const jobIds = [...new Set(rows.map((r) => r.scheduledJobId))];
    const [serviceUsers, employees, nightVisits, nightJobs] = await Promise.all([
      suIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: suIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              serviceUserNumber: true,
              careType: { select: { code: true } },
              address: {
                select: {
                  addressLine1: true,
                  addressLine2: true,
                  postcode: true,
                },
              },
            },
          })
        : [],
      empIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: empIds } },
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true } },
            },
          })
        : [],
      visitIds.length
        ? this.prisma.scheduledVisit.findMany({
            where: { id: { in: visitIds } },
            select: {
              id: true,
              scheduledJobId: true,
              visitPlanSlot: { select: { nightDuty: true } },
              scheduledJob: { select: { metadata: true } },
            },
          })
        : [],
      jobIds.length
        ? this.prisma.scheduledJob.findMany({
            where: { id: { in: jobIds } },
            select: { id: true, metadata: true },
          })
        : [],
    ]);

    const suById = new Map(serviceUsers.map((su) => [su.id, su]));
    const nightDutyByJobId = new Map(
      nightJobs.map((job) => [
        job.id,
        resolveStoredNightDuty({ jobMetadata: job.metadata }),
      ]),
    );
    const nightDutyByVisitId = new Map(
      nightVisits.map((visit) => {
        const nightDuty = resolveStoredNightDuty({
          slotNightDuty: visit.visitPlanSlot?.nightDuty,
          jobMetadata: visit.scheduledJob?.metadata,
        });
        return [visit.id, nightDuty] as const;
      }),
    );
    const empMap = new Map(
      employees.map((e) => [
        e.id,
        formatPersonName({
          firstName: e.personalDetail?.firstName,
          lastName: e.personalDetail?.lastName,
        }),
      ]),
    );

    return rows.map((row) => {
      const su = suById.get(row.serviceUserId);
      const emonitored = resolveEmonitored(row.actualStartDateTime, row.actualEndDateTime);
      const clientAddress = [su?.address?.addressLine1, su?.address?.addressLine2]
        .filter(Boolean)
        .join(' ')
        .trim();

      return {
        id: row.id,
        visitRef: row.visitRef,
        scheduledVisitId: row.scheduledVisitId,
        scheduledJobId: row.scheduledJobId,
        serviceUserId: row.serviceUserId,
        serviceUserName: su ? formatPersonName(su) : 'Unknown',
        employeeId: row.employeeId,
        carerName: row.employeeId ? (empMap.get(row.employeeId) ?? null) : null,
        date: formatDateOnly(row.plannedStartDateTime, timeZone),
        planned: formatTimeRange(row.plannedStartDateTime, row.plannedEndDateTime, timeZone),
        actual: formatTimeRange(row.actualStartDateTime, row.actualEndDateTime, timeZone),
        approvedPayable: formatTimeRange(row.approvedPayStart, row.approvedPayEnd, timeZone),
        approvedBillable: formatTimeRange(row.approvedBillStart, row.approvedBillEnd, timeZone),
        payableAmount:
          row.payableAmount != null
            ? `£${Number(row.payableAmount).toFixed(2)}`
            : (() => {
                const manual = resolveManualPayableAmount(row);
                return manual != null ? `£${manual.toFixed(2)}` : null;
              })(),
        billableAmount:
          row.billableAmount != null
            ? `£${Number(row.billableAmount).toFixed(2)}`
            : (() => {
                const manual = resolveManualBillableAmount(row);
                return manual != null ? `£${manual.toFixed(2)}` : null;
              })(),
        travelMiles: row.travelMiles != null ? Number(row.travelMiles) : null,
        travelMinutes: row.travelMinutes ?? null,
        currency: row.currency,
        status: row.status,
        exceptions: row.exceptions.map((e) => ({
          code: e.code,
          message: e.message?.trim() || e.code,
        })),
        overrunMinutes: row.overrunMinutes ?? null,
        overrunReason: row.overrunReason ?? null,
        overrunDecision: row.overrunDecision ?? null,
        overrunPayBasis: row.overrunPayBasis ?? null,
        overrunBillBasis: row.overrunBillBasis ?? null,
        approvalNotes: row.approvalNotes ?? null,
        emonitored,
        clientId: su?.serviceUserNumber?.trim() || '',
        clientFirstName: su?.firstName ?? '',
        clientSecondName: su?.lastName ?? '',
        clientAddress,
        clientPostCode: su?.address?.postcode?.trim() || '',
        visitDate: formatVisitDateMmDdYy(row.plannedStartDateTime, timeZone),
        careType: resolveCareTypeExportCode(su?.careType?.code),
        plannedArrival: formatTimeHhMmSs(row.plannedStartDateTime, timeZone),
        plannedDeparture: formatTimeHhMmSsOrZero(row.plannedEndDateTime, timeZone),
        actualArrival:
          emonitored === 'LOGGED'
            ? formatTimeHhMmSs(row.actualStartDateTime!, timeZone)
            : '00:00:00',
        actualDeparture:
          emonitored === 'LOGGED'
            ? formatTimeHhMmSs(row.actualEndDateTime!, timeZone)
            : '00:00:00',
        createdAt: row.createdAt.toISOString(),
        nightDuty:
          nightDutyByVisitId.get(row.scheduledVisitId) ??
          nightDutyByJobId.get(row.scheduledJobId) ??
          'NONE',
        nightDutyLabel:
          nightDutyAppLabel(
            nightDutyByVisitId.get(row.scheduledVisitId) ??
              nightDutyByJobId.get(row.scheduledJobId) ??
              'NONE',
          ) ?? 'Standard',
      };
    });
  }

  private async buildCalculationPreview(row: ReconciliationRow, db: DbClient = this.prisma) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const exceptions = row.exceptions
      .filter((e) => !e.resolvedAt)
      .map((e) => ({ code: e.code, message: e.message ?? '' }));

    const defaults = resolveDefaultApprovedWindows({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: row.plannedEndDateTime,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      exceptions,
      durationToleranceMinutes: await this.resolveDurationToleranceMinutes(
        db,
        row.scheduledVisitId,
      ),
    });

    const payStart = row.approvedPayStart ?? defaults.approvedPayStart;
    const payEnd = row.approvedPayEnd ?? defaults.approvedPayEnd;
    const billStart = row.approvedBillStart;
    const billEnd = row.approvedBillEnd;

    const orgChargeMode = await db.organisationGeneralSettings.findFirst({
      select: { multiCarerFunderChargeMode: true },
    });
    const multiCarerMode =
      orgChargeMode?.multiCarerFunderChargeMode === 'FIXED' ? 'FIXED' : 'COMBINED';

    const siblingCount = await db.visitReconciliation.count({
      where: { scheduledVisitId: row.scheduledVisitId },
    });
    const isMultiCarer = siblingCount > 1;
    const isFunderBillingRow = Boolean(billStart && billEnd && (row.billableMinutes ?? 0) > 0);
    let funderChargeNote: string | null = null;
    if (isMultiCarer && multiCarerMode === 'FIXED') {
      funderChargeNote = isFunderBillingRow
        ? 'Fixed visit pay — client charge uses the full visit window (not this carer’s assignment alone).'
        : 'Fixed visit pay — funder is charged once on the visit window (this carer has £0 client charge).';
    } else if (isMultiCarer && multiCarerMode === 'COMBINED') {
      funderChargeNote =
        'Combined visit pay — client charge is this carer’s hours; sibling carers are charged separately.';
    }

    const plannedMinutes =
      row.plannedEndDateTime != null
        ? minutesBetween(row.plannedStartDateTime, row.plannedEndDateTime)
        : null;
    const actualMinutes =
      row.actualStartDateTime && row.actualEndDateTime
        ? minutesBetween(row.actualStartDateTime, row.actualEndDateTime)
        : null;

    const payMinutes =
      row.payableMinutes ?? minutesBetween(payStart, payEnd);
    const billMinutes =
      row.billableMinutes ??
      (billStart && billEnd ? minutesBetween(billStart, billEnd) : 0);

    let carerPay = null;
    let clientCharge = null;
    let funderClientCharges: Array<{
      funderName: string;
      splitPercent: number | null;
      shareAmount: string;
      cardGrossAmount: string | null;
      breakdown: ReturnType<typeof buildChargeRateBreakdown>;
      reason: string | null;
    }> | null = null;

    const isBankHoliday = await isVisitOnBankHoliday(
      db,
      row.plannedStartDateTime,
      timeZone,
    );
    const bankHolidayDates =
      billStart && billEnd
        ? await loadBankHolidayDateSet(db, billStart, billEnd, timeZone)
        : new Set<string>();
    const nightVisit = await db.scheduledVisit.findUnique({
      where: { id: row.scheduledVisitId },
      select: {
        status: true,
        actualStartDateTime: true,
        actualEndDateTime: true,
        scheduledStartDateTime: true,
        visitPlanSlot: { select: { nightDuty: true } },
        scheduledJob: { select: { metadata: true } },
      },
    });
    const nightDuty = resolveStoredNightDuty({
      slotNightDuty: nightVisit?.visitPlanSlot?.nightDuty,
      jobMetadata: nightVisit?.scheduledJob?.metadata,
    });
    const billRateAnchor = nightVisit?.scheduledStartDateTime ?? row.plannedStartDateTime;

    const visitCompleted = nightVisit
      ? isBillingEligibleVisit({
          status: nightVisit.status,
          actualStartDateTime: nightVisit.actualStartDateTime,
          actualEndDateTime: nightVisit.actualEndDateTime,
        })
      : false;
    const freezeBillable =
      hasManualBillableOverride(row) || (visitCompleted && row.billableAmount != null);
    const freezePayable =
      hasManualPayableOverride(row) || (visitCompleted && row.payableAmount != null);

    const perFunderCharges =
      billMinutes > 0 && billStart && billEnd
        ? await loadPerFunderChargeCalculation(db, {
            serviceUserId: row.serviceUserId,
            billMinutes,
            rateBasisMinutes: plannedMinutes,
            billRateAnchor,
            approvedBillStart: billStart,
            approvedBillEnd: billEnd,
            isBankHoliday,
            isBankHolidayFn: (d) =>
              bankHolidayDates.has(dayKeyInTimeZone(d, timeZone)),
            nightDuty,
            timeZone,
          })
        : null;

    const frozenBillable = freezeBillable
      ? row.billableAmount != null
        ? Number(row.billableAmount)
        : resolveManualBillableAmount(row)
      : null;
    const liveBillableTotal = perFunderCharges?.totalAmount ?? null;
    const frozenDiffersFromLive =
      frozenBillable != null &&
      liveBillableTotal != null &&
      Math.abs(frozenBillable - liveBillableTotal) > 0.009;

    const pricingFrozenNote =
      freezeBillable || freezePayable
        ? frozenDiffersFromLive
          ? `Stored client charge is ${formatMoney(frozenBillable!)}. Current funder charge cards would price this visit at ${formatMoney(liveBillableTotal!)}. Use Recalculate amounts on Visit reconciliations if you want to update the stored figure.`
          : 'Amounts were priced when this visit completed. Changing charge/pay cards later does not update these figures (unless finance force-recalculates).'
        : null;

    if (perFunderCharges) {
      funderClientCharges = [];
      for (const line of perFunderCharges.lines) {
        let breakdown: ReturnType<typeof buildChargeRateBreakdown> = null;
        if (line.chargeCardId && billStart && billEnd) {
          const [chargeCard, chargeRules] = await Promise.all([
            db.chargeCard.findUnique({
              where: { id: line.chargeCardId },
              select: { name: true, code: true, defaultChargeMethod: true },
            }),
            db.chargeCardRule.findMany({ where: { chargeCardId: line.chargeCardId } }),
          ]);
          breakdown = buildChargeRateBreakdown(
            chargeRules,
            billRateAnchor,
            billMinutes,
            chargeCard?.defaultChargeMethod ?? 'HOURLY_PRO_RATA',
            {
              cardName: chargeCard?.name ?? null,
              cardCode: chargeCard?.code ?? null,
              cardSource: 'EXPLICIT_FUNDING',
            },
            isBankHoliday,
            { start: billStart, end: billEnd, timeZone },
            nightDuty,
            plannedMinutes,
          );
        }
        funderClientCharges.push({
          funderName: line.funderName ?? 'Unassigned funder',
          splitPercent: line.splitPercent,
          shareAmount: formatMoney(line.amount),
          cardGrossAmount:
            line.cardGrossAmount != null ? formatMoney(line.cardGrossAmount) : null,
          breakdown,
          reason: line.reason,
        });
      }
      const includedCount = perFunderCharges.lines.filter((line) => line.included).length;
      const displayTotal =
        freezeBillable && frozenBillable != null ? frozenBillable : perFunderCharges.totalAmount;
      const appliedRules = funderClientCharges.flatMap((funderCharge) => {
        const rules = funderCharge.breakdown?.appliedRules ?? [];
        if (!rules.length && funderCharge.breakdown?.ruleLabel) {
          return [
            {
              label: `${funderCharge.funderName}: ${funderCharge.breakdown.ruleLabel}`,
              rateType: funderCharge.breakdown.rateType,
              rateTypeLabel: funderCharge.breakdown.rateType,
              dayType: null,
              dayTypeLabel: null,
              timeWindow: null,
              unitRate: funderCharge.breakdown.unitRate,
              amount: funderCharge.shareAmount,
              detail: [
                funderCharge.breakdown.ruleLabel,
                funderCharge.splitPercent != null ? `${funderCharge.splitPercent}% split` : null,
                funderCharge.cardGrossAmount
                  ? `${funderCharge.cardGrossAmount} visit price`
                  : null,
              ]
                .filter(Boolean)
                .join(' · '),
            },
          ];
        }
        return rules.map((rule) => ({
          ...rule,
          label: `${funderCharge.funderName}: ${rule.label}`,
          amount: funderCharge.shareAmount,
          detail: [
            rule.detail,
            funderCharge.splitPercent != null ? `${funderCharge.splitPercent}% split` : null,
            funderCharge.cardGrossAmount ? `card ${funderCharge.cardGrossAmount}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        }));
      });
      clientCharge = {
        minutes: billMinutes,
        hoursLabel: formatMinutesAsHours(billMinutes),
        rateType: freezeBillable ? 'FROZEN_MULTI_FUNDER' : 'MULTI_FUNDER',
        unitRate: null,
        amount: formatMoney(displayTotal),
        formula: freezeBillable
          ? `Stored total across ${includedCount} funder${includedCount === 1 ? '' : 's'} (priced at completion)`
          : `Total across ${includedCount} funder${includedCount === 1 ? '' : 's'}`,
        cardName: null,
        cardCode: null,
        cardSource: row.chargeCardSource,
        ruleLabel: freezeBillable
          ? 'Per-funder charge cards (frozen total)'
          : 'Per-funder charge cards',
        appliedRules: appliedRules.length ? appliedRules : undefined,
      };
    } else if (row.chargeCardId && billMinutes > 0 && billStart && billEnd) {
      const [chargeCard, chargeRules] = await Promise.all([
        db.chargeCard.findUnique({
          where: { id: row.chargeCardId },
          select: { name: true, code: true, defaultChargeMethod: true },
        }),
        db.chargeCardRule.findMany({ where: { chargeCardId: row.chargeCardId } }),
      ]);
      clientCharge = buildChargeRateBreakdown(
        chargeRules,
        billRateAnchor,
        billMinutes,
        chargeCard?.defaultChargeMethod ?? 'HOURLY_PRO_RATA',
        {
          cardName: chargeCard?.name ?? null,
          cardCode: chargeCard?.code ?? null,
          cardSource: row.chargeCardSource,
        },
        isBankHoliday,
        { start: billStart, end: billEnd, timeZone },
        nightDuty,
        plannedMinutes,
      );
      if (freezeBillable && frozenBillable != null && clientCharge) {
        const manual = hasManualBillableOverride(row);
        clientCharge = {
          ...clientCharge,
          amount: formatMoney(frozenBillable),
          manualOverride: manual || undefined,
          formula: `${clientCharge.formula} (${manual ? 'manual override' : 'stored total frozen at completion'})`,
          ruleLabel: clientCharge.ruleLabel
            ? `${clientCharge.ruleLabel} · ${manual ? 'manual' : 'frozen total'}`
            : manual
              ? 'Manual billable amount'
              : 'Frozen at completion',
          explanation: manual ? 'Manual billable amount override' : clientCharge.explanation,
        };
      }
    } else if (freezeBillable && frozenBillable != null) {
      const manual = hasManualBillableOverride(row);
      clientCharge = {
        minutes: billMinutes,
        hoursLabel: formatMinutesAsHours(billMinutes),
        rateType: manual ? 'MANUAL' : 'FROZEN',
        unitRate: null,
        amount: formatMoney(frozenBillable),
        formula: manual
          ? 'Manual billable amount override'
          : 'Priced at visit completion — charge-card changes no longer update this amount',
        cardName: null,
        cardCode: null,
        cardSource: row.chargeCardSource,
        ruleLabel: manual ? 'Manual billable amount' : 'Frozen at completion',
        manualOverride: manual || undefined,
        explanation: manual ? 'Manual billable amount override' : null,
      };
    }
    if (row.payCardId && payMinutes > 0) {
      const [payCard, payRules] = await Promise.all([
        db.payCard.findUnique({
          where: { id: row.payCardId },
          select: { name: true, code: true, bankHolidayRegion: true },
        }),
        loadPayCardRulesForVersion(db, row.payCardId, row.payCardVersion),
      ]);
      const payRegion = payCard?.bankHolidayRegion || DEFAULT_BANK_HOLIDAY_REGION;
      // The explanation is worked out on the same calendar as the amount.
      const payCalendar = await loadPayCalendar(db, payStart, payEnd, payRegion);
      const payIsBankHoliday = payCalendar.bankHolidayKeys.has(
        dayKeyInTimeZone(row.plannedStartDateTime, timeZone),
      );
      const livePay = buildPayRateBreakdown(
        payRules,
        row.plannedStartDateTime,
        payMinutes,
        {
          cardName: payCard?.name ?? null,
          cardCode: payCard?.code ?? null,
          cardSource: row.payCardSource,
        },
        payIsBankHoliday,
        {
          start: payStart,
          end: payEnd,
          timeZone,
          isBankHolidayFn: (d) => payCalendar.bankHolidayKeys.has(dayKeyInTimeZone(d, timeZone)),
          calendar: payCalendar.calendar,
        },
        nightDuty,
        plannedMinutes,
      );
      if (freezePayable) {
        const frozenPayable =
          row.payableAmount != null
            ? Number(row.payableAmount)
            : resolveManualPayableAmount(row);
        if (frozenPayable != null) {
          const manual = hasManualPayableOverride(row);
          carerPay = livePay
            ? {
                ...livePay,
                amount: formatMoney(frozenPayable),
                manualOverride: manual || undefined,
                formula: livePay.formula
                  ? `${livePay.formula} (${manual ? 'manual override' : 'stored total frozen at completion'})`
                  : manual
                    ? 'Manual payable amount override'
                    : 'Priced at visit completion — pay-card changes no longer update this amount',
                ruleLabel: livePay.ruleLabel
                  ? `${livePay.ruleLabel} · ${manual ? 'manual' : 'frozen total'}`
                  : manual
                    ? 'Manual payable amount'
                    : 'Frozen at completion',
                explanation: manual ? 'Manual payable amount override' : livePay.explanation,
              }
            : {
                minutes: payMinutes,
                hoursLabel: formatMinutesAsHours(payMinutes),
                rateType: manual ? 'MANUAL' : 'FROZEN',
                unitRate: null,
                amount: formatMoney(frozenPayable),
                formula: manual
                  ? 'Manual payable amount override'
                  : 'Priced at visit completion — pay-card changes no longer update this amount',
                cardName: payCard?.name ?? null,
                cardCode: payCard?.code ?? null,
                cardSource: row.payCardSource,
                ruleLabel: manual ? 'Manual payable amount' : 'Frozen at completion',
                manualOverride: manual || undefined,
                explanation: manual ? 'Manual payable amount override' : null,
              };
        } else {
          carerPay = livePay;
        }
      } else {
        carerPay = livePay;
      }
    }

    let funderSplitPreview: {
      note: string;
      totalAmount: string;
      visitChargeCardName: string | null;
      lines: Array<{
        funderName: string;
        splitPercent: number | null;
        amount: string;
        included: boolean;
        reason: string | null;
        chargeCardName: string | null;
        pricedWithVisitCard: boolean;
        pricingNote: string | null;
      }>;
    } | null = null;

    const fundingLines = await db.serviceUserFunding.findMany({
      where: { serviceUserId: row.serviceUserId, deletedAt: null },
      include: {
        funder: {
          select: {
            name: true,
            defaultChargeCard: { select: { id: true, name: true, code: true } },
          },
        },
        defaultChargeCard: { select: { id: true, name: true, code: true } },
      },
    });
    const fundingSplits = buildFundingSplits(fundingLines);
    if (perFunderCharges) {
      const cardNameByFunding = new Map(
        fundingLines.map((funding) => [
          funding.id,
          funding.defaultChargeCard?.name ?? funding.funder?.defaultChargeCard?.name ?? null,
        ]),
      );
      const displayTotal =
        freezeBillable && frozenBillable != null
          ? frozenBillable
          : perFunderCharges.totalAmount;
      funderSplitPreview = {
        note: freezeBillable
          ? 'Each funder is priced with their own charge card (45‑min / hourly rules as applicable). The stored visit total was frozen at completion.'
          : 'Each funder is charged using their own funding rate card. The split % applies to that funder\'s full visit price.',
        totalAmount: formatMoney(displayTotal),
        visitChargeCardName: null,
        lines: perFunderCharges.lines.map((line) => ({
          funderName: line.funderName ?? 'Unassigned funder',
          splitPercent: line.splitPercent,
          amount: formatMoney(line.amount),
          included: line.included,
          reason: line.reason,
          chargeCardName: cardNameByFunding.get(line.fundingId) ?? null,
          pricedWithVisitCard: true,
          pricingNote:
            line.included && line.cardGrossAmount != null && line.splitPercent != null
              ? `${formatMoney(line.cardGrossAmount)} visit price × ${line.splitPercent}%`
              : line.reason,
        })),
      };
    } else if (fundingSplits.length >= 2) {
      const totalCharge =
        row.billableAmount != null
          ? Number(row.billableAmount)
          : clientCharge?.amount != null
            ? Number(String(clientCharge.amount).replace(/[^0-9.-]+/g, ''))
            : 0;
      const fundingChargeCardById = new Map<
        string,
        { id: string; name: string } | null
      >();
      for (const funding of fundingLines) {
        const card =
          funding.defaultChargeCard ??
          funding.funder?.defaultChargeCard ??
          null;
        fundingChargeCardById.set(
          funding.id,
          card ? { id: card.id, name: card.name } : null,
        );
      }
      const preview = buildFunderSplitPreview(totalCharge, fundingSplits, {
        visitChargeCardId: row.chargeCardId,
        visitChargeCardName: clientCharge?.cardName ?? null,
        fundingChargeCardById,
      });
      if (preview) {
        funderSplitPreview = {
          note: preview.note,
          totalAmount: formatMoney(preview.totalAmount),
          visitChargeCardName: preview.visitChargeCardName,
          lines: preview.lines.map((line) => ({
            funderName: line.funderName,
            splitPercent: line.splitPercent,
            amount: formatMoney(line.amount),
            included: line.included,
            reason: line.reason,
            chargeCardName: line.chargeCardName,
            pricedWithVisitCard: line.pricedWithVisitCard,
            pricingNote: line.pricingNote,
          })),
        };
      }
    }

    return {
      plannedMinutes,
      actualMinutes,
      plannedHours: plannedMinutes != null ? formatMinutesAsHours(plannedMinutes) : null,
      actualHours: actualMinutes != null ? formatMinutesAsHours(actualMinutes) : null,
      payableMinutes: payMinutes,
      billableMinutes: billMinutes,
      payableHours: payMinutes > 0 ? formatMinutesAsHours(payMinutes) : null,
      billableHours: billMinutes > 0 ? formatMinutesAsHours(billMinutes) : null,
      multiCarerFunderChargeMode: multiCarerMode,
      isFunderBillingRow,
      funderChargeNote,
      funderSplitPreview,
      pricingFrozen: freezeBillable || freezePayable,
      pricingFrozenNote,
      timeWindows: {
        planned: formatTimeRange(row.plannedStartDateTime, row.plannedEndDateTime, timeZone),
        actual: formatTimeRange(row.actualStartDateTime, row.actualEndDateTime, timeZone),
        approvedPayable: formatTimeRange(payStart, payEnd, timeZone),
        approvedBillable:
          billStart && billEnd && billMinutes > 0
            ? formatTimeRange(billStart, billEnd, timeZone)
            : '— (not charged)',
      },
      carerPay,
      clientCharge,
      funderClientCharges,
      exceptionDetails: row.exceptions.map((e) => ({
        code: e.code,
        message: e.message ?? e.code,
        resolved: Boolean(e.resolvedAt),
      })),
    };
  }
}

function formatPersonName(person: {
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
}): string {
  const parts = [person.preferredName?.trim() || person.firstName?.trim(), person.lastName?.trim()].filter(
    Boolean,
  );
  return parts.join(' ') || 'Unknown';
}
