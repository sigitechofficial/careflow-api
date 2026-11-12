import { existsSync } from 'fs';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AllocationStatus,
  CallOffVisitStatus as PrismaCallOffStatus,
  CarerVisitPushKind,
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
import {
  operationalScheduleDayBounds,
  utcDayBounds,
} from '../scheduling/schedule-date-range.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
import { assertVisitCancellationCompliance } from './visit-cancellation-validation.util';
import {
  visitCancellationOutcomeStatus,
  visitCancellationReasonMeta,
  type VisitCancellationReasonCode,
} from './visit-cancellation-reason.util';
import { lateCancellationPercent } from '../billing/invoice-late-cancellation.util';
import {
  TIMEBANK_CHARGEABLE_NOT_BANKED,
  cancelledByPartyFromReason,
  evaluateVisitCancellationPolicy,
  resolveCancellationFundingType,
  type VisitCancellationPolicyResult,
  type VisitCancelledByParty,
} from './visit-cancellation-policy.util';
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
import { CancelJobDto, ChangeCancellationBillingDto } from './dto/cancel-job.dto';
import { ReinstateJobDto } from './dto/reinstate-job.dto';
import { ResetJobDeliveryDto } from './dto/reset-job-delivery.dto';
import { ResetJobTaskDto } from './dto/reset-job-task.dto';
import {
  applyVisitDeliveryResetMetadata,
  jobHasDeliveryToReset,
} from './visit-delivery-reset.util';
import {
  applyVisitTaskResetMetadata,
  parseVisitTaskAssignmentKey,
  taskCompletionHasDeliveryToReset,
} from './visit-task-reset.util';
import { SaveVisitJobTasksDto } from './dto/save-visit-job-tasks.dto';
import { resolveJobMedicationRoundCode } from './visit-job-tasks.util';
import { VisitObservationsCatalogService } from '../service-user-observations/visit-observations-catalog.service';
import { EcmEvaluationService } from '../ecm/ecm-evaluation.service';
import { VisitAttendanceService } from '../visit-attendance/visit-attendance.service';
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';
import {
  AUTHORED_LOG_TYPES,
  logEntryRolesById,
  visitLogAuthorLabel,
  type VisitLogAuthor,
} from '../employee-app/employee-app-log-author.util';
import { SUPPORT_AUTO_CLOSED_META_KEY } from './support-auto-close.util';
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
import { catalogueFeedsBodyMap, resolveTaskObsLink } from '../employee-app/visit-task-obs-link.util';
import { syncObservationFromCompletedVisitTask } from '../employee-app/visit-task-obs-sync.util';
import {
  isCancelledJobStatus,
  loadOperationalTimeZone,
  loadVisitTaskPlacement,
  visitHmWindow,
} from '../visit-tasks/visit-task-window.util';
import { loadCarePlanFormFields } from '../service-user-care-plans/compose/compose-context.loader';
import {
  parseVoiceNoteLinks,
  resolveVoiceNoteAbsolutePath,
  timelineSourceForLink,
  VISIT_VOICE_NOTE_ENTRY_LABELS,
  voiceNoteIdsByLogEntryId,
  type StoredVoiceNoteLink,
  type VisitVoiceNoteApiItem,
  type VisitVoiceNoteGroupApi,
} from '../employee-app/visit-voice-note.util';
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

/** Round code stored on ad-hoc task completions for visits that have no visit-plan slot. */
const AD_HOC_TASK_ROUND_CODE = 'VISIT';

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
    private readonly carerPush: CarerVisitPushHook,
    private readonly orgSettings: OrganisationGeneralSettingsService,
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
      select: { id: true, metadata: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    const timeline = await this.visitTimeline.listForJob(jobId);
    const jobMeta = this.parseJobMetadata(job.metadata);
    const incidentPhotos = incidentPhotosBySourceId(jobMeta);

    // Who wrote notes / handover / concerns / incidents, and their role at the time.
    const authorRows = await this.prisma.visitTimelineEvent.findMany({
      where: { scheduledJobId: jobId, id: { in: timeline.map((t) => t.id) } },
      select: { id: true, createdByEmployeeId: true },
    });
    const authorIdByEventId = new Map(
      authorRows
        .filter((r) => r.createdByEmployeeId)
        .map((r) => [r.id, r.createdByEmployeeId!] as const),
    );
    const authorIds = [...new Set(authorIdByEventId.values())];
    const authorNames = authorIds.length
      ? await this.prisma.employeePersonalDetail.findMany({
          where: { employeeId: { in: authorIds } },
          select: { employeeId: true, firstName: true, lastName: true },
        })
      : [];
    const nameById = new Map(
      authorNames.map((p) => [
        p.employeeId,
        [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || 'Carer',
      ]),
    );
    const employeeAppMeta =
      jobMeta.employeeApp && typeof jobMeta.employeeApp === 'object' && !Array.isArray(jobMeta.employeeApp)
        ? (jobMeta.employeeApp as Record<string, unknown>)
        : null;
    const rolesByEntryId = logEntryRolesById(employeeAppMeta);
    // Clock in / out rows: name the carer, and on shared visits their role,
    // so three "Clocked in" rows can be told apart.
    const allocationRoles = await this.prisma.jobAllocation.findMany({
      where: { scheduledJobId: jobId, deletedAt: null },
      select: { employeeId: true, isLeadCarer: true },
    });
    const sharedVisit = allocationRoles.length > 1;
    const attendanceRoleById = new Map(
      allocationRoles.map((a) => [a.employeeId, a.isLeadCarer ? ('lead' as const) : ('support' as const)]),
    );
    const voiceGroups = await this.resolveJobVoiceNotes(jobId, employeeAppMeta);
    const voiceNotesByEventId = new Map<string, VisitVoiceNoteApiItem[]>();
    const otherVoiceNotes: VisitVoiceNoteGroupApi[] = [];
    for (const group of voiceGroups) {
      if (group.timelineEventId) {
        voiceNotesByEventId.set(group.timelineEventId, [
          ...(voiceNotesByEventId.get(group.timelineEventId) ?? []),
          ...group.voiceNotes,
        ]);
      } else {
        otherVoiceNotes.push(group);
      }
    }

    return {
      jobId,
      /** Voice notes on records without a timeline row (SOS, check-in request, body map review). */
      otherVoiceNotes,
      timeline: timeline.map((item) => {
        let next = item;
        if (item.type === 'clock_in' && item.detail) {
          const methodOnly = item.detail.split('\n')[0]?.trim() || item.detail;
          next = { ...item, detail: methodOnly, subtitle: methodOnly };
        }
        const authorId = authorIdByEventId.get(item.id);
        const isAttendance = item.type === 'clock_in' || item.type === 'clock_out';
        if (authorId && (AUTHORED_LOG_TYPES.has(item.type) || isAttendance)) {
          const name = nameById.get(authorId) ?? 'Carer';
          const role = isAttendance
            ? sharedVisit
              ? (attendanceRoleById.get(authorId) ?? null)
              : null
            : (rolesByEntryId.get(item.logEntryId ?? '') ?? rolesByEntryId.get(item.sourceId) ?? null);
          const author: VisitLogAuthor = {
            employeeId: authorId,
            name,
            role,
            label: visitLogAuthorLabel(name, role),
          };
          next = { ...next, author } as typeof next & { author: VisitLogAuthor };
        }
        const photos = item.type === 'incident' ? incidentPhotos.get(item.sourceId) : undefined;
        if (photos?.length) next = { ...next, photos };
        const voiceNotes = voiceNotesByEventId.get(item.id);
        return voiceNotes?.length ? { ...next, voiceNotes } : next;
      }),
    };
  }

  /** Admin: every carer voice note on the visit, grouped by the record it belongs to. */
  async getVisitVoiceNotes(user: RequestUser, jobId: string) {
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(user), jobId);
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null },
      select: { id: true, metadata: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    const jobMeta = this.parseJobMetadata(job.metadata);
    const employeeAppMeta =
      jobMeta.employeeApp && typeof jobMeta.employeeApp === 'object' && !Array.isArray(jobMeta.employeeApp)
        ? (jobMeta.employeeApp as Record<string, unknown>)
        : null;
    return { jobId, groups: await this.resolveJobVoiceNotes(jobId, employeeAppMeta) };
  }

  /**
   * Carer app: the same voice note groups, with download URLs on the employee-app route.
   * The caller must already have checked the carer is allocated to the visit.
   */
  async listVoiceNoteGroupsForCarerApp(jobId: string): Promise<VisitVoiceNoteGroupApi[]> {
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null },
      select: { id: true, metadata: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    const jobMeta = this.parseJobMetadata(job.metadata);
    const employeeAppMeta =
      jobMeta.employeeApp && typeof jobMeta.employeeApp === 'object' && !Array.isArray(jobMeta.employeeApp)
        ? (jobMeta.employeeApp as Record<string, unknown>)
        : null;
    return this.resolveJobVoiceNotes(
      jobId,
      employeeAppMeta,
      (voiceNoteId) => `/employee-app/visits/${jobId}/voice-notes/${voiceNoteId}/file`,
    );
  }

  /**
   * Resolves the voice notes on a visit to the records they belong to:
   * - notes / handover / concerns point at theirs on their own entry (`voiceNoteIds`);
   * - every other record via `voiceNoteLinks`: the save's idempotency key finds the server
   *   record in the job's idempotency cache (observation / MAR event / body map record ids),
   *   else the record's own timeline source (task key, incident id, clock in/out …).
   * Only uploaded, current voice notes are returned (recording order).
   */
  private async resolveJobVoiceNotes(
    jobId: string,
    employeeAppMeta: Record<string, unknown> | null,
    downloadUrlFor: (voiceNoteId: string) => string = (voiceNoteId) =>
      `/scheduled-jobs-housekeeping/jobs/${jobId}/voice-notes/${voiceNoteId}/file`,
  ): Promise<VisitVoiceNoteGroupApi[]> {
    const logPointers = voiceNoteIdsByLogEntryId(employeeAppMeta);
    // Latest link per record — older saves of the same task / incident are superseded.
    const latestLinks = new Map<string, StoredVoiceNoteLink>();
    for (const link of parseVoiceNoteLinks(employeeAppMeta)) {
      const recordKey = `${link.entryType}:${link.entryId}`;
      const prev = latestLinks.get(recordKey);
      if (!prev || prev.updatedAt < link.updatedAt) latestLinks.set(recordKey, link);
    }
    const links = [...latestLinks.values()].filter((l) => l.voiceNoteIds.length > 0);
    const allIds = [...new Set([...[...logPointers.values()].flat(), ...links.flatMap((l) => l.voiceNoteIds)])];
    if (allIds.length === 0) return [];

    const [rows, events] = await Promise.all([
      this.prisma.visitVoiceNote.findMany({
        where: { scheduledJobId: jobId, clientVoiceNoteId: { in: allIds }, deletedAt: null },
      }),
      this.prisma.visitTimelineEvent.findMany({
        where: { scheduledJobId: jobId, isDraft: false },
        select: { id: true, sourceType: true, sourceId: true, logEntryId: true },
      }),
    ]);
    const byClientId = new Map(rows.map((r) => [r.clientVoiceNoteId, r]));
    const toItems = (ids: string[]): VisitVoiceNoteApiItem[] =>
      ids.flatMap((clientId) => {
        const row = byClientId.get(clientId);
        if (!row) return []; // not uploaded yet (carer offline)
        return [
          {
            id: row.id,
            clientVoiceNoteId: row.clientVoiceNoteId,
            durationMs: row.durationMs,
            mimeType: row.mimeType,
            sizeBytes: row.fileSize,
            recordedAt: row.recordedAt?.toISOString() ?? null,
            downloadUrl: downloadUrlFor(row.id),
          },
        ];
      });
    // Save responses cached by idempotency key — they carry the server record ids.
    const savedResponses =
      employeeAppMeta?.idempotency &&
      typeof employeeAppMeta.idempotency === 'object' &&
      !Array.isArray(employeeAppMeta.idempotency)
        ? (employeeAppMeta.idempotency as Record<string, unknown>)
        : {};
    const sourceFromSave = (link: StoredVoiceNoteLink) => {
      const response = link.writeIdempotencyKey ? savedResponses[link.writeIdempotencyKey] : null;
      if (!response || typeof response !== 'object') return null;
      const r = response as Record<string, unknown>;
      const id = (key: string) => (typeof r[key] === 'string' && r[key] ? (r[key] as string) : null);
      switch (link.entryType) {
        case 'observation':
          return id('observationId') ? { sourceType: 'observation', sourceId: id('observationId')! } : null;
        case 'medication':
          return id('administrationId')
            ? { sourceType: 'medication', sourceId: id('administrationId')! }
            : null;
        case 'body_map':
          return id('recordId') ? { sourceType: 'body_map', sourceId: id('recordId')! } : null;
        default:
          return null;
      }
    };
    const eventBySource = new Map(events.map((e) => [`${e.sourceType}:${e.sourceId}`, e]));
    const eventByLogEntry = new Map(
      events.filter((e) => e.logEntryId).map((e) => [e.logEntryId as string, e]),
    );
    const incidents = Array.isArray(employeeAppMeta?.incidents)
      ? (employeeAppMeta.incidents as Array<Record<string, unknown>>)
      : [];
    const registerIncidentIdByEntry = new Map(
      incidents
        .filter((i) => typeof i.registerIncidentId === 'string')
        .map((i) => [String(i.id), String(i.registerIncidentId)]),
    );

    const groups: VisitVoiceNoteGroupApi[] = [];
    for (const [logEntryId, ids] of logPointers) {
      const voiceNotes = toItems(ids);
      if (!voiceNotes.length) continue;
      const event = eventByLogEntry.get(logEntryId);
      groups.push({
        entryType: event?.sourceType === 'handover' ? 'handover' : event?.sourceType === 'concern' ? 'concern' : 'visit_note',
        label: '',
        entryId: logEntryId,
        timelineEventId: event?.id ?? null,
        sourceType: event?.sourceType ?? null,
        sourceId: event?.sourceId ?? null,
        registerIncidentId: null,
        voiceNotes,
      });
    }
    for (const link of links) {
      const voiceNotes = toItems(link.voiceNoteIds);
      if (!voiceNotes.length) continue;
      const source = sourceFromSave(link) ?? timelineSourceForLink(link);
      const event = source ? eventBySource.get(`${source.sourceType}:${source.sourceId}`) : undefined;
      groups.push({
        entryType: link.entryType,
        label: '',
        entryId: link.entryId,
        timelineEventId: event?.id ?? null,
        // The server record id even when it has no timeline row yet.
        sourceType: event?.sourceType ?? source?.sourceType ?? null,
        sourceId: event?.sourceId ?? source?.sourceId ?? null,
        registerIncidentId:
          link.entryType === 'incident' ? (registerIncidentIdByEntry.get(link.entryId) ?? null) : null,
        voiceNotes,
      });
    }
    return groups.map((g) => ({
      ...g,
      label:
        VISIT_VOICE_NOTE_ENTRY_LABELS[g.entryType as keyof typeof VISIT_VOICE_NOTE_ENTRY_LABELS] ??
        'Voice note',
    }));
  }

  /** Permission + org-scope checked voice note file for streaming playback. */
  async getVoiceNoteFile(user: RequestUser, jobId: string, voiceNoteId: string) {
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(user), jobId);
    return this.voiceNoteFileForJob(jobId, voiceNoteId);
  }

  /** Voice note file on a visit — callers check access (office scope, or carer allocation). */
  async voiceNoteFileForJob(jobId: string, voiceNoteId: string) {
    const row = await this.prisma.visitVoiceNote.findFirst({
      where: { id: voiceNoteId, scheduledJobId: jobId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Voice note not found');
    const absolutePath = resolveVoiceNoteAbsolutePath(row.storagePath);
    if (!absolutePath || !existsSync(absolutePath)) {
      throw new NotFoundException('Voice note file is no longer available');
    }
    return { absolutePath, mimeType: row.mimeType, fileName: row.fileName };
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

  /** `timeZone` = organisation timezone; date filters are org-local calendar days. */
  private buildBaseWhere(
    query: HousekeepingQueryDto,
    scope: OrgScope,
    timeZone: string,
  ): Prisma.ScheduledJobWhereInput {
    const where: Prisma.ScheduledJobWhereInput = { deletedAt: null, isActive: true };
    if (query.scheduleBatchId) where.scheduleBatchId = query.scheduleBatchId;
    if (query.serviceUserId) where.serviceUserId = query.serviceUserId;
    if (query.status) where.status = query.status as PrismaJobStatus;

    if (query.date) {
      const { start, end } = operationalScheduleDayBounds(query.date, timeZone);
      where.scheduledStartDateTime = { gte: start, lte: end };
    } else if (query.dateFrom || query.dateTo) {
      where.scheduledStartDateTime = {};
      if (query.dateFrom) {
        where.scheduledStartDateTime.gte = operationalScheduleDayBounds(query.dateFrom, timeZone).start;
      }
      if (query.dateTo) {
        where.scheduledStartDateTime.lte = operationalScheduleDayBounds(query.dateTo, timeZone).end;
      }
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
    const base = this.buildBaseWhere(
      query,
      scope,
      await this.orgSettings.getOperationalTimezone(),
    );

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
    const base = this.buildBaseWhere(
      query,
      scope,
      await this.orgSettings.getOperationalTimezone(),
    );
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
    const where = this.buildBaseWhere(
      { ...query, date },
      scope,
      await this.orgSettings.getOperationalTimezone(),
    );

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

      // Lead closing a multi-carer visit never clocks a SUPPORT carer out: each carer's
      // session is their own. A support carer still on site clocks out themselves; until
      // then their clock-out stays empty (the office sees "Clock-out missing").

      await this.scheduledJobsService.syncJobStatusFromVisits(tx, id, userId || null);

      const previousMeta = this.parseJobMetadata(existing.metadata);
      const metadataPatch: Record<string, unknown> = { ...previousMeta };
      let metadataChanged = false;

      {
        const previousEa =
          previousMeta.employeeApp &&
          typeof previousMeta.employeeApp === 'object' &&
          !Array.isArray(previousMeta.employeeApp)
            ? (previousMeta.employeeApp as Record<string, unknown>)
            : {};
        // Re-opened / back to in progress: carer ends were cleared, so drop the markers
        // left by older visits (support clock-outs auto-closed at lead clock-out).
        const clearMarkers =
          (reopeningFromCompleted || markingStarted) &&
          SUPPORT_AUTO_CLOSED_META_KEY in previousEa;
        if (clearMarkers) {
          const nextEa: Record<string, unknown> = { ...previousEa };
          delete nextEa[SUPPORT_AUTO_CLOSED_META_KEY];
          metadataPatch.employeeApp = nextEa;
          metadataChanged = true;
        }
      }

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
      // Visit completion must succeed even if the pay records cannot be created. The failure is
      // not dropped: it is kept as an open pay evaluation failure for the office (R-17).
      await this.visitReconciliationsService.ensureForCompletedJobSafe(id, { overrunReason });
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

    return { message: result.message, data: result.data };
  }

  /**
   * Job Cancellation rules (Settings → Dom Care Settings) for a visit cancelled from the rota:
   * notice is worked out here from the planned start, and the rules apply only when the service
   * user cancelled (who cancelled is read from the reason).
   */
  private async rotaCancellationPolicy(
    job: { scheduledStartDateTime: Date; serviceUserId: string },
    reasonCode: VisitCancellationReasonCode,
  ): Promise<{ cancelledBy: VisitCancelledByParty; noticeHours: number; policy: VisitCancellationPolicyResult | null }> {
    const cancelledBy = cancelledByPartyFromReason(reasonCode);
    const noticeHours = Math.max(0, (job.scheduledStartDateTime.getTime() - Date.now()) / 3600000);
    if (cancelledBy !== 'SERVICE_USER') return { cancelledBy, noticeHours, policy: null };
    const settings = (await this.orgSettings.get()).data;
    const funding = await resolveCancellationFundingType(this.prisma, job.serviceUserId);
    const policy = evaluateVisitCancellationPolicy({
      cancelledBy,
      reasonCode,
      noticeHours,
      rules: settings.domJobCancellationRules,
      hospitalExemption: settings.domCancellationHospitalExemption,
      fundingTypeCode: funding?.code ?? null,
    });
    return { cancelledBy, noticeHours, policy };
  }

  /** What the cancellation rules suggest for this rota visit and reason (read only). */
  async cancellationPolicyPreview(user: RequestUser, id: string, reasonCode: VisitCancellationReasonCode) {
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(user), id);
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id, deletedAt: null, isActive: true },
      select: { scheduledStartDateTime: true, serviceUserId: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    const { cancelledBy, noticeHours, policy } = await this.rotaCancellationPolicy(job, reasonCode);
    return {
      data: {
        cancelledBy,
        noticeHours: Math.round(noticeHours * 10) / 10,
        applies: policy != null,
        suggestedDecision: policy?.decision ?? null,
        chargePercent: policy?.chargePercent ?? null,
        explanation: policy?.explanation ?? null,
      },
    };
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

    // The visit plan sends its own policy result; a rota cancellation gets it worked out here.
    const rota =
      dto.cancellationSource === 'VISIT_PLAN'
        ? null
        : await this.rotaCancellationPolicy(existing, dto.reasonCode);

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
            callOffDate: utcDayBounds(
              dayKeyInTimeZone(
                existing.scheduledStartDateTime,
                await this.orgSettings.getOperationalTimezone(),
              ),
            ).start,
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
        // Who asked for it and what the cancellation policy suggested (visit plan: sent with the request; rota: worked out above).
        cancelledByParty: rota ? rota.cancelledBy : (dto.cancelledByParty ?? null),
        cancelledByDescription: dto.cancelledByDescription?.trim() || null,
        cancellationSource: dto.cancellationSource ?? 'ROTA',
        noticeHours: rota ? Math.round(rota.noticeHours * 100) / 100 : (dto.noticeHours ?? null),
        suggestedChargeDecision: rota ? (rota.policy?.decision ?? null) : (dto.suggestedChargeDecision ?? null),
        suggestedChargePercent: rota ? (rota.policy?.chargePercent ?? null) : (dto.suggestedChargePercent ?? null),
        // Percent billed for a Charge decision: the rule's percent, else the full visit.
        chargePercent:
          dto.chargeDecision === 'CHARGE'
            ? lateCancellationPercent(
                null,
                rota ? (rota.policy?.chargePercent ?? null) : (dto.suggestedChargePercent ?? null),
              )
            : null,
        // The timebank marker: a Charge decision recorded from now on keeps the visit out of the timebank.
        policySnapshot: {
          ...((rota ? rota.policy?.snapshot : dto.policySnapshot) ?? {}),
          timebank: TIMEBANK_CHARGEABLE_NOT_BANKED,
        } as Prisma.InputJsonValue,
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
    const employeeIds = [
      ...new Set(
        (existing.allocations ?? [])
          .filter((a) => ACTIVE_ALLOCATION.includes(a.status))
          .map((a) => a.employeeId),
      ),
    ];
    const calledOff = dto.outcome === 'CALLED_OFF';
    this.carerPush.notify({
      employeeIds,
      kind: CarerVisitPushKind.VISIT_CALLED_OFF,
      title: calledOff ? 'Visit called off' : 'Visit cancelled',
      body: calledOff
        ? `Your visit "${existing.jobName}" has been called off.`
        : `Your visit "${existing.jobName}" has been cancelled.`,
      scheduledJobId: id,
      serviceUserId: existing.serviceUserId,
    });
    return cancelResult;
  }

  /**
   * Change the billing decision of a cancelled or called-off visit (finance confirming a charge, or
   * taking one off). Refused once the charge is on a locked invoice. The timebank reads the decision
   * live; an open invoice run picks the change up when it is recalculated.
   */
  async changeCancellationBilling(
    user: RequestUser,
    id: string,
    dto: ChangeCancellationBillingDto,
    meta?: RequestAuditMeta,
  ) {
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(user), id);
    const cancellation = await this.prisma.scheduledJobCancellation.findUnique({
      where: { scheduledJobId: id },
      include: {
        includedInInvoiceRun: {
          select: { invoiceNumber: true, documents: { select: { serviceUserId: true, invoiceNumber: true } } },
        },
      },
    });
    if (!cancellation || cancellation.reinstatedAt) {
      throw new NotFoundException('This visit has no active cancellation');
    }
    if (cancellation.includedInInvoiceRunId) {
      throw new BadRequestException(
        `The charge is on a locked invoice (${
          cancellation.includedInInvoiceRun?.documents.find((d) => d.serviceUserId === cancellation.serviceUserId)
            ?.invoiceNumber ??
          cancellation.includedInInvoiceRun?.invoiceNumber ??
          'invoice run'
        }) and can no longer be changed`,
      );
    }
    const note = dto.note.trim();
    if (!note) throw new BadRequestException('Add a note explaining the change');

    const snapshot =
      cancellation.policySnapshot && typeof cancellation.policySnapshot === 'object'
        ? (cancellation.policySnapshot as Record<string, unknown>)
        : {};
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.scheduledJobCancellation.update({
        where: { id: cancellation.id },
        data: {
          chargeDecision: dto.chargeDecision,
          chargeDecisionNotes: note,
          chargePercent:
            dto.chargeDecision === 'CHARGE'
              ? lateCancellationPercent(null, cancellation.suggestedChargePercent)
              : null,
          // A decision made now follows the current rule (out of the timebank when charged).
          policySnapshot: { ...snapshot, timebank: TIMEBANK_CHARGEABLE_NOT_BANKED } as Prisma.InputJsonValue,
        },
      });
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_JOB_UPDATED,
        recordType: 'ScheduledJob',
        recordId: id,
        oldValues: auditSnapshot({
          cancellationId: cancellation.id,
          chargeDecision: cancellation.chargeDecision,
          chargeDecisionNotes: cancellation.chargeDecisionNotes,
        }),
        newValues: auditSnapshot({
          cancellationId: cancellation.id,
          chargeDecision: dto.chargeDecision,
          chargeDecisionNotes: note,
        }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      // A visit cancelled from the visit plan also keeps the decision on the plan's cancelled date.
      if (cancellation.scheduledVisitId) {
        const visit = await tx.scheduledVisit.findUnique({
          where: { id: cancellation.scheduledVisitId },
          select: { visitPlanSlotId: true, scheduledJob: { select: { scheduledStartDateTime: true } } },
        });
        if (visit?.visitPlanSlotId && visit.scheduledJob) {
          const dayIso = dayKeyInTimeZone(
            visit.scheduledJob.scheduledStartDateTime,
            await this.orgSettings.getOperationalTimezone(),
          );
          await tx.visitPlanSlotException.updateMany({
            where: {
              visitPlanSlotId: visit.visitPlanSlotId,
              exceptionDate: new Date(`${dayIso}T00:00:00.000Z`),
              exceptionType: 'SKIP',
            },
            data: { chargeDecision: dto.chargeDecision, chargeDecisionNotes: note },
          });
        }
      }
      return row;
    });
    return {
      message: 'Billing decision changed',
      data: {
        chargeDecision: updated.chargeDecision,
        chargeDecisionNotes: updated.chargeDecisionNotes,
        chargePercent: updated.chargePercent,
      },
    };
  }

  /** Invoice number of the locked invoice holding this cancellation's charge, else null. */
  private async lockedCancellationInvoice(
    cancellation: { includedInInvoiceRunId: string | null; reinstatedAt: Date | null; serviceUserId: string } | null,
  ): Promise<string | null> {
    if (!cancellation?.includedInInvoiceRunId || cancellation.reinstatedAt) return null;
    const run = await this.prisma.invoiceRun.findUnique({
      where: { id: cancellation.includedInInvoiceRunId },
      select: { invoiceNumber: true, documents: { select: { serviceUserId: true, invoiceNumber: true } } },
    });
    return (
      run?.documents.find((d) => d.serviceUserId === cancellation.serviceUserId)?.invoiceNumber ??
      run?.invoiceNumber ??
      'an invoice run'
    );
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
    // A late cancellation charge already on a locked invoice: bringing the visit back would bill
    // the same visit twice (the charge, then the delivered visit on the next run).
    const lockedInvoice = await this.lockedCancellationInvoice(existing.cancellation);
    if (lockedInvoice) {
      throw new BadRequestException(
        `Can't reinstate: the late cancellation charge is on locked invoice ${lockedInvoice}. ` +
          'Add an extra visit for that day instead, or raise a credit with finance.',
      );
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
   * Wipe clock-in and this-visit care writes so the carer app shows the
   * initial Clock-in screen again. Hard-deletes attendance events (incl. SOS),
   * tasks, MAR, observations, body maps and the visit reconciliation (pay/charge)
   * for this job. Allocations and planned times stay. Works whether or not the
   * visit was completed, but is blocked once the visit is in a payroll or
   * invoice run (remove it from that run first).
   */
  async resetJobDelivery(
    user: RequestUser,
    id: string,
    dto: ResetJobDeliveryDto,
    meta?: RequestAuditMeta,
  ) {
    const userId = user.id;
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(user), id);
    const existing = await this.prisma.scheduledJob.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: housekeepingInclude,
    });
    if (!existing) throw new NotFoundException('Scheduled job not found');
    if (
      existing.status === PrismaJobStatus.CANCELLED ||
      existing.status === PrismaJobStatus.CALLED_OFF
    ) {
      throw new BadRequestException('Reinstate a cancelled visit before resetting delivery');
    }

    const visits = existing.visits ?? [];
    const employeeApp = jsonObject(this.parseJobMetadata(existing.metadata).employeeApp);
    const checkIns = jsonObject(employeeApp?.checkIns);
    const eligible = jobHasDeliveryToReset({
      status: existing.status,
      allocations: existing.allocations,
      visits,
      checkIn: employeeApp?.checkIn ?? (checkIns && Object.keys(checkIns).length > 0 ? checkIns : null),
    });
    if (!eligible) {
      throw new BadRequestException('This visit has no clock-in or delivery to reset');
    }

    // Financial guard — once a visit's reconciliation is pulled into a payroll
    // or invoice run those lines hold it with onDelete: Restrict, and the run
    // may already be paid or invoiced. Block the reset and make the office
    // remove the visit from that run first, rather than silently unwinding
    // committed pay/billing.
    const [payrollLine, invoiceLine] = await Promise.all([
      this.prisma.payrollRunLine.findFirst({
        where: { visitReconciliation: { scheduledJobId: id } },
        select: { id: true },
      }),
      this.prisma.invoiceRunLine.findFirst({
        where: { visitReconciliation: { scheduledJobId: id } },
        select: { id: true },
      }),
    ]);
    if (payrollLine || invoiceLine) {
      throw new BadRequestException(
        'This visit is already in a payroll or invoice run. Remove it from that run before resetting.',
      );
    }

    const reason = dto.reason.trim();
    const resetAt = new Date();
    const resetAtIso = resetAt.toISOString();
    const visitIds = visits.map((visit) => visit.id);

    const resetResult = await this.prisma.$transaction(async (tx) => {
      await tx.scheduledVisit.updateMany({
        where: { scheduledJobId: id, deletedAt: null, isActive: true },
        data: {
          status: PrismaVisitStatus.PLANNED,
          actualStartDateTime: null,
          actualEndDateTime: null,
          updatedById: userId,
        },
      });

      await tx.jobAllocation.updateMany({
        where: { scheduledJobId: id, deletedAt: null, isActive: true },
        data: { actualStartDateTime: null, actualEndDateTime: null },
      });

      await tx.visitCareConsent.deleteMany({ where: { scheduledJobId: id } });
      await tx.scheduledVisitTaskCompletion.deleteMany({ where: { scheduledJobId: id } });
      await tx.visitTimelineEvent.deleteMany({ where: { scheduledJobId: id } });
      await tx.visitAreaLock.deleteMany({ where: { scheduledJobId: id } });
      await tx.visitCheckInMethodGrant.deleteMany({ where: { scheduledJobId: id } });
      await tx.ecmNotificationEvidence.deleteMany({ where: { scheduledJobId: id } });
      await tx.lateVisitAlertLog.deleteMany({ where: { scheduledJobId: id } });
      await tx.carerVisitPushReceipt.deleteMany({ where: { scheduledJobId: id } });
      await tx.ecmException.deleteMany({ where: { scheduledJobId: id } });
      // Clock-in/out + SOS live here (VisitAttendanceEventType.CARER_SOS), not
      // just in metadata — wipe them so nothing reappears after refresh.
      await tx.visitAttendanceEvent.deleteMany({ where: { scheduledJobId: id } });
      // Pay/charge outcome for this visit — safe to delete now the payroll /
      // invoice guard above has confirmed the visit is in no financial run.
      await tx.visitReconciliation.deleteMany({ where: { scheduledJobId: id } });
      await tx.ecmVisitEvaluation.updateMany({
        where: { scheduledJobId: id },
        data: {
          actualCheckInAt: null,
          actualCheckOutAt: null,
          actualDurationMinutes: null,
          startVarianceMinutes: null,
          endVarianceMinutes: null,
          durationVarianceMinutes: null,
        },
      });

      await tx.visitAction.updateMany({
        where: { scheduledJobId: id, deletedAt: null },
        data: { completedAt: null, completedById: null, status: null },
      });

      if (visitIds.length > 0) {
        await tx.medicationAdministrationEvent.deleteMany({
          where: { visitId: { in: visitIds } },
        });
      }

      const observations = await tx.serviceUserObservation.findMany({
        where: { serviceUserId: existing.serviceUserId, deletedAt: null },
        select: { id: true, payload: true },
      });
      const observationIds = observations
        .filter((row) => observationPayloadJobId(row.payload) === id)
        .map((row) => row.id);
      if (observationIds.length > 0) {
        // Hard delete — child readings cascade (onDelete: Cascade).
        await tx.serviceUserObservation.deleteMany({
          where: { id: { in: observationIds } },
        });
      }

      const bodyMapRows = await tx.bodyMapRecord.findMany({
        where: { serviceUserId: existing.serviceUserId },
        select: { id: true, observationDetails: true },
      });
      const bodyMapIds = bodyMapRows
        .filter((row) => jsonObject(row.observationDetails)?.scheduledJobId === id)
        .map((row) => row.id);
      if (bodyMapIds.length > 0) {
        // Hard delete the visit's body maps — markers, photos, wound/pressure
        // assessments, reviews, safeguarding checks and alerts all cascade
        // (onDelete: Cascade), so the visit returns to its initial state.
        await tx.bodyMapRecord.deleteMany({ where: { id: { in: bodyMapIds } } });
      }

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

      const metadata = applyVisitDeliveryResetMetadata(this.parseJobMetadata(existing.metadata), {
        resetAt: resetAtIso,
        reason,
        resetById: userId,
      });

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
        action: AuditAction.SCHEDULED_JOB_DELIVERY_RESET,
        recordType: 'ScheduledJob',
        recordId: id,
        oldValues: auditSnapshot({
          status: existing.status,
          visitStatuses: visits.map((visit) => visit.status),
        }),
        newValues: auditSnapshot({
          status: updated.status,
          deliveryResetAt: resetAtIso,
          reason,
        }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return {
        message: 'Visit reset to planned',
        data: this.mapDayJob(updated),
      };
    });

    await this.ecmEvaluation.evaluateJobSafe(id);
    return resetResult;
  }

  /**
   * Wipe one task completion (and linked this-visit MAR / obs) so the carer
   * sees that task at its initial state. Clock-in and other tasks stay.
   */
  async resetJobTask(
    user: RequestUser,
    jobId: string,
    assignmentKey: string,
    dto: ResetJobTaskDto,
    meta?: RequestAuditMeta,
  ) {
    const userId = user.id;
    await this.orgScope.assertScheduledJobInScope(this.orgScope.fromRequestUser(user), jobId);
    const parsed = parseVisitTaskAssignmentKey(assignmentKey);
    if (!parsed.stampKey || (parsed.kind === 'planned' && !parsed.assignmentId) || (parsed.kind === 'extra' && !parsed.taskCatalogueTaskId)) {
      throw new BadRequestException('Task id is required');
    }

    const existing = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null, isActive: true },
      include: housekeepingInclude,
    });
    if (!existing) throw new NotFoundException('Scheduled job not found');
    if (
      existing.status === PrismaJobStatus.CANCELLED ||
      existing.status === PrismaJobStatus.CALLED_OFF
    ) {
      throw new BadRequestException('Reinstate a cancelled visit before resetting a task');
    }

    const completion = parsed.kind === 'planned'
      ? await this.prisma.scheduledVisitTaskCompletion.findFirst({
          where: { scheduledJobId: jobId, assignmentId: parsed.assignmentId! },
        })
      : await this.prisma.scheduledVisitTaskCompletion.findFirst({
          where: {
            scheduledJobId: jobId,
            assignmentId: null,
            taskCatalogueTaskId: parsed.taskCatalogueTaskId!,
          },
        });
    if (!completion || !taskCompletionHasDeliveryToReset(completion)) {
      throw new BadRequestException('This task has nothing to reset');
    }

    const catalogueTaskId = completion.taskCatalogueTaskId;
    const assignment = parsed.assignmentId
      ? await this.prisma.serviceUserVisitTaskAssignment.findFirst({
          where: { id: parsed.assignmentId, deletedAt: null },
          include: { task: { include: { category: { include: { group: true } } } } },
        })
      : null;
    const catalogueTask = assignment
      ? assignment.task
      : catalogueTaskId
        ? await this.prisma.taskCatalogueTask.findFirst({
            where: { id: catalogueTaskId, deletedAt: null },
            include: { category: { include: { group: true } } },
          })
        : null;
    if (!catalogueTask) throw new NotFoundException('Visit task not found');

    const flagsJson =
      catalogueTask.flagsJson && typeof catalogueTask.flagsJson === 'object'
        ? (catalogueTask.flagsJson as Record<string, unknown>)
        : null;
    const taskName = catalogueTask.name;
    const groupCode = catalogueTask.category?.group?.code ?? null;
    const wipeMar = isEmarMedicationPromptTask({ name: taskName, flagsJson });
    const obsLink = resolveTaskObsLink({ name: taskName, groupCode, flagsJson });
    const wipeBodyMap =
      catalogueFeedsBodyMap(flagsJson) || obsLink?.observationTypeCode === 'BODY_MAP';

    const reason = dto.reason.trim();
    const resetAt = new Date();
    const resetAtIso = resetAt.toISOString();
    const visitIds = (existing.visits ?? []).map((visit) => visit.id);
    const timelineSourceIds = [parsed.stampKey, parsed.assignmentId, catalogueTaskId].filter(
      (value): value is string => Boolean(value),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.scheduledVisitTaskCompletion.delete({ where: { id: completion.id } });

      if (timelineSourceIds.length > 0) {
        await tx.visitTimelineEvent.deleteMany({
          where: {
            scheduledJobId: jobId,
            sourceType: 'task',
            sourceId: { in: timelineSourceIds },
          },
        });
      }

      if (wipeMar && visitIds.length > 0) {
        await tx.medicationAdministrationEvent.updateMany({
          where: { visitId: { in: visitIds }, deletedAt: null },
          data: { deletedAt: resetAt, isActive: false, deletedById: userId },
        });
      }

      if (obsLink) {
        const type = await tx.observationType.findFirst({
          where: { code: obsLink.observationTypeCode, isActive: true },
          select: { id: true },
        });
        if (type) {
          const observations = await tx.serviceUserObservation.findMany({
            where: {
              serviceUserId: existing.serviceUserId,
              observationTypeId: type.id,
              deletedAt: null,
            },
            select: { id: true, payload: true },
          });
          const observationIds = observations
            .filter((row) => observationPayloadJobId(row.payload) === jobId)
            .map((row) => row.id);
          if (observationIds.length > 0) {
            await tx.serviceUserObservation.updateMany({
              where: { id: { in: observationIds } },
              data: { deletedAt: resetAt, isActive: false, deletedById: userId },
            });
          }
        }
      }

      if (wipeBodyMap) {
        const bodyMapRows = await tx.bodyMapRecord.findMany({
          where: { serviceUserId: existing.serviceUserId },
          select: { id: true, observationDetails: true },
        });
        for (const row of bodyMapRows) {
          const details = jsonObject(row.observationDetails);
          if (!details || details.scheduledJobId !== jobId) continue;
          const next = { ...details };
          delete next.scheduledJobId;
          delete next.scheduledVisitId;
          await tx.bodyMapRecord.update({
            where: { id: row.id },
            data: { observationDetails: next as Prisma.InputJsonValue, updatedById: userId },
          });
        }
      }

      const metadata = applyVisitTaskResetMetadata(this.parseJobMetadata(existing.metadata), {
        assignmentId: parsed.stampKey,
        resetAt: resetAtIso,
        reason,
        resetById: userId,
      });
      await tx.scheduledJob.update({
        where: { id: jobId },
        data: {
          metadata: metadata as Prisma.InputJsonValue,
          updatedById: userId,
        },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_JOB_TASK_RESET,
        recordType: 'ScheduledVisitTaskCompletion',
        recordId: completion.id,
        oldValues: auditSnapshot({
          assignmentId: parsed.stampKey,
          taskName,
          isCompleted: completion.isCompleted,
        }),
        newValues: auditSnapshot({
          assignmentId: parsed.stampKey,
          taskResetAt: resetAtIso,
          reason,
          wipedMar: wipeMar,
          wipedObservationType: obsLink?.observationTypeCode ?? null,
        }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    });

    return this.getVisitJobTasks(user, jobId, meta);
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
            actualEndDateTime: true,
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
      until: primaryVisit?.actualEndDateTime ?? null,
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

  /**
   * Planned tasks placed on this visit: each task goes to the one visit of the client's day
   * that covers its due time, else the nearest visit (flagged). Also returns the visit window.
   */
  private async resolveJobTaskPlacement(job: {
    id: string;
    serviceUserId: string;
    scheduledStartDateTime: Date;
    scheduledEndDateTime: Date | null;
    visits: Array<{ scheduledStartDateTime: Date; scheduledEndDateTime: Date | null }>;
  }) {
    const visit = job.visits[0];
    const start = visit?.scheduledStartDateTime ?? job.scheduledStartDateTime;
    const end = visit?.scheduledEndDateTime ?? job.scheduledEndDateTime ?? null;
    const timeZone = await loadOperationalTimeZone(this.prisma);
    const { byJob } = await loadVisitTaskPlacement(
      this.prisma,
      [{ id: job.id, serviceUserId: job.serviceUserId, start, end }],
      timeZone,
    );
    const placements = byJob.get(job.id) ?? [];
    return {
      window: visitHmWindow(start, end, timeZone),
      placementById: new Map(placements.map((p) => [p.assignmentId, p])),
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
    const { window: taskWindow, placementById } = await this.resolveJobTaskPlacement(job);

    const round = medicationRoundCode
      ? await this.prisma.medicationAdministrationRound.findFirst({
          where: { code: medicationRoundCode, deletedAt: null, isActive: true },
          select: { name: true, code: true, windowStart: true, windowEnd: true },
        })
      : null;

    // Ensure carers see Medication prompt even if planner was never opened.
    await syncEmarMedicationPromptsForServiceUser(
      this.prisma,
      job.serviceUserId,
      userId || null,
    );

    const [allAssignments, completions] = await Promise.all([
      this.prisma.serviceUserVisitTaskAssignment.findMany({
        where: {
          serviceUserId: job.serviceUserId,
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

    // Tasks attach by clock time (covering visit, else nearest); keep any already recorded here.
    const assignments = allAssignments.filter(
      (a) => placementById.has(a.id) || completionByAssignment.has(a.id),
    );

    // Org-local calendar day of the visit (label at UTC midnight) for weekday task rules.
    const visitDay = utcDayBounds(
      dayKeyInTimeZone(job.scheduledStartDateTime, await this.orgSettings.getOperationalTimezone()),
    ).start;
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

    // Placement carries the time used for this visit (the dose time for the eMAR prompt);
    // fall back to the planner time only for tasks kept because they were already recorded here.
    const dueTimeOf = (assignment: (typeof dueAssignments)[number]) => {
      const placed = placementById.get(assignment.id);
      if (placed) return placed.dueTime;
      if (isEmarMedicationPromptTask({ name: assignment.task.name, flagsJson: assignment.task.flagsJson })) {
        return null;
      }
      return assignment.dueTime ?? null;
    };
    // Same order a carer works through the visit: by due time, then planner order.
    const orderedAssignments = [...dueAssignments].sort((a, b) =>
      (dueTimeOf(a) ?? '99:99').localeCompare(dueTimeOf(b) ?? '99:99'),
    );

    const plannedTasks = orderedAssignments.map((assignment) => {
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
        bodyMapRequired: Boolean(assignment.bodyMapRequired),
        priority,
        dueTime: dueTimeOf(assignment),
        /** No visit covers the due time — task moved to this (nearest) visit of the day. */
        placedAtNearestVisit: Boolean(placementById.get(assignment.id)?.nearest),
        /** This visit was cancelled / called off — the task stays here as not done (not moved). */
        visitCancelled: isCancelledJobStatus(job.status) && !completion?.isCompleted,
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
          bodyMapRequired: catalogueFeedsBodyMap(flagsJson),
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
        /** Cancelled / called-off visit: its tasks are listed as not done, not moved elsewhere. */
        visitCancelled: isCancelledJobStatus(job.status),
        roundLabel: round?.name ?? medicationRoundCode,
        // Tasks are picked by the visit's own clock window (same as medicines).
        windowStart: taskWindow?.startHm ?? round?.windowStart ?? null,
        windowEnd: taskWindow?.endHm ?? round?.windowEnd ?? null,
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
    if (assignments.length > 0) {
      // A planned task belongs to this visit when its due time is in the visit window
      // (or it was already recorded on this visit before a time change).
      const { placementById } = await this.resolveJobTaskPlacement(job);
      const recorded = new Set(
        (
          await this.prisma.scheduledVisitTaskCompletion.findMany({
            where: { scheduledJobId: job.id, assignmentId: { in: assignmentIds } },
            select: { assignmentId: true },
          })
        ).map((row) => row.assignmentId),
      );
      const outside = assignments.filter((a) => !recorded.has(a.id) && !placementById.has(a.id));
      if (outside.length > 0) {
        throw new BadRequestException('One or more visit tasks are not due in this visit time');
      }
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
        throw new BadRequestException('Extra task is already planned for this visit');
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
            medicationRoundCode: medicationRoundCode ?? assignment.medicationRoundCode,
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
              medicationRoundCode: medicationRoundCode ?? AD_HOC_TASK_ROUND_CODE,
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

function incidentPhotosBySourceId(
  metadata: Record<string, unknown>,
): Map<string, Array<{ id: string; fileUrl: string; caption: string | null }>> {
  const map = new Map<string, Array<{ id: string; fileUrl: string; caption: string | null }>>();
  const employeeApp =
    typeof metadata.employeeApp === 'object' && metadata.employeeApp && !Array.isArray(metadata.employeeApp)
      ? (metadata.employeeApp as Record<string, unknown>)
      : {};
  const incidents = Array.isArray(employeeApp.incidents)
    ? (employeeApp.incidents as Array<Record<string, unknown>>)
    : [];
  for (const incident of incidents) {
    const id = String(incident.id ?? '').trim();
    if (!id) continue;
    const attachments = Array.isArray(incident.attachments)
      ? (incident.attachments as Array<Record<string, unknown>>)
      : [];
    const photos = attachments
      .map((a) => {
        const fileUrl = String(a.url ?? a.fileUrl ?? '').trim();
        const photoId = String(a.attachmentId ?? a.id ?? '').trim();
        if (!fileUrl) return null;
        return {
          id: photoId || fileUrl,
          fileUrl,
          caption: a.caption != null ? String(a.caption) : null,
        };
      })
      .filter((p): p is { id: string; fileUrl: string; caption: string | null } => p != null);
    if (photos.length) map.set(id, photos);
  }
  return map;
}

function jsonObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function observationPayloadJobId(raw: unknown): string | null {
  const payload = jsonObject(raw);
  const jobId = payload?.scheduledJobId;
  return typeof jobId === 'string' && jobId.trim() ? jobId.trim() : null;
}
