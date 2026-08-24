import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus,
  FinanceExceptionCode,
  Prisma,
  ScheduledVisitStatus,
  VisitOverrunDecision,
  VisitPlanNightDuty,
  VisitReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { PayCardsService, ChargeCardsService } from './billing-cards.service';
import {
  ApproveVisitReconciliationDto,
  BackfillVisitReconciliationsDto,
  BulkApproveVisitReconciliationsDto,
  DecideVisitOverrunDto,
  RecalculateVisitReconciliationsDto,
  RejectVisitReconciliationDto,
  SetVisitPayableAmountDto,
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
  formatVisitRef,
  formatMinutesAsHours,
  hasUnresolvedBlockingExceptions,
  listUnresolvedBlockingCodes,
  hasPayBlockingExceptions,
  listPayBlockingCodes,
  minutesBetween,
  isInvertedDateWindow,
  isDurationShortfallWithinTolerance,
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

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const COMPLETED_VISIT_STATUSES: ScheduledVisitStatus[] = [
  ScheduledVisitStatus.COMPLETED,
  ScheduledVisitStatus.PARTIALLY_COMPLETED,
];

function isBillingEligibleVisit(visit: {
  status: ScheduledVisitStatus;
  actualStartDateTime: Date | null;
  actualEndDateTime: Date | null;
}): boolean {
  if (COMPLETED_VISIT_STATUSES.includes(visit.status)) return true;
  return Boolean(visit.actualStartDateTime && visit.actualEndDateTime);
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

async function isVisitOnBankHoliday(db: DbClient, date: Date): Promise<boolean> {
  const set = await loadBankHolidayDateSet(db, date, date);
  return set.has(utcDateKey(date));
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Load active bank-holiday UTC date keys covering [from, to] inclusive. */
async function loadBankHolidayDateSet(
  db: DbClient,
  from: Date,
  to: Date,
): Promise<Set<string>> {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  const rows = await db.bankHoliday.findMany({
    where: {
      isActive: true,
      holidayDate: { gte: start, lte: end },
    },
    select: { holidayDate: true },
  });
  return new Set(rows.map((r) => utcDateKey(r.holidayDate)));
}

@Injectable()
export class VisitReconciliationsService {
  private readonly logger = new Logger(VisitReconciliationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payCardsService: PayCardsService,
    private readonly chargeCardsService: ChargeCardsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  private client(tx?: Prisma.TransactionClient): DbClient {
    return tx ?? this.prisma;
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

  async ensureForVisit(
    scheduledVisitId: string,
    tx?: Prisma.TransactionClient,
    options?: { overrunReason?: string | null },
  ): Promise<string | null> {
    const db = this.client(tx);
    const visit = await db.scheduledVisit.findFirst({
      where: {
        id: scheduledVisitId,
        deletedAt: null,
        isActive: true,
      },
    });
    if (!visit || !isBillingEligibleVisit(visit)) return null;

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

    let firstId: string | null = null;
    for (const allocation of targets) {
      // Same scheduled visit → same visitRef for every carer (double-up / multi-allocation).
      const visitRef = formatVisitRef(visit.id, visit.scheduledStartDateTime);

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
      const actual = resolveAllocationActualWindow(
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
        const updated = await db.visitReconciliation.update({
          where: { id: existing.id },
          data: {
            plannedStartDateTime: planned.start,
            plannedEndDateTime: planned.end,
            actualStartDateTime: actual.start,
            actualEndDateTime: actual.end,
            employeeId: allocation.employeeId ?? existing.employeeId,
            jobAllocationId: allocation.id ?? existing.jobAllocationId,
            visitRef,
            ...(overrunReason != null ? { overrunReason } : {}),
          },
        });
        await this.safeEvaluate(db, updated.id);
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
          visitRef,
          plannedStartDateTime: planned.start,
          plannedEndDateTime: planned.end,
          actualStartDateTime: actual.start,
          actualEndDateTime: actual.end,
          overrunReason,
        },
      });
      await this.safeEvaluate(db, created.id);
      firstId ??= created.id;
    }

    // Keep every carer's reconciliation on the same shared visit id for this scheduled visit.
    const sharedVisitRef = formatVisitRef(visit.id, visit.scheduledStartDateTime);
    await db.visitReconciliation.updateMany({
      where: {
        scheduledVisitId: visit.id,
        NOT: { visitRef: sharedVisitRef },
      },
      data: { visitRef: sharedVisitRef },
    });

    return firstId;
  }

  private async safeEvaluate(db: DbClient, id: string) {
    try {
      await this.evaluateInternal(db, id);
    } catch (err) {
      this.logger.warn(
        `Visit reconciliation evaluate failed for ${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
      where.plannedStartDateTime = {};
      if (query.dateFrom) {
        where.plannedStartDateTime.gte = new Date(`${query.dateFrom}T00:00:00.000Z`);
      }
      if (query.dateTo) {
        where.plannedStartDateTime.lte = new Date(`${query.dateTo}T23:59:59.999Z`);
      }
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
      where.OR = [
        { visitRef: { contains: s, mode: 'insensitive' } },
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
    const preview = await this.buildCalculationPreview(row);
    return { data: { ...enriched, calculationPreview: preview } };
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

  async update(id: string, dto: UpdateVisitReconciliationDto) {
    const existing = await this.prisma.visitReconciliation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Visit reconciliation not found');
    if (existing.status === VisitReconciliationStatus.LOCKED) {
      throw new BadRequestException('Reconciliation is locked');
    }

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

    await this.prisma.visitReconciliation.update({ where: { id }, data });
    await this.evaluateInternal(this.prisma, id);
    return this.getById(id);
  }

  /**
   * Manually set payable amount for salary. Optionally accept the visit for pay
   * so the amount is included in employee salary totals.
   */
  async setPayableAmount(userId: string, id: string, dto: SetVisitPayableAmountDto) {
    const existing = await this.prisma.visitReconciliation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Visit reconciliation not found');
    if (existing.status === VisitReconciliationStatus.LOCKED) {
      throw new BadRequestException('Reconciliation is locked');
    }
    if (existing.includedInPayrollRunId) {
      throw new BadRequestException(
        'Visit is already included in a payroll run — unlock or remove it before changing the amount',
      );
    }

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
      }
    }

    await this.prisma.visitReconciliation.update({ where: { id }, data });
    return this.getById(id);
  }

  async approve(userId: string, id: string, dto: ApproveVisitReconciliationDto) {
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

    await this.prisma.visitReconciliation.update({
      where: { id },
      data: {
        approvedPayStart,
        approvedPayEnd,
        approvedBillStart,
        approvedBillEnd,
        approvalNotes: dto.approvalNotes?.trim() || row.approvalNotes,
        approvedById: userId,
        approvedAt: new Date(),
        status,
      },
    });

    await this.evaluateInternal(this.prisma, id);
    return this.getById(id);
  }

  async reject(userId: string, id: string, dto: RejectVisitReconciliationDto) {
    const row = await this.prisma.visitReconciliation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Visit reconciliation not found');
    if (row.status === VisitReconciliationStatus.LOCKED) {
      throw new BadRequestException('Reconciliation is locked');
    }

    let status = row.status;
    if (dto.scope === 'PAY') status = VisitReconciliationStatus.REJECTED_FOR_PAY;
    else if (dto.scope === 'INVOICE') status = VisitReconciliationStatus.REJECTED_FOR_INVOICE;
    else status = VisitReconciliationStatus.REJECTED_FOR_PAY;

    await this.prisma.visitReconciliation.update({
      where: { id },
      data: {
        status,
        approvalNotes: dto.approvalNotes?.trim() || row.approvalNotes,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });

    return this.getById(id);
  }

  async approveOverrun(userId: string, id: string, dto: DecideVisitOverrunDto) {
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

    const defaults = resolveDefaultApprovedWindows({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: row.plannedEndDateTime,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      exceptions: [{ code: FinanceExceptionCode.OVERRUN, message: '' }],
      overrunDecision: VisitOverrunDecision.APPROVED,
      durationToleranceMinutes: await this.resolveDurationToleranceMinutes(
        this.prisma,
        row.scheduledVisitId,
      ),
    });

    const notes = [row.approvalNotes, dto.notes?.trim()].filter(Boolean).join('\n') || null;

    await this.prisma.visitReconciliation.update({
      where: { id },
      data: {
        overrunDecision: VisitOverrunDecision.APPROVED,
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

    await this.evaluateInternal(this.prisma, id);
    return this.getById(id);
  }

  async rejectOverrun(userId: string, id: string, dto: DecideVisitOverrunDto) {
    const row = await this.prisma.visitReconciliation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Visit reconciliation not found');
    if (row.status === VisitReconciliationStatus.LOCKED) {
      throw new BadRequestException('Reconciliation is locked');
    }
    if (!row.overrunMinutes || row.overrunMinutes <= 0) {
      throw new BadRequestException('This visit has no overrun to reject');
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

    await this.prisma.visitReconciliation.update({
      where: { id },
      data: {
        overrunDecision: VisitOverrunDecision.REJECTED,
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

    await this.evaluateInternal(this.prisma, id);
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

      if (
        row.status === VisitReconciliationStatus.LOCKED ||
        row.status === VisitReconciliationStatus.APPROVED_FOR_BOTH
      ) {
        skipped.push({ id: row.id, reason: 'Already locked or fully approved' });
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
        await this.approve(userId, row.id, { scope: dto.scope });
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
      where.scheduledStartDateTime = {};
      if (dto.dateFrom) {
        where.scheduledStartDateTime.gte = new Date(`${dto.dateFrom}T00:00:00.000Z`);
      }
      if (dto.dateTo) {
        where.scheduledStartDateTime.lte = new Date(`${dto.dateTo}T23:59:59.999Z`);
      }
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
   */
  async recalculateAmounts(dto: RecalculateVisitReconciliationsDto) {
    const where: Prisma.VisitReconciliationWhereInput = {
      status: { not: VisitReconciliationStatus.LOCKED },
    };

    if (dto.ids?.length) {
      where.id = { in: dto.ids };
    }

    if (dto.dateFrom || dto.dateTo) {
      where.plannedStartDateTime = {
        ...(dto.dateFrom ? { gte: new Date(`${dto.dateFrom}T00:00:00.000Z`) } : {}),
        ...(dto.dateTo ? { lte: new Date(`${dto.dateTo}T23:59:59.999Z`) } : {}),
      };
    }

    const pending = await this.prisma.visitReconciliation.findMany({
      where,
      select: { id: true },
      orderBy: { plannedStartDateTime: 'asc' },
      take: 1000,
    });

    for (const row of pending) {
      await this.safeEvaluate(this.prisma, row.id);
    }

    return {
      message: `Recalculated amounts for ${pending.length} reconciliation(s)`,
      data: { reEvaluated: pending.length, ids: pending.map((r) => r.id) },
    };
  }

  /**
   * Delete visit reconciliations (and dependent finance lines).
   * When `serviceUserId` is set, only that client's rows are removed.
   * Does not reset scheduled visits — use Sync completed visits to recreate.
   */
  async clearAll(serviceUserId?: string) {
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

  async getExceptionQueue(limit = 10) {
    const rows = await this.prisma.financeException.findMany({
      where: { resolvedAt: null },
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

  private async evaluateInternal(db: DbClient, id: string) {
    const row = await db.visitReconciliation.findUnique({
      where: { id },
      include: reconciliationInclude,
    });
    if (!row) return;

    const visit = await db.scheduledVisit.findUnique({
      where: { id: row.scheduledVisitId },
      select: {
        status: true,
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

    const tasksIncomplete = await this.hasIncompleteTasks(db, row.scheduledJobId);
    const funding = await this.loadFundingSnapshot(db, row.serviceUserId);

    let payCard: {
      id: string;
      status: string;
      rulesCount: number;
      stackingPolicy?: string;
      version?: number;
    } | null = null;
    let payCardSource: string | null = null;
    if (row.employeeId) {
      const resolved = await this.payCardsService.resolveForEmployee(
        row.employeeId,
        row.plannedStartDateTime,
      );
      payCardSource = resolved.data.source;
      if (resolved.data.payCard) {
        payCard = {
          id: resolved.data.payCard.id,
          status: resolved.data.payCard.status,
          rulesCount: resolved.data.payCard.rules?.length ?? 0,
          stackingPolicy: (resolved.data.payCard as { stackingPolicy?: string }).stackingPolicy,
          version: (resolved.data.payCard as { version?: number }).version,
        };
      }
    }

    const chargeResolved = await this.chargeCardsService.resolveForServiceUser(row.serviceUserId);
    const chargeCardSource = chargeResolved.data.source;
    let chargeCard: { id: string; status: string; rulesCount: number } | null = null;
    if (chargeResolved.data.chargeCard) {
      chargeCard = {
        id: chargeResolved.data.chargeCard.id,
        status: chargeResolved.data.chargeCard.status,
        rulesCount: chargeResolved.data.chargeCard.rules?.length ?? 0,
      };
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

    const status =
      row.status === VisitReconciliationStatus.APPROVED_FOR_PAY ||
      row.status === VisitReconciliationStatus.APPROVED_FOR_INVOICE ||
      row.status === VisitReconciliationStatus.APPROVED_FOR_BOTH ||
      row.status === VisitReconciliationStatus.LOCKED ||
      row.status === VisitReconciliationStatus.REJECTED_FOR_PAY ||
      row.status === VisitReconciliationStatus.REJECTED_FOR_INVOICE
        ? row.status
        : deriveReconciliationStatus(activeExceptions, row.status);

    const promotedStatus =
      status === VisitReconciliationStatus.APPROVED_FOR_INVOICE &&
      !hasPayBlockingExceptions(activeExceptions)
        ? VisitReconciliationStatus.APPROVED_FOR_BOTH
        : status;

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

    const forceDefaultWindows = computedOverrun != null || withinDurationTolerance;

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
    );
    const isBankHoliday = bankHolidayDates.has(utcDateKey(row.plannedStartDateTime));

    if (payCard && payMinutes) {
      const payRules = await db.payCardRule.findMany({ where: { payCardId: payCard.id } });
      const stackingPolicy =
        ((payCard as { stackingPolicy?: string }).stackingPolicy as
          | 'PRIORITY'
          | 'HIGHEST'
          | 'STACK'
          | undefined) ?? 'PRIORITY';
      const calc = calculatePayableAmount(
        payRules,
        row.plannedStartDateTime,
        payMinutes,
        isBankHoliday,
        {
          start: approvedPayStart,
          end: approvedPayEnd,
          stackingPolicy,
          isBankHolidayFn: (d) => bankHolidayDates.has(utcDateKey(d)),
        },
      );
      payableAmount = calc?.amount ?? null;
      if (payableAmount == null && payMinutes > 0) {
        activeExceptions.push({
          code: FinanceExceptionCode.RATE_MISSING,
          message:
            'No pay card rate matches this visit’s day or time. Add a matching rule (e.g. weekday) or check Saturday/Sunday bands.',
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
        billRateAnchor,
        approvedBillStart,
        approvedBillEnd,
        isBankHoliday,
        isBankHolidayFn: (d) => bankHolidayDates.has(utcDateKey(d)),
        nightDuty,
      });
    }

    if (perFunderCharges) {
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
    } else if (chargeCard && billMinutes) {
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
              isBankHolidayFn: (d) => bankHolidayDates.has(utcDateKey(d)),
            }
          : undefined,
        nightDuty,
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
    } else if (multiCarerMode === 'FIXED' && siblingRecons.length > 1 && !isFunderBillingRow) {
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

    // Once a visit is priced from the pay card, accept it for carer pay immediately.
    // Invoice / overrun / funding exceptions stay on the row for finance review, but
    // earnings and salary must not wait on a visit-reconciliation approve click.
    const lockedOrRejected =
      row.status === VisitReconciliationStatus.LOCKED ||
      row.status === VisitReconciliationStatus.REJECTED_FOR_PAY ||
      row.status === VisitReconciliationStatus.REJECTED_FOR_INVOICE;

    let finalStatus = promotedStatus;
    if (!lockedOrRejected && payableAmount != null && payMinutes > 0) {
      if (
        promotedStatus === VisitReconciliationStatus.APPROVED_FOR_INVOICE ||
        row.status === VisitReconciliationStatus.APPROVED_FOR_INVOICE
      ) {
        finalStatus = VisitReconciliationStatus.APPROVED_FOR_BOTH;
      } else if (
        promotedStatus !== VisitReconciliationStatus.APPROVED_FOR_BOTH &&
        row.status !== VisitReconciliationStatus.APPROVED_FOR_BOTH
      ) {
        finalStatus = VisitReconciliationStatus.APPROVED_FOR_PAY;
      }
    } else if (
      !lockedOrRejected &&
      payCard &&
      payMinutes > 0 &&
      payableAmount == null &&
      activeExceptions.some((e) => e.code === FinanceExceptionCode.RATE_MISSING)
    ) {
      // Clear a previously auto-approved pay status when no matching rate applies.
      finalStatus = deriveReconciliationStatus(activeExceptions, row.status);
    }

    await db.visitReconciliation.update({
      where: { id },
      data: {
        status: finalStatus,
        payCardId: payCard?.id ?? null,
        chargeCardId: chargeCard?.id ?? null,
        payCardSource,
        chargeCardSource,
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
          : null,
        lastEvaluatedAt: new Date(),
        ...((finalStatus === VisitReconciliationStatus.APPROVED_FOR_PAY ||
          finalStatus === VisitReconciliationStatus.APPROVED_FOR_BOTH) &&
        row.status !== finalStatus &&
        !row.approvedAt
          ? { approvedAt: new Date() }
          : {}),
        ...(suggestedTravelMinutes != null ? { travelMinutes: suggestedTravelMinutes } : {}),
        ...(suggestedUnpaidTravelMinutes != null
          ? { unpaidTravelMinutes: suggestedUnpaidTravelMinutes }
          : {}),
      },
    });
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

  private async loadFundingSnapshot(db: DbClient, serviceUserId: string) {
    const su = await db.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: {
        currentFunding: {
          select: {
            status: true,
            isActive: true,
            funderId: true,
            defaultChargeCardId: true,
            purchaseOrderNumber: true,
            purchaseOrderExpiresAt: true,
            billingContactName: true,
            funder: { select: { defaultChargeCardId: true } },
          },
        },
      },
    });
    if (!su?.currentFunding) return null;
    return {
      status: su.currentFunding.status,
      isActive: su.currentFunding.isActive,
      funderId: su.currentFunding.funderId,
      defaultChargeCardId: su.currentFunding.defaultChargeCardId,
      funderDefaultChargeCardId: su.currentFunding.funder?.defaultChargeCardId ?? null,
      purchaseOrderNumber: su.currentFunding.purchaseOrderNumber,
      purchaseOrderExpiresAt: su.currentFunding.purchaseOrderExpiresAt,
      billingContactName: su.currentFunding.billingContactName,
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
          row.payableAmount != null ? `£${Number(row.payableAmount).toFixed(2)}` : null,
        billableAmount:
          row.billableAmount != null ? `£${Number(row.billableAmount).toFixed(2)}` : null,
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

  private async buildCalculationPreview(row: ReconciliationRow) {
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
        this.prisma,
        row.scheduledVisitId,
      ),
    });

    const payStart = row.approvedPayStart ?? defaults.approvedPayStart;
    const payEnd = row.approvedPayEnd ?? defaults.approvedPayEnd;
    const billStart = row.approvedBillStart;
    const billEnd = row.approvedBillEnd;

    const orgChargeMode = await this.prisma.organisationGeneralSettings.findFirst({
      select: { multiCarerFunderChargeMode: true },
    });
    const multiCarerMode =
      orgChargeMode?.multiCarerFunderChargeMode === 'FIXED' ? 'FIXED' : 'COMBINED';

    const siblingCount = await this.prisma.visitReconciliation.count({
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

    const isBankHoliday = await isVisitOnBankHoliday(this.prisma, row.plannedStartDateTime);
    const bankHolidayDates =
      billStart && billEnd
        ? await loadBankHolidayDateSet(this.prisma, billStart, billEnd)
        : new Set<string>();
    const nightVisit = await this.prisma.scheduledVisit.findUnique({
      where: { id: row.scheduledVisitId },
      select: {
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

    const perFunderCharges =
      billMinutes > 0 && billStart && billEnd
        ? await loadPerFunderChargeCalculation(this.prisma, {
            serviceUserId: row.serviceUserId,
            billMinutes,
            billRateAnchor,
            approvedBillStart: billStart,
            approvedBillEnd: billEnd,
            isBankHoliday,
            isBankHolidayFn: (d) => bankHolidayDates.has(utcDateKey(d)),
            nightDuty,
          })
        : null;

    if (perFunderCharges) {
      funderClientCharges = [];
      for (const line of perFunderCharges.lines) {
        let breakdown: ReturnType<typeof buildChargeRateBreakdown> = null;
        if (line.chargeCardId && billStart && billEnd) {
          const [chargeCard, chargeRules] = await Promise.all([
            this.prisma.chargeCard.findUnique({
              where: { id: line.chargeCardId },
              select: { name: true, code: true, defaultChargeMethod: true },
            }),
            this.prisma.chargeCardRule.findMany({ where: { chargeCardId: line.chargeCardId } }),
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
            { start: billStart, end: billEnd },
            nightDuty,
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
      clientCharge = {
        minutes: billMinutes,
        hoursLabel: formatMinutesAsHours(billMinutes),
        rateType: 'MULTI_FUNDER',
        unitRate: null,
        amount: formatMoney(perFunderCharges.totalAmount),
        formula: `Total across ${includedCount} funder${includedCount === 1 ? '' : 's'}`,
        cardName: null,
        cardCode: null,
        cardSource: row.chargeCardSource,
        ruleLabel: 'Per-funder charge cards',
      };
    } else if (row.chargeCardId && billMinutes > 0 && billStart && billEnd) {
      const [chargeCard, chargeRules] = await Promise.all([
        this.prisma.chargeCard.findUnique({
          where: { id: row.chargeCardId },
          select: { name: true, code: true, defaultChargeMethod: true },
        }),
        this.prisma.chargeCardRule.findMany({ where: { chargeCardId: row.chargeCardId } }),
      ]);
      clientCharge = buildChargeRateBreakdown(
        chargeRules,
        billStart,
        billMinutes,
        chargeCard?.defaultChargeMethod ?? 'HOURLY_PRO_RATA',
        {
          cardName: chargeCard?.name ?? null,
          cardCode: chargeCard?.code ?? null,
          cardSource: row.chargeCardSource,
        },
        isBankHoliday,
        { start: billStart, end: billEnd },
        nightDuty,
      );
    }
    if (row.payCardId && payMinutes > 0) {
      const [payCard, payRules] = await Promise.all([
        this.prisma.payCard.findUnique({
          where: { id: row.payCardId },
          select: { name: true, code: true },
        }),
        this.prisma.payCardRule.findMany({ where: { payCardId: row.payCardId } }),
      ]);
      carerPay = buildPayRateBreakdown(
        payRules,
        row.plannedStartDateTime,
        payMinutes,
        {
          cardName: payCard?.name ?? null,
          cardCode: payCard?.code ?? null,
          cardSource: row.payCardSource,
        },
        isBankHoliday,
        { start: payStart, end: payEnd },
      );
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

    const fundingLines = await this.prisma.serviceUserFunding.findMany({
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
      funderSplitPreview = {
        note:
          'Each funder is charged using their own funding rate card. The split % applies to that funder\'s full visit price.',
        totalAmount: formatMoney(perFunderCharges.totalAmount),
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
