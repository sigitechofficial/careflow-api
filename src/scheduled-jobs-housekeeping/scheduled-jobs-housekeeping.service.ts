import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AllocationStatus,
  CallOffVisitStatus as PrismaCallOffStatus,
  Prisma,
  ScheduledJobStatus as PrismaJobStatus,
  ScheduledVisitStatus as PrismaVisitStatus,
  VisitAttendanceEventType,
  VisitAttendanceVerificationMethod,
  VisitChargeDecision,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { andWhereFragment, OrgScopeService } from '../common/org-scope/org-scope.service';
import type { OrgScope } from '../common/org-scope/org-scope.types';
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
import { VisitTimelineService } from '../employee-app/visit-timeline.service';
import { assessVisitDeliveryFromJobLike } from '../scheduling/visit-delivery-assessment.util';
import {
  isAcceptedVisitTimingExceptionReason,
  VISIT_TIMING_EXCEPTION_REASONS,
} from '../scheduling/visit-timing-exception-reason.util';
import {
  isVisitMissedReasonCode,
  VISIT_MISSED_REASONS,
  visitMissedReasonLabel,
} from '../scheduling/visit-missed-reason.util';
import {
  isVisitCareNotDeliveredReasonCode,
  VISIT_CARE_NOT_DELIVERED_REASONS,
  visitCareNotDeliveredReasonLabel,
} from '../scheduling/visit-care-not-delivered-reason.util';
import { ScheduledJobsService } from '../scheduled-jobs/scheduled-jobs.service';
import { VisitReconciliationsService } from '../billing/visit-reconciliations.service';
import { ScheduledVisitStatus } from '../scheduled-visits/enums/scheduled-visit-status.enum';
import { HousekeepingQueryDto } from './dto/housekeeping-query.dto';
import { CompleteJobDto } from './dto/complete-job.dto';
import { CancelJobDto } from './dto/cancel-job.dto';
import { ReinstateJobDto } from './dto/reinstate-job.dto';
import { SaveVisitJobTasksDto } from './dto/save-visit-job-tasks.dto';
import { resolveJobMedicationRoundCode } from './visit-job-tasks.util';
import { VisitObservationsCatalogService } from '../service-user-observations/visit-observations-catalog.service';
import { EcmEvaluationService } from '../ecm/ecm-evaluation.service';
import { VisitAttendanceService } from '../visit-attendance/visit-attendance.service';
import {
  pickScheduleFromAssignment,
  visitTaskMatchesDay,
} from '../visit-tasks/visit-task-schedule.util';
import {
  isEmarMedicationPromptTask,
  syncEmarMedicationPromptsForServiceUser,
} from '../visit-tasks/visit-task-emar-prompt.sync';
import {
  resolveVisitTaskCompletionInput,
  visitTaskCompletionInputMissing,
} from '../visit-tasks/visit-task-completion-input.util';
import {
  encodeVisitTaskOutcomeFields,
  inferVisitTaskOutcome,
  isVisitTaskOutcomeSentinel,
  normalizeVisitTaskOutcomeCode,
  stripVisitTaskOutcomeNotes,
} from '../employee-app/visit-task-progress.util';
import { resolveTaskObsLink } from '../employee-app/visit-task-obs-link.util';
import { syncObservationFromCompletedVisitTask } from '../employee-app/visit-task-obs-sync.util';
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
    private readonly orgScope: OrgScopeService,
    private readonly scheduledJobsService: ScheduledJobsService,
    private readonly visitReconciliationsService: VisitReconciliationsService,
    private readonly visitObservationsCatalog: VisitObservationsCatalogService,
    private readonly ecmEvaluation: EcmEvaluationService,
    private readonly visitAttendance: VisitAttendanceService,
    private readonly visitTimeline: VisitTimelineService,
  ) {}

  /** Staff JWT actors get branch scope checks; employee-app may pass a userId string. */
  private async assertJobForStaffActor(
    actor: RequestUser | string,
    jobId: string,
  ): Promise<void> {
    if (typeof actor === 'string') return;
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(actor), jobId);
  }

  private actorUserId(actor: RequestUser | string): string {
    return typeof actor === 'string' ? actor : actor.id;
  }

  /**
   * Visit activity timeline for the admin workspace Log tab — same events the
   * carer app shows (clock in/out, tasks, medication, observations, visit
   * notes, handovers, concerns, incidents), oldest → newest.
   */
  async getVisitTimeline(user: RequestUser, jobId: string) {
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(user), jobId);
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null },
      select: { id: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    const timeline = await this.visitTimeline.listForJob(jobId);
    return {
      jobId,
      timeline: timeline.map((item) => {
        if (item.type !== 'clock_in' || !item.detail) return item;
        const methodOnly = item.detail.split('\n')[0]?.trim() || item.detail;
        return { ...item, detail: methodOnly, subtitle: methodOnly };
      }),
    };
  }

  /**
   * Admin complete with typed carer times → always write MANUAL_OFFICE evidence.
   * Even if demo/seed GPS events exist, office completion must count as Manual.
   */
  private async ensureOfficeManualAttendanceFromAdminComplete(input: {
    jobId: string;
    userId: string;
    actualStart: Date;
    actualEnd?: Date;
    visitId?: string | null;
    allocations: Array<{ id: string; employeeId: string; status: AllocationStatus }>;
  }): Promise<void> {
    const events = await this.prisma.visitAttendanceEvent.findMany({
      where: { scheduledJobId: input.jobId },
      select: {
        eventType: true,
        verificationMethod: true,
      },
    });

    const allocation =
      input.allocations.find((a) => ACTIVE_ALLOCATION.includes(a.status)) ?? null;
    if (!allocation?.employeeId) return;

    const hasManualCheckIn = events.some(
      (e) =>
        e.eventType === VisitAttendanceEventType.CHECK_IN &&
        e.verificationMethod === VisitAttendanceVerificationMethod.MANUAL_OFFICE,
    );
    if (!hasManualCheckIn) {
      await this.visitAttendance.recordEvent({
        scheduledJobId: input.jobId,
        scheduledVisitId: input.visitId ?? null,
        jobAllocationId: allocation.id,
        employeeId: allocation.employeeId,
        eventType: VisitAttendanceEventType.CHECK_IN,
        verificationMethod: VisitAttendanceVerificationMethod.MANUAL_OFFICE,
        occurredAt: input.actualStart,
        identityConfirmed: true,
        notes: `MANUAL:ADMIN_COMPLETE | approvedBy:${input.userId}`,
      });
    }

    if (!input.actualEnd) return;
    const hasManualCheckOut = events.some(
      (e) =>
        e.eventType === VisitAttendanceEventType.CHECK_OUT &&
        e.verificationMethod === VisitAttendanceVerificationMethod.MANUAL_OFFICE,
    );
    if (!hasManualCheckOut) {
      await this.visitAttendance.recordEvent({
        scheduledJobId: input.jobId,
        scheduledVisitId: input.visitId ?? null,
        jobAllocationId: allocation.id,
        employeeId: allocation.employeeId,
        eventType: VisitAttendanceEventType.CHECK_OUT,
        verificationMethod: VisitAttendanceVerificationMethod.MANUAL_OFFICE,
        occurredAt: input.actualEnd,
        identityConfirmed: true,
        notes: `MANUAL:ADMIN_COMPLETE | approvedBy:${input.userId}`,
      });
    }
  }

  private buildBaseWhere(
    query: HousekeepingQueryDto,
    scope: OrgScope,
  ): Prisma.ScheduledJobWhereInput {
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

    andWhereFragment(where, this.orgScope.scheduledJobScopeWhere(scope));
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
    const meta = this.parseJobMetadata(row.metadata);
    const careNotDeliveredReasonCode =
      typeof meta.careNotDeliveredReasonCode === 'string'
        ? meta.careNotDeliveredReasonCode
        : null;
    const careNotDelivered =
      meta.careNotDelivered === true || Boolean(careNotDeliveredReasonCode)
        ? {
            reasonCode: careNotDeliveredReasonCode,
            reasonLabel:
              typeof meta.careNotDeliveredReasonLabel === 'string'
                ? meta.careNotDeliveredReasonLabel
                : visitCareNotDeliveredReasonLabel(careNotDeliveredReasonCode),
            notes:
              typeof meta.careNotDeliveredNotes === 'string' ? meta.careNotDeliveredNotes : null,
          }
        : null;

    return {
      ...timeline,
      visits,
      scheduledStartDateTime: row.scheduledStartDateTime.toISOString(),
      scheduledEndDateTime: row.scheduledEndDateTime?.toISOString() ?? null,
      actualStartDateTime: actualStart,
      actualEndDateTime: actualEnd,
      careNotDelivered,
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

  async jobsNotStarted(user: RequestUser, query: HousekeepingQueryDto, meta?: RequestAuditMeta) {
    const userId = user.id;
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const scope = this.orgScope.fromRequestUser(user);
    if (scope.locationIds?.length === 0) {
      return { data: [], meta: buildPaginationMeta({ page, limit, total: 0 }) };
    }
    const now = new Date();
    const base = this.buildBaseWhere(query, scope);

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

  async jobsNeedingAttention(user: RequestUser, query: HousekeepingQueryDto, meta?: RequestAuditMeta) {
    const userId = user.id;
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const scope = this.orgScope.fromRequestUser(user);
    if (scope.locationIds?.length === 0) {
      return { data: [], meta: buildPaginationMeta({ page, limit, total: 0 }) };
    }
    const base = this.buildBaseWhere(query, scope);
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

  async dayJobs(user: RequestUser, query: HousekeepingQueryDto, meta?: RequestAuditMeta) {
    if (!query.date) throw new BadRequestException('date is required for day jobs');
    const userId = user.id;
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const { date } = utcDayBounds(query.date);
    const scope = this.orgScope.fromRequestUser(user);
    if (scope.locationIds?.length === 0) {
      return {
        data: { date, jobs: [] },
        meta: buildPaginationMeta({ page, limit, total: 0 }),
      };
    }
    const where = this.buildBaseWhere({ ...query, date }, scope);

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
    user: RequestUser,
    jobId: string,
    options?: { formIds?: string[] },
    meta?: RequestAuditMeta,
  ) {
    void meta;
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(user), jobId);
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

  async completeJob(
    actor: RequestUser | string,
    id: string,
    dto: CompleteJobDto,
    meta?: RequestAuditMeta,
  ) {
    const userId = this.actorUserId(actor);
    await this.assertJobForStaffActor(actor, id);
    const existing = await this.prisma.scheduledJob.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: housekeepingInclude,
    });
    if (!existing) throw new NotFoundException('Scheduled job not found');
    // Cancelled / called-off must use reinstate. COMPLETED jobs may still update outcome
    // (e.g. reopen to PLANNED or correct times) via this endpoint.
    if (
      existing.status === PrismaJobStatus.CANCELLED ||
      existing.status === PrismaJobStatus.CALLED_OFF
    ) {
      throw new BadRequestException(`Cannot complete job in status ${existing.status}`);
    }

    const visitStatus = (dto.status ?? ScheduledVisitStatus.COMPLETED) as PrismaVisitStatus;
    const completing =
      visitStatus === ScheduledVisitStatus.COMPLETED ||
      visitStatus === ScheduledVisitStatus.PARTIALLY_COMPLETED;
    const markingStarted = visitStatus === ScheduledVisitStatus.STARTED;
    const markingMissed = visitStatus === ScheduledVisitStatus.MISSED;
    const reopeningFromCompleted =
      existing.status === PrismaJobStatus.COMPLETED && !completing;

    if (completing && (!dto.actualStartDateTime || !dto.actualEndDateTime)) {
      if (!dto.carerActuals?.length) {
        throw new BadRequestException('Actual start and end times are required when completing a visit');
      }
    }

    let missedReasonCode: string | null = null;
    let missedReasonNotes: string | null = null;
    if (markingMissed) {
      const code = dto.missedReasonCode?.trim() ?? '';
      if (!isVisitMissedReasonCode(code)) {
        throw new BadRequestException(
          'A structured missed reason is required when marking a visit as did not attend.',
        );
      }
      missedReasonCode = code;
      missedReasonNotes = dto.missedReasonNotes?.trim() || null;
      const reasonMeta = VISIT_MISSED_REASONS.find((r) => r.code === code);
      if (reasonMeta?.requiresNotes && !missedReasonNotes) {
        throw new BadRequestException('Notes are required when the missed reason is Other.');
      }
    }

    let careNotDelivered = false;
    let careNotDeliveredReasonCode: string | null = null;
    let careNotDeliveredNotes: string | null = null;
    if (completing && dto.careNotDelivered === true) {
      careNotDelivered = true;
      const code = dto.careNotDeliveredReasonCode?.trim() ?? '';
      if (!isVisitCareNotDeliveredReasonCode(code)) {
        throw new BadRequestException(
          'Select a reason when care was not delivered (service user unavailable / not home). Visit stays completed because the carer attended.',
        );
      }
      careNotDeliveredReasonCode = code;
      careNotDeliveredNotes = dto.careNotDeliveredNotes?.trim() || null;
      const reasonMeta = VISIT_CARE_NOT_DELIVERED_REASONS.find((r) => r.code === code);
      if (reasonMeta?.requiresNotes && !careNotDeliveredNotes) {
        throw new BadRequestException(
          'Notes are required when care was not delivered after attendance.',
        );
      }
    } else if (completing && dto.careNotDeliveredReasonCode?.trim()) {
      // Allow reason without explicit flag for clients that only send the code.
      const code = dto.careNotDeliveredReasonCode.trim();
      if (!isVisitCareNotDeliveredReasonCode(code)) {
        throw new BadRequestException('Invalid care-not-delivered reason code.');
      }
      careNotDelivered = true;
      careNotDeliveredReasonCode = code;
      careNotDeliveredNotes = dto.careNotDeliveredNotes?.trim() || null;
      const reasonMeta = VISIT_CARE_NOT_DELIVERED_REASONS.find((r) => r.code === code);
      if (reasonMeta?.requiresNotes && !careNotDeliveredNotes) {
        throw new BadRequestException(
          'Notes are required when care was not delivered after attendance.',
        );
      }
    }

    let actualStart = dto.actualStartDateTime ? new Date(dto.actualStartDateTime) : undefined;
    // Started must never persist checkout — strip any client-sent draft/planned ends.
    let actualEnd = markingStarted
      ? undefined
      : dto.actualEndDateTime
        ? new Date(dto.actualEndDateTime)
        : completing && !dto.status
          ? new Date()
          : undefined;

    const carerActualRows: Array<{
      allocationId: string;
      start: Date;
      end: Date | null;
    }> = [];

    if (dto.carerActuals?.length) {
      const activeAllocationIds = new Set(
        (existing.allocations ?? [])
          .filter((a) => ACTIVE_ALLOCATION.includes(a.status))
          .map((a) => a.id),
      );
      for (const row of dto.carerActuals) {
        if (!activeAllocationIds.has(row.allocationId)) {
          throw new BadRequestException(
            `Allocation ${row.allocationId} is not an active carer on this visit`,
          );
        }
        const start = new Date(row.actualStartDateTime);
        if (Number.isNaN(start.getTime())) {
          throw new BadRequestException('Invalid carer actual start time');
        }
        if (markingStarted) {
          carerActualRows.push({ allocationId: row.allocationId, start, end: null });
          continue;
        }
        if (!row.actualEndDateTime) {
          throw new BadRequestException(
            'Each carer actual end time is required when completing a visit',
          );
        }
        const end = new Date(row.actualEndDateTime);
        if (Number.isNaN(end.getTime())) {
          throw new BadRequestException('Invalid carer actual end time');
        }
        if (end.getTime() <= start.getTime()) {
          throw new BadRequestException(
            'Each carer actual end time must be later than their start time',
          );
        }
        carerActualRows.push({ allocationId: row.allocationId, start, end });
      }
      if (carerActualRows.length) {
        actualStart = new Date(Math.min(...carerActualRows.map((r) => r.start.getTime())));
        if (!markingStarted) {
          const ends = carerActualRows
            .map((r) => r.end)
            .filter((d): d is Date => d != null);
          if (ends.length) {
            actualEnd = new Date(Math.max(...ends.map((d) => d.getTime())));
          }
        }
      }
    }

    if (actualStart && Number.isNaN(actualStart.getTime())) {
      throw new BadRequestException('Invalid actualStartDateTime');
    }
    if (actualEnd && Number.isNaN(actualEnd.getTime())) {
      throw new BadRequestException('Invalid actualEndDateTime');
    }
    if (markingStarted) {
      actualEnd = undefined;
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

      if (deliveryAssessment.requiresExceptionReason && !careNotDelivered) {
        const code = dto.timingExceptionReasonCode?.trim() ?? '';
        if (!isAcceptedVisitTimingExceptionReason(code)) {
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
        if (actualMinutes > plannedMinutes && !careNotDelivered) {
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
          ...(actualStart
            ? { actualStartDateTime: actualStart }
            : reopeningFromCompleted
              ? { actualStartDateTime: null }
              : {}),
          // In-progress visits keep start only — clear draft/planned end times.
          ...(markingStarted
            ? { actualEndDateTime: null }
            : actualEnd
              ? { actualEndDateTime: actualEnd }
              : reopeningFromCompleted
                ? { actualEndDateTime: null }
                : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          ...(userId ? { updatedById: userId } : {}),
        },
      });

      for (const row of carerActualRows) {
        await tx.jobAllocation.update({
          where: { id: row.allocationId },
          data: {
            actualStartDateTime: row.start,
            actualEndDateTime: markingStarted ? null : row.end,
          },
        });
      }

      if ((reopeningFromCompleted || markingStarted) && !carerActualRows.length) {
        const activeAllocationIds = (existing.allocations ?? [])
          .filter((a) => ACTIVE_ALLOCATION.includes(a.status))
          .map((a) => a.id);
        if (activeAllocationIds.length) {
          await tx.jobAllocation.updateMany({
            where: { id: { in: activeAllocationIds } },
            data: markingStarted
              ? { actualEndDateTime: null }
              : {
                  actualStartDateTime: null,
                  actualEndDateTime: null,
                },
          });
        }
      }

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
      } else if ((completing || reopeningFromCompleted) && 'overrunReason' in metadataPatch) {
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
      } else if (completing || reopeningFromCompleted) {
        if ('timingExceptionReasonCode' in metadataPatch) {
          delete metadataPatch.timingExceptionReasonCode;
          metadataChanged = true;
        }
        if ('timingExceptionNotes' in metadataPatch) {
          delete metadataPatch.timingExceptionNotes;
          metadataChanged = true;
        }
      }

      if (markingMissed && missedReasonCode) {
        metadataPatch.missedReasonCode = missedReasonCode;
        if (missedReasonNotes) metadataPatch.missedReasonNotes = missedReasonNotes;
        else delete metadataPatch.missedReasonNotes;
        metadataPatch.missedReasonLabel = visitMissedReasonLabel(missedReasonCode);
        metadataChanged = true;
      } else if (!markingMissed) {
        if ('missedReasonCode' in metadataPatch) {
          delete metadataPatch.missedReasonCode;
          metadataChanged = true;
        }
        if ('missedReasonNotes' in metadataPatch) {
          delete metadataPatch.missedReasonNotes;
          metadataChanged = true;
        }
        if ('missedReasonLabel' in metadataPatch) {
          delete metadataPatch.missedReasonLabel;
          metadataChanged = true;
        }
      }

      if (completing && careNotDelivered && careNotDeliveredReasonCode) {
        metadataPatch.careNotDelivered = true;
        metadataPatch.careNotDeliveredReasonCode = careNotDeliveredReasonCode;
        metadataPatch.careNotDeliveredReasonLabel =
          visitCareNotDeliveredReasonLabel(careNotDeliveredReasonCode);
        if (careNotDeliveredNotes) metadataPatch.careNotDeliveredNotes = careNotDeliveredNotes;
        else delete metadataPatch.careNotDeliveredNotes;
        metadataChanged = true;
      } else if (completing || reopeningFromCompleted) {
        if ('careNotDelivered' in metadataPatch) {
          delete metadataPatch.careNotDelivered;
          metadataChanged = true;
        }
        if ('careNotDeliveredReasonCode' in metadataPatch) {
          delete metadataPatch.careNotDeliveredReasonCode;
          metadataChanged = true;
        }
        if ('careNotDeliveredReasonLabel' in metadataPatch) {
          delete metadataPatch.careNotDeliveredReasonLabel;
          metadataChanged = true;
        }
        if ('careNotDeliveredNotes' in metadataPatch) {
          delete metadataPatch.careNotDeliveredNotes;
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
          missedReasonCode,
          careNotDelivered,
          careNotDeliveredReasonCode,
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

    // Admin actor (non-empty userId) + completion → Manual (even if GPS seed exists).
    // Carer app calls completeJob('') and records MOBILE_GPS → Electronic.
    const officeCompleted = Boolean(completing && userId?.trim() && actualStart);
    if (officeCompleted && userId) {
      try {
        await this.ensureOfficeManualAttendanceFromAdminComplete({
          jobId: id,
          userId,
          actualStart: actualStart!,
          actualEnd: actualEnd ?? undefined,
          visitId: existing.visits?.[0]?.id ?? null,
          allocations: (existing.allocations ?? []).map((a) => ({
            id: a.id,
            employeeId: a.employeeId,
            status: a.status,
          })),
        });
      } catch {
        // Completion must succeed even if attendance evidence write fails; ECM evaluate still runs.
      }

      try {
        const previousMeta = this.parseJobMetadata(existing.metadata);
        await this.prisma.scheduledJob.update({
          where: { id },
          data: {
            metadata: {
              ...previousMeta,
              ecmCompletionSource: 'office',
            } as Prisma.InputJsonValue,
          },
        });
      } catch {
        // Non-fatal — MANUAL_OFFICE events + officeCompleted option still drive Manual.
      }
    }

    // ECM evaluation is a derived cache — rebuild from workspace after every outcome write.
    await this.ecmEvaluation.evaluateJobSafe(id, {
      confirmedMissed: markingMissed || undefined,
      officeCompleted: officeCompleted || undefined,
    });

    return result;
  }

  async cancelJob(user: RequestUser, id: string, dto: CancelJobDto, meta?: RequestAuditMeta) {
    const userId = user.id;
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(user), id);
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

    const cancelResult = await this.prisma.$transaction(async (tx) => {
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

    await this.ecmEvaluation.evaluateJobSafe(id);
    return cancelResult;
  }

  async reinstateJob(user: RequestUser, id: string, dto: ReinstateJobDto, meta?: RequestAuditMeta) {
    const userId = user.id;
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(user), id);
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

    const reinstateResult = await this.prisma.$transaction(async (tx) => {
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

    await this.ecmEvaluation.evaluateJobSafe(id);
    return reinstateResult;
  }

  /**
   * Same Obs catalog + recorded-this-visit payload as carer
   * GET employee-app/visits/:jobId/details → observations (and GET …/observations).
   */
  async getVisitObservations(user: RequestUser, jobId: string) {
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(user), jobId);
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null, isActive: true },
      include: {
        visits: {
          where: { deletedAt: null, isActive: true },
          orderBy: { scheduledStartDateTime: 'asc' },
          take: 1,
          select: {
            id: true,
            scheduledStartDateTime: true,
            actualStartDateTime: true,
          },
        },
      },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    const primaryVisit = job.visits[0];
    const since =
      primaryVisit?.actualStartDateTime ??
      primaryVisit?.scheduledStartDateTime ??
      job.scheduledStartDateTime;

    const payload = await this.visitObservationsCatalog.buildVisitObservationsPayload({
      serviceUserId: job.serviceUserId,
      since,
      scheduledJobId: job.id,
    });

    return {
      data: {
        scheduledJobId: job.id,
        scheduledVisitId: primaryVisit?.id ?? null,
        serviceUserId: job.serviceUserId,
        ...payload,
      },
    };
  }

  async getVisitJobTasks(actor: RequestUser | string, jobId: string, meta?: RequestAuditMeta) {
    void meta;
    const userId = this.actorUserId(actor);
    await this.assertJobForStaffActor(actor, jobId);
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

    // Ensure carers see Medication prompt even if planner was never opened.
    await syncEmarMedicationPromptsForServiceUser(
      this.prisma,
      job.serviceUserId,
      userId || null,
    );

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
        include: {
          completedBy: {
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);

    const completionByAssignment = new Map<string, (typeof completions)[number]>();
    for (const row of completions) {
      if (!row.assignmentId) continue;
      const existing = completionByAssignment.get(row.assignmentId);
      // Prefer a completed row if duplicates ever exist.
      if (!existing || (!existing.isCompleted && row.isCompleted)) {
        completionByAssignment.set(row.assignmentId, row);
      }
    }
    const adHocCompletions = completions.filter((row) => !row.assignmentId);

    const visitDay = utcDayBounds(job.scheduledStartDateTime.toISOString().slice(0, 10)).start;
    const dueAssignments = assignments.filter((assignment) => {
      // Keep tasks already interacted with on this visit even if schedule was changed later.
      if (completionByAssignment.has(assignment.id)) return true;
      return visitTaskMatchesDay(pickScheduleFromAssignment(assignment), visitDay, visitDay);
    });

    const mapCompletedBy = (
      completion: (typeof completions)[number] | undefined,
    ): { completedById: string | null; completedByName: string | null } => {
      if (!completion?.completedById) {
        return { completedById: null, completedByName: null };
      }
      const pd = completion.completedBy?.personalDetail;
      const name = [pd?.firstName, pd?.lastName].filter(Boolean).join(' ').trim();
      return {
        completedById: completion.completedById,
        completedByName: name || null,
      };
    };

    const plannedTasks = dueAssignments.map((assignment) => {
      const completion = completionByAssignment.get(assignment.id);
      const flagsJson =
        assignment.task.flagsJson && typeof assignment.task.flagsJson === 'object'
          ? (assignment.task.flagsJson as Record<string, unknown>)
          : null;
      const completionInput = resolveVisitTaskCompletionInput({
        name: assignment.task.name,
        flagsJson,
      });
      const obsLink = resolveTaskObsLink({
        name: assignment.task.name,
        groupCode: assignment.task.category.group.code,
        flagsJson,
      });
      const completedBy = mapCompletedBy(completion);
      const priority = assignment.priority ?? 'routine';
      return {
        assignmentId: assignment.id,
        taskCatalogueTaskId: assignment.taskCatalogueTaskId,
        name: assignment.task.name,
        categoryName: assignment.task.category.name,
        groupCode: assignment.task.category.group.code,
        consentRequired: assignment.task.consentRequired,
        supportLevelApplicable: assignment.task.supportLevelApplicable,
        /** DB source for employee-app TaskItem.twoPerson */
        requiresMultipleCarers: Boolean(assignment.task.requiresMultipleCarers),
        completionInput,
        carerInstructions: assignment.carerInstructions,
        priority,
        isRequired: !['optional', 'low', 'nice_to_have'].includes(String(priority).toLowerCase()),
        flagsJson,
        isEmarPrompt: isEmarMedicationPromptTask({
          name: assignment.task.name,
          flagsJson,
        }),
        observationTypeCode: obsLink?.observationTypeCode ?? null,
        linkedTypeCode: obsLink?.linkedTypeCode ?? null,
        isExtra: false,
        isCompleted: completion?.isCompleted ?? false,
        outcome: inferVisitTaskOutcome({
          isCompleted: completion?.isCompleted ?? false,
          recordedValue: completion?.recordedValue ?? null,
          notes: completion?.notes ?? null,
        }),
        recordedValue: completion?.recordedValue ?? null,
        notes: stripVisitTaskOutcomeNotes(completion?.notes) ?? null,
        completedAt: completion?.completedAt?.toISOString() ?? null,
        completedById: completedBy.completedById,
        completedByName: completedBy.completedByName,
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
        const obsLink = resolveTaskObsLink({
          name: task.name,
          groupCode: task.category.group.code,
          flagsJson,
        });
        const completedBy = mapCompletedBy(completion);
        return {
          assignmentId: `extra-${completion.taskCatalogueTaskId}`,
          taskCatalogueTaskId: completion.taskCatalogueTaskId,
          name: task.name,
          categoryName: task.category.name,
          groupCode: task.category.group.code,
          consentRequired: task.consentRequired,
          supportLevelApplicable: task.supportLevelApplicable,
          requiresMultipleCarers: Boolean(task.requiresMultipleCarers),
          completionInput,
          carerInstructions: null,
          priority: 'routine',
          isRequired: true,
          flagsJson,
          observationTypeCode: obsLink?.observationTypeCode ?? null,
          linkedTypeCode: obsLink?.linkedTypeCode ?? null,
          isExtra: true,
          isCompleted: completion.isCompleted,
          outcome: inferVisitTaskOutcome({
            isCompleted: completion.isCompleted,
            recordedValue: completion.recordedValue ?? null,
            notes: completion.notes ?? null,
          }),
          recordedValue: completion.recordedValue ?? null,
          notes: stripVisitTaskOutcomeNotes(completion.notes) ?? null,
          completedAt: completion.completedAt?.toISOString() ?? null,
          completedById: completedBy.completedById,
          completedByName: completedBy.completedByName,
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
    actor: RequestUser | string,
    jobId: string,
    dto: SaveVisitJobTasksDto,
    meta?: RequestAuditMeta,
    options?: { pruneMissingExtras?: boolean },
  ) {
    void meta;
    const userId = this.actorUserId(actor);
    await this.assertJobForStaffActor(actor, jobId);
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
              task: {
                include: {
                  category: { include: { group: true } },
                },
              },
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
            include: { category: { include: { group: true } } },
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

    type NormalizedTaskItem = {
      assignmentId?: string;
      taskCatalogueTaskId?: string;
      isExtra?: boolean;
      isCompleted: boolean;
      recordedValue?: string | null;
      notes?: string | null;
      outcomeCode: ReturnType<typeof normalizeVisitTaskOutcomeCode>;
    };

    const normalizedTasks: NormalizedTaskItem[] = dto.tasks.map((item) => {
      const outcomeCode = normalizeVisitTaskOutcomeCode(item.outcome);
      if (item.outcome && !outcomeCode) {
        throw new BadRequestException('outcome must be COMPLETED, PARTIAL, or DECLINED');
      }

      if (outcomeCode) {
        if (
          (outcomeCode === 'PARTIAL' || outcomeCode === 'DECLINED') &&
          !stripVisitTaskOutcomeNotes(item.notes) &&
          !item.outcomeReasonCode?.trim()
        ) {
          throw new BadRequestException('notes or outcomeReasonCode required for PARTIAL/DECLINED');
        }
        const encoded = encodeVisitTaskOutcomeFields({
          outcome: outcomeCode,
          notes: item.notes,
          recordedValue: item.recordedValue,
          outcomeReasonCode: item.outcomeReasonCode,
        });
        return {
          assignmentId: item.assignmentId,
          taskCatalogueTaskId: item.taskCatalogueTaskId,
          isExtra: item.isExtra,
          isCompleted: true,
          recordedValue: encoded.recordedValue,
          notes: encoded.notes,
          outcomeCode,
        };
      }

      return {
        assignmentId: item.assignmentId,
        taskCatalogueTaskId: item.taskCatalogueTaskId,
        isExtra: item.isExtra,
        isCompleted: item.isCompleted,
        recordedValue: item.recordedValue ?? null,
        notes: item.notes ?? null,
        outcomeCode: item.isCompleted
          ? (normalizeVisitTaskOutcomeCode(
              inferVisitTaskOutcome({
                isCompleted: item.isCompleted,
                recordedValue: item.recordedValue,
                notes: item.notes,
              }) ?? 'COMPLETED',
            ) ?? 'COMPLETED')
          : null,
      };
    });

    for (const item of normalizedTasks) {
      if (!item.isCompleted) continue;
      // Clinical value/note fields required only for fully completed outcomes (parity with carer app).
      if (item.outcomeCode === 'PARTIAL' || item.outcomeCode === 'DECLINED') continue;

      const recordedForValidation = isVisitTaskOutcomeSentinel(item.recordedValue)
        ? null
        : item.recordedValue;
      const notesForValidation = stripVisitTaskOutcomeNotes(item.notes);

      if (item.isExtra && item.taskCatalogueTaskId) {
        const task = extraCatalogueTasks.find((row) => row.id === item.taskCatalogueTaskId);
        if (!task) continue;
        const flagsJson =
          task.flagsJson && typeof task.flagsJson === 'object'
            ? (task.flagsJson as Record<string, unknown>)
            : null;
        const spec = resolveVisitTaskCompletionInput({ name: task.name, flagsJson });
        const missing = visitTaskCompletionInputMissing(
          spec,
          true,
          recordedForValidation,
          notesForValidation,
        );
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
        recordedForValidation,
        notesForValidation,
      );
      if (missing) {
        throw new BadRequestException(`${assignment.task.name}: ${missing}`);
      }
    }

    const assignmentById = new Map(assignments.map((row) => [row.id, row]));
    const extraTaskById = new Map(extraCatalogueTasks.map((row) => [row.id, row]));
    const now = new Date();
    const plannedNormalized = normalizedTasks.filter((task) => !task.isExtra && task.assignmentId);
    const extraNormalized = normalizedTasks.filter((task) => task.isExtra && task.taskCatalogueTaskId);

    await this.prisma.$transaction(async (tx) => {
      for (const item of plannedNormalized) {
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

      for (const item of extraNormalized) {
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

      const retainedExtraTaskIds = extraNormalized.map((item) => item.taskCatalogueTaskId!);
      // Partial carer-app saves (single planned task) must not wipe other ad-hoc rows.
      // Admin full checklist saves keep pruneMissingExtras=true (default).
      if (options?.pruneMissingExtras !== false) {
        await tx.scheduledVisitTaskCompletion.deleteMany({
          where: {
            scheduledJobId: job.id,
            assignmentId: null,
            ...(retainedExtraTaskIds.length > 0
              ? { taskCatalogueTaskId: { notIn: retainedExtraTaskIds } }
              : {}),
          },
        });
      }
    });

    // Admin office path: mirror fully completed Obs-linked readings into Observations.
    // Carer app passes empty userId and syncs via employee-app with recordedByEmployeeId.
    const primaryVisitId = job.visits[0]?.id ?? null;
    if (userId && primaryVisitId) {
      for (const item of normalizedTasks) {
        if (!item.isCompleted || item.outcomeCode !== 'COMPLETED') continue;
        const recordedValue = item.recordedValue?.trim() || null;
        const notes = item.notes?.trim() || null;
        if (!recordedValue && !notes) continue;
        if (isVisitTaskOutcomeSentinel(recordedValue)) continue;

        if (item.isExtra && item.taskCatalogueTaskId) {
          const task = extraTaskById.get(item.taskCatalogueTaskId);
          if (!task) continue;
          const flagsJson =
            task.flagsJson && typeof task.flagsJson === 'object'
              ? (task.flagsJson as Record<string, unknown>)
              : null;
          await syncObservationFromCompletedVisitTask(this.prisma, {
            serviceUserId: job.serviceUserId,
            jobId: job.id,
            visitId: primaryVisitId,
            taskName: task.name,
            groupCode: task.category?.group?.code ?? null,
            flagsJson,
            recordedValue,
            notes: stripVisitTaskOutcomeNotes(notes),
            recordedByUserId: userId,
          });
          continue;
        }

        const assignment = assignmentById.get(item.assignmentId!);
        if (!assignment) continue;
        const flagsJson =
          assignment.task.flagsJson && typeof assignment.task.flagsJson === 'object'
            ? (assignment.task.flagsJson as Record<string, unknown>)
            : null;
        await syncObservationFromCompletedVisitTask(this.prisma, {
          serviceUserId: job.serviceUserId,
          jobId: job.id,
          visitId: primaryVisitId,
          taskName: assignment.task.name,
          groupCode: assignment.task.category?.group?.code ?? null,
          flagsJson,
          recordedValue,
          notes: stripVisitTaskOutcomeNotes(notes),
          recordedByUserId: userId,
        });
      }
    }

    return this.getVisitJobTasks(userId, jobId, meta);
  }
}
