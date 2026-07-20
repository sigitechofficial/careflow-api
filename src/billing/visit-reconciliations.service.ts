import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus,
  FinanceExceptionCode,
  Prisma,
  ScheduledVisitStatus,
  VisitOverrunDecision,
  VisitReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { PayCardsService, ChargeCardsService } from './billing-cards.service';
import {
  ApproveVisitReconciliationDto,
  BackfillVisitReconciliationsDto,
  BulkApproveVisitReconciliationsDto,
  DecideVisitOverrunDto,
  RejectVisitReconciliationDto,
  SetVisitPayableAmountDto,
  UpdateVisitReconciliationDto,
  VisitReconciliationsQueryDto,
} from './dto/visit-reconciliations.dto';
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
  minutesBetween,
  resolveDefaultApprovedWindows,
} from './visit-reconciliation.util';
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
  exceptions: FinanceExceptionCode[];
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly payCardsService: PayCardsService,
    private readonly chargeCardsService: ChargeCardsService,
  ) {}

  private client(tx?: Prisma.TransactionClient): DbClient {
    return tx ?? this.prisma;
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
        : [{ id: null as string | null, employeeId: null as string | null }];

    let firstId: string | null = null;
    for (const allocation of targets) {
      const visitRef = formatVisitRef(visit.id, visit.scheduledStartDateTime);
      const suffix =
        targets.length > 1 && allocation.employeeId
          ? `-${allocation.employeeId.replace(/-/g, '').slice(0, 4).toUpperCase()}`
          : '';

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
            plannedStartDateTime: visit.scheduledStartDateTime,
            plannedEndDateTime: visit.scheduledEndDateTime,
            actualStartDateTime: visit.actualStartDateTime,
            actualEndDateTime: visit.actualEndDateTime,
            employeeId: allocation.employeeId ?? existing.employeeId,
            jobAllocationId: allocation.id ?? existing.jobAllocationId,
            visitRef: `${visitRef}${suffix}`,
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
          visitRef: `${visitRef}${suffix}`,
          plannedStartDateTime: visit.scheduledStartDateTime,
          plannedEndDateTime: visit.scheduledEndDateTime,
          actualStartDateTime: visit.actualStartDateTime,
          actualEndDateTime: visit.actualEndDateTime,
          overrunReason,
        },
      });
      await this.safeEvaluate(db, created.id);
      firstId ??= created.id;
    }

    return firstId;
  }

  private async safeEvaluate(db: DbClient, id: string) {
    try {
      await this.evaluateInternal(db, id);
    } catch {
      // Keep reconciliation row even if card resolution fails.
    }
  }

  private async resolveAllAllocations(
    db: DbClient,
    jobId: string,
    visitId: string,
  ): Promise<Array<{ id: string; employeeId: string }>> {
    const visitAllocations = await db.jobAllocation.findMany({
      where: {
        scheduledVisitId: visitId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
      },
      orderBy: [{ isLeadCarer: 'desc' }, { allocatedAt: 'asc' }],
      select: { id: true, employeeId: true },
    });
    if (visitAllocations.length) return visitAllocations;

    return db.jobAllocation.findMany({
      where: {
        scheduledJobId: jobId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
      },
      orderBy: [{ isLeadCarer: 'desc' }, { allocatedAt: 'asc' }],
      select: { id: true, employeeId: true },
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
        orderBy: [{ plannedStartDateTime: 'desc' }, { createdAt: 'desc' }],
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

    if (hasUnresolvedBlockingExceptions(exceptions) && !dto.managerOverride) {
      const blocking = listUnresolvedBlockingCodes(exceptions);
      throw new BadRequestException(
        `Blocking exceptions must be resolved before approval, or use manager override. Unresolved: ${blocking.join(', ')}`,
      );
    }

    if (
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

    return {
      message: `Processed ${visits.length} completed visit(s)`,
      data: { count: created.length, ids: created },
    };
  }

  /**
   * Delete every visit reconciliation (and dependent finance lines).
   * Does not reset scheduled visits — use Sync completed visits to recreate.
   */
  async clearAll() {
    const before = await this.prisma.visitReconciliation.count();
    const result = await this.prisma.$transaction(async (tx) => {
      const payrollRunLines = await tx.payrollRunLine.deleteMany();
      const invoiceRunLines = await tx.invoiceRunLine.deleteMany();
      await tx.payComponent.deleteMany({
        where: { visitReconciliationId: { not: null } },
      });
      const financeExceptions = await tx.financeException.deleteMany();
      const visitReconciliations = await tx.visitReconciliation.deleteMany();
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
          : `Deleted ${result.visitReconciliations} visit reconciliation(s)`,
      data: { before, ...result },
    };
  }

  async getSummary() {
    const [pending, withExceptions, approved, requiresManager] = await this.prisma.$transaction([
      this.prisma.visitReconciliation.count({
        where: {
          status: {
            in: [
              VisitReconciliationStatus.PENDING_REVIEW,
              VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
            ],
          },
        },
      }),
      this.prisma.visitReconciliation.count({
        where: { exceptions: { some: { resolvedAt: null } } },
      }),
      this.prisma.visitReconciliation.count({
        where: {
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
        where: { status: VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL },
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
        serviceUser: suMap.get(row.visitReconciliation.serviceUserId) ?? 'Unknown',
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
      },
    });
    if (!visit) return;

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

    // Overrun pending/rejected → planned pay window; APPROVED → actual pay window.
    const defaultWindows = resolveDefaultApprovedWindows({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: row.plannedEndDateTime,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      exceptions: computedOverrun
        ? [{ code: FinanceExceptionCode.OVERRUN, message: '' }]
        : activeExceptions,
      overrunDecision,
    });

    const approvedPayStart =
      computedOverrun != null
        ? defaultWindows.approvedPayStart
        : (row.approvedPayStart ?? defaultWindows.approvedPayStart);
    const approvedPayEnd =
      computedOverrun != null
        ? defaultWindows.approvedPayEnd
        : (row.approvedPayEnd ?? defaultWindows.approvedPayEnd);
    const approvedBillStart =
      computedOverrun != null
        ? defaultWindows.approvedBillStart
        : (row.approvedBillStart ?? defaultWindows.approvedBillStart);
    const approvedBillEnd =
      computedOverrun != null
        ? defaultWindows.approvedBillEnd
        : (row.approvedBillEnd ?? defaultWindows.approvedBillEnd);

    const payMinutes = minutesBetween(approvedPayStart, approvedPayEnd);
    const billMinutes = minutesBetween(approvedBillStart, approvedBillEnd);

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
    }
    if (chargeCard && billMinutes) {
      const chargeRules = await db.chargeCardRule.findMany({
        where: { chargeCardId: chargeCard.id },
      });
      const card = await db.chargeCard.findUnique({
        where: { id: chargeCard.id },
        select: { defaultChargeMethod: true },
      });
      const calc = calculateBillableAmount(
        chargeRules,
        row.plannedStartDateTime,
        billMinutes,
        card?.defaultChargeMethod ?? 'HOURLY_PRO_RATA',
        isBankHoliday,
      );
      billableAmount = calc?.amount ?? null;
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

    await db.visitReconciliation.update({
      where: { id },
      data: {
        status,
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
        ...(status === VisitReconciliationStatus.APPROVED_FOR_PAY &&
        row.status !== VisitReconciliationStatus.APPROVED_FOR_PAY &&
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

  private async enrichRows(rows: ReconciliationRow[]): Promise<VisitReconciliationListRow[]> {
    const suIds = [...new Set(rows.map((r) => r.serviceUserId))];
    const empIds = [...new Set(rows.map((r) => r.employeeId).filter(Boolean))] as string[];

    const [serviceUsers, employees] = await Promise.all([
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
    ]);

    const suById = new Map(serviceUsers.map((su) => [su.id, su]));
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
        date: formatDateOnly(row.plannedStartDateTime),
        planned: formatTimeRange(row.plannedStartDateTime, row.plannedEndDateTime),
        actual: formatTimeRange(row.actualStartDateTime, row.actualEndDateTime),
        approvedPayable: formatTimeRange(row.approvedPayStart, row.approvedPayEnd),
        approvedBillable: formatTimeRange(row.approvedBillStart, row.approvedBillEnd),
        payableAmount:
          row.payableAmount != null ? `£${Number(row.payableAmount).toFixed(2)}` : null,
        billableAmount:
          row.billableAmount != null ? `£${Number(row.billableAmount).toFixed(2)}` : null,
        travelMiles: row.travelMiles != null ? Number(row.travelMiles) : null,
        travelMinutes: row.travelMinutes ?? null,
        currency: row.currency,
        status: row.status,
        exceptions: row.exceptions.map((e) => e.code),
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
        visitDate: formatVisitDateMmDdYy(row.plannedStartDateTime),
        careType: resolveCareTypeExportCode(su?.careType?.code),
        plannedArrival: formatTimeHhMmSs(row.plannedStartDateTime),
        plannedDeparture: formatTimeHhMmSsOrZero(row.plannedEndDateTime),
        actualArrival:
          emonitored === 'LOGGED'
            ? formatTimeHhMmSs(row.actualStartDateTime!)
            : '00:00:00',
        actualDeparture:
          emonitored === 'LOGGED'
            ? formatTimeHhMmSs(row.actualEndDateTime!)
            : '00:00:00',
      };
    });
  }

  private async buildCalculationPreview(row: ReconciliationRow) {
    const exceptions = row.exceptions
      .filter((e) => !e.resolvedAt)
      .map((e) => ({ code: e.code, message: e.message ?? '' }));

    const defaults = resolveDefaultApprovedWindows({
      plannedStartDateTime: row.plannedStartDateTime,
      plannedEndDateTime: row.plannedEndDateTime,
      actualStartDateTime: row.actualStartDateTime,
      actualEndDateTime: row.actualEndDateTime,
      exceptions,
    });

    const payStart = row.approvedPayStart ?? defaults.approvedPayStart;
    const payEnd = row.approvedPayEnd ?? defaults.approvedPayEnd;
    const billStart = row.approvedBillStart ?? defaults.approvedBillStart;
    const billEnd = row.approvedBillEnd ?? defaults.approvedBillEnd;

    const plannedMinutes =
      row.plannedEndDateTime != null
        ? minutesBetween(row.plannedStartDateTime, row.plannedEndDateTime)
        : null;
    const actualMinutes =
      row.actualStartDateTime && row.actualEndDateTime
        ? minutesBetween(row.actualStartDateTime, row.actualEndDateTime)
        : null;

    const payMinutes = minutesBetween(payStart, payEnd);
    const billMinutes = minutesBetween(billStart, billEnd);

    let carerPay = null;
    let clientCharge = null;

    const isBankHoliday = await isVisitOnBankHoliday(this.prisma, row.plannedStartDateTime);

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

    if (row.chargeCardId && billMinutes > 0) {
      const [chargeCard, chargeRules] = await Promise.all([
        this.prisma.chargeCard.findUnique({
          where: { id: row.chargeCardId },
          select: { name: true, code: true, defaultChargeMethod: true },
        }),
        this.prisma.chargeCardRule.findMany({ where: { chargeCardId: row.chargeCardId } }),
      ]);
      clientCharge = buildChargeRateBreakdown(
        chargeRules,
        row.plannedStartDateTime,
        billMinutes,
        chargeCard?.defaultChargeMethod ?? 'HOURLY_PRO_RATA',
        {
          cardName: chargeCard?.name ?? null,
          cardCode: chargeCard?.code ?? null,
          cardSource: row.chargeCardSource,
        },
        isBankHoliday,
      );
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
      timeWindows: {
        planned: formatTimeRange(row.plannedStartDateTime, row.plannedEndDateTime),
        actual: formatTimeRange(row.actualStartDateTime, row.actualEndDateTime),
        approvedPayable: formatTimeRange(payStart, payEnd),
        approvedBillable: formatTimeRange(billStart, billEnd),
      },
      carerPay,
      clientCharge,
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
