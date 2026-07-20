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
import { assessVisitDeliveryFromJobLike } from '../scheduling/visit-delivery-assessment.util';
import {
  isVisitTimingExceptionReasonCode,
  VISIT_TIMING_EXCEPTION_REASONS,
} from '../scheduling/visit-timing-exception-reason.util';
import { ScheduledJobsService } from '../scheduled-jobs/scheduled-jobs.service';
import { VisitReconciliationsService } from '../billing/visit-reconciliations.service';
import { ScheduledVisitStatus } from '../scheduled-visits/enums/scheduled-visit-status.enum';
import { HousekeepingQueryDto } from './dto/housekeeping-query.dto';
import { CompleteJobDto } from './dto/complete-job.dto';
import { CancelJobDto } from './dto/cancel-job.dto';
import { ReinstateJobDto } from './dto/reinstate-job.dto';
import { SaveVisitJobTasksDto } from './dto/save-visit-job-tasks.dto';
import { resolveJobMedicationRoundCode } from './visit-job-tasks.util';
import {
  resolveVisitTaskCompletionInput,
  visitTaskCompletionInputMissing,
} from '../visit-tasks/visit-task-completion-input.util';
import { loadCarePlanFormFields } from '../service-user-care-plans/compose/compose-context.loader';
import {
  buildCarePlanDeliveryTasks,
  deriveDeliveredCarePlanFormIds,
  parsePublishedValuesJson,
  validateDeliveredCarePlanDetails,
  type CarePlanDeliveryPlanTemplate,
  type DeliveredCarePlanDetailPayload,
} from './visit-care-plan-delivery.util';

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
    private readonly visitReconciliationsService: VisitReconciliationsService,
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

  private resolveLinkedCarePlanFormIds(job: HousekeepingJobRow): string[] {
    const ids = new Set<string>();
    for (const visit of job.visits) {
      for (const formId of visit.visitPlanSlot?.linkedCarePlanFormIds ?? []) {
        if (formId?.trim()) ids.add(formId.trim());
      }
    }
    return [...ids];
  }

  private parseJobMetadata(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return {};
  }

  async getCarePlanDeliveryTasks(
    userId: string,
    jobId: string,
    options?: { formIds?: string[] },
    meta?: RequestAuditMeta,
  ) {
    void userId;
    void meta;
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null, isActive: true },
      include: housekeepingInclude,
    });
    if (!job) throw new NotFoundException('Scheduled job not found');

    const linkedFormIds = this.resolveLinkedCarePlanFormIds(job);
    const existingMeta = this.parseJobMetadata(job.metadata);
    const savedDelivery = Array.isArray(existingMeta.deliveredCarePlanDetails)
      ? (existingMeta.deliveredCarePlanDetails as DeliveredCarePlanDetailPayload[])
      : undefined;

    const requestedFormIds = (options?.formIds ?? []).filter(Boolean);
    const formIds = [
      ...new Set([
        ...linkedFormIds,
        ...requestedFormIds,
        ...(savedDelivery?.map((entry) => entry.carePathwayFormId) ?? []),
      ]),
    ];

    const plans: CarePlanDeliveryPlanTemplate[] = [];

    for (const formId of formIds) {
      const { formName, fields } = await loadCarePlanFormFields(this.prisma, formId);
      const form = await this.prisma.carePathwayForm.findFirst({
        where: { id: formId, deletedAt: null },
        select: { id: true, name: true, pictureUrl: true },
      });
      const instance = await this.prisma.serviceUserCarePlanInstance.findUnique({
        where: {
          serviceUserId_carePathwayFormId: {
            serviceUserId: job.serviceUserId,
            carePathwayFormId: formId,
          },
        },
        include: {
          publishedVersions: {
            where: { supersededAt: null },
            orderBy: { versionNumber: 'desc' },
            take: 1,
            select: { id: true, versionNumber: true, valuesJson: true },
          },
        },
      });

      const published = instance?.publishedVersions[0] ?? null;
      const publishedValues = parsePublishedValuesJson(published?.valuesJson);
      const tasks = buildCarePlanDeliveryTasks(fields, publishedValues);

      plans.push({
        carePathwayFormId: formId,
        formName: form?.name ?? formName,
        pictureUrl: form?.pictureUrl ?? null,
        instanceId: instance?.id ?? null,
        publishedVersionId: published?.id ?? null,
        publishedVersionNumber: published?.versionNumber ?? null,
        isPublished: Boolean(published),
        tasks,
      });
    }

    return {
      data: {
        linkedCarePlanFormIds: linkedFormIds,
        plans,
        savedDelivery,
        savedExtraCareNotes:
          typeof existingMeta.extraCareNotes === 'string' ? existingMeta.extraCareNotes : undefined,
      },
    };
  }

  private async buildAllowedFieldKeysByFormId(
    serviceUserId: string,
    formIds: string[],
  ): Promise<Map<string, Set<string>>> {
    const map = new Map<string, Set<string>>();
    for (const formId of formIds) {
      const { fields } = await loadCarePlanFormFields(this.prisma, formId);
      const instance = await this.prisma.serviceUserCarePlanInstance.findUnique({
        where: {
          serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId: formId },
        },
        include: {
          publishedVersions: {
            where: { supersededAt: null },
            orderBy: { versionNumber: 'desc' },
            take: 1,
            select: { valuesJson: true },
          },
        },
      });
      const publishedValues = parsePublishedValuesJson(instance?.publishedVersions[0]?.valuesJson);
      const tasks = buildCarePlanDeliveryTasks(fields, publishedValues);
      map.set(formId, new Set(tasks.map((task) => task.fieldKey)));
    }
    return map;
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

    let overrunReason: string | null = null;
    let timingExceptionReasonCode: string | null = null;
    let timingExceptionNotes: string | null = null;

    if (completing && actualStart && actualEnd) {
      const plannedStart = existing.scheduledStartDateTime;
      const plannedEnd =
        existing.scheduledEndDateTime ??
        existing.visits?.[0]?.scheduledEndDateTime ??
        (existing.estimatedDurationMinutes
          ? new Date(plannedStart.getTime() + existing.estimatedDurationMinutes * 60_000)
          : null);

      const slot = existing.visits?.[0]?.visitPlanSlot;
      const deliveryAssessment = assessVisitDeliveryFromJobLike({
        status: visitStatus,
        requiredCarers: existing.requiredCarers,
        allocatedCarers: existing.allocations?.filter((a) =>
          ACTIVE_ALLOCATION.includes(a.status),
        ).length,
        scheduledStartDateTime: existing.scheduledStartDateTime.toISOString(),
        scheduledEndDateTime:
          existing.scheduledEndDateTime?.toISOString() ??
          existing.visits?.[0]?.scheduledEndDateTime?.toISOString() ??
          null,
        actualStartDateTime: actualStart.toISOString(),
        actualEndDateTime: actualEnd.toISOString(),
        visitPlan: slot
          ? {
              slotId: slot.id,
              timeCritical: slot.timeCritical,
              timeToleranceMinutes: slot.timeToleranceMinutes,
            }
          : null,
        visits: existing.visits?.map((v) => ({
          status: visitStatus,
          visitPlanSlotId: v.visitPlanSlotId,
          scheduledStartDateTime: v.scheduledStartDateTime.toISOString(),
          scheduledEndDateTime: v.scheduledEndDateTime?.toISOString() ?? null,
          actualStartDateTime: actualStart.toISOString(),
          actualEndDateTime: actualEnd.toISOString(),
        })),
      });

      if (deliveryAssessment.requiresExceptionReason) {
        const code = dto.timingExceptionReasonCode?.trim() ?? '';
        if (!isVisitTimingExceptionReasonCode(code)) {
          throw new BadRequestException(
            `A structured timing exception reason is required for ${deliveryAssessment.timingLabel}${
              deliveryAssessment.durationExceptions.length
                ? ` / ${deliveryAssessment.durationExceptions.join(', ')}`
                : ''
            }.`,
          );
        }
        timingExceptionReasonCode = code;
        timingExceptionNotes = dto.timingExceptionNotes?.trim() || null;
        const reasonMeta = VISIT_TIMING_EXCEPTION_REASONS.find((r) => r.code === code);
        if (reasonMeta?.requiresNotes && !timingExceptionNotes) {
          throw new BadRequestException('Notes are required when the timing exception reason is Other.');
        }
      }

      if (plannedStart && plannedEnd) {
        const plannedMinutes = Math.max(
          0,
          Math.round((plannedEnd.getTime() - plannedStart.getTime()) / 60_000),
        );
        const actualMinutes = Math.max(
          0,
          Math.round((actualEnd.getTime() - actualStart.getTime()) / 60_000),
        );
        if (actualMinutes > plannedMinutes) {
          // Prefer explicit overrunReason; otherwise accept structured timing exception
          // (mobile apps should not need two near-duplicate reason fields).
          const fromDto = dto.overrunReason?.trim() ?? '';
          const fromTimingNotes = timingExceptionNotes?.trim() ?? '';
          const fromTimingCode = timingExceptionReasonCode
            ? VISIT_TIMING_EXCEPTION_REASONS.find((r) => r.code === timingExceptionReasonCode)
                ?.label ?? timingExceptionReasonCode
            : '';
          const resolved = fromDto || fromTimingNotes || fromTimingCode;
          if (!resolved) {
            throw new BadRequestException(
              `Actual time (${actualMinutes} min) exceeds planned (${plannedMinutes} min). Provide overrunReason or timingExceptionReasonCode for the ${actualMinutes - plannedMinutes} min overrun.`,
            );
          }
          overrunReason = resolved;
        }
      }
    }

    const linkedFormIds = this.resolveLinkedCarePlanFormIds(existing);
    const deliveryFormIds = [
      ...new Set([
        ...linkedFormIds,
        ...(dto.deliveredCarePlanFormIds ?? []),
        ...(dto.deliveredCarePlanDetails?.map((plan) => plan.carePathwayFormId) ?? []),
      ]),
    ];

    if (dto.deliveredCarePlanDetails?.length) {
      const allowedKeys = await this.buildAllowedFieldKeysByFormId(
        existing.serviceUserId,
        deliveryFormIds,
      );
      const validationError = validateDeliveredCarePlanDetails(
        dto.deliveredCarePlanDetails,
        deliveryFormIds,
        allowedKeys,
      );
      if (validationError) throw new BadRequestException(validationError);
    }

    const resolvedDeliveredFormIds =
      dto.deliveredCarePlanFormIds ??
      (dto.deliveredCarePlanDetails?.length
        ? deriveDeliveredCarePlanFormIds(dto.deliveredCarePlanDetails)
        : undefined);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.scheduledVisit.updateMany({
        where: { scheduledJobId: id, deletedAt: null, isActive: true },
        data: {
          status: visitStatus,
          ...(actualStart ? { actualStartDateTime: actualStart } : {}),
          ...(actualEnd ? { actualEndDateTime: actualEnd } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          ...(userId ? { updatedById: userId } : {}),
        },
      });

      await this.scheduledJobsService.syncJobStatusFromVisits(tx, id, userId || null);

      const previousMeta = this.parseJobMetadata(existing.metadata);
      const metadataPatch: Record<string, unknown> = { ...previousMeta };
      let metadataChanged = false;

      if (resolvedDeliveredFormIds?.length) {
        metadataPatch.deliveredCarePlanFormIds = resolvedDeliveredFormIds;
        metadataChanged = true;
      }
      if (dto.deliveredCarePlanDetails?.length) {
        metadataPatch.deliveredCarePlanDetails = dto.deliveredCarePlanDetails;
        metadataChanged = true;
      }
      if (dto.extraCareNotes !== undefined) {
        const trimmed = dto.extraCareNotes.trim();
        if (trimmed) metadataPatch.extraCareNotes = trimmed;
        else delete metadataPatch.extraCareNotes;
        metadataChanged = true;
      }
      if (overrunReason) {
        metadataPatch.overrunReason = overrunReason;
        metadataChanged = true;
      } else if (completing && 'overrunReason' in metadataPatch) {
        delete metadataPatch.overrunReason;
        metadataChanged = true;
      } else if (completing && previousMeta.overrunReason && !overrunReason) {
        delete metadataPatch.overrunReason;
        metadataChanged = true;
      }

      if (timingExceptionReasonCode) {
        metadataPatch.timingExceptionReasonCode = timingExceptionReasonCode;
        if (timingExceptionNotes) metadataPatch.timingExceptionNotes = timingExceptionNotes;
        else delete metadataPatch.timingExceptionNotes;
        metadataChanged = true;
      } else if (completing) {
        if ('timingExceptionReasonCode' in metadataPatch) {
          delete metadataPatch.timingExceptionReasonCode;
          metadataChanged = true;
        }
        if ('timingExceptionNotes' in metadataPatch) {
          delete metadataPatch.timingExceptionNotes;
          metadataChanged = true;
        }
      }

      const metadata = metadataChanged ? metadataPatch : undefined;

      const updated = await tx.scheduledJob.update({
        where: { id },
        data: {
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
          ...(userId ? { updatedById: userId } : {}),
        },
        include: housekeepingInclude,
      });

      await this.audit.logAudit({
        tx,
        userId: userId || undefined,
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

    if (completing) {
      try {
        await this.visitReconciliationsService.ensureForCompletedJob(id, undefined, {
          overrunReason,
        });
      } catch {
        // Visit completion must succeed even if finance evaluate fails; ops can Sync later.
      }
    }

    return result;
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

  async getVisitJobTasks(userId: string, jobId: string, meta?: RequestAuditMeta) {
    void userId;
    void meta;
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null, isActive: true },
      include: housekeepingInclude,
    });
    if (!job) throw new NotFoundException('Scheduled job not found');

    const medicationRoundCode = resolveJobMedicationRoundCode(job.visits);
    if (!medicationRoundCode) {
      return {
        data: {
          medicationRoundCode: null,
          roundLabel: null,
          windowStart: null,
          windowEnd: null,
          tasks: [],
        },
      };
    }

    const round = await this.prisma.medicationAdministrationRound.findFirst({
      where: { code: medicationRoundCode, deletedAt: null, isActive: true },
      select: { name: true, code: true, windowStart: true, windowEnd: true },
    });

    const [assignments, completions] = await Promise.all([
      this.prisma.serviceUserVisitTaskAssignment.findMany({
        where: {
          serviceUserId: job.serviceUserId,
          medicationRoundCode,
          deletedAt: null,
          isActive: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          task: {
            include: {
              category: { include: { group: true } },
            },
          },
        },
      }),
      this.prisma.scheduledVisitTaskCompletion.findMany({
        where: { scheduledJobId: job.id },
      }),
    ]);

    const completionByAssignment = new Map(
      completions.filter((row) => row.assignmentId).map((row) => [row.assignmentId!, row]),
    );
    const adHocCompletions = completions.filter((row) => !row.assignmentId);

    const plannedTasks = assignments.map((assignment) => {
      const completion = completionByAssignment.get(assignment.id);
      const flagsJson =
        assignment.task.flagsJson && typeof assignment.task.flagsJson === 'object'
          ? (assignment.task.flagsJson as Record<string, unknown>)
          : null;
      const completionInput = resolveVisitTaskCompletionInput({
        name: assignment.task.name,
        flagsJson,
      });
      return {
        assignmentId: assignment.id,
        taskCatalogueTaskId: assignment.taskCatalogueTaskId,
        name: assignment.task.name,
        categoryName: assignment.task.category.name,
        groupCode: assignment.task.category.group.code,
        consentRequired: assignment.task.consentRequired,
        supportLevelApplicable: assignment.task.supportLevelApplicable,
        completionInput,
        carerInstructions: assignment.carerInstructions,
        priority: assignment.priority,
        isExtra: false,
        isCompleted: completion?.isCompleted ?? false,
        recordedValue: completion?.recordedValue ?? null,
        notes: completion?.notes ?? null,
        completedAt: completion?.completedAt?.toISOString() ?? null,
      };
    });

    const adHocTaskIds = [...new Set(adHocCompletions.map((row) => row.taskCatalogueTaskId))];
    const adHocCatalogueTasks =
      adHocTaskIds.length > 0
        ? await this.prisma.taskCatalogueTask.findMany({
            where: { id: { in: adHocTaskIds }, deletedAt: null, isActive: true },
            include: { category: { include: { group: true } } },
          })
        : [];
    const adHocTaskById = new Map(adHocCatalogueTasks.map((task) => [task.id, task]));

    const extraTasks = adHocCompletions
      .map((completion) => {
        const task = adHocTaskById.get(completion.taskCatalogueTaskId);
        if (!task) return null;
        const flagsJson =
          task.flagsJson && typeof task.flagsJson === 'object'
            ? (task.flagsJson as Record<string, unknown>)
            : null;
        const completionInput = resolveVisitTaskCompletionInput({
          name: task.name,
          flagsJson,
        });
        return {
          assignmentId: `extra-${completion.taskCatalogueTaskId}`,
          taskCatalogueTaskId: completion.taskCatalogueTaskId,
          name: task.name,
          categoryName: task.category.name,
          groupCode: task.category.group.code,
          consentRequired: task.consentRequired,
          supportLevelApplicable: task.supportLevelApplicable,
          completionInput,
          carerInstructions: null,
          priority: 'routine',
          isExtra: true,
          isCompleted: completion.isCompleted,
          recordedValue: completion.recordedValue ?? null,
          notes: completion.notes ?? null,
          completedAt: completion.completedAt?.toISOString() ?? null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    return {
      data: {
        medicationRoundCode,
        roundLabel: round?.name ?? medicationRoundCode,
        windowStart: round?.windowStart ?? null,
        windowEnd: round?.windowEnd ?? null,
        tasks: [...plannedTasks, ...extraTasks],
      },
    };
  }

  async saveVisitJobTasks(
    userId: string,
    jobId: string,
    dto: SaveVisitJobTasksDto,
    meta?: RequestAuditMeta,
  ) {
    void meta;
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null, isActive: true },
      include: housekeepingInclude,
    });
    if (!job) throw new NotFoundException('Scheduled job not found');

    const medicationRoundCode = resolveJobMedicationRoundCode(job.visits);
    if (!medicationRoundCode) {
      throw new BadRequestException('This visit is not linked to a medication administration round');
    }

    const plannedItems = dto.tasks.filter((task) => !task.isExtra && task.assignmentId);
    const extraItems = dto.tasks.filter((task) => task.isExtra && task.taskCatalogueTaskId);

    for (const item of dto.tasks) {
      const hasAssignment = Boolean(item.assignmentId);
      const hasExtra = Boolean(item.isExtra && item.taskCatalogueTaskId);
      if (!hasAssignment && !hasExtra) {
        throw new BadRequestException('Each task must include assignmentId or taskCatalogueTaskId with isExtra');
      }
      if (hasAssignment && hasExtra) {
        throw new BadRequestException('Task cannot be both a planned assignment and an extra task');
      }
    }

    const assignmentIds = plannedItems.map((task) => task.assignmentId!);
    const assignments =
      assignmentIds.length > 0
        ? await this.prisma.serviceUserVisitTaskAssignment.findMany({
            where: {
              id: { in: assignmentIds },
              serviceUserId: job.serviceUserId,
              medicationRoundCode,
              deletedAt: null,
              isActive: true,
            },
            include: {
              task: true,
            },
          })
        : [];
    if (assignments.length !== assignmentIds.length) {
      throw new BadRequestException('One or more visit tasks are invalid for this job');
    }

    const extraTaskIds = [...new Set(extraItems.map((task) => task.taskCatalogueTaskId!))];
    const extraCatalogueTasks =
      extraTaskIds.length > 0
        ? await this.prisma.taskCatalogueTask.findMany({
            where: { id: { in: extraTaskIds }, deletedAt: null, isActive: true },
          })
        : [];
    if (extraCatalogueTasks.length !== extraTaskIds.length) {
      throw new BadRequestException('One or more extra tasks are invalid');
    }

    const plannedAssignmentIds = new Set(assignments.map((row) => row.taskCatalogueTaskId));
    for (const taskId of extraTaskIds) {
      if (plannedAssignmentIds.has(taskId)) {
        throw new BadRequestException('Extra task is already planned for this visit round');
      }
    }

    for (const item of dto.tasks) {
      if (!item.isCompleted) continue;
      if (item.isExtra && item.taskCatalogueTaskId) {
        const task = extraCatalogueTasks.find((row) => row.id === item.taskCatalogueTaskId);
        if (!task) continue;
        const flagsJson =
          task.flagsJson && typeof task.flagsJson === 'object'
            ? (task.flagsJson as Record<string, unknown>)
            : null;
        const spec = resolveVisitTaskCompletionInput({ name: task.name, flagsJson });
        const missing = visitTaskCompletionInputMissing(spec, true, item.recordedValue, item.notes);
        if (missing) throw new BadRequestException(`${task.name}: ${missing}`);
        continue;
      }
      const assignment = assignments.find((row) => row.id === item.assignmentId);
      if (!assignment) continue;
      const flagsJson =
        assignment.task.flagsJson && typeof assignment.task.flagsJson === 'object'
          ? (assignment.task.flagsJson as Record<string, unknown>)
          : null;
      const spec = resolveVisitTaskCompletionInput({
        name: assignment.task.name,
        flagsJson,
      });
      const missing = visitTaskCompletionInputMissing(
        spec,
        true,
        item.recordedValue,
        item.notes,
      );
      if (missing) {
        throw new BadRequestException(`${assignment.task.name}: ${missing}`);
      }
    }

    const assignmentById = new Map(assignments.map((row) => [row.id, row]));
    const extraTaskById = new Map(extraCatalogueTasks.map((row) => [row.id, row]));
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const item of plannedItems) {
        const assignment = assignmentById.get(item.assignmentId!);
        if (!assignment) continue;
        await tx.scheduledVisitTaskCompletion.upsert({
          where: {
            scheduledJobId_assignmentId: {
              scheduledJobId: job.id,
              assignmentId: assignment.id,
            },
          },
          create: {
            scheduledJobId: job.id,
            assignmentId: assignment.id,
            taskCatalogueTaskId: assignment.taskCatalogueTaskId,
            medicationRoundCode,
            isAdHoc: false,
            isCompleted: item.isCompleted,
            recordedValue: item.recordedValue?.trim() ?? null,
            notes: item.notes?.trim() ?? null,
            completedAt: item.isCompleted ? now : null,
          },
          update: {
            isCompleted: item.isCompleted,
            recordedValue: item.isCompleted ? item.recordedValue?.trim() ?? null : null,
            notes: item.isCompleted ? item.notes?.trim() ?? null : null,
            completedAt: item.isCompleted ? now : null,
          },
        });
      }

      for (const item of extraItems) {
        const task = extraTaskById.get(item.taskCatalogueTaskId!);
        if (!task) continue;
        const existing = await tx.scheduledVisitTaskCompletion.findFirst({
          where: {
            scheduledJobId: job.id,
            taskCatalogueTaskId: task.id,
            assignmentId: null,
          },
        });
        if (existing) {
          await tx.scheduledVisitTaskCompletion.update({
            where: { id: existing.id },
            data: {
              isCompleted: item.isCompleted,
              recordedValue: item.isCompleted ? item.recordedValue?.trim() ?? null : null,
              notes: item.isCompleted ? item.notes?.trim() ?? null : null,
              completedAt: item.isCompleted ? now : null,
            },
          });
        } else if (item.isCompleted) {
          await tx.scheduledVisitTaskCompletion.create({
            data: {
              scheduledJobId: job.id,
              assignmentId: null,
              taskCatalogueTaskId: task.id,
              medicationRoundCode,
              isAdHoc: true,
              isCompleted: true,
              recordedValue: item.recordedValue?.trim() ?? null,
              notes: item.notes?.trim() ?? null,
              completedAt: now,
            },
          });
        }
      }

      const retainedExtraTaskIds = extraItems.map((item) => item.taskCatalogueTaskId!);
      await tx.scheduledVisitTaskCompletion.deleteMany({
        where: {
          scheduledJobId: job.id,
          assignmentId: null,
          ...(retainedExtraTaskIds.length > 0
            ? { taskCatalogueTaskId: { notIn: retainedExtraTaskIds } }
            : {}),
        },
      });
    });

    void userId;
    return this.getVisitJobTasks(userId, jobId, meta);
  }
}
