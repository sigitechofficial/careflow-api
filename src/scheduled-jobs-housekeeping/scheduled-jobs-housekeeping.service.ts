import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AllocationStatus,
  CallOffVisitStatus as PrismaCallOffStatus,
  Prisma,
  ScheduledJobStatus as PrismaJobStatus,
  ScheduledVisitStatus as PrismaVisitStatus,
  VisitChargeDecision,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { utcDayBounds } from '../scheduling/schedule-date-range.util';
import { assertVisitCancellationCompliance } from './visit-cancellation-validation.util';
import {
  visitCancellationOutcomeStatus,
  visitCancellationReasonMeta,
} from './visit-cancellation-reason.util';
import { mapTimelineJob, timelineJobInclude, timelineVisitSelect } from '../scheduling/schedule-timeline.mapper';
import { ScheduledJobsService } from '../scheduled-jobs/scheduled-jobs.service';
import { ScheduledVisitStatus } from '../scheduled-visits/enums/scheduled-visit-status.enum';
import { HousekeepingQueryDto } from './dto/housekeeping-query.dto';
import { CompleteJobDto } from './dto/complete-job.dto';
import { CancelJobDto } from './dto/cancel-job.dto';
import { ReinstateJobDto } from './dto/reinstate-job.dto';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const TERMINAL_JOB_STATUSES: PrismaJobStatus[] = [
  PrismaJobStatus.IN_PROGRESS,
  PrismaJobStatus.COMPLETED,
  PrismaJobStatus.PARTIALLY_COMPLETED,
  PrismaJobStatus.MISSED,
  PrismaJobStatus.CANCELLED,
  PrismaJobStatus.CALLED_OFF,
];

const NOT_STARTED_JOB_STATUSES: PrismaJobStatus[] = [
  PrismaJobStatus.UNALLOCATED,
  PrismaJobStatus.ALLOCATED,
  PrismaJobStatus.DRAFT,
];

const housekeepingInclude = {
  ...timelineJobInclude,
  visits: {
    where: { deletedAt: null, isActive: true },
    orderBy: { scheduledStartDateTime: 'asc' as const },
    select: {
      ...timelineVisitSelect,
      status: true,
      scheduledStartDateTime: true,
      scheduledEndDateTime: true,
      actualStartDateTime: true,
      actualEndDateTime: true,
    },
  },
} satisfies Prisma.ScheduledJobInclude;

type HousekeepingJobRow = Prisma.ScheduledJobGetPayload<{ include: typeof housekeepingInclude }>;

@Injectable()
export class ScheduledJobsHousekeepingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly scheduledJobsService: ScheduledJobsService,
  ) {}

  private buildBaseWhere(query: HousekeepingQueryDto): Prisma.ScheduledJobWhereInput {
    const where: Prisma.ScheduledJobWhereInput = { deletedAt: null, isActive: true };
    if (query.scheduleBatchId) where.scheduleBatchId = query.scheduleBatchId;
    if (query.serviceUserId) where.serviceUserId = query.serviceUserId;
    if (query.status) where.status = query.status as PrismaJobStatus;

    if (query.date) {
      const { start, end } = utcDayBounds(query.date);
      where.scheduledStartDateTime = { gte: start, lte: end };
    } else if (query.dateFrom || query.dateTo) {
      where.scheduledStartDateTime = {};
      if (query.dateFrom) where.scheduledStartDateTime.gte = utcDayBounds(query.dateFrom).start;
      if (query.dateTo) where.scheduledStartDateTime.lte = utcDayBounds(query.dateTo).end;
    }

    if (query.employeeId) {
      where.allocations = {
        some: {
          employeeId: query.employeeId,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
        },
      };
    }

    return where;
  }

  private mapDayJob(row: HousekeepingJobRow) {
    const timeline = mapTimelineJob(row);
    const visits = row.visits.map((v) => ({
      id: v.id,
      visitName: v.visitName,
      status: v.status,
      scheduledStartDateTime: v.scheduledStartDateTime.toISOString(),
      scheduledEndDateTime: v.scheduledEndDateTime?.toISOString() ?? null,
      actualStartDateTime: v.actualStartDateTime?.toISOString() ?? null,
      actualEndDateTime: v.actualEndDateTime?.toISOString() ?? null,
    }));
    const actualStart = visits.find((v) => v.actualStartDateTime)?.actualStartDateTime ?? null;
    const actualEnd = [...visits].reverse().find((v) => v.actualEndDateTime)?.actualEndDateTime ?? null;

    return {
      ...timeline,
      visits,
      scheduledStartDateTime: row.scheduledStartDateTime.toISOString(),
      scheduledEndDateTime: row.scheduledEndDateTime?.toISOString() ?? null,
      actualStartDateTime: actualStart,
      actualEndDateTime: actualEnd,
      employees: row.allocations
        .filter((a) => ACTIVE_ALLOCATION.includes(a.status))
        .map((a) => ({
          allocationId: a.id,
          status: a.status,
          employee: a.employee,
        })),
    };
  }

  private async findUnderstaffedJobIds(baseWhere: Prisma.ScheduledJobWhereInput): Promise<string[]> {
    const jobs = await this.prisma.scheduledJob.findMany({
      where: baseWhere,
      select: {
        id: true,
        requiredCarers: true,
        allocations: {
          where: { deletedAt: null, isActive: true, status: { in: ACTIVE_ALLOCATION } },
          select: { id: true },
        },
      },
    });
    return jobs.filter((j) => j.allocations.length < j.requiredCarers).map((j) => j.id);
  }

  async jobsNotStarted(userId: string, query: HousekeepingQueryDto, meta?: RequestAuditMeta) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const now = new Date();
    const base = this.buildBaseWhere(query);

    const where: Prisma.ScheduledJobWhereInput = {
      ...base,
      scheduledStartDateTime: {
        ...(typeof base.scheduledStartDateTime === 'object' ? base.scheduledStartDateTime : {}),
        lt: now,
      },
      status: { notIn: TERMINAL_JOB_STATUSES },
      OR: [
        { status: { in: NOT_STARTED_JOB_STATUSES } },
        {
          visits: {
            some: { status: PrismaVisitStatus.PLANNED, deletedAt: null, isActive: true },
          },
        },
        {
          allocations: {
            some: {
              deletedAt: null,
              isActive: true,
              status: AllocationStatus.CONFIRMED,
            },
          },
          status: { in: [PrismaJobStatus.UNALLOCATED, PrismaJobStatus.ALLOCATED] },
        },
      ],
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduledJob.count({ where }),
      this.prisma.scheduledJob.findMany({
        where,
        orderBy: { scheduledStartDateTime: 'asc' },
        skip,
        take: limit,
        include: housekeepingInclude,
      }),
    ]);

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.HOUSEKEEPING_JOBS_NOT_STARTED_VIEWED,
      metadata: { filters: query, total },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: rows.map((r) => this.mapDayJob(r)),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async jobsNeedingAttention(userId: string, query: HousekeepingQueryDto, meta?: RequestAuditMeta) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const base = this.buildBaseWhere(query);
    const understaffedIds = await this.findUnderstaffedJobIds(base);

    const where: Prisma.ScheduledJobWhereInput = {
      ...base,
      OR: [
        { status: { in: [PrismaJobStatus.NEEDS_ATTENTION, PrismaJobStatus.MISSED, PrismaJobStatus.PARTIALLY_COMPLETED] } },
        ...(understaffedIds.length ? [{ id: { in: understaffedIds } }] : []),
        {
          allocations: {
            some: {
              deletedAt: null,
              isActive: true,
              OR: [
                { requiresConfirmation: true },
                { warningTypes: { not: Prisma.DbNull } },
              ],
            },
          },
        },
      ],
    };

    if (!where.OR?.length) {
      return { data: [], meta: buildPaginationMeta({ page, limit, total: 0 }) };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduledJob.count({ where }),
      this.prisma.scheduledJob.findMany({
        where,
        orderBy: { scheduledStartDateTime: 'asc' },
        skip,
        take: limit,
        include: housekeepingInclude,
      }),
    ]);

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.HOUSEKEEPING_JOBS_NEEDING_ATTENTION_VIEWED,
      metadata: { filters: query, total },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: rows.map((r) => ({
        ...this.mapDayJob(r),
        attentionReasons: this.buildAttentionReasons(r),
      })),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  private buildAttentionReasons(row: HousekeepingJobRow): string[] {
    const reasons: string[] = [];
    if (
      row.status === PrismaJobStatus.NEEDS_ATTENTION ||
      row.status === PrismaJobStatus.MISSED ||
      row.status === PrismaJobStatus.PARTIALLY_COMPLETED
    ) {
      reasons.push(`Job status is ${row.status}`);
    }
    const active = row.allocations.filter(
      (a) => !a.deletedAt && a.isActive && ACTIVE_ALLOCATION.includes(a.status),
    );
    if (active.length < row.requiredCarers) {
      reasons.push(`Under-allocated (${active.length}/${row.requiredCarers} carers)`);
    }
    if (active.some((a) => a.requiresConfirmation)) {
      reasons.push('Allocation requires confirmation');
    }
    if (active.some((a) => a.warningTypes != null)) {
      reasons.push('Allocation has validation warnings');
    }
    return reasons;
  }

  async dayJobs(userId: string, query: HousekeepingQueryDto, meta?: RequestAuditMeta) {
    if (!query.date) throw new BadRequestException('date is required for day jobs');
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const { date } = utcDayBounds(query.date);
    const where = this.buildBaseWhere({ ...query, date });

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduledJob.count({ where }),
      this.prisma.scheduledJob.findMany({
        where,
        orderBy: { scheduledStartDateTime: 'asc' },
        skip,
        take: limit,
        include: housekeepingInclude,
      }),
    ]);

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.HOUSEKEEPING_DAY_JOBS_VIEWED,
      metadata: { date, filters: query, total },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: { date, jobs: rows.map((r) => this.mapDayJob(r)) },
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async completeJob(userId: string, id: string, dto: CompleteJobDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduledJob.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: housekeepingInclude,
    });
    if (!existing) throw new NotFoundException('Scheduled job not found');
    if (
      existing.status === PrismaJobStatus.COMPLETED ||
      existing.status === PrismaJobStatus.CANCELLED ||
      existing.status === PrismaJobStatus.CALLED_OFF
    ) {
      throw new BadRequestException(`Cannot complete job in status ${existing.status}`);
    }

    const visitStatus = (dto.status ?? ScheduledVisitStatus.COMPLETED) as PrismaVisitStatus;
    const completing =
      visitStatus === ScheduledVisitStatus.COMPLETED ||
      visitStatus === ScheduledVisitStatus.PARTIALLY_COMPLETED;

    if (completing && (!dto.actualStartDateTime || !dto.actualEndDateTime)) {
      throw new BadRequestException('Actual start and end times are required when completing a visit');
    }

    const actualStart = dto.actualStartDateTime ? new Date(dto.actualStartDateTime) : undefined;
    const actualEnd = dto.actualEndDateTime
      ? new Date(dto.actualEndDateTime)
      : completing && !dto.status
        ? new Date()
        : undefined;

    if (actualStart && Number.isNaN(actualStart.getTime())) {
      throw new BadRequestException('Invalid actualStartDateTime');
    }
    if (actualEnd && Number.isNaN(actualEnd.getTime())) {
      throw new BadRequestException('Invalid actualEndDateTime');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.scheduledVisit.updateMany({
        where: { scheduledJobId: id, deletedAt: null, isActive: true },
        data: {
          status: visitStatus,
          ...(actualStart ? { actualStartDateTime: actualStart } : {}),
          ...(actualEnd ? { actualEndDateTime: actualEnd } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          updatedById: userId,
        },
      });

      await this.scheduledJobsService.syncJobStatusFromVisits(tx, id, userId);

      const metadata =
        dto.deliveredCarePlanFormIds?.length && existing.metadata && typeof existing.metadata === 'object'
          ? {
              ...(existing.metadata as Record<string, unknown>),
              deliveredCarePlanFormIds: dto.deliveredCarePlanFormIds,
            }
          : dto.deliveredCarePlanFormIds?.length
            ? { deliveredCarePlanFormIds: dto.deliveredCarePlanFormIds }
            : undefined;

      const updated = await tx.scheduledJob.update({
        where: { id },
        data: {
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
          updatedById: userId,
        },
        include: housekeepingInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: completing ? AuditAction.SCHEDULED_JOB_COMPLETED : AuditAction.SCHEDULED_VISIT_STATUS_CHANGED,
        recordType: 'ScheduledJob',
        recordId: id,
        oldValues: auditSnapshot({ status: existing.status }),
        newValues: auditSnapshot({
          status: updated.status,
          visitStatus,
          actualStartDateTime: actualStart?.toISOString() ?? null,
          actualEndDateTime: actualEnd?.toISOString() ?? null,
        }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return {
        message: completing ? 'Scheduled job completed' : 'Visit outcome saved',
        data: this.mapDayJob(updated),
      };
    });
  }

  async cancelJob(userId: string, id: string, dto: CancelJobDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduledJob.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: {
        ...housekeepingInclude,
        cancellation: { select: { id: true, reinstatedAt: true } },
        visits: {
          where: { deletedAt: null, isActive: true },
          orderBy: { scheduledStartDateTime: 'asc' },
          select: {
            id: true,
            visitPlanSlotId: true,
            visitPlanSlot: { select: { timeCritical: true, timeToleranceMinutes: true } },
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('Scheduled job not found');
    if (existing.cancellation && !existing.cancellation.reinstatedAt) {
      throw new BadRequestException('This job already has an active cancellation record');
    }
    if (
      existing.status === PrismaJobStatus.COMPLETED ||
      existing.status === PrismaJobStatus.CANCELLED ||
      existing.status === PrismaJobStatus.CALLED_OFF
    ) {
      throw new BadRequestException(`Cannot cancel job in status ${existing.status}`);
    }

    const primaryVisit = existing.visits[0];
    const timeCriticalVisit = Boolean(primaryVisit?.visitPlanSlot?.timeCritical);
    assertVisitCancellationCompliance({
      reasonCode: dto.reasonCode,
      reasonNotes: dto.reasonNotes,
      outcome: dto.outcome,
      welfareChecked: dto.welfareChecked,
      familyNotified: dto.familyNotified,
      commissionerNotified: dto.commissionerNotified,
      chargeDecision: dto.chargeDecision,
      chargeDecisionNotes: dto.chargeDecisionNotes,
      timeCriticalVisit,
    });

    const reasonMeta = visitCancellationReasonMeta(dto.reasonCode);
    const jobOutcome = visitCancellationOutcomeStatus(dto.outcome);
    const visitOutcome =
      dto.outcome === 'CALLED_OFF' ? PrismaVisitStatus.CALLED_OFF : PrismaVisitStatus.CANCELLED;
    const combinedNotes = [dto.notes?.trim(), dto.reasonNotes?.trim()].filter(Boolean).join('\n\n') || undefined;
    const callOffReason = `${reasonMeta.label}${dto.reasonNotes?.trim() ? `: ${dto.reasonNotes.trim()}` : ''}`;

    return this.prisma.$transaction(async (tx) => {
      await tx.scheduledVisit.updateMany({
        where: { scheduledJobId: id, deletedAt: null, isActive: true },
        data: { status: visitOutcome, updatedById: userId },
      });

      await tx.jobAllocation.updateMany({
        where: { scheduledJobId: id, deletedAt: null, isActive: true },
        data: {
          status: AllocationStatus.CANCELLED,
          unallocatedAt: new Date(),
          unallocatedById: userId,
        },
      });

      let callOffVisitId: string | null = null;
      if (dto.outcome === 'CALLED_OFF') {
        const callOff = await tx.callOffVisit.create({
          data: {
            scheduledJobId: id,
            scheduledVisitId: primaryVisit?.id ?? null,
            serviceUserId: existing.serviceUserId,
            callOffDate: utcDayBounds(existing.scheduledStartDateTime.toISOString().slice(0, 10)).start,
            reason: callOffReason,
            notes: combinedNotes ?? null,
            status: PrismaCallOffStatus.APPROVED,
            requestedById: userId,
            approvedById: userId,
            approvedAt: new Date(),
          },
        });
        callOffVisitId = callOff.id;
      }

      const cancellationData = {
        scheduledVisitId: primaryVisit?.id ?? null,
        serviceUserId: existing.serviceUserId,
        outcome: jobOutcome,
        reasonCode: dto.reasonCode,
        reasonNotes: dto.reasonNotes?.trim() ?? null,
        welfareChecked: dto.welfareChecked,
        familyNotified: dto.familyNotified,
        commissionerNotified: dto.commissionerNotified,
        chargeDecision: dto.chargeDecision as VisitChargeDecision,
        chargeDecisionNotes: dto.chargeDecisionNotes?.trim() ?? null,
        timeCriticalVisit,
        timeCriticalEscalated: timeCriticalVisit,
        callOffVisitId,
        cancelledById: userId,
        cancelledAt: new Date(),
        reinstatedAt: null,
        reinstatedById: null,
        reinstateNotes: null,
      };

      const cancellation =
        existing.cancellation?.reinstatedAt
          ? await tx.scheduledJobCancellation.update({
              where: { id: existing.cancellation.id },
              data: cancellationData,
            })
          : await tx.scheduledJobCancellation.create({
              data: {
                scheduledJobId: id,
                ...cancellationData,
              },
            });

      const updated = await tx.scheduledJob.update({
        where: { id },
        data: {
          status: jobOutcome,
          ...(combinedNotes !== undefined ? { notes: combinedNotes } : {}),
          metadata: {
            ...(existing.metadata && typeof existing.metadata === 'object'
              ? (existing.metadata as Record<string, unknown>)
              : {}),
            cancellationId: cancellation.id,
            chargeDecision: dto.chargeDecision,
          } as Prisma.InputJsonValue,
          updatedById: userId,
        },
        include: housekeepingInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_JOB_CANCELLED,
        recordType: 'ScheduledJob',
        recordId: id,
        oldValues: auditSnapshot({ status: existing.status }),
        newValues: auditSnapshot({
          status: updated.status,
          cancellationId: cancellation.id,
          reasonCode: dto.reasonCode,
          outcome: dto.outcome,
          chargeDecision: dto.chargeDecision,
          welfareChecked: dto.welfareChecked,
          familyNotified: dto.familyNotified,
          commissionerNotified: dto.commissionerNotified,
          timeCriticalVisit,
        }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return {
        message: dto.outcome === 'CALLED_OFF' ? 'Visit called off' : 'Scheduled job cancelled',
        data: { ...this.mapDayJob(updated), cancellationId: cancellation.id },
      };
    });
  }

  async reinstateJob(userId: string, id: string, dto: ReinstateJobDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduledJob.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: {
        ...housekeepingInclude,
        cancellation: true,
      },
    });
    if (!existing) throw new NotFoundException('Scheduled job not found');
    if (
      existing.status !== PrismaJobStatus.CANCELLED &&
      existing.status !== PrismaJobStatus.CALLED_OFF
    ) {
      throw new BadRequestException('Only cancelled or called-off jobs can be reinstated');
    }

    const activeCancellation =
      existing.cancellation && !existing.cancellation.reinstatedAt
        ? existing.cancellation
        : null;

    return this.prisma.$transaction(async (tx) => {
      await tx.scheduledVisit.updateMany({
        where: { scheduledJobId: id, deletedAt: null, isActive: true },
        data: { status: PrismaVisitStatus.PLANNED, updatedById: userId },
      });

      await tx.jobAllocation.updateMany({
        where: {
          scheduledJobId: id,
          deletedAt: null,
          isActive: true,
          status: AllocationStatus.CANCELLED,
        },
        data: {
          status: AllocationStatus.CONFIRMED,
          unallocatedAt: null,
          unallocatedById: null,
        },
      });

      const activeAllocations = await tx.jobAllocation.count({
        where: {
          scheduledJobId: id,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
        },
      });

      let nextJobStatus: PrismaJobStatus = PrismaJobStatus.UNALLOCATED;
      if (activeAllocations >= existing.requiredCarers) {
        nextJobStatus = PrismaJobStatus.ALLOCATED;
      } else if (activeAllocations > 0) {
        nextJobStatus = PrismaJobStatus.NEEDS_ATTENTION;
      }

      if (activeCancellation?.callOffVisitId) {
        await tx.callOffVisit.updateMany({
          where: { id: activeCancellation.callOffVisitId, deletedAt: null },
          data: { status: PrismaCallOffStatus.CANCELLED },
        });
      } else if (!activeCancellation) {
        await tx.callOffVisit.updateMany({
          where: {
            scheduledJobId: id,
            deletedAt: null,
            status: PrismaCallOffStatus.APPROVED,
          },
          data: { status: PrismaCallOffStatus.CANCELLED },
        });
      }

      if (activeCancellation) {
        await tx.scheduledJobCancellation.update({
          where: { id: activeCancellation.id },
          data: {
            reinstatedAt: new Date(),
            reinstatedById: userId,
            reinstateNotes: dto.notes?.trim() ?? null,
          },
        });
      }

      const metadata =
        existing.metadata && typeof existing.metadata === 'object'
          ? { ...(existing.metadata as Record<string, unknown>) }
          : {};
      delete metadata.cancellationId;
      delete metadata.chargeDecision;

      const updated = await tx.scheduledJob.update({
        where: { id },
        data: {
          status: nextJobStatus,
          metadata: metadata as Prisma.InputJsonValue,
          updatedById: userId,
        },
        include: housekeepingInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_JOB_REINSTATED,
        recordType: 'ScheduledJob',
        recordId: id,
        oldValues: auditSnapshot({
          status: existing.status,
          cancellationId: activeCancellation?.id ?? null,
          legacyReinstate: !activeCancellation,
        }),
        newValues: auditSnapshot({
          status: updated.status,
          activeAllocations,
          reinstateNotes: dto.notes?.trim() ?? null,
        }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return {
        message: 'Visit reinstated on rota',
        data: this.mapDayJob(updated),
      };
    });
  }
}
