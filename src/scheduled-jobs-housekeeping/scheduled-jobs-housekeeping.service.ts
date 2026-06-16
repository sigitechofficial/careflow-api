import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AllocationStatus,
  Prisma,
  ScheduledJobStatus as PrismaJobStatus,
  ScheduledVisitStatus as PrismaVisitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { utcDayBounds } from '../scheduling/schedule-date-range.util';
import { mapTimelineJob, timelineJobInclude, timelineVisitSelect } from '../scheduling/schedule-timeline.mapper';
import { HousekeepingQueryDto } from './dto/housekeeping-query.dto';
import { CompleteJobDto } from './dto/complete-job.dto';
import { CancelJobDto } from './dto/cancel-job.dto';

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

    const actualEnd = dto.actualEndDateTime ? new Date(dto.actualEndDateTime) : new Date();
    const existingMeta =
      existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
        ? (existing.metadata as Record<string, unknown>)
        : {};
    const deliveredCarePlanFormIds = dto.deliveredCarePlanFormIds ?? [];

    return this.prisma.$transaction(async (tx) => {
      await tx.scheduledVisit.updateMany({
        where: { scheduledJobId: id, deletedAt: null, isActive: true },
        data: {
          status: PrismaVisitStatus.COMPLETED,
          actualEndDateTime: actualEnd,
          updatedById: userId,
        },
      });

      const updated = await tx.scheduledJob.update({
        where: { id },
        data: {
          status: PrismaJobStatus.COMPLETED,
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          metadata: {
            ...existingMeta,
            completion: {
              deliveredCarePlanFormIds,
              completedAt: actualEnd.toISOString(),
            },
          } as Prisma.InputJsonValue,
          updatedById: userId,
        },
        include: housekeepingInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_JOB_COMPLETED,
        recordType: 'ScheduledJob',
        recordId: id,
        oldValues: auditSnapshot({ status: existing.status }),
        newValues: auditSnapshot({ status: updated.status }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return { message: 'Scheduled job completed', data: this.mapDayJob(updated) };
    });
  }

  async cancelJob(userId: string, id: string, dto: CancelJobDto, meta?: RequestAuditMeta) {
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
      throw new BadRequestException(`Cannot cancel job in status ${existing.status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.scheduledVisit.updateMany({
        where: { scheduledJobId: id, deletedAt: null, isActive: true },
        data: { status: PrismaVisitStatus.CANCELLED, updatedById: userId },
      });

      await tx.jobAllocation.updateMany({
        where: { scheduledJobId: id, deletedAt: null, isActive: true },
        data: {
          status: AllocationStatus.CANCELLED,
          unallocatedAt: new Date(),
          unallocatedById: userId,
        },
      });

      const updated = await tx.scheduledJob.update({
        where: { id },
        data: {
          status: PrismaJobStatus.CANCELLED,
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
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
        newValues: auditSnapshot({ status: updated.status }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return { message: 'Scheduled job cancelled', data: this.mapDayJob(updated) };
    });
  }
}
