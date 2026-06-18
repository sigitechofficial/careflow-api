import { Injectable } from '@nestjs/common';
import {
  AllocationStatus,
  Prisma,
  ScheduledJobStatus as PrismaJobStatus,
  ScheduledVisitStatus as PrismaVisitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { JobAllocationsService } from '../job-allocations/job-allocations.service';
import {
  ACTIVE_ALLOCATION_STATUSES,
  buildCancellableServiceUserJobsWhere,
  buildUnallocateEmployeeJobsWhere,
  calendarDayUtc,
  CANCELLABLE_JOB_STATUSES,
  datesOverlap,
  normalizeImpactStartDate,
  resolveImpactEndDate,
  type JobImpactOutcome,
  type ScheduleImpactResult,
  type ScheduleImpactSource,
} from './schedule-lifecycle-impact.util';
import { ScheduleLifecycleNotificationHook } from './schedule-lifecycle-notification.hook';

export type CancelServiceUserJobsParams = {
  serviceUserId: string;
  fromDate: Date;
  toDate?: Date | null;
  reason: string;
  source: ScheduleImpactSource;
  outcome?: JobImpactOutcome;
};

export type UnallocateEmployeeJobsParams = {
  employeeId: string;
  fromDate: Date;
  toDate: Date;
  reason: string;
  source: ScheduleImpactSource;
};

export type TimelineJobOperationalFlags = {
  serviceUserAbsent?: boolean;
  carersOnLeave?: string[];
  needsCover?: boolean;
};

type TimelineJobForOperationalFlags = {
  id: string;
  serviceUserId: string;
  requiredCarers: number;
  underAllocated?: boolean;
  allocations: Array<{ employeeId: string; status: string }>;
};

@Injectable()
export class ScheduleLifecycleImpactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly jobAllocations: JobAllocationsService,
    private readonly notifications: ScheduleLifecycleNotificationHook,
  ) {}

  async isServiceUserAbsentOnDay(serviceUserId: string, day: Date): Promise<boolean> {
    const noon = calendarDayUtc(day);
    const count = await this.prisma.serviceUserAbsence.count({
      where: {
        serviceUserId,
        deletedAt: null,
        startDate: { lte: noon },
        OR: [{ endDate: null }, { endDate: { gte: noon } }],
      },
    });
    return count > 0;
  }

  async previewCancelServiceUserJobsInRange(params: {
    serviceUserId: string;
    fromDate: Date;
    toDate?: Date | null;
  }): Promise<ScheduleImpactResult> {
    const from = normalizeImpactStartDate(params.fromDate);
    const to = resolveImpactEndDate(from, params.toDate ?? null);
    const jobs = await this.prisma.scheduledJob.findMany({
      where: buildCancellableServiceUserJobsWhere(params.serviceUserId, from, to),
      select: { id: true },
      orderBy: { scheduledStartDateTime: 'asc' },
      take: 500,
    });
    const jobIds = jobs.map((j) => j.id);
    return { jobsCancelled: jobIds.length, jobsUnallocated: 0, jobIds };
  }

  async previewUnallocateEmployeeJobsInRange(params: {
    employeeId: string;
    fromDate: Date;
    toDate: Date;
  }): Promise<ScheduleImpactResult> {
    const from = normalizeImpactStartDate(params.fromDate);
    const to = resolveImpactEndDate(from, params.toDate);
    const allocations = await this.prisma.jobAllocation.findMany({
      where: buildUnallocateEmployeeJobsWhere(params.employeeId, from, to),
      select: { scheduledJobId: true },
    });
    const jobIdSet = new Set(allocations.map((a) => a.scheduledJobId));
    const jobIds = [...jobIdSet];
    return { jobsCancelled: 0, jobsUnallocated: jobIds.length, jobIds };
  }

  async previewCancelFutureServiceUserJobs(serviceUserId: string): Promise<ScheduleImpactResult> {
    const from = normalizeImpactStartDate(new Date());
    const to = resolveImpactEndDate(from, null);
    return this.previewCancelServiceUserJobsInRange({ serviceUserId, fromDate: from, toDate: to });
  }

  async unallocateEmployeeFutureJobs(
    userId: string,
    employeeId: string,
    reason: string,
    source: ScheduleImpactSource,
    meta?: RequestAuditMeta,
    tx?: Prisma.TransactionClient,
  ): Promise<ScheduleImpactResult> {
    const from = normalizeImpactStartDate(new Date());
    const to = resolveImpactEndDate(from, null);
    return this.unallocateEmployeeJobsInRange(
      userId,
      { employeeId, fromDate: from, toDate: to, reason, source },
      meta,
      tx,
    );
  }

  async loadTimelineOperationalFlags(
    jobs: TimelineJobForOperationalFlags[],
    day: Date,
  ): Promise<Map<string, TimelineJobOperationalFlags>> {
    const dayStart = normalizeImpactStartDate(day);
    const dayEnd = resolveImpactEndDate(dayStart, dayStart);
    const dayNoon = calendarDayUtc(day);

    const serviceUserIds = [...new Set(jobs.map((j) => j.serviceUserId))];
    const employeeIds = [
      ...new Set(
        jobs.flatMap((j) =>
          j.allocations
            .filter((a) => ACTIVE_ALLOCATION_STATUSES.includes(a.status as (typeof ACTIVE_ALLOCATION_STATUSES)[number]))
            .map((a) => a.employeeId),
        ),
      ),
    ];

    const [absences, holidays, ncas] = await Promise.all([
      serviceUserIds.length
        ? this.prisma.serviceUserAbsence.findMany({
            where: {
              serviceUserId: { in: serviceUserIds },
              deletedAt: null,
              startDate: { lte: dayNoon },
              OR: [{ endDate: null }, { endDate: { gte: dayNoon } }],
            },
            select: { serviceUserId: true },
          })
        : [],
      employeeIds.length
        ? this.prisma.employeeHoliday.findMany({
            where: {
              employeeId: { in: employeeIds },
              deletedAt: null,
              isActive: true,
              startDate: { lte: dayNoon },
              endDate: { gte: dayNoon },
            },
            select: { employeeId: true },
          })
        : [],
      employeeIds.length
        ? this.prisma.employeeNonCoreActivity.findMany({
            where: {
              employeeId: { in: employeeIds },
              deletedAt: null,
              isActive: true,
              dateFrom: { lte: dayEnd },
              dateTo: { gte: dayStart },
            },
            select: { employeeId: true },
          })
        : [],
    ]);

    const absentServiceUsers = new Set(absences.map((a) => a.serviceUserId));
    const employeesOnLeave = new Set([
      ...holidays.map((h) => h.employeeId),
      ...ncas.map((n) => n.employeeId),
    ]);

    const result = new Map<string, TimelineJobOperationalFlags>();
    for (const job of jobs) {
      const activeAllocations = job.allocations.filter((a) =>
        ACTIVE_ALLOCATION_STATUSES.includes(a.status as (typeof ACTIVE_ALLOCATION_STATUSES)[number]),
      );
      const carersOnLeave = activeAllocations
        .filter((a) => employeesOnLeave.has(a.employeeId))
        .map((a) => a.employeeId);
      const serviceUserAbsent = absentServiceUsers.has(job.serviceUserId);
      const needsCover =
        Boolean(job.underAllocated) ||
        activeAllocations.length < job.requiredCarers ||
        carersOnLeave.length > 0;
      result.set(job.id, { serviceUserAbsent, carersOnLeave, needsCover });
    }
    return result;
  }

  async cancelServiceUserJobsInRange(
    userId: string,
    params: CancelServiceUserJobsParams,
    meta?: RequestAuditMeta,
    tx?: Prisma.TransactionClient,
  ): Promise<ScheduleImpactResult> {
    const from = normalizeImpactStartDate(params.fromDate);
    const to = resolveImpactEndDate(from, params.toDate ?? null);

    const run = async (client: Prisma.TransactionClient) => {
      const jobs = await client.scheduledJob.findMany({
        where: buildCancellableServiceUserJobsWhere(params.serviceUserId, from, to),
        select: { id: true, status: true, jobName: true },
        orderBy: { scheduledStartDateTime: 'asc' },
        take: 500,
      });

      const jobIds: string[] = [];
      for (const job of jobs) {
        await this.cancelJobInTransaction(client, userId, job.id, params.reason, params.outcome ?? 'CANCELLED');
        jobIds.push(job.id);
      }

      if (jobIds.length) {
        await this.audit.logAudit({
          tx: client,
          userId,
          module: AuditModule.SCHEDULING,
          action: AuditAction.SCHEDULED_JOB_CANCELLED,
          recordType: 'ScheduleLifecycleImpact',
          recordId: params.serviceUserId,
          metadata: {
            source: params.source,
            reason: params.reason,
            outcome: params.outcome ?? 'CANCELLED',
            serviceUserId: params.serviceUserId,
            from: from.toISOString(),
            to: to.toISOString(),
            jobIds,
            jobsCancelled: jobIds.length,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      }

      const result = { jobsCancelled: jobIds.length, jobsUnallocated: 0, jobIds };
      if (jobIds.length && !tx) {
        void this.notifications.notifyBulkScheduleImpact({
          source: params.source,
          reason: params.reason,
          jobsCancelled: result.jobsCancelled,
          jobsUnallocated: 0,
          serviceUserId: params.serviceUserId,
          actorUserId: userId,
        });
      }
      return result;
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  async unallocateEmployeeJobsInRange(
    userId: string,
    params: UnallocateEmployeeJobsParams,
    meta?: RequestAuditMeta,
    tx?: Prisma.TransactionClient,
  ): Promise<ScheduleImpactResult> {
    const from = normalizeImpactStartDate(params.fromDate);
    const to = resolveImpactEndDate(from, params.toDate);

    const run = async (client: Prisma.TransactionClient) => {
      const allocations = await client.jobAllocation.findMany({
        where: buildUnallocateEmployeeJobsWhere(params.employeeId, from, to),
        select: { id: true, scheduledJobId: true },
      });

      const jobIdSet = new Set<string>();
      for (const row of allocations) {
        await client.jobAllocation.update({
          where: { id: row.id },
          data: {
            status: AllocationStatus.UNALLOCATED,
            isActive: false,
            unallocatedAt: new Date(),
            unallocatedById: userId,
            unallocationReason: params.reason,
          },
        });
        jobIdSet.add(row.scheduledJobId);
      }

      for (const jobId of jobIdSet) {
        await this.jobAllocations.syncJobAllocationStatus(client, jobId, userId);
      }

      const jobIds = [...jobIdSet];
      if (jobIds.length) {
        await this.audit.logAudit({
          tx: client,
          userId,
          module: AuditModule.SCHEDULING,
          action: AuditAction.JOB_UNALLOCATED,
          recordType: 'ScheduleLifecycleImpact',
          recordId: params.employeeId,
          metadata: {
            source: params.source,
            reason: params.reason,
            employeeId: params.employeeId,
            from: from.toISOString(),
            to: to.toISOString(),
            jobIds,
            allocationsRemoved: allocations.length,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      }

      const result = { jobsCancelled: 0, jobsUnallocated: jobIds.length, jobIds };
      if (jobIds.length && !tx) {
        void this.notifications.notifyBulkScheduleImpact({
          source: params.source,
          reason: params.reason,
          jobsCancelled: 0,
          jobsUnallocated: result.jobsUnallocated,
          employeeId: params.employeeId,
          actorUserId: userId,
        });
      }
      return result;
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  async cancelFutureServiceUserJobs(
    userId: string,
    serviceUserId: string,
    reason: string,
    source: ScheduleImpactSource,
    meta?: RequestAuditMeta,
  ): Promise<ScheduleImpactResult> {
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    return this.cancelServiceUserJobsInRange(
      userId,
      { serviceUserId, fromDate: from, toDate: null, reason, source },
      meta,
    );
  }

  private async cancelJobInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    jobId: string,
    notes?: string,
    outcome: JobImpactOutcome = 'CANCELLED',
  ): Promise<void> {
    const existing = await tx.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null, isActive: true },
    });
    if (!existing) return;
    if (!CANCELLABLE_JOB_STATUSES.includes(existing.status)) return;

    const visitStatus =
      outcome === 'CALLED_OFF' ? PrismaVisitStatus.CALLED_OFF : PrismaVisitStatus.CANCELLED;
    const jobStatus =
      outcome === 'CALLED_OFF' ? PrismaJobStatus.CALLED_OFF : PrismaJobStatus.CANCELLED;

    await tx.scheduledVisit.updateMany({
      where: { scheduledJobId: jobId, deletedAt: null, isActive: true },
      data: { status: visitStatus, updatedById: userId },
    });

    await tx.jobAllocation.updateMany({
      where: { scheduledJobId: jobId, deletedAt: null, isActive: true },
      data: {
        status: AllocationStatus.CANCELLED,
        unallocatedAt: new Date(),
        unallocatedById: userId,
      },
    });

    await tx.scheduledJob.update({
      where: { id: jobId },
      data: {
        status: jobStatus,
        ...(notes?.trim() ? { notes: notes.trim() } : {}),
        updatedById: userId,
      },
    });
  }
}

export { datesOverlap };
