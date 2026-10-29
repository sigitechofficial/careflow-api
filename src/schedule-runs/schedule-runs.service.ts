import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus,
  Prisma,
  ScheduledJobStatus,
  ScheduleRunStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { andWhereFragment, OrgScopeService } from '../common/org-scope/org-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  ensureActiveEmployee,
  ensureScheduleArea,
  ensureScheduleBatch,
} from '../scheduling/scheduling-validation.util';
import { parseScheduleDate } from '../schedules/schedules-date.util';
import {
  mapTimelineJob,
  timelineJobInclude,
} from '../scheduling/schedule-timeline.mapper';
import { JobAllocationsService } from '../job-allocations/job-allocations.service';
import { ScheduleRunQueryDto } from './dto/schedule-run-query.dto';
import { CreateScheduleRunDto } from './dto/create-schedule-run.dto';
import { UpdateScheduleRunDto } from './dto/update-schedule-run.dto';
import { SyncScheduleRunCarerDto } from './dto/sync-schedule-run-carer.dto';
import type { PreviewRunCarerDto } from './dto/preview-run-carer.dto';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const SYNC_SKIP_JOB_STATUSES = new Set<ScheduledJobStatus>([
  ScheduledJobStatus.COMPLETED,
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
]);

const runInclude = {
  scheduleBatch: { select: { id: true, scheduleDate: true } },
  scheduleArea: { select: { id: true, name: true, code: true } },
  employee: {
    select: {
      id: true,
      personalDetail: { select: { firstName: true, lastName: true, email: true } },
    },
  },
  _count: { select: { jobs: true } },
} satisfies Prisma.ScheduleRunInclude;

const runIncludeWithJobs = {
  ...runInclude,
  jobs: {
    where: { deletedAt: null, isActive: true },
    orderBy: [{ runSequence: 'asc' as const }, { scheduledStartDateTime: 'asc' as const }],
    include: timelineJobInclude,
  },
} satisfies Prisma.ScheduleRunInclude;

type RunRow = Prisma.ScheduleRunGetPayload<{ include: typeof runInclude }>;
type RunRowWithJobs = Prisma.ScheduleRunGetPayload<{ include: typeof runIncludeWithJobs }>;

@Injectable()
export class ScheduleRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly allocations: JobAllocationsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  async list(query: ScheduleRunQueryDto, actor?: RequestUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const where: Prisma.ScheduleRunWhereInput = { deletedAt: null, isActive: true };
    if (query.scheduleBatchId) where.scheduleBatchId = query.scheduleBatchId;
    if (query.scheduleAreaId) where.scheduleAreaId = query.scheduleAreaId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    if (query.runDate) {
      where.runDate = parseScheduleDate(query.runDate);
    } else if (query.runDateFrom || query.runDateTo) {
      where.runDate = {};
      if (query.runDateFrom) where.runDate.gte = parseScheduleDate(query.runDateFrom);
      if (query.runDateTo) where.runDate.lte = parseScheduleDate(query.runDateTo);
    }

    if (actor) {
      const scope = this.orgScope.fromRequestUser(actor);
      if (scope.locationIds?.length === 0) {
        return { data: [], meta: buildPaginationMeta({ page, limit, total: 0 }) };
      }
      if (query.scheduleAreaId) {
        await this.orgScope.assertScheduleAreaInScope(scope, query.scheduleAreaId);
      }
      andWhereFragment(where, this.orgScope.scheduleRunScopeWhere(scope));
    }

    const orderBy: Prisma.ScheduleRunOrderByWithRelationInput = {
      [query.sortBy ?? 'sortOrder']: query.sortOrder ?? 'asc',
    };

    const include = query.includeJobs ? runIncludeWithJobs : runInclude;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduleRun.count({ where }),
      this.prisma.scheduleRun.findMany({ where, orderBy, skip, take: limit, include }),
    ]);
    return {
      data: rows.map((r) => this.mapRun(r, query.includeJobs)),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(id: string, includeJobs = false, actor?: RequestUser) {
    if (actor) {
      await this.orgScope.assertScheduleRunInScope(this.orgScope.fromRequestUser(actor), id);
    }
    const row = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      include: includeJobs ? runIncludeWithJobs : runInclude,
    });
    if (!row) throw new NotFoundException('Schedule run not found');
    return { data: this.mapRun(row, includeJobs) };
  }

  async create(userId: string, dto: CreateScheduleRunDto, meta?: RequestAuditMeta) {
    const scheduleBatchId = await this.resolveScheduleBatchId(dto.scheduleBatchId, dto.runDate);
    await ensureScheduleArea(this.prisma, dto.scheduleAreaId);
    if (dto.employeeId) await ensureActiveEmployee(this.prisma, dto.employeeId);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.scheduleRun.create({
        data: {
          scheduleBatchId,
          scheduleAreaId: dto.scheduleAreaId ?? null,
          employeeId: dto.employeeId ?? null,
          name: dto.name.trim(),
          description: dto.description?.trim() ?? null,
          runDate: parseScheduleDate(dto.runDate),
          startTime: dto.startTime ?? null,
          endTime: dto.endTime ?? null,
          shiftType: dto.shiftType ?? null,
          sortOrder: dto.sortOrder ?? 0,
          createdById: userId,
        },
        include: runInclude,
      });

      if (dto.visitIds?.length) {
        await this.attachJobsToRun(tx, created.id, scheduleBatchId, dto.visitIds, userId);
      }

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_RUN_CREATED,
        recordType: 'ScheduleRun',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      const refreshed = await tx.scheduleRun.findFirstOrThrow({
        where: { id: created.id },
        include: runIncludeWithJobs,
      });
      return { message: 'Schedule run created', data: this.mapRun(refreshed, true) };
    });
  }

  async update(userId: string, id: string, dto: UpdateScheduleRunDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      include: runInclude,
    });
    if (!existing) throw new NotFoundException('Schedule run not found');
    if (dto.scheduleBatchId) await ensureScheduleBatch(this.prisma, dto.scheduleBatchId);
    if (dto.scheduleAreaId) await ensureScheduleArea(this.prisma, dto.scheduleAreaId);
    if (dto.employeeId) await ensureActiveEmployee(this.prisma, dto.employeeId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.scheduleRun.update({
        where: { id },
        data: {
          ...(dto.scheduleBatchId !== undefined ? { scheduleBatchId: dto.scheduleBatchId } : {}),
          ...(dto.scheduleAreaId !== undefined ? { scheduleAreaId: dto.scheduleAreaId ?? null } : {}),
          ...(dto.employeeId !== undefined ? { employeeId: dto.employeeId ?? null } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
          ...(dto.runDate !== undefined ? { runDate: parseScheduleDate(dto.runDate) } : {}),
          ...(dto.startTime !== undefined ? { startTime: dto.startTime ?? null } : {}),
          ...(dto.endTime !== undefined ? { endTime: dto.endTime ?? null } : {}),
          ...(dto.shiftType !== undefined ? { shiftType: dto.shiftType ?? null } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          updatedById: userId,
        },
        include: runIncludeWithJobs,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_RUN_UPDATED,
        recordType: 'ScheduleRun',
        recordId: id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Schedule run updated', data: this.mapRun(updated, true) };
    });
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      include: runInclude,
    });
    if (!existing) throw new NotFoundException('Schedule run not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.scheduledJob.updateMany({
        where: { scheduleRunId: id, deletedAt: null },
        data: { scheduleRunId: null, runSequence: null, updatedById: userId },
      });
      const deleted = await tx.scheduleRun.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false, updatedById: userId },
        include: runInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_RUN_DELETED,
        recordType: 'ScheduleRun',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Schedule run deleted', data: this.mapRun(deleted, false) };
    });
  }

  async addJobs(userId: string, id: string, visitIds: string[], meta?: RequestAuditMeta) {
    const run = await this.requireActiveRun(id);
    await this.prisma.$transaction(async (tx) => {
      await this.attachJobsToRun(tx, run.id, run.scheduleBatchId, visitIds, userId);
    });
    return this.getById(id, true);
  }

  async removeJob(userId: string, runId: string, jobId: string, meta?: RequestAuditMeta) {
    await this.requireActiveRun(runId);
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, scheduleRunId: runId, deletedAt: null },
    });
    if (!job) throw new NotFoundException('Visit not found in this run');

    await this.prisma.scheduledJob.update({
      where: { id: jobId },
      data: { scheduleRunId: null, runSequence: null, updatedById: userId },
    });
    return this.getById(runId, true);
  }

  async reorderJobs(userId: string, id: string, visitIds: string[], meta?: RequestAuditMeta) {
    await this.requireActiveRun(id);
    const jobs = await this.prisma.scheduledJob.findMany({
      where: { scheduleRunId: id, deletedAt: null, id: { in: visitIds } },
      select: { id: true },
    });
    if (jobs.length !== visitIds.length) {
      throw new BadRequestException('One or more visits are not part of this run');
    }

    await this.prisma.$transaction(
      visitIds.map((jobId, index) =>
        this.prisma.scheduledJob.update({
          where: { id: jobId },
          data: { runSequence: index + 1, updatedById: userId },
        }),
      ),
    );
    return this.getById(id, true);
  }

  async cancel(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.requireActiveRun(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.scheduledJob.updateMany({
        where: { scheduleRunId: id, deletedAt: null },
        data: { scheduleRunId: null, runSequence: null, updatedById: userId },
      });
      const updated = await tx.scheduleRun.update({
        where: { id },
        data: { status: ScheduleRunStatus.CANCELLED, updatedById: userId },
        include: runIncludeWithJobs,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_RUN_UPDATED,
        recordType: 'ScheduleRun',
        recordId: id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        metadata: { cancelled: true },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Schedule run cancelled', data: this.mapRun(updated, true) };
    });
  }

  /** What putting a carer on these run visits would do: weekly hours and checks, nothing saved. */
  async previewCarer(dto: PreviewRunCarerDto) {
    await ensureActiveEmployee(this.prisma, dto.employeeId);
    const plan = await this.allocations.planRunCarer(dto.employeeId, dto.visitIds, {
      replaceExisting: dto.replaceExisting,
      releasingEmployeeId: dto.releaseEmployeeId,
    });
    return {
      message: 'Run carer preview',
      data: {
        visits: plan.visits.map((v) => ({
          jobId: v.jobId,
          outcome: v.outcome,
          message: v.message,
          overWeeklyHours: v.overWeeklyHours,
          replaceNames: v.replaceNames,
        })),
        weeks: plan.weeks.map((w) => ({
          weekStart: w.weekStart,
          beforeHours: Math.round((w.beforeMinutes / 60) * 10) / 10,
          afterHours: Math.round((w.afterMinutes / 60) * 10) / 10,
          limitHours: w.limitMinutes != null ? Math.round((w.limitMinutes / 60) * 10) / 10 : null,
          extraHours: Math.round((w.extraMinutes / 60) * 10) / 10,
        })),
        maxHours: Math.round((plan.maxMinutes / 60) * 10) / 10,
      },
    };
  }

  async syncCarer(userId: string, id: string, dto: SyncScheduleRunCarerDto, meta?: RequestAuditMeta) {
    const run = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: {
        jobs: {
          where: { deletedAt: null, isActive: true },
          orderBy: [{ runSequence: 'asc' }, { scheduledStartDateTime: 'asc' }],
          include: {
            allocations: {
              where: { deletedAt: null, isActive: true, status: { in: ACTIVE_ALLOCATION } },
            },
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Schedule run not found');
    if (!run.employeeId) {
      throw new BadRequestException('Assign a carer to this run before syncing visits');
    }

    const warnings: Array<{ jobId: string; message: string }> = [];
    /** Visits over the run carer's weekly hours, waiting for a manager on Hours approvals. */
    const approvalRequested: Array<{ jobId: string; approvalId: string | null }> = [];
    let synced = 0;
    const syncJobs = run.jobs.filter((job) => !SYNC_SKIP_JOB_STATUSES.has(job.status));

    // The previous run carer comes off first, so their places are free.
    if (dto.unallocateEmployeeId && dto.unallocateEmployeeId !== run.employeeId) {
      for (const job of syncJobs) {
        if (!job.allocations.some((a) => a.employeeId === dto.unallocateEmployeeId)) continue;
        try {
          await this.allocations.unallocate(userId, job.id, {
            employeeId: dto.unallocateEmployeeId!,
            reason: 'Run carer reassigned',
          }, meta);
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
        }
      }
    }

    // Decide every visit first (weekly hours in run order, checks, clashes), then act: a carer
    // being replaced only comes off once the run carer can really go on the visit.
    const plan = await this.allocations.planRunCarer(
      run.employeeId,
      syncJobs.map((job) => job.id),
      { replaceExisting: dto.replaceExisting },
    );
    for (const visit of plan.visits) {
      if (visit.outcome === 'ALREADY') {
        synced += 1;
        continue;
      }
      if (visit.outcome === 'BLOCKED') {
        warnings.push({ jobId: visit.jobId, message: visit.message ?? 'Allocation failed' });
        continue;
      }
      try {
        if (visit.outcome === 'NEEDS_APPROVAL' && visit.replaceEmployeeIds.length) {
          // The carer on it stays until a manager approves; approving swaps them.
          const request = await this.allocations.requestReplacingApproval(userId, visit.jobId, run.employeeId, {
            employeeIds: visit.replaceEmployeeIds,
            names: visit.replaceNames,
          });
          approvalRequested.push({ jobId: visit.jobId, approvalId: request.id });
          continue;
        }
        for (const employeeId of visit.replaceEmployeeIds) {
          try {
            await this.allocations.unallocate(userId, visit.jobId, {
              employeeId,
              reason: 'Visit moved to the run carer',
            }, meta);
          } catch (error) {
            if (!(error instanceof NotFoundException)) throw error;
          }
        }
        const result = (await this.allocations.allocate(userId, visit.jobId, {
          employeeId: run.employeeId,
          force: dto.force ?? false,
        }, meta)) as { meta?: { approvalRequested?: boolean; approvalId?: string } };
        if (result?.meta?.approvalRequested) {
          approvalRequested.push({ jobId: visit.jobId, approvalId: result.meta.approvalId ?? null });
        } else {
          synced += 1;
        }
      } catch (error) {
        const message =
          error instanceof BadRequestException
            ? typeof error.getResponse() === 'object' &&
              error.getResponse() !== null &&
              'message' in (error.getResponse() as object)
              ? String((error.getResponse() as { message?: unknown }).message)
              : error.message
            : error instanceof Error
              ? error.message
              : 'Allocation failed';
        warnings.push({ jobId: visit.jobId, message });
      }
    }

    const refreshed = await this.getById(id, true);
    return {
      message: [
        `Run carer on ${synced} visit(s)`,
        approvalRequested.length ? `${approvalRequested.length} sent to a manager (over the weekly hours)` : null,
        warnings.length ? `${warnings.length} could not be allocated` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      data: refreshed.data,
      warnings,
      approvalRequested,
      synced,
      // Only message, data and meta reach the client (response interceptor).
      meta: { warnings, approvalRequested, synced },
    };
  }

  private async requireActiveRun(id: string) {
    const run = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: runInclude,
    });
    if (!run) throw new NotFoundException('Schedule run not found');
    return run;
  }

  private async resolveScheduleBatchId(scheduleBatchId: string | undefined, runDate: string) {
    if (scheduleBatchId) {
      await ensureScheduleBatch(this.prisma, scheduleBatchId);
      return scheduleBatchId;
    }
    const batch = await this.prisma.scheduleBatch.findFirst({
      where: {
        scheduleDate: parseScheduleDate(runDate),
        deletedAt: null,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!batch) {
      throw new BadRequestException(`No schedule batch found for ${runDate}`);
    }
    return batch.id;
  }

  private async attachJobsToRun(
    tx: Prisma.TransactionClient,
    runId: string,
    scheduleBatchId: string,
    visitIds: string[],
    userId: string,
  ) {
    const jobs = await tx.scheduledJob.findMany({
      where: {
        id: { in: visitIds },
        scheduleBatchId,
        deletedAt: null,
        isActive: true,
      },
      orderBy: { scheduledStartDateTime: 'asc' },
    });
    if (jobs.length !== visitIds.length) {
      throw new BadRequestException('One or more visits were not found for this schedule day');
    }

    const inOtherRun = jobs.filter((j) => j.scheduleRunId && j.scheduleRunId !== runId);
    if (inOtherRun.length > 0) {
      throw new BadRequestException('One or more visits already belong to another run');
    }

    const maxSequence = await tx.scheduledJob.aggregate({
      where: { scheduleRunId: runId, deletedAt: null },
      _max: { runSequence: true },
    });
    let nextSequence = (maxSequence._max.runSequence ?? 0) + 1;

    for (const job of jobs) {
      if (job.scheduleRunId === runId) continue;
      await tx.scheduledJob.update({
        where: { id: job.id },
        data: { scheduleRunId: runId, runSequence: nextSequence, updatedById: userId },
      });
      nextSequence += 1;
    }
  }

  private mapRun(row: RunRow | RunRowWithJobs, includeJobs = false) {
    const withJobs = includeJobs && 'jobs' in row && Array.isArray(row.jobs);
    return {
      id: row.id,
      scheduleBatchId: row.scheduleBatchId,
      scheduleAreaId: row.scheduleAreaId,
      employeeId: row.employeeId,
      name: row.name,
      description: row.description,
      runDate: row.runDate.toISOString().slice(0, 10),
      startTime: row.startTime,
      endTime: row.endTime,
      shiftType: row.shiftType,
      status: row.status,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      jobCount: withJobs ? row.jobs.length : (row._count?.jobs ?? 0),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      scheduleBatch: row.scheduleBatch
        ? { ...row.scheduleBatch, scheduleDate: row.scheduleBatch.scheduleDate.toISOString().slice(0, 10) }
        : null,
      scheduleArea: row.scheduleArea,
      employee: row.employee
        ? {
            id: row.employee.id,
            firstName: row.employee.personalDetail?.firstName,
            lastName: row.employee.personalDetail?.lastName,
            email: row.employee.personalDetail?.email ?? null,
          }
        : null,
      jobs: withJobs
        ? row.jobs.map((job) => ({
            ...mapTimelineJob(job),
            runSequence: job.runSequence,
          }))
        : undefined,
    };
  }
}
