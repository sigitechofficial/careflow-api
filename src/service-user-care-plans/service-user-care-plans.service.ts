import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CarePathwayFormType,
  CarePlanVisitTaskLinkStatus,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
  ReviewReminderSubject,
  ServiceUserCarePlanDraftApprovalStatus as ApprovalStatus,
  ServiceUserCarePlanInstanceStatus,
  ServiceUserCarePlanLifecycleStatus as LifecycleStatus,
} from '@prisma/client';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { InitialAssessmentCarePlanRulesService } from '../initial-assessments/initial-assessment-care-plan-rules.service';
import { readCarePlanDecisions } from '../initial-assessments/initial-assessment-care-plan-decisions.util';
import { PrismaService } from '../prisma/prisma.service';
import { incidentServiceUserIds } from '../incidents/incident-care-plan-measure.util';
import {
  buildAcceptedDecisionOnPublish,
  mergeCarePlanDecisionsIntoMetadata,
  recommendationsMatchingPublishedForm,
} from './accept-ia-recommendation-on-publish.util';
import {
  ApproveCarePlanDto,
  CarePlanLifecycleReasonDto,
  PublishCarePlanDto,
  RequestCarePlanChangesDto,
  ResumeCarePlanDto,
} from './dto/save-care-plan-draft.dto';
import { carePlanApprovalTransitionError, carePlanDraftContentHash } from './care-plan-approval.util';
import { CarePlanCarerNotificationService } from './care-plan-carer-notification.service';
import type { SaveCarePlanDraftDto } from './dto/save-care-plan-draft.dto';
import {
  aggregatePublishedCarePlanReview,
  computeCarePlanReviewState,
  defaultNextReviewDate,
  ensureDraftValuesNextReviewDate,
  isoDateOnly,
  parseDraftNextReviewDate,
  resolvePublishedNextReviewDueAt,
  reviewGuidanceSummary,
} from './care-plan-review-schedule';
import {
  carePlanInstanceDisplayStatus,
  consumePublishedDraftWhere,
} from './care-plan-instance-display-status.util';
import { sanitizeCarePlanDraftValuesForSave } from './compose/care-plan-draft-sanitize.util';
import {
  COMPOSE_IA_LOAD_STATUSES,
  splitLatestAndPreviousAssessments,
} from './compose/compose-ia-eligibility.util';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  DEFAULT_REVIEW_SETTINGS,
  type ReviewSettings,
} from '../organisation-general-settings/review-settings.util';
import {
  claimReviewReminder,
  completeReviewReminder,
  releaseReviewReminder,
  resolveCareTeamUserIds,
  reviewReminderAlreadySent,
  reviewReminderKind,
} from '../review-reminders/review-reminders';

const instanceInclude = {
  draft: true,
  publishedVersions: {
    where: { supersededAt: null },
    orderBy: { versionNumber: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.ServiceUserCarePlanInstanceInclude;

type InstanceRow = Prisma.ServiceUserCarePlanInstanceGetPayload<{ include: typeof instanceInclude }>;

export type CarePlanReviewQueueStatusFilter = 'all' | 'overdue' | 'due_soon' | 'ok';

@Injectable()
export class ServiceUserCarePlansService {
  private readonly logger = new Logger(ServiceUserCarePlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly carePlanRules: InitialAssessmentCarePlanRulesService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly carerNotifications?: CarePlanCarerNotificationService,
    @Optional() private readonly orgSettings?: OrganisationGeneralSettingsService,
  ) {}

  private async ensureServiceUser(serviceUserId: string) {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true },
    });
    if (!su) throw new NotFoundException('Service user not found');
  }

  private async ensureCarePlanForm(formId: string) {
    const form = await this.prisma.carePathwayForm.findFirst({
      where: { id: formId, deletedAt: null, formType: CarePathwayFormType.CARE_PLAN },
      select: { id: true, name: true, currentVersionId: true, reviewFrequencyMonths: true, pictureUrl: true },
    });
    if (!form) throw new NotFoundException('Care plan form not found');
    return form;
  }

  private mapInstance(
    row: InstanceRow,
    form: { name?: string | null; reviewFrequencyMonths?: number | null } | null | undefined,
    dueSoonDays: number,
  ) {
    const latest = row.publishedVersions[0] ?? null;
    const displayStatus = carePlanInstanceDisplayStatus({
      hasDraft: Boolean(row.draft),
      hasPublishedVersion: latest != null,
    });

    const intervalMonths = form?.reviewFrequencyMonths ?? null;
    const review = computeCarePlanReviewState({
      nextReviewDueAt: row.nextReviewDueAt,
      lastReviewedAt: row.lastReviewedAt,
      intervalMonths,
      guidanceSummary: reviewGuidanceSummary(intervalMonths),
      dueSoonDays,
    });
    const defaultDue = defaultNextReviewDate(new Date(), intervalMonths);

    return {
      id: row.id,
      serviceUserId: row.serviceUserId,
      carePathwayFormId: row.carePathwayFormId,
      carePathwayFormVersionId: row.carePathwayFormVersionId,
      status: row.status,
      displayStatus,
      lifecycle: {
        status: row.lifecycleStatus,
        reason: row.lifecycleReason,
        changedAt: row.lifecycleChangedAt?.toISOString() ?? null,
        changedById: row.lifecycleChangedById,
      },
      nextReviewDueAt: row.nextReviewDueAt?.toISOString() ?? null,
      lastReviewedAt: row.lastReviewedAt?.toISOString() ?? null,
      lastReviewedById: row.lastReviewedById,
      reviewFrequencyMonths: intervalMonths,
      defaultNextReviewDate: defaultDue ? isoDateOnly(defaultDue) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      draft: row.draft
        ? {
            values: (row.draft.valuesJson as Record<string, string | boolean>) ?? {},
            composedFrom: (row.draft.composedFromJson as Record<string, unknown> | null) ?? null,
            gaps: row.draft.gapsJson ?? null,
            updatedAt: row.draft.updatedAt.toISOString(),
            updatedById: row.draft.updatedById,
            approval: {
              status: row.draft.approvalStatus,
              contentHash: row.draft.approvalContentHash,
              submittedAt: row.draft.submittedForApprovalAt?.toISOString() ?? null,
              submittedById: row.draft.submittedForApprovalById,
              decidedAt: row.draft.approvalDecidedAt?.toISOString() ?? null,
              decidedById: row.draft.approvalDecidedById,
              reason: row.draft.approvalReason,
            },
          }
        : null,
      latestPublishedVersion: latest
        ? {
            id: latest.id,
            versionNumber: latest.versionNumber,
            summary: latest.summary,
            publishedAt: latest.publishedAt.toISOString(),
            publishedById: latest.publishedById,
          }
        : null,
      review,
    };
  }

  private countBlockingGaps(gapsJson: unknown): number {
    if (!Array.isArray(gapsJson)) return 0;
    return gapsJson.filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        (item as { severity?: string }).severity === 'blocking',
    ).length;
  }

  async getOrCreateInstance(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
  ): Promise<InstanceRow> {
    await this.ensureServiceUser(serviceUserId);
    await this.ensureCarePlanForm(carePathwayFormId);

    const existing = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: {
        serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId },
      },
      include: instanceInclude,
    });
    if (existing) return existing;

    const created = await this.prisma.serviceUserCarePlanInstance.create({
      data: {
        serviceUserId,
        carePathwayFormId,
        createdById: userId,
        updatedById: userId,
      },
      include: instanceInclude,
    });
    return created;
  }

  async listInstances(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);

    const rows = await this.prisma.serviceUserCarePlanInstance.findMany({
      where: { serviceUserId },
      include: instanceInclude,
      orderBy: { updatedAt: 'desc' },
    });

    const formIds = [...new Set(rows.map((r) => r.carePathwayFormId))];
    const forms =
      formIds.length > 0
        ? await this.prisma.carePathwayForm.findMany({
            where: { id: { in: formIds }, deletedAt: null },
            select: { id: true, name: true, pictureUrl: true, reviewFrequencyMonths: true },
          })
        : [];
    const formById = new Map(forms.map((f) => [f.id, f]));
    const { carePlanDueSoonDays } = await this.reviewSettings();
    const data = rows.map((row) => ({
      ...this.mapInstance(row, formById.get(row.carePathwayFormId) ?? null, carePlanDueSoonDays),
      formName: formById.get(row.carePathwayFormId)?.name ?? null,
      pictureUrl: formById.get(row.carePathwayFormId)?.pictureUrl ?? null,
    }));
    const publishedReviews = data
      .filter(
        (row) =>
          row.status === ServiceUserCarePlanInstanceStatus.PUBLISHED &&
          row.lifecycle.status === LifecycleStatus.ACTIVE,
      )
      .map((row) => row.review);

    return {
      data,
      meta: aggregatePublishedCarePlanReview(publishedReviews),
    };
  }

  async getInstance(serviceUserId: string, carePathwayFormId: string) {
    await this.ensureServiceUser(serviceUserId);
    await this.ensureCarePlanForm(carePathwayFormId);

    const row = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: {
        serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId },
      },
      include: instanceInclude,
    });

    if (!row) {
      return { data: null };
    }

    const form = await this.prisma.carePathwayForm.findFirst({
      where: { id: carePathwayFormId, deletedAt: null },
      select: { id: true, name: true, pictureUrl: true, reviewFrequencyMonths: true },
    });

    return {
      data: {
        ...this.mapInstance(row, form, (await this.reviewSettings()).carePlanDueSoonDays),
        formName: form?.name ?? null,
        pictureUrl: form?.pictureUrl ?? null,
        carePlanApprovalRequired: await this.isCarePlanApprovalRequired(),
        reassessmentReview: await this.openReassessmentReview(row.id),
      },
    };
  }

  /** Open reassessment review flags and risk links needing review for one plan. */
  private async openReassessmentReview(instanceId: string) {
    const [flags, riskLinksNeedingReview] = await Promise.all([
      this.prisma.carePlanReassessmentFlag.findMany({
        where: { carePlanInstanceId: instanceId, status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, changeTypes: true, reason: true, triggeringSubmissionId: true, createdAt: true },
      }),
      this.prisma.carePlanRiskLink.count({ where: { carePlanInstanceId: instanceId, status: 'REVIEW_REQUIRED' } }),
    ]);
    return {
      required: flags.length > 0 || riskLinksNeedingReview > 0,
      riskLinksNeedingReview,
      flags: flags.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() })),
    };
  }

  /** Organisation setting; off (the original publish flow) when not configured. */
  async isCarePlanApprovalRequired(): Promise<boolean> {
    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      select: { carePlanApprovalRequired: true },
    });
    return settings?.carePlanApprovalRequired === true;
  }

  async saveDraft(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    dto: SaveCarePlanDraftDto,
    meta?: RequestAuditMeta,
  ) {
    const form = await this.ensureCarePlanForm(carePathwayFormId);
    const instance = await this.getOrCreateInstance(userId, serviceUserId, carePathwayFormId);

    const sanitized = sanitizeCarePlanDraftValuesForSave(form.name, dto.values) as Record<
      string,
      unknown
    >;
    const valuesWithReview = ensureDraftValuesNextReviewDate(sanitized, {
      existingNextReviewDueAt: instance.nextReviewDueAt,
      reviewFrequencyMonths: form.reviewFrequencyMonths,
      from: new Date(),
    });
    const valuesJson = valuesWithReview as Prisma.InputJsonValue;
    const composedFromJson = dto.composedFrom
      ? (dto.composedFrom as Prisma.InputJsonValue)
      : undefined;
    const gapsJson = dto.gaps ? (dto.gaps as Prisma.InputJsonValue) : undefined;

    this.assertNotArchived(instance);
    const approvalState = instance.draft?.approvalStatus ?? ApprovalStatus.DRAFT;
    if (approvalState === ApprovalStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        'This care plan is awaiting approval and cannot be edited until a manager approves it or requests changes.',
      );
    }
    // Changing an approved draft withdraws the approval: the new content needs its own review.
    // Re-saving identical content keeps it.
    const invalidatesApproval =
      approvalState === ApprovalStatus.APPROVED &&
      carePlanDraftContentHash(valuesWithReview) !== instance.draft?.approvalContentHash;

    await this.prisma.$transaction([
      this.prisma.serviceUserCarePlanInstance.update({
        where: { id: instance.id },
        data: { updatedById: userId },
      }),
      this.prisma.serviceUserCarePlanDraft.upsert({
        where: { instanceId: instance.id },
        create: {
          instanceId: instance.id,
          valuesJson,
          composedFromJson,
          gapsJson,
          updatedById: userId,
        },
        update: {
          valuesJson,
          ...(composedFromJson !== undefined ? { composedFromJson } : {}),
          ...(gapsJson !== undefined ? { gapsJson } : {}),
          updatedById: userId,
          ...(invalidatesApproval
            ? {
                approvalStatus: ApprovalStatus.DRAFT,
                approvalContentHash: null,
                approvalDecidedAt: null,
                approvalDecidedById: null,
              }
            : {}),
        },
      }),
    ]);

    if (invalidatesApproval && instance.draft) {
      await this.audit.logAudit({
        userId,
        module: AuditModule.CARE_PLAN,
        action: AuditAction.CARE_PLAN_APPROVAL_INVALIDATED,
        recordType: 'ServiceUserCarePlanDraft',
        recordId: instance.draft.id,
        oldValues: {
          status: ApprovalStatus.APPROVED,
          contentHash: instance.draft.approvalContentHash,
          approvedById: instance.draft.approvalDecidedById,
        },
        newValues: { status: ApprovalStatus.DRAFT, reason: 'Draft edited after approval' },
        metadata: { serviceUserId, carePathwayFormId, instanceId: instance.id, draftId: instance.draft.id },
        ...meta,
      });
    }

    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PLAN,
      action: AuditAction.CARE_PLAN_DRAFT_SAVED,
      recordType: 'ServiceUserCarePlanInstance',
      recordId: instance.id,
      newValues: auditSnapshot({
        carePathwayFormId,
        fieldCount: Object.keys(dto.values).length,
      }),
      metadata: { serviceUserId, carePathwayFormId, instanceId: instance.id },
      ...meta,
    });

    return this.getInstance(serviceUserId, carePathwayFormId);
  }

  /** Author submits the working draft for manager approval; the content is fingerprinted and locked. */
  async submitForApproval(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    meta?: RequestAuditMeta,
  ) {
    const draft = await this.loadDraftForApproval(serviceUserId, carePathwayFormId);
    const owner = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: { id: draft.instanceId },
      select: { lifecycleStatus: true },
    });
    if (owner) this.assertNotArchived(owner);
    const error = carePlanApprovalTransitionError(draft.approvalStatus, 'submit');
    if (error) throw new BadRequestException(error);
    const values = draft.valuesJson as Record<string, unknown> | null;
    if (!values || typeof values !== 'object' || Object.keys(values).length === 0) {
      throw new BadRequestException('Care plan draft has no values to submit.');
    }
    const contentHash = carePlanDraftContentHash(values);
    await this.applyApprovalChange(draft, {
      userId,
      serviceUserId,
      carePathwayFormId,
      meta,
      action: AuditAction.CARE_PLAN_SUBMITTED_FOR_APPROVAL,
      next: ApprovalStatus.PENDING_APPROVAL,
      data: {
        approvalContentHash: contentHash,
        submittedForApprovalAt: new Date(),
        submittedForApprovalById: userId,
        approvalDecidedAt: null,
        approvalDecidedById: null,
        approvalReason: null,
      },
    });
    return this.getInstance(serviceUserId, carePathwayFormId);
  }

  /**
   * Manager approves the submitted draft. The approver cannot be the submitter, and must confirm the
   * content hash they reviewed, which must still match the draft.
   */
  async approveDraft(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    dto: ApproveCarePlanDto,
    meta?: RequestAuditMeta,
  ) {
    const draft = await this.loadDraftForApproval(serviceUserId, carePathwayFormId);
    const error = carePlanApprovalTransitionError(draft.approvalStatus, 'approve');
    if (error) throw new BadRequestException(error);
    if (draft.submittedForApprovalById === userId) {
      throw new ForbiddenException('You cannot approve a care plan you submitted. Another manager must approve it.');
    }
    const currentHash = carePlanDraftContentHash(draft.valuesJson);
    if (currentHash !== draft.approvalContentHash || dto.contentHash !== draft.approvalContentHash) {
      throw new ConflictException('The care plan changed since it was submitted. Reload it and review again.');
    }
    await this.applyApprovalChange(draft, {
      userId,
      serviceUserId,
      carePathwayFormId,
      meta,
      action: AuditAction.CARE_PLAN_APPROVED,
      next: ApprovalStatus.APPROVED,
      data: { approvalDecidedAt: new Date(), approvalDecidedById: userId, approvalReason: null },
    });
    return this.getInstance(serviceUserId, carePathwayFormId);
  }

  /** Manager returns the submitted draft to the author with a reason; the content is kept. */
  async requestDraftChanges(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    dto: RequestCarePlanChangesDto,
    meta?: RequestAuditMeta,
  ) {
    const draft = await this.loadDraftForApproval(serviceUserId, carePathwayFormId);
    const error = carePlanApprovalTransitionError(draft.approvalStatus, 'request_changes');
    if (error) throw new BadRequestException(error);
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 3) {
      throw new BadRequestException('A reason is required when requesting changes (min 3 characters)');
    }
    await this.applyApprovalChange(draft, {
      userId,
      serviceUserId,
      carePathwayFormId,
      meta,
      action: AuditAction.CARE_PLAN_CHANGES_REQUESTED,
      next: ApprovalStatus.DRAFT,
      reason,
      data: { approvalDecidedAt: new Date(), approvalDecidedById: userId, approvalReason: reason },
    });
    return this.getInstance(serviceUserId, carePathwayFormId);
  }

  private async loadDraftForApproval(serviceUserId: string, carePathwayFormId: string) {
    await this.ensureServiceUser(serviceUserId);
    await this.ensureCarePlanForm(carePathwayFormId);
    const instance = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: { serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId } },
      select: { id: true, draft: true },
    });
    if (!instance?.draft) {
      throw new BadRequestException('Save a draft before submitting it for approval.');
    }
    return instance.draft;
  }

  /**
   * Moves the draft to its next approval state only if nobody changed it meanwhile (same status and
   * updatedAt), and records the change in the audit log in the same transaction.
   */
  private async applyApprovalChange(
    draft: Prisma.ServiceUserCarePlanDraftGetPayload<object>,
    input: {
      userId: string;
      serviceUserId: string;
      carePathwayFormId: string;
      meta?: RequestAuditMeta;
      action: AuditAction;
      next: ApprovalStatus;
      reason?: string;
      data: Prisma.ServiceUserCarePlanDraftUpdateManyMutationInput;
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.serviceUserCarePlanDraft.updateMany({
        where: { id: draft.id, approvalStatus: draft.approvalStatus, updatedAt: draft.updatedAt },
        data: { ...input.data, approvalStatus: input.next },
      });
      if (changed.count !== 1) {
        throw new ConflictException('The care plan changed while you were working. Reload it and try again.');
      }
      const after = await tx.serviceUserCarePlanDraft.findUniqueOrThrow({ where: { id: draft.id } });
      await this.audit.logAudit({
        tx,
        userId: input.userId,
        module: AuditModule.CARE_PLAN,
        action: input.action,
        recordType: 'ServiceUserCarePlanDraft',
        recordId: draft.id,
        oldValues: { status: draft.approvalStatus, contentHash: draft.approvalContentHash },
        newValues: {
          status: after.approvalStatus,
          contentHash: after.approvalContentHash,
          submittedById: after.submittedForApprovalById,
          submittedAt: after.submittedForApprovalAt?.toISOString() ?? null,
          reviewedById: after.approvalDecidedById,
          reviewedAt: after.approvalDecidedAt?.toISOString() ?? null,
          reason: input.reason ?? null,
        },
        metadata: {
          serviceUserId: input.serviceUserId,
          carePathwayFormId: input.carePathwayFormId,
          instanceId: draft.instanceId,
          draftId: draft.id,
        },
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      });
    });
  }

  /** Takes an active published plan out of carers' current instructions. Its versions are kept. */
  async suspend(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    dto: CarePlanLifecycleReasonDto,
    meta?: RequestAuditMeta,
  ) {
    return this.changeLifecycle(userId, serviceUserId, carePathwayFormId, {
      from: [LifecycleStatus.ACTIVE],
      to: LifecycleStatus.SUSPENDED,
      reason: dto.reason,
      requirePublished: true,
      action: AuditAction.CARE_PLAN_SUSPENDED,
      meta,
    });
  }

  /**
   * Returns a suspended plan to carers. The manager must confirm it is still appropriate, and a plan
   * whose review is overdue must be reviewed (a new version published) first.
   */
  async resume(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    dto: ResumeCarePlanDto,
    meta?: RequestAuditMeta,
  ) {
    if (dto.reviewConfirmed !== true) {
      throw new BadRequestException('Confirm the care plan is still appropriate before resuming it.');
    }
    const result = await this.changeLifecycle(userId, serviceUserId, carePathwayFormId, {
      from: [LifecycleStatus.SUSPENDED],
      to: LifecycleStatus.ACTIVE,
      reason: dto.reason,
      requirePublished: true,
      rejectOverdueReview: true,
      action: AuditAction.CARE_PLAN_RESUMED,
      meta,
    });
    // Back in carers' instructions: carers not yet told about this version are notified.
    if (result.data?.id) await this.carerNotifications?.notifyCurrentVersion(result.data.id);
    return result;
  }

  /** Retires a plan for good: hidden from carers, kept with its full history. No un-archive here. */
  async archive(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    dto: CarePlanLifecycleReasonDto,
    meta?: RequestAuditMeta,
  ) {
    return this.changeLifecycle(userId, serviceUserId, carePathwayFormId, {
      from: [LifecycleStatus.ACTIVE, LifecycleStatus.SUSPENDED],
      to: LifecycleStatus.ARCHIVED,
      reason: dto.reason,
      requirePublished: false,
      action: AuditAction.CARE_PLAN_ARCHIVED,
      meta,
    });
  }

  private assertNotArchived(instance: { lifecycleStatus: LifecycleStatus }) {
    if (instance.lifecycleStatus === LifecycleStatus.ARCHIVED) {
      throw new BadRequestException(
        'This care plan is archived. Its history is kept, but it cannot be edited or published again.',
      );
    }
  }

  private async changeLifecycle(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    input: {
      from: LifecycleStatus[];
      to: LifecycleStatus;
      reason: string;
      requirePublished: boolean;
      rejectOverdueReview?: boolean;
      action: AuditAction;
      meta?: RequestAuditMeta;
    },
  ) {
    await this.ensureServiceUser(serviceUserId);
    await this.ensureCarePlanForm(carePathwayFormId);
    const reason = input.reason?.trim() ?? '';
    if (reason.length < 3) {
      throw new BadRequestException('A reason is required (min 3 characters)');
    }
    const instance = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: { serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId } },
      include: instanceInclude,
    });
    if (!instance) throw new NotFoundException('Care plan not found');
    const current = instance.publishedVersions[0] ?? null;
    if (input.requirePublished && (!current || instance.status !== ServiceUserCarePlanInstanceStatus.PUBLISHED)) {
      throw new BadRequestException('Only a published care plan can be suspended or resumed.');
    }
    if (!input.from.includes(instance.lifecycleStatus)) {
      throw new BadRequestException(
        `This care plan is ${instance.lifecycleStatus.toLowerCase()} and cannot be ${input.to === LifecycleStatus.ACTIVE ? 'resumed' : input.to.toLowerCase()}.`,
      );
    }
    if (input.rejectOverdueReview && instance.nextReviewDueAt && instance.nextReviewDueAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'This care plan is overdue for review. Review it and publish an updated version before resuming it.',
      );
    }

    const changedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Only from the state just checked, so two managers cannot both apply a change.
      const changed = await tx.serviceUserCarePlanInstance.updateMany({
        where: { id: instance.id, lifecycleStatus: instance.lifecycleStatus },
        data: {
          lifecycleStatus: input.to,
          lifecycleReason: reason,
          lifecycleChangedAt: changedAt,
          lifecycleChangedById: userId,
          updatedById: userId,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('The care plan changed while you were working. Reload it and try again.');
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PLAN,
        action: input.action,
        recordType: 'ServiceUserCarePlanInstance',
        recordId: instance.id,
        oldValues: {
          lifecycleStatus: instance.lifecycleStatus,
          reason: instance.lifecycleReason,
          changedAt: instance.lifecycleChangedAt?.toISOString() ?? null,
          changedById: instance.lifecycleChangedById,
        },
        newValues: {
          lifecycleStatus: input.to,
          reason,
          changedAt: changedAt.toISOString(),
          changedById: userId,
          publishedVersionId: current?.id ?? null,
          publishedVersionNumber: current?.versionNumber ?? null,
        },
        metadata: { serviceUserId, carePathwayFormId, instanceId: instance.id },
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      });
    });
    return this.getInstance(serviceUserId, carePathwayFormId);
  }

  async publish(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    dto: PublishCarePlanDto,
    meta?: RequestAuditMeta,
  ) {
    const form = await this.ensureCarePlanForm(carePathwayFormId);
    const instance = await this.getOrCreateInstance(userId, serviceUserId, carePathwayFormId);

    const draft = await this.prisma.serviceUserCarePlanDraft.findUnique({
      where: { instanceId: instance.id },
    });
    if (!draft) {
      throw new BadRequestException('Save a draft before publishing.');
    }

    const values = draft.valuesJson as Record<string, unknown>;
    if (!values || typeof values !== 'object' || Object.keys(values).length === 0) {
      throw new BadRequestException('Care plan draft has no values to publish.');
    }

    const approvalRequired = await this.isCarePlanApprovalRequired();
    if (approvalRequired) {
      const error = carePlanApprovalTransitionError(draft.approvalStatus, 'publish');
      if (error) throw new BadRequestException(error);
    }

    const blockingGapCount = this.countBlockingGaps(draft.gapsJson);
    if (blockingGapCount > 0 && !dto.gapAcknowledged) {
      throw new BadRequestException(
        `Acknowledge ${blockingGapCount} blocking gap(s) before publishing.`,
      );
    }

    const incidentMeasure = dto.incidentActionId
      ? await this.loadIncidentCarePlanMeasure(dto.incidentActionId, serviceUserId, instance.id)
      : null;

    this.assertNotArchived(instance);
    const publishedAt = new Date();
    const valuesForPublish = ensureDraftValuesNextReviewDate(
      values && typeof values === 'object' ? { ...values } : {},
      {
        existingNextReviewDueAt: instance.nextReviewDueAt,
        reviewFrequencyMonths: form.reviewFrequencyMonths,
        from: publishedAt,
      },
    );
    const nextReviewDueAt = resolvePublishedNextReviewDueAt({
      explicitDate: parseDraftNextReviewDate(valuesForPublish),
      existingNextReviewDueAt: instance.nextReviewDueAt,
      reviewFrequencyMonths: form.reviewFrequencyMonths,
      from: publishedAt,
    });

    let flaggedTaskLinks = 0;
    const version = await this.prisma.$transaction(async (tx) => {
      // One publish at a time per plan: concurrent or repeated requests wait here, then find the
      // draft already consumed instead of creating a second version.
      await tx.$queryRaw`SELECT "id" FROM "service_users"."ServiceUserCarePlanInstance" WHERE "id" = ${instance.id}::uuid FOR UPDATE`;
      const currentDraft = await tx.serviceUserCarePlanDraft.findUnique({
        where: { id: draft.id },
      });
      if (!currentDraft) {
        throw new ConflictException('This draft has already been published. Reload the care plan.');
      }
      const latestVersion = await tx.serviceUserCarePlanPublishedVersion.findFirst({
        where: { instanceId: instance.id },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;

      const currentValues = currentDraft.valuesJson as Record<string, unknown>;
      if (!currentValues || typeof currentValues !== 'object' || Object.keys(currentValues).length === 0) {
        throw new BadRequestException('Care plan draft has no values to publish.');
      }

      // Re-check inside the transaction: the approval must cover exactly the content being published.
      const approved =
        currentDraft.approvalStatus === ApprovalStatus.APPROVED &&
        currentDraft.approvalContentHash === carePlanDraftContentHash(currentValues);
      if (approvalRequired && !approved) {
        throw new ConflictException(
          'The care plan changed after it was approved. Submit it for approval again before publishing.',
        );
      }

      const publishedValues = ensureDraftValuesNextReviewDate(
        { ...currentValues },
        {
          existingNextReviewDueAt: instance.nextReviewDueAt,
          reviewFrequencyMonths: form.reviewFrequencyMonths,
          from: publishedAt,
        },
      );

      await tx.serviceUserCarePlanPublishedVersion.updateMany({
        where: { instanceId: instance.id, supersededAt: null },
        data: { supersededAt: new Date() },
      });

      const created = await tx.serviceUserCarePlanPublishedVersion.create({
        data: {
          instanceId: instance.id,
          versionNumber,
          valuesJson: publishedValues as Prisma.InputJsonValue,
          composedFromJson: currentDraft.composedFromJson ?? undefined,
          summary: dto.summary?.trim() || null,
          signaturesJson: dto.signatures
            ? (dto.signatures as Prisma.InputJsonValue)
            : undefined,
          publishedById: userId,
          incidentActionId: incidentMeasure?.id ?? null,
          approvalJson: approved
            ? ({
                contentHash: currentDraft.approvalContentHash,
                submittedById: currentDraft.submittedForApprovalById,
                submittedAt: currentDraft.submittedForApprovalAt?.toISOString() ?? null,
                approvedById: currentDraft.approvalDecidedById,
                approvedAt: currentDraft.approvalDecidedAt?.toISOString() ?? null,
                draftId: currentDraft.id,
              } satisfies Prisma.InputJsonValue)
            : undefined,
        },
      });

      await tx.serviceUserCarePlanInstance.update({
        where: { id: instance.id },
        data: {
          status: ServiceUserCarePlanInstanceStatus.PUBLISHED,
          carePathwayFormVersionId: instance.carePathwayFormVersionId ?? form.currentVersionId,
          updatedById: userId,
          lastReviewedAt: publishedAt,
          lastReviewedById: userId,
          nextReviewDueAt,
        },
      });

      // Consumes the draft (and with it any approval). If it changed meanwhile, publish nothing.
      const consumed = await tx.serviceUserCarePlanDraft.deleteMany({
        where: consumePublishedDraftWhere(currentDraft),
      });
      if (consumed.count !== 1) {
        throw new ConflictException('The draft changed while publishing. Reload the care plan and try again.');
      }

      // Visit task links confirmed against an earlier version need a manager to re-check them.
      // They keep their old version reference; no task is changed.
      const flagged = await tx.carePlanVisitTaskLink.updateMany({
        where: {
          carePlanInstanceId: instance.id,
          status: { in: [CarePlanVisitTaskLinkStatus.LINKED, CarePlanVisitTaskLinkStatus.NOT_APPLICABLE] },
        },
        data: { status: CarePlanVisitTaskLinkStatus.REVIEW_REQUIRED },
      });
      flaggedTaskLinks = flagged.count;

      return created;
    });
    const versionNumber = version.versionNumber;

    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PLAN,
      action: AuditAction.CARE_PLAN_PUBLISHED,
      recordType: 'ServiceUserCarePlanPublishedVersion',
      recordId: version.id,
      newValues: auditSnapshot({
        carePathwayFormId,
        versionNumber,
        summary: dto.summary ?? null,
        approval: version.approvalJson ?? null,
      }),
      metadata: {
        serviceUserId,
        carePathwayFormId,
        instanceId: instance.id,
        versionNumber,
      },
      ...meta,
    });

    if (flaggedTaskLinks > 0) {
      await this.audit.logAudit({
        userId,
        module: AuditModule.CARE_PLAN,
        action: AuditAction.CARE_PLAN_TASK_LINKS_FLAGGED,
        recordType: 'ServiceUserCarePlanInstance',
        recordId: instance.id,
        newValues: { status: CarePlanVisitTaskLinkStatus.REVIEW_REQUIRED, count: flaggedTaskLinks, reason: 'New version published' },
        metadata: { serviceUserId, carePathwayFormId, instanceId: instance.id, publishedVersionId: version.id, versionNumber },
        ...meta,
      });
    }

    if (incidentMeasure) {
      // On the incident timeline next to the measure.
      await this.audit.logAudit({
        userId,
        module: AuditModule.INCIDENT,
        action: AuditAction.INCIDENT_UPDATED,
        recordType: 'IncidentActionChange',
        recordId: incidentMeasure.incidentId,
        description: `Care plan published for measure "${incidentMeasure.title}": ${form.name} version ${versionNumber}`,
        newValues: { incidentActionId: incidentMeasure.id, carePlanVersionId: version.id },
        ...meta,
      });
    }

    await this.acceptMatchingIaRecommendationsOnPublish({
      userId,
      serviceUserId,
      carePathwayFormId,
      carePathwayFormName: form.name,
      meta,
    });

    // After the version is committed: tell carers on upcoming visits. Never fails the publish.
    await this.carerNotifications?.notifyCurrentVersion(instance.id);

    return this.getInstance(serviceUserId, carePathwayFormId);
  }

  /**
   * Publishing from an incident's "Care plan update" measure: the measure must still be open, be
   * about this service user, and name this plan (or say a new plan is needed).
   */
  private async loadIncidentCarePlanMeasure(
    actionId: string,
    serviceUserId: string,
    instanceId: string,
  ) {
    const action = await this.prisma.incidentAction.findFirst({
      where: { id: actionId, deletedAt: null },
      select: {
        id: true,
        title: true,
        incidentId: true,
        measureType: true,
        status: true,
        newRecordNeeded: true,
        linkedRecords: true,
        incident: {
          select: {
            status: true,
            deletedAt: true,
            primaryServiceUserId: true,
            involvedServiceUserIds: true,
          },
        },
      },
    });
    if (!action || action.incident.deletedAt || action.measureType !== 'CARE_PLAN_UPDATE') {
      throw new BadRequestException('The incident care plan measure was not found');
    }
    if (action.incident.status === 'CLOSED') {
      throw new BadRequestException('The incident is closed — publish without linking it');
    }
    if (action.status === 'COMPLETED' || action.status === 'CANCELLED') {
      throw new BadRequestException('That incident measure is already completed or cancelled');
    }
    if (!incidentServiceUserIds(action.incident).includes(serviceUserId)) {
      throw new BadRequestException('That incident measure is about a different service user');
    }
    const named = Array.isArray(action.linkedRecords)
      ? action.linkedRecords.some(
          (r) => r && typeof r === 'object' && (r as { id?: unknown }).id === instanceId,
        )
      : false;
    if (!named && !action.newRecordNeeded) {
      throw new BadRequestException('That incident measure is about a different care plan');
    }
    return action;
  }

  /**
   * Publishing a care plan created from an IA recommendation must mark that
   * recommendation accepted (same metadata shape as decideCarePlanRecommendation).
   * Otherwise Recommended Care Plans keeps showing pending cards.
   */
  private async acceptMatchingIaRecommendationsOnPublish(input: {
    userId: string;
    serviceUserId: string;
    carePathwayFormId: string;
    carePathwayFormName: string;
    meta?: RequestAuditMeta;
  }) {
    const submissions = await this.prisma.initialAssessmentSubmission.findMany({
      where: {
        serviceUserId: input.serviceUserId,
        deletedAt: null,
        status: { in: COMPOSE_IA_LOAD_STATUSES },
      },
      select: { id: true, metadata: true, submittedAt: true, updatedAt: true, status: true },
    });
    const { latest: submission } = splitLatestAndPreviousAssessments(submissions);
    if (!submission) return;

    const recommendations = await this.carePlanRules.loadRecommendations(submission.id);
    const existingDecisions = readCarePlanDecisions(submission.metadata);
    const catalogue = await this.prisma.carePathwayForm.findMany({
      where: { formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
      select: { id: true, name: true },
    });

    const matches = recommendationsMatchingPublishedForm(
      recommendations,
      input.carePathwayFormId,
      input.carePathwayFormName,
      catalogue,
      existingDecisions,
    );
    if (matches.length === 0) return;

    const decidedAtIso = new Date().toISOString();
    const additions = Object.fromEntries(
      matches.map((recommendation) => [
        recommendation.id,
        buildAcceptedDecisionOnPublish({
          userId: input.userId,
          decidedAtIso,
          carePathwayFormId: input.carePathwayFormId,
          carePathwayFormName: input.carePathwayFormName,
          recommendation,
        }),
      ]),
    );

    const nextMetadata = mergeCarePlanDecisionsIntoMetadata(
      submission.metadata,
      additions,
    ) as Prisma.InputJsonValue;

    await this.prisma.$transaction(async (tx) => {
      await tx.initialAssessmentSubmission.update({
        where: { id: submission.id },
        data: { metadata: nextMetadata, updatedById: input.userId },
      });

      for (const recommendation of matches) {
        await this.audit.logAudit({
          tx,
          userId: input.userId,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.INITIAL_ASSESSMENT_CARE_PLAN_DECISION,
          recordType: 'InitialAssessmentSubmission',
          recordId: submission.id,
          newValues: {
            recommendationId: recommendation.id,
            carePlanArea: recommendation.carePlanArea,
            decision: 'accepted',
            reason: null,
            source: 'care_plan_publish',
          },
          metadata: {
            serviceUserId: input.serviceUserId,
            submissionId: submission.id,
            recommendationId: recommendation.id,
            carePathwayFormId: input.carePathwayFormId,
          },
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        });
      }
    });
  }

  async listVersions(serviceUserId: string, carePathwayFormId: string) {
    await this.ensureServiceUser(serviceUserId);
    const instance = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: {
        serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId },
      },
      select: { id: true },
    });
    if (!instance) {
      return { data: [] };
    }

    const rows = await this.prisma.serviceUserCarePlanPublishedVersion.findMany({
      where: { instanceId: instance.id },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        summary: true,
        publishedAt: true,
        publishedById: true,
        supersededAt: true,
        incidentActionId: true,
      },
    });

    // Versions made for an incident measure link back to it.
    const actionIds = rows.map((r) => r.incidentActionId).filter((v): v is string => !!v);
    const actions = actionIds.length
      ? await this.prisma.incidentAction.findMany({
          where: { id: { in: actionIds } },
          select: {
            id: true,
            title: true,
            incidentId: true,
            incident: { select: { referenceNumber: true } },
          },
        })
      : [];
    const actionById = new Map(actions.map((a) => [a.id, a]));

    return {
      data: rows.map((row) => {
        const action = row.incidentActionId ? actionById.get(row.incidentActionId) : undefined;
        return {
          id: row.id,
          versionNumber: row.versionNumber,
          summary: row.summary,
          publishedAt: row.publishedAt.toISOString(),
          publishedById: row.publishedById,
          supersededAt: row.supersededAt?.toISOString() ?? null,
          isCurrent: row.supersededAt == null,
          incident: action
            ? {
                incidentId: action.incidentId,
                referenceNumber: action.incident.referenceNumber,
                measureTitle: action.title,
              }
            : null,
        };
      }),
    };
  }

  async getVersion(serviceUserId: string, carePathwayFormId: string, versionId: string) {
    await this.ensureServiceUser(serviceUserId);
    const instance = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: {
        serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId },
      },
      select: { id: true },
    });
    if (!instance) throw new NotFoundException('Care plan instance not found');

    const version = await this.prisma.serviceUserCarePlanPublishedVersion.findFirst({
      where: { id: versionId, instanceId: instance.id },
    });
    if (!version) throw new NotFoundException('Published version not found');

    return {
      data: {
        id: version.id,
        instanceId: version.instanceId,
        versionNumber: version.versionNumber,
        values: (version.valuesJson as Record<string, string | boolean>) ?? {},
        composedFrom: (version.composedFromJson as Record<string, unknown> | null) ?? null,
        summary: version.summary,
        signatures: (version.signaturesJson as Record<string, unknown> | null) ?? null,
        publishedAt: version.publishedAt.toISOString(),
        publishedById: version.publishedById,
        supersededAt: version.supersededAt?.toISOString() ?? null,
      },
    };
  }

  async reviewQueue(
    params?: {
      status?: CarePlanReviewQueueStatusFilter;
      serviceUserId?: string;
      locationId?: string;
    },
    settings?: ReviewSettings,
    now: Date = new Date(),
  ) {
    const { carePlanDueSoonDays } = settings ?? (await this.reviewSettings());
    const rows = await this.prisma.serviceUserCarePlanInstance.findMany({
      where: {
        status: ServiceUserCarePlanInstanceStatus.PUBLISHED,
        // Suspended and archived plans are not active review items.
        lifecycleStatus: LifecycleStatus.ACTIVE,
        nextReviewDueAt: { not: null },
        ...(params?.serviceUserId ? { serviceUserId: params.serviceUserId } : {}),
        serviceUser: {
          deletedAt: null,
          isActive: true,
          ...(params?.locationId ? { locationId: params.locationId } : {}),
        },
      },
      select: {
        id: true,
        serviceUserId: true,
        carePathwayFormId: true,
        nextReviewDueAt: true,
        lastReviewedAt: true,
        serviceUser: { select: { firstName: true, lastName: true, preferredName: true } },
        carePathwayForm: { select: { name: true, reviewFrequencyMonths: true } },
      },
      orderBy: { nextReviewDueAt: 'asc' },
    });

    const items = rows.map((row) => {
      const intervalMonths = row.carePathwayForm.reviewFrequencyMonths;
      const review = computeCarePlanReviewState({
        nextReviewDueAt: row.nextReviewDueAt,
        lastReviewedAt: row.lastReviewedAt,
        intervalMonths,
        guidanceSummary: reviewGuidanceSummary(intervalMonths),
        dueSoonDays: carePlanDueSoonDays,
        now,
      });
      const preferred = row.serviceUser.preferredName?.trim();
      const serviceUserName =
        preferred ||
        [row.serviceUser.firstName, row.serviceUser.lastName].filter(Boolean).join(' ').trim() ||
        'Service user';
      return {
        instanceId: row.id,
        serviceUserId: row.serviceUserId,
        serviceUserName,
        carePathwayFormId: row.carePathwayFormId,
        carePlanName: row.carePathwayForm.name,
        nextReviewDueAt: row.nextReviewDueAt?.toISOString() ?? null,
        review,
      };
    });

    const filtered =
      !params?.status || params.status === 'all'
        ? items
        : items.filter((item) => item.review.status === params.status);

    const counts = {
      overdueCount: items.filter((item) => item.review.status === 'overdue').length,
      dueSoonCount: items.filter((item) => item.review.status === 'due_soon').length,
      upToDateCount: items.filter((item) => item.review.status === 'ok').length,
    };

    return {
      data: filtered,
      meta: {
        total: filtered.length,
        carePlanReviewRequired: counts.overdueCount > 0,
        ...counts,
      },
    };
  }

  async sendReviewReminders(params?: { triggeredByUserId?: string; dryRun?: boolean; now?: Date }) {
    const now = params?.now ?? new Date();
    const settings = await this.reviewSettings();
    const queue = await this.reviewQueue({ status: 'all' }, settings, now);
    const due = queue.data.filter(
      (item) => item.review.status === 'overdue' || item.review.status === 'due_soon',
    );
    let sent = 0;
    let skipped = 0;

    for (const item of due) {
      const dueDate = item.nextReviewDueAt ? new Date(item.nextReviewDueAt) : null;
      const kind = reviewReminderKind(item.review.status, dueDate, now, settings.reminderRepeatDays);
      if (!kind || !dueDate) {
        skipped += 1;
        continue;
      }
      const claim = {
        subjectType: ReviewReminderSubject.CARE_PLAN,
        subjectId: item.instanceId,
        serviceUserId: item.serviceUserId,
        dueDate,
        kind,
      };
      if (params?.dryRun) {
        if (await reviewReminderAlreadySent(this.prisma, claim)) skipped += 1;
        else sent += 1;
        continue;
      }
      if (!this.notifications) {
        skipped += 1;
        continue;
      }
      const recipientUserIds = await resolveCareTeamUserIds(this.prisma, item.serviceUserId);
      if (!recipientUserIds.length) {
        skipped += 1;
        continue;
      }
      const logId = await claimReviewReminder(this.prisma, claim);
      if (!logId) {
        skipped += 1;
        continue;
      }
      const statusLabel = item.review.status === 'overdue' ? 'overdue' : 'due soon';
      try {
        await this.notifications.notifyUsers({
          recipientUserIds,
          type: NotificationType.CARE_PLAN_REVIEW_DUE,
          title: `Care plan review ${statusLabel}: ${item.carePlanName}`,
          message: `${item.serviceUserName} — ${item.carePlanName} is ${statusLabel}. Open the care plan to complete the review.`,
          module: NotificationModule.SERVICE_CARE,
          severity:
            item.review.status === 'overdue'
              ? NotificationSeverity.WARNING
              : NotificationSeverity.INFO,
          recordType: 'ServiceUserCarePlanInstance',
          recordId: item.instanceId,
          metadata: {
            serviceUserId: item.serviceUserId,
            carePathwayFormId: item.carePathwayFormId,
            reviewStatus: item.review.status,
            nextReviewDueAt: item.nextReviewDueAt,
            reminderKind: kind,
          },
          createdById: params?.triggeredByUserId,
        });
        await completeReviewReminder(this.prisma, logId, recipientUserIds);
        sent += 1;
      } catch (err) {
        await releaseReviewReminder(this.prisma, logId);
        this.logger.warn(`Care plan review reminder failed: ${(err as Error).message}`);
        skipped += 1;
      }
    }

    return { data: { sent, skipped, due: due.length } };
  }

  /** Settings → Reviews & reminders (defaults when the settings service is not wired, e.g. in tests). */
  private async reviewSettings(): Promise<ReviewSettings> {
    return this.orgSettings ? this.orgSettings.getReviewSettings() : DEFAULT_REVIEW_SETTINGS;
  }
}
