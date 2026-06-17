import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ScheduleRunStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  ensureActiveEmployee,
  ensureScheduleArea,
  ensureScheduleBatch,
} from '../scheduling/scheduling-validation.util';
import { mapTimelineJob, timelineJobInclude } from '../scheduling/schedule-timeline.mapper';
import { parseScheduleDate } from '../schedules/schedules-date.util';
import { ScheduleRunQueryDto } from './dto/schedule-run-query.dto';
import { CreateScheduleRunDto } from './dto/create-schedule-run.dto';
import { UpdateScheduleRunDto } from './dto/update-schedule-run.dto';
import { AddJobsToRunDto } from './dto/add-jobs-to-run.dto';
import { ReorderRunJobsDto } from './dto/reorder-run-jobs.dto';
import {
  ACTIVE_SCHEDULE_RUN_STATUSES,
  assertReorderVisitIdsMatchRun,
  assertRunEditable,
  assertRunFound,
  assertUniqueVisitIds,
  jobStartMatchesRunDate,
  nextRunSequence,
  sortJobsByRunSequence,
} from './schedule-run-jobs.util';
import { ScheduleRunCarerSyncService } from './schedule-run-carer-sync.service';

const runInclude = {
  scheduleBatch: { select: { id: true, scheduleDate: true } },
  scheduleArea: { select: { id: true, name: true, code: true } },
  employee: {
    select: {
      id: true,
      personalDetail: { select: { firstName: true, lastName: true, email: true } },
    },
  },
  _count: { select: { jobs: { where: { deletedAt: null, isActive: true } } } },
} satisfies Prisma.ScheduleRunInclude;

const runDetailInclude = {
  ...runInclude,
  jobs: {
    where: { deletedAt: null, isActive: true },
    include: timelineJobInclude,
  },
} satisfies Prisma.ScheduleRunInclude;

type RunRow = Prisma.ScheduleRunGetPayload<{ include: typeof runInclude }>;
type RunDetailRow = Prisma.ScheduleRunGetPayload<{ include: typeof runDetailInclude }>;

@Injectable()
export class ScheduleRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly runCarerSync: ScheduleRunCarerSyncService,
  ) {}

  async list(query: ScheduleRunQueryDto) {
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
    const orderBy: Prisma.ScheduleRunOrderByWithRelationInput = {
      [query.sortBy ?? 'sortOrder']: query.sortOrder ?? 'asc',
    };

    const include = query.includeJobs
      ? {
          ...runInclude,
          jobs: {
            where: { deletedAt: null, isActive: true },
            include: timelineJobInclude,
          },
        }
      : runInclude;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduleRun.count({ where }),
      this.prisma.scheduleRun.findMany({ where, orderBy, skip, take: limit, include }),
    ]);

    return {
      data: rows.map((r) => this.mapRun(r, query.includeJobs)),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(id: string) {
    const row = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      include: runDetailInclude,
    });
    assertRunFound(row);
    return { data: this.mapRunDetail(row) };
  }

  async create(userId: string, dto: CreateScheduleRunDto, meta?: RequestAuditMeta) {
    const scheduleBatchId = await this.resolveScheduleBatchId(dto.scheduleBatchId, dto.runDate);
    await ensureScheduleArea(this.prisma, dto.scheduleAreaId);
    await ensureActiveEmployee(this.prisma, dto.employeeId);
    if (dto.visitIds?.length) assertUniqueVisitIds(dto.visitIds);

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
          status: ScheduleRunStatus.DRAFT,
          createdById: userId,
        },
        include: runDetailInclude,
      });

      if (dto.visitIds?.length) {
        await this.assignJobsToRunTx(tx, created, dto.visitIds, userId);
      }

      const refreshed = await tx.scheduleRun.findFirstOrThrow({
        where: { id: created.id },
        include: runDetailInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_RUN_CREATED,
        recordType: 'ScheduleRun',
        recordId: created.id,
        newValues: auditSnapshot(refreshed),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { runId: created.id, message: 'Schedule run created' as const };
    }).then(async ({ runId, message }) => {
      if (dto.employeeId) {
        await this.runCarerSync.syncRunCarerToJobs(userId, runId, meta);
      }
      return { message, data: await this.loadRunDetail(runId) };
    });
  }

  async update(userId: string, id: string, dto: UpdateScheduleRunDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      include: runInclude,
    });
    assertRunFound(existing);
    if (dto.status !== ScheduleRunStatus.CANCELLED) {
      assertRunEditable(existing.status);
    }
    if (dto.scheduleBatchId) await ensureScheduleBatch(this.prisma, dto.scheduleBatchId);
    if (dto.scheduleAreaId) await ensureScheduleArea(this.prisma, dto.scheduleAreaId);
    if (dto.employeeId !== undefined && dto.employeeId !== null) {
      await ensureActiveEmployee(this.prisma, dto.employeeId);
    }

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
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          updatedById: userId,
        },
        include: runDetailInclude,
      });

      if (dto.status === ScheduleRunStatus.CANCELLED) {
        await this.detachRunJobsTx(tx, id, userId);
      }

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
      return { message: 'Schedule run updated' as const, runId: id, syncCarer: updated.employeeId != null };
    }).then(async ({ message, runId, syncCarer }) => {
      if (syncCarer && dto.status !== ScheduleRunStatus.CANCELLED) {
        await this.runCarerSync.syncRunCarerToJobs(userId, runId, meta);
      }
      return { message, data: await this.loadRunDetail(runId) };
    });
  }

  async addJobs(userId: string, id: string, dto: AddJobsToRunDto, meta?: RequestAuditMeta) {
    assertUniqueVisitIds(dto.visitIds);
    const run = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      include: runDetailInclude,
    });
    assertRunFound(run);
    assertRunEditable(run.status);

    return this.prisma.$transaction(async (tx) => {
      await this.assignJobsToRunTx(tx, run, dto.visitIds, userId);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_RUN_UPDATED,
        recordType: 'ScheduleRun',
        recordId: id,
        metadata: { action: 'add_jobs', visitIds: dto.visitIds },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Visits added to run' as const, employeeId: run.employeeId };
    }).then(async ({ message, employeeId }) => {
      if (employeeId) {
        await this.runCarerSync.syncRunCarerToJobs(userId, id, meta);
      }
      return { message, data: await this.loadRunDetail(id) };
    });
  }

  async removeJob(userId: string, runId: string, jobId: string, meta?: RequestAuditMeta) {
    const run = await this.prisma.scheduleRun.findFirst({ where: { id: runId, deletedAt: null } });
    assertRunFound(run);
    assertRunEditable(run.status);

    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null, scheduleRunId: runId },
    });
    if (!job) throw new NotFoundException('Visit not found in this run');

    return this.prisma.$transaction(async (tx) => {
      await tx.scheduledJob.update({
        where: { id: jobId },
        data: { scheduleRunId: null, runSequence: null, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_RUN_UPDATED,
        recordType: 'ScheduleRun',
        recordId: runId,
        metadata: { action: 'remove_job', jobId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      const refreshed = await tx.scheduleRun.findFirstOrThrow({
        where: { id: runId },
        include: runDetailInclude,
      });
      return { message: 'Visit removed from run', data: this.mapRunDetail(refreshed) };
    });
  }

  async reorderJobs(userId: string, id: string, dto: ReorderRunJobsDto, meta?: RequestAuditMeta) {
    assertUniqueVisitIds(dto.visitIds);
    const run = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      include: {
        jobs: {
          where: { deletedAt: null, isActive: true },
          select: { id: true },
        },
      },
    });
    assertRunFound(run);
    assertRunEditable(run.status);
    assertReorderVisitIdsMatchRun(
      dto.visitIds,
      run.jobs.map((j) => j.id),
    );

    return this.prisma.$transaction(async (tx) => {
      for (let index = 0; index < dto.visitIds.length; index += 1) {
        await tx.scheduledJob.update({
          where: { id: dto.visitIds[index] },
          data: { runSequence: index + 1, updatedById: userId },
        });
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_RUN_UPDATED,
        recordType: 'ScheduleRun',
        recordId: id,
        metadata: { action: 'reorder_jobs', visitIds: dto.visitIds },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      const refreshed = await tx.scheduleRun.findFirstOrThrow({
        where: { id },
        include: runDetailInclude,
      });
      return { message: 'Run visits reordered', data: this.mapRunDetail(refreshed) };
    });
  }

  async cancel(userId: string, id: string, meta?: RequestAuditMeta) {
    return this.update(userId, id, { status: ScheduleRunStatus.CANCELLED }, meta);
  }

  async syncCarer(userId: string, id: string, meta?: RequestAuditMeta) {
    const run = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, employeeId: true, status: true },
    });
    assertRunFound(run);
    assertRunEditable(run.status);
    if (!run.employeeId) {
      throw new BadRequestException('Assign a carer to this run before syncing allocations');
    }
    const carerSync = await this.runCarerSync.syncRunCarerToJobs(userId, id, meta);
    return {
      message: 'Run carer synced to visits',
      data: await this.loadRunDetail(id),
      meta: { carerSync },
    };
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      include: runInclude,
    });
    assertRunFound(existing);

    return this.prisma.$transaction(async (tx) => {
      await this.detachRunJobsTx(tx, id, userId);
      const deleted = await tx.scheduleRun.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedById: userId,
          isActive: false,
          status: ScheduleRunStatus.CANCELLED,
          updatedById: userId,
        },
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
      return { message: 'Schedule run deleted', data: this.mapRun(deleted) };
    });
  }

  private async resolveScheduleBatchId(scheduleBatchId: string | undefined, runDate: string): Promise<string> {
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
    });
    if (!batch) {
      throw new BadRequestException(
        'No schedule batch exists for this date. Build the schedule first or provide scheduleBatchId.',
      );
    }
    return batch.id;
  }

  private async assignJobsToRunTx(
    tx: Prisma.TransactionClient,
    run: RunDetailRow,
    visitIds: string[],
    userId: string,
  ): Promise<void> {
    const jobs = await tx.scheduledJob.findMany({
      where: { id: { in: visitIds }, deletedAt: null, isActive: true },
      include: { scheduleRun: { select: { id: true, name: true, status: true } } },
    });
    if (jobs.length !== visitIds.length) {
      throw new NotFoundException('One or more visits were not found');
    }

    const existingSequences = run.jobs.map((j) => j.runSequence);
    let sequence = nextRunSequence(existingSequences);

    for (const jobId of visitIds) {
      const job = jobs.find((j) => j.id === jobId)!;
      if (job.scheduleRunId === run.id) {
        throw new BadRequestException(`Visit ${jobId} is already in this run`);
      }
      if (
        job.scheduleRunId &&
        job.scheduleRun &&
        ACTIVE_SCHEDULE_RUN_STATUSES.includes(job.scheduleRun.status)
      ) {
        throw new BadRequestException(
          `Visit is already assigned to run "${job.scheduleRun.name}"`,
        );
      }
      if (!jobStartMatchesRunDate(run.runDate, job.scheduledStartDateTime)) {
        throw new BadRequestException('Visit date does not match the run date');
      }

      await tx.scheduledJob.update({
        where: { id: jobId },
        data: {
          scheduleRunId: run.id,
          runSequence: sequence,
          updatedById: userId,
        },
      });
      sequence += 1;
    }
  }

  private async detachRunJobsTx(
    tx: Prisma.TransactionClient,
    runId: string,
    userId: string,
  ): Promise<void> {
    await tx.scheduledJob.updateMany({
      where: { scheduleRunId: runId, deletedAt: null },
      data: { scheduleRunId: null, runSequence: null, updatedById: userId },
    });
  }

  private mapRun(
    row: RunRow | (RunRow & { jobs?: RunDetailRow['jobs'] }),
    includeJobs?: boolean,
  ) {
    const base = {
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
      jobCount: row._count?.jobs ?? 0,
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
            email: row.employee.personalDetail?.email,
          }
        : null,
    };

    if (!includeJobs || !('jobs' in row) || !row.jobs) {
      return base;
    }

    const ordered = sortJobsByRunSequence(row.jobs);
    return {
      ...base,
      jobs: ordered.map((job) => ({
        ...mapTimelineJob(job),
        runSequence: job.runSequence,
      })),
    };
  }

  private mapRunDetail(row: RunDetailRow) {
    return this.mapRun(row, true);
  }

  private async loadRunDetail(runId: string) {
    const row = await this.prisma.scheduleRun.findFirstOrThrow({
      where: { id: runId },
      include: runDetailInclude,
    });
    return this.mapRunDetail(row);
  }
}
