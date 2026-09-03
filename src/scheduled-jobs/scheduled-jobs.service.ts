import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import {
  AllocationStatus,
  Prisma,
  ScheduledJobPriority as PrismaPriority,
  ScheduledJobStatus as PrismaJobStatus,
  ScheduledVisitStatus as PrismaVisitStatus,
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
import { EcmScheduleVersionService } from '../ecm/ecm-schedule-version.service';
import { JobAllocationsService } from '../job-allocations/job-allocations.service';
import {
  assertDateRange,
  assertRequiredCarers,
  ensureActiveServiceUser,
  ensureScheduleArea,
  ensureScheduleBatch,
  ensureScheduleRun,
  parseIsoDateTime,
} from '../scheduling/scheduling-validation.util';
import { deriveJobStatusFromVisits } from '../scheduling/scheduling-job-status.util';
import { ScheduledJobQueryDto } from './dto/scheduled-job-query.dto';
import { CreateScheduledJobDto } from './dto/create-scheduled-job.dto';
import { UpdateScheduledJobDto } from './dto/update-scheduled-job.dto';
import { UpdateScheduledJobStatusDto } from './dto/update-scheduled-job-status.dto';
import type { BuildScheduleJobDto } from '../schedules/dto/build-schedule-job.dto';
import {
  mapTimelineJob,
  timelineJobInclude,
} from '../scheduling/schedule-timeline.mapper';
import { attachVisitRefsToJobs } from '../scheduling/visit-ref-lookup.util';
import { assessVisitDeliveryFromJobLike } from '../scheduling/visit-delivery-assessment.util';
import { visitTimingExceptionReasonLabel } from '../scheduling/visit-timing-exception-reason.util';
import { visitCareNotDeliveredReasonLabel } from '../scheduling/visit-care-not-delivered-reason.util';

const jobInclude = {
  serviceUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      serviceUserNumber: true,
    },
  },
  scheduleBatch: { select: { id: true, scheduleDate: true, status: true } },
  scheduleArea: { select: { id: true, name: true, code: true } },
  scheduleRun: { select: { id: true, name: true, runDate: true } },
  visits: { where: { deletedAt: null }, orderBy: { scheduledStartDateTime: 'asc' as const } },
} satisfies Prisma.ScheduledJobInclude;

const jobDetailInclude = {
  ...timelineJobInclude,
  cancellation: {
    select: {
      id: true,
      outcome: true,
      reasonCode: true,
      reasonNotes: true,
      chargeDecision: true,
      timeCriticalVisit: true,
      timeCriticalEscalated: true,
      cancelledAt: true,
    },
  },
  attendanceEvents: {
    orderBy: { occurredAt: 'desc' as const },
    take: 20,
    select: {
      id: true,
      eventType: true,
      occurredAt: true,
      verificationMethod: true,
      outsideGeofence: true,
      outsideGeofenceReason: true,
      distanceMeters: true,
    },
  },
} satisfies Prisma.ScheduledJobInclude;

@Injectable()
export class ScheduledJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly ecmScheduleVersions: EcmScheduleVersionService,
    private readonly orgScope: OrgScopeService,
    @Inject(forwardRef(() => JobAllocationsService))
    private readonly jobAllocations: JobAllocationsService,
  ) {}

  async list(query: ScheduledJobQueryDto, actor?: RequestUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.ScheduledJobWhereInput = { deletedAt: null, isActive: true };
    if (query.scheduleBatchId) where.scheduleBatchId = query.scheduleBatchId;
    if (query.scheduleAreaId) where.scheduleAreaId = query.scheduleAreaId;
    if (query.scheduleRunId) where.scheduleRunId = query.scheduleRunId;
    if (query.serviceUserId) where.serviceUserId = query.serviceUserId;
    if (query.status) where.status = query.status as PrismaJobStatus;
    if (query.priority) where.priority = query.priority as PrismaPriority;
    if (query.postcode?.trim()) where.postcode = { contains: query.postcode.trim(), mode: 'insensitive' };
    if (query.dateFrom || query.dateTo) {
      where.scheduledStartDateTime = {};
      if (query.dateFrom) where.scheduledStartDateTime.gte = parseIsoDateTime(query.dateFrom, 'dateFrom');
      if (query.dateTo) where.scheduledStartDateTime.lte = parseIsoDateTime(query.dateTo, 'dateTo');
    }
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { jobName: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { address: { contains: s, mode: 'insensitive' } },
        { notes: { contains: s, mode: 'insensitive' } },
      ];
    }

    if (actor) {
      const scope = this.orgScope.fromRequestUser(actor);
      if (scope.locationIds?.length === 0) {
        return { data: [], meta: buildPaginationMeta({ page, limit, total: 0 }) };
      }
      if (query.scheduleAreaId) {
        await this.orgScope.assertScheduleAreaInScope(scope, query.scheduleAreaId);
      }
      if (query.serviceUserId) {
        await this.orgScope.assertServiceUserInScope(scope, query.serviceUserId);
      }
      andWhereFragment(where, this.orgScope.scheduledJobScopeWhere(scope));
    }

    const sortBy = query.sortBy ?? 'scheduledStartDateTime';
    const sortOrder = query.sortOrder ?? 'asc';
    const orderBy: Prisma.ScheduledJobOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduledJob.count({ where }),
      this.prisma.scheduledJob.findMany({ where, orderBy, skip, take: limit, include: jobInclude }),
    ]);
    return { data: rows.map((r) => this.mapJob(r)), meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string, actor?: RequestUser) {
    if (actor) {
      await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(actor), id);
    }
    const row = await this.prisma.scheduledJob.findFirst({
      where: { id, deletedAt: null },
      include: jobDetailInclude,
    });
    if (!row) throw new NotFoundException('Scheduled job not found');
    const detail = this.mapJobDetail(row);
    const [withRef] = await attachVisitRefsToJobs(this.prisma, [detail]);
    return { data: withRef };
  }

  async listCareConsents(jobId: string, actor?: RequestUser) {
    if (actor) {
      await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(actor), jobId);
    }
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null },
      select: { id: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');

    const rows = await this.prisma.visitCareConsent.findMany({
      where: { scheduledJobId: jobId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        reason: true,
        deviceRecordedAt: true,
        createdAt: true,
        updatedAt: true,
        capturedByEmployeeId: true,
        capturedBy: {
          select: {
            personalDetail: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    return {
      data: {
        required: true,
        consents: rows.map((row) => {
          const first = row.capturedBy.personalDetail?.firstName?.trim() ?? '';
          const last = row.capturedBy.personalDetail?.lastName?.trim() ?? '';
          const name = `${first} ${last}`.trim();
          return {
            status: row.status,
            reason: row.reason,
            recordedAt: (row.deviceRecordedAt ?? row.updatedAt ?? row.createdAt).toISOString(),
            capturedByEmployeeId: row.capturedByEmployeeId,
            capturedByName: name || null,
          };
        }),
      },
    };
  }

  async clearCareConsents(jobId: string) {
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null },
      select: { id: true, metadata: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');

    await this.prisma.visitCareConsent.deleteMany({
      where: { scheduledJobId: jobId },
    });

    const previousMeta =
      job.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
        ? { ...(job.metadata as Record<string, unknown>) }
        : {};
    const previousEa =
      previousMeta.employeeApp &&
      typeof previousMeta.employeeApp === 'object' &&
      !Array.isArray(previousMeta.employeeApp)
        ? { ...(previousMeta.employeeApp as Record<string, unknown>) }
        : {};
    if ('careConsent' in previousEa) {
      delete previousEa.careConsent;
      await this.prisma.scheduledJob.update({
        where: { id: jobId },
        data: {
          metadata: { ...previousMeta, employeeApp: previousEa } as Prisma.InputJsonValue,
        },
      });
    }

    return { data: { required: true, consents: [] as const } };
  }

  private jobDataFromDto(
    dto: CreateScheduledJobDto | UpdateScheduledJobDto,
    userId: string,
    isCreate: boolean,
  ): Prisma.ScheduledJobUncheckedUpdateInput {
    const start =
      dto.scheduledStartDateTime !== undefined
        ? parseIsoDateTime(dto.scheduledStartDateTime, 'scheduledStartDateTime')
        : undefined;
    const end =
      dto.scheduledEndDateTime !== undefined
        ? dto.scheduledEndDateTime
          ? parseIsoDateTime(dto.scheduledEndDateTime, 'scheduledEndDateTime')
          : null
        : undefined;
    if (start && end) assertDateRange(start, end);
    if (dto.requiredCarers !== undefined) assertRequiredCarers(dto.requiredCarers);

    return {
      ...(dto.scheduleBatchId !== undefined ? { scheduleBatchId: dto.scheduleBatchId } : {}),
      ...(dto.scheduleAreaId !== undefined ? { scheduleAreaId: dto.scheduleAreaId ?? null } : {}),
      ...(dto.scheduleRunId !== undefined ? { scheduleRunId: dto.scheduleRunId ?? null } : {}),
      ...(dto.serviceUserId !== undefined ? { serviceUserId: dto.serviceUserId } : {}),
      ...(dto.jobName !== undefined ? { jobName: dto.jobName.trim() } : {}),
      ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
      ...(start !== undefined ? { scheduledStartDateTime: start } : {}),
      ...(dto.scheduledEndDateTime !== undefined ? { scheduledEndDateTime: end } : {}),
      ...(dto.estimatedDurationMinutes !== undefined
        ? { estimatedDurationMinutes: dto.estimatedDurationMinutes }
        : {}),
      ...(dto.requiredCarers !== undefined ? { requiredCarers: dto.requiredCarers } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority as PrismaPriority } : {}),
      ...(dto.status !== undefined ? { status: dto.status as PrismaJobStatus } : {}),
      ...(dto.postcode !== undefined ? { postcode: dto.postcode?.trim() ?? null } : {}),
      ...(dto.address !== undefined ? { address: dto.address?.trim() ?? null } : {}),
      ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
      ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
      ...(dto.timePeriodColor !== undefined ? { timePeriodColor: dto.timePeriodColor ?? null } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes?.trim() ?? null } : {}),
      ...(isCreate ? { createdById: userId } : { updatedById: userId }),
    };
  }

  async create(userId: string, dto: CreateScheduledJobDto, meta?: RequestAuditMeta) {
    const start = parseIsoDateTime(dto.scheduledStartDateTime, 'scheduledStartDateTime');
    const end = dto.scheduledEndDateTime
      ? parseIsoDateTime(dto.scheduledEndDateTime, 'scheduledEndDateTime')
      : null;
    assertDateRange(start, end);
    assertRequiredCarers(dto.requiredCarers ?? 1);
    await ensureScheduleBatch(this.prisma, dto.scheduleBatchId);
    await ensureScheduleArea(this.prisma, dto.scheduleAreaId);
    await ensureScheduleRun(this.prisma, dto.scheduleRunId, dto.scheduleBatchId);
    await ensureActiveServiceUser(this.prisma, dto.serviceUserId);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.scheduledJob.create({
        data: {
          scheduleBatchId: dto.scheduleBatchId,
          scheduleAreaId: dto.scheduleAreaId ?? null,
          scheduleRunId: dto.scheduleRunId ?? null,
          serviceUserId: dto.serviceUserId,
          jobName: dto.jobName.trim(),
          description: dto.description?.trim() ?? null,
          scheduledStartDateTime: start,
          scheduledEndDateTime: end,
          estimatedDurationMinutes: dto.estimatedDurationMinutes ?? null,
          requiredCarers: dto.requiredCarers ?? 1,
          priority: (dto.priority ?? 'NORMAL') as PrismaPriority,
          status: (dto.status ?? 'UNALLOCATED') as PrismaJobStatus,
          postcode: dto.postcode?.trim() ?? null,
          address: dto.address?.trim() ?? null,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          timePeriodColor: dto.timePeriodColor ?? null,
          notes: dto.notes?.trim() ?? null,
          createdById: userId,
        },
        include: jobInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_JOB_CREATED,
        recordType: 'ScheduledJob',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      await this.ecmScheduleVersions.ensureOriginal({
        tx,
        scheduledJobId: created.id,
        plannedStartDateTime: created.scheduledStartDateTime,
        plannedEndDateTime: created.scheduledEndDateTime,
        changedById: userId,
      });
      return { message: 'Scheduled job created', data: this.mapJob(created) };
    });
  }

  async update(userId: string, id: string, dto: UpdateScheduledJobDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduledJob.findFirst({
      where: { id, deletedAt: null },
      include: jobInclude,
    });
    if (!existing) throw new NotFoundException('Scheduled job not found');
    if (dto.scheduleBatchId) await ensureScheduleBatch(this.prisma, dto.scheduleBatchId);
    if (dto.scheduleAreaId) await ensureScheduleArea(this.prisma, dto.scheduleAreaId);
    if (dto.scheduleRunId !== undefined) {
      await ensureScheduleRun(
        this.prisma,
        dto.scheduleRunId ?? undefined,
        dto.scheduleBatchId ?? existing.scheduleBatchId,
      );
    }
    if (dto.serviceUserId) await ensureActiveServiceUser(this.prisma, dto.serviceUserId);

    const start = dto.scheduledStartDateTime
      ? parseIsoDateTime(dto.scheduledStartDateTime, 'scheduledStartDateTime')
      : existing.scheduledStartDateTime;
    const end = dto.scheduledEndDateTime !== undefined
      ? dto.scheduledEndDateTime
        ? parseIsoDateTime(dto.scheduledEndDateTime, 'scheduledEndDateTime')
        : null
      : existing.scheduledEndDateTime;
    assertDateRange(start, end);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.scheduledJob.update({
        where: { id },
        data: this.jobDataFromDto(dto, userId, false),
        include: jobInclude,
      });
      if (
        dto.scheduledStartDateTime !== undefined ||
        dto.scheduledEndDateTime !== undefined
      ) {
        await this.jobAllocations.syncAllocationTimingsToJobWindow(tx, {
          scheduledJobId: id,
          previousJob: existing,
          nextJob: updated,
          userId,
          meta,
        });
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_JOB_UPDATED,
        recordType: 'ScheduledJob',
        recordId: id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      if (
        dto.scheduledStartDateTime !== undefined ||
        dto.scheduledEndDateTime !== undefined
      ) {
        await this.ecmScheduleVersions.recordTimeChange({
          tx,
          scheduledJobId: id,
          plannedStartDateTime: updated.scheduledStartDateTime,
          plannedEndDateTime: updated.scheduledEndDateTime,
          previousStartDateTime: existing.scheduledStartDateTime,
          previousEndDateTime: existing.scheduledEndDateTime,
          changedById: userId,
          reasonNote: dto.notes?.trim() || null,
        });
      }
      return { message: 'Scheduled job updated', data: this.mapJob(updated) };
    });
  }

  async updateStatus(
    userId: string,
    id: string,
    dto: UpdateScheduledJobStatusDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.scheduledJob.findFirst({
      where: { id, deletedAt: null },
      include: jobInclude,
    });
    if (!existing) throw new NotFoundException('Scheduled job not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.scheduledJob.update({
        where: { id },
        data: {
          status: dto.status as PrismaJobStatus,
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          updatedById: userId,
        },
        include: jobInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_JOB_STATUS_CHANGED,
        recordType: 'ScheduledJob',
        recordId: id,
        oldValues: auditSnapshot({ status: existing.status }),
        newValues: auditSnapshot({ status: updated.status }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Scheduled job status updated', data: this.mapJob(updated) };
    });
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduledJob.findFirst({
      where: { id, deletedAt: null },
      include: jobInclude,
    });
    if (!existing) throw new NotFoundException('Scheduled job not found');

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.scheduledJob.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false, updatedById: userId },
        include: jobInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_JOB_DELETED,
        recordType: 'ScheduledJob',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Scheduled job deleted', data: this.mapJob(deleted) };
    });
  }

  async syncJobStatusFromVisits(
    tx: Prisma.TransactionClient,
    scheduledJobId: string,
    userId?: string | null,
  ): Promise<void> {
    const visits = await tx.scheduledVisit.findMany({
      where: { scheduledJobId, deletedAt: null, isActive: true },
      select: { status: true },
    });
    const job = await tx.scheduledJob.findUnique({
      where: { id: scheduledJobId },
      include: {
        allocations: {
          where: {
            status: {
              in: [
                AllocationStatus.PENDING_CONFIRMATION,
                AllocationStatus.ALLOCATED,
                AllocationStatus.CONFIRMED,
              ],
            },
          },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!job) return;
    let nextStatus = deriveJobStatusFromVisits(visits, job.status);
    // Planned visits with carers should stay ALLOCATED, not drop to UNALLOCATED.
    if (nextStatus === PrismaJobStatus.UNALLOCATED && job.allocations.length > 0) {
      nextStatus = PrismaJobStatus.ALLOCATED;
    }
    if (nextStatus !== job.status) {
      await tx.scheduledJob.update({
        where: { id: scheduledJobId },
        data: {
          status: nextStatus,
          ...(userId ? { updatedById: userId } : {}),
        },
      });
    }
  }

  async createJobsFromBuild(
    tx: Prisma.TransactionClient,
    userId: string,
    scheduleBatchId: string,
    jobs: BuildScheduleJobDto[],
    meta?: RequestAuditMeta,
  ): Promise<{ jobIds: string[]; visitCount: number }> {
    const jobIds: string[] = [];
    let visitCount = 0;

    for (const item of jobs) {
      const start = parseIsoDateTime(item.scheduledStartDateTime, 'scheduledStartDateTime');
      const end = item.scheduledEndDateTime
        ? parseIsoDateTime(item.scheduledEndDateTime, 'scheduledEndDateTime')
        : null;
      assertDateRange(start, end);
      assertRequiredCarers(item.requiredCarers ?? 1);
      await ensureActiveServiceUser(tx, item.serviceUserId);
      await ensureScheduleArea(tx, item.scheduleAreaId);
      await ensureScheduleRun(tx, item.scheduleRunId, scheduleBatchId);

      const job = await tx.scheduledJob.create({
        data: {
          scheduleBatchId,
          scheduleAreaId: item.scheduleAreaId ?? null,
          scheduleRunId: item.scheduleRunId ?? null,
          serviceUserId: item.serviceUserId,
          jobName: item.jobName.trim(),
          scheduledStartDateTime: start,
          scheduledEndDateTime: end,
          requiredCarers: item.requiredCarers ?? 1,
          priority: (item.priority ?? 'NORMAL') as PrismaPriority,
          status: (item.status ?? 'UNALLOCATED') as PrismaJobStatus,
          postcode: item.postcode?.trim() ?? null,
          address: item.address?.trim() ?? null,
          metadata: { source: 'schedule_build', phase: 2 } as Prisma.InputJsonValue,
          createdById: userId,
        },
      });
      jobIds.push(job.id);

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_JOB_CREATED,
        recordType: 'ScheduledJob',
        recordId: job.id,
        newValues: auditSnapshot(job),
        metadata: { source: 'schedule_build' },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      const visits = item.visits?.length
        ? item.visits
        : [
            {
              visitName: item.jobName,
              scheduledStartDateTime: item.scheduledStartDateTime,
              scheduledEndDateTime: item.scheduledEndDateTime,
              requiredCarers: item.requiredCarers,
            },
          ];

      for (const v of visits) {
        const vStart = parseIsoDateTime(v.scheduledStartDateTime, 'scheduledStartDateTime');
        const vEnd = v.scheduledEndDateTime
          ? parseIsoDateTime(v.scheduledEndDateTime, 'scheduledEndDateTime')
          : null;
        assertDateRange(vStart, vEnd);

        const visit = await tx.scheduledVisit.create({
          data: {
            scheduledJobId: job.id,
            serviceUserId: item.serviceUserId,
            visitName: v.visitName.trim(),
            scheduledStartDateTime: vStart,
            scheduledEndDateTime: vEnd,
            status: (v.status ?? 'PLANNED') as PrismaVisitStatus,
            requiredCarers: v.requiredCarers ?? item.requiredCarers ?? 1,
            notes: v.notes?.trim() ?? null,
            createdById: userId,
          },
        });
        visitCount += 1;

        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SCHEDULING,
          action: AuditAction.SCHEDULED_VISIT_CREATED,
          recordType: 'ScheduledVisit',
          recordId: visit.id,
          newValues: auditSnapshot(visit),
          metadata: { source: 'schedule_build' },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });

        for (const action of v.actions ?? []) {
          await tx.visitAction.create({
            data: {
              scheduledVisitId: visit.id,
              name: action.name.trim(),
              description: action.description?.trim() ?? null,
              actionType: action.actionType ?? null,
              isRequired: action.isRequired ?? false,
              sortOrder: action.sortOrder ?? 0,
            },
          });
        }
      }

      for (const action of item.actions ?? []) {
        await tx.visitAction.create({
          data: {
            scheduledJobId: job.id,
            name: action.name.trim(),
            description: action.description?.trim() ?? null,
            actionType: action.actionType ?? null,
            isRequired: action.isRequired ?? false,
            sortOrder: action.sortOrder ?? 0,
          },
        });
      }

      await this.syncJobStatusFromVisits(tx, job.id, userId);
    }

    return { jobIds, visitCount };
  }

  mapJob(row: Prisma.ScheduledJobGetPayload<{ include: typeof jobInclude }>) {
    const visits = row.visits?.map((v) => ({
      id: v.id,
      visitName: v.visitName,
      visitPlanSlotId: v.visitPlanSlotId,
      status: v.status,
      scheduledStartDateTime: v.scheduledStartDateTime.toISOString(),
      scheduledEndDateTime: v.scheduledEndDateTime?.toISOString() ?? null,
      actualStartDateTime: v.actualStartDateTime?.toISOString() ?? null,
      actualEndDateTime: v.actualEndDateTime?.toISOString() ?? null,
    }));
    const primaryVisit = visits?.[0];
    const mapped = {
      id: row.id,
      scheduleBatchId: row.scheduleBatchId,
      scheduleAreaId: row.scheduleAreaId,
      scheduleRunId: row.scheduleRunId,
      serviceUserId: row.serviceUserId,
      jobName: row.jobName,
      description: row.description,
      scheduledStartDateTime: row.scheduledStartDateTime.toISOString(),
      scheduledEndDateTime: row.scheduledEndDateTime?.toISOString() ?? null,
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      requiredCarers: row.requiredCarers,
      priority: row.priority,
      status: row.status,
      postcode: row.postcode,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      timePeriodColor: row.timePeriodColor,
      notes: row.notes,
      metadata: row.metadata,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      serviceUser: row.serviceUser,
      scheduleBatch: row.scheduleBatch
        ? {
            ...row.scheduleBatch,
            scheduleDate: row.scheduleBatch.scheduleDate.toISOString().slice(0, 10),
          }
        : null,
      scheduleArea: row.scheduleArea,
      scheduleRun: row.scheduleRun
        ? { ...row.scheduleRun, runDate: row.scheduleRun.runDate.toISOString().slice(0, 10) }
        : null,
      visits,
      actualStartDateTime: primaryVisit?.actualStartDateTime ?? null,
      actualEndDateTime: primaryVisit?.actualEndDateTime ?? null,
    };
    return {
      ...mapped,
      deliveryAssessment: assessVisitDeliveryFromJobLike({
        status: mapped.status,
        requiredCarers: mapped.requiredCarers,
        scheduledStartDateTime: mapped.scheduledStartDateTime,
        scheduledEndDateTime: mapped.scheduledEndDateTime,
        actualStartDateTime: mapped.actualStartDateTime,
        actualEndDateTime: mapped.actualEndDateTime,
        visits,
      }),
    };
  }

  private mapJobDetail(row: Prisma.ScheduledJobGetPayload<{ include: typeof jobDetailInclude }>) {
    const timeline = mapTimelineJob(row);
    const latestAttendance = row.attendanceEvents[0] ?? null;
    const meta =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const timingExceptionReasonCode =
      typeof meta.timingExceptionReasonCode === 'string'
        ? meta.timingExceptionReasonCode
        : null;
    const timingExceptionNotes =
      typeof meta.timingExceptionNotes === 'string' ? meta.timingExceptionNotes : null;
    const overrunReason =
      typeof meta.overrunReason === 'string' ? meta.overrunReason : null;
    const careNotDeliveredReasonCode =
      typeof meta.careNotDeliveredReasonCode === 'string'
        ? meta.careNotDeliveredReasonCode
        : null;
    const careNotDeliveredNotes =
      typeof meta.careNotDeliveredNotes === 'string' ? meta.careNotDeliveredNotes : null;
    const careNotDeliveredFlag = meta.careNotDelivered === true || Boolean(careNotDeliveredReasonCode);

    const deliveryAssessment = assessVisitDeliveryFromJobLike({
      status: timeline.status,
      requiredCarers: timeline.requiredCarers,
      allocatedCarers: timeline.allocatedCarers,
      scheduledStartDateTime: timeline.scheduledStartDateTime,
      scheduledEndDateTime: timeline.scheduledEndDateTime,
      actualStartDateTime: timeline.actualStartDateTime,
      actualEndDateTime: timeline.actualEndDateTime,
      visitPlan: timeline.visitPlan,
      visits: timeline.visits,
      latestAttendanceEventType: latestAttendance?.eventType ?? null,
    });

    return {
      ...timeline,
      notes: row.notes,
      metadata: row.metadata,
      description: row.description,
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      deliveryAssessment,
      cancellation: row.cancellation
        ? {
            ...row.cancellation,
            cancelledAt: row.cancellation.cancelledAt.toISOString(),
          }
        : null,
      attendanceEvents: row.attendanceEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        occurredAt: e.occurredAt.toISOString(),
        verificationMethod: e.verificationMethod,
        outsideGeofence: e.outsideGeofence,
        outsideGeofenceReason: e.outsideGeofenceReason,
        distanceMeters: e.distanceMeters,
      })),
      timingException: timingExceptionReasonCode
        ? {
            reasonCode: timingExceptionReasonCode,
            reasonLabel: visitTimingExceptionReasonLabel(timingExceptionReasonCode),
            notes: timingExceptionNotes,
            overrunReason,
          }
        : overrunReason
          ? {
              reasonCode: null,
              reasonLabel: null,
              notes: timingExceptionNotes,
              overrunReason,
            }
          : null,
      careNotDelivered: careNotDeliveredFlag
        ? {
            reasonCode: careNotDeliveredReasonCode,
            reasonLabel:
              typeof meta.careNotDeliveredReasonLabel === 'string'
                ? meta.careNotDeliveredReasonLabel
                : visitCareNotDeliveredReasonLabel(careNotDeliveredReasonCode),
            notes: careNotDeliveredNotes,
          }
        : null,
    };
  }
}
