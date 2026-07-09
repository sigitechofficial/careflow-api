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
  VisitReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { PayCardsService, ChargeCardsService } from './billing-cards.service';
import {
  ApproveVisitReconciliationDto,
  BackfillVisitReconciliationsDto,
  BulkApproveVisitReconciliationsDto,
  RejectVisitReconciliationDto,
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
  minutesBetween,
  resolveDefaultApprovedWindows,
} from './visit-reconciliation.util';

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
  currency: string;
  status: VisitReconciliationStatus;
  exceptions: FinanceExceptionCode[];
};

type DbClient = PrismaService | Prisma.TransactionClient;

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

  async ensureForCompletedJob(jobId: string, tx?: Prisma.TransactionClient) {
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
      const id = await this.ensureForVisit(visit.id, tx);
      if (id) results.push(id);
    }
    return results;
  }

  async ensureForVisit(scheduledVisitId: string, tx?: Prisma.TransactionClient): Promise<string | null> {
    const db = this.client(tx);
    const visit = await db.scheduledVisit.findFirst({
      where: {
        id: scheduledVisitId,
        deletedAt: null,
        isActive: true,
      },
    });
    if (!visit || !isBillingEligibleVisit(visit)) return null;

    const allocation = await this.resolveLeadAllocation(db, visit.scheduledJobId, visit.id);
    const visitRef = formatVisitRef(visit.id, visit.scheduledStartDateTime);

    const existing = await db.visitReconciliation.findUnique({
      where: { scheduledVisitId: visit.id },
    });

    if (existing) {
      const updated = await db.visitReconciliation.update({
        where: { id: existing.id },
        data: {
          plannedStartDateTime: visit.scheduledStartDateTime,
          plannedEndDateTime: visit.scheduledEndDateTime,
          actualStartDateTime: visit.actualStartDateTime,
          actualEndDateTime: visit.actualEndDateTime,
          employeeId: allocation?.employeeId ?? existing.employeeId,
          jobAllocationId: allocation?.id ?? existing.jobAllocationId,
        },
      });
      await this.safeEvaluate(db, updated.id);
      return updated.id;
    }

    const created = await db.visitReconciliation.create({
      data: {
        scheduledVisitId: visit.id,
        scheduledJobId: visit.scheduledJobId,
        serviceUserId: visit.serviceUserId,
        employeeId: allocation?.employeeId ?? null,
        jobAllocationId: allocation?.id ?? null,
        visitRef,
        plannedStartDateTime: visit.scheduledStartDateTime,
        plannedEndDateTime: visit.scheduledEndDateTime,
        actualStartDateTime: visit.actualStartDateTime,
        actualEndDateTime: visit.actualEndDateTime,
      },
    });

    await this.safeEvaluate(db, created.id);
    return created.id;
  }

  private async safeEvaluate(db: DbClient, id: string) {
    try {
      await this.evaluateInternal(db, id);
    } catch {
      // Keep reconciliation row even if card resolution fails.
    }
  }

  private async resolveLeadAllocation(
    db: DbClient,
    jobId: string,
    visitId: string,
  ): Promise<{ id: string; employeeId: string } | null> {
    const visitAllocation = await db.jobAllocation.findFirst({
      where: {
        scheduledVisitId: visitId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
      },
      orderBy: [{ isLeadCarer: 'desc' }, { allocatedAt: 'asc' }],
      select: { id: true, employeeId: true },
    });
    if (visitAllocation) return visitAllocation;

    return db.jobAllocation.findFirst({
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

    await this.prisma.visitReconciliation.update({ where: { id }, data });
    await this.evaluateInternal(this.prisma, id);
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
      throw new BadRequestException(
        'Blocking exceptions must be resolved before approval, or use manager override',
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
        skipped.push({ id: row.id, reason: 'Blocking exceptions present' });
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

    let payCard: { id: string; status: string; rulesCount: number } | null = null;
    let payCardSource: string | null = null;
    if (row.employeeId) {
      const resolved = await this.payCardsService.resolveForEmployee(row.employeeId);
      payCardSource = resolved.data.source;
      if (resolved.data.payCard) {
        payCard = {
          id: resolved.data.payCard.id,
          status: resolved.data.payCard.status,
          rulesCount: resolved.data.payCard.rules?.length ?? 0,
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

    const status =
      row.status === VisitReconciliationStatus.APPROVED_FOR_PAY ||
      row.status === VisitReconciliationStatus.APPROVED_FOR_INVOICE ||
      row.status === VisitReconciliationStatus.APPROVED_FOR_BOTH ||
      row.status === VisitReconciliationStatus.LOCKED ||
      row.status === VisitReconciliationStatus.REJECTED_FOR_PAY ||
      row.status === VisitReconciliationStatus.REJECTED_FOR_INVOICE
        ? row.status
        : deriveReconciliationStatus(exceptions, row.status);

    const payMinutes =
      row.approvedPayStart && row.approvedPayEnd
        ? minutesBetween(row.approvedPayStart, row.approvedPayEnd)
        : null;
    const billMinutes =
      row.approvedBillStart && row.approvedBillEnd
        ? minutesBetween(row.approvedBillStart, row.approvedBillEnd)
        : null;

    let payableAmount: number | null = null;
    let billableAmount: number | null = null;

    if (payCard && payMinutes) {
      const payRules = await db.payCardRule.findMany({ where: { payCardId: payCard.id } });
      const calc = calculatePayableAmount(payRules, row.plannedStartDateTime, payMinutes);
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
      );
      billableAmount = calc?.amount ?? null;
    }

    await db.financeException.deleteMany({ where: { visitReconciliationId: id } });
    if (exceptions.length) {
      await db.financeException.createMany({
        data: exceptions.map((ex) => ({
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
        payableMinutes: payMinutes,
        billableMinutes: billMinutes,
        payableAmount: payableAmount != null ? payableAmount : null,
        billableAmount: billableAmount != null ? billableAmount : null,
        lastEvaluatedAt: new Date(),
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
            select: { id: true, firstName: true, lastName: true, preferredName: true },
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

    const suMap = new Map(serviceUsers.map((su) => [su.id, formatPersonName(su)]));
    const empMap = new Map(
      employees.map((e) => [
        e.id,
        formatPersonName({
          firstName: e.personalDetail?.firstName,
          lastName: e.personalDetail?.lastName,
        }),
      ]),
    );

    return rows.map((row) => ({
      id: row.id,
      visitRef: row.visitRef,
      scheduledVisitId: row.scheduledVisitId,
      scheduledJobId: row.scheduledJobId,
      serviceUserId: row.serviceUserId,
      serviceUserName: suMap.get(row.serviceUserId) ?? 'Unknown',
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
      currency: row.currency,
      status: row.status,
      exceptions: row.exceptions.map((e) => e.code),
    }));
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

    if (row.payCardId && payMinutes > 0) {
      const [payCard, payRules] = await Promise.all([
        this.prisma.payCard.findUnique({
          where: { id: row.payCardId },
          select: { name: true, code: true },
        }),
        this.prisma.payCardRule.findMany({ where: { payCardId: row.payCardId } }),
      ]);
      carerPay = buildPayRateBreakdown(payRules, row.plannedStartDateTime, payMinutes, {
        cardName: payCard?.name ?? null,
        cardCode: payCard?.code ?? null,
        cardSource: row.payCardSource,
      });
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
