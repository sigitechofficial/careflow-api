import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CarePathwayFormType,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
  ServiceUserCarePlanInstanceStatus,
} from '@prisma/client';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { InitialAssessmentCarePlanRulesService } from '../initial-assessments/initial-assessment-care-plan-rules.service';
import { readCarePlanDecisions } from '../initial-assessments/initial-assessment-care-plan-decisions.util';
import type { CarePlanTriggerItem } from '../initial-assessments/initial-assessment-care-plan.util';
import { isSecureQuestionMetadata } from '../initial-assessments/initial-assessment-secure-field.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildAcceptedDecisionOnPublish,
  mergeCarePlanDecisionsIntoMetadata,
  recommendationsMatchingPublishedForm,
} from './accept-ia-recommendation-on-publish.util';
import { PublishCarePlanDto } from './dto/save-care-plan-draft.dto';
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
    form?: { name?: string | null; reviewFrequencyMonths?: number | null } | null,
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
    });
    const defaultDue = defaultNextReviewDate(new Date(), intervalMonths);

    return {
      id: row.id,
      serviceUserId: row.serviceUserId,
      carePathwayFormId: row.carePathwayFormId,
      carePathwayFormVersionId: row.carePathwayFormVersionId,
      status: row.status,
      displayStatus,
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
    const data = rows.map((row) => ({
      ...this.mapInstance(row, formById.get(row.carePathwayFormId) ?? null),
      formName: formById.get(row.carePathwayFormId)?.name ?? null,
      pictureUrl: formById.get(row.carePathwayFormId)?.pictureUrl ?? null,
    }));
    const publishedReviews = data
      .filter((row) => row.status === ServiceUserCarePlanInstanceStatus.PUBLISHED)
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
        ...this.mapInstance(row, form),
        formName: form?.name ?? null,
        pictureUrl: form?.pictureUrl ?? null,
      },
    };
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
        },
      }),
    ]);

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

    const blockingGapCount = this.countBlockingGaps(draft.gapsJson);
    if (blockingGapCount > 0 && !dto.gapAcknowledged) {
      throw new BadRequestException(
        `Acknowledge ${blockingGapCount} blocking gap(s) before publishing.`,
      );
    }

    const latestVersion = await this.prisma.serviceUserCarePlanPublishedVersion.findFirst({
      where: { instanceId: instance.id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
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

    const version = await this.prisma.$transaction(async (tx) => {
      const currentDraft = await tx.serviceUserCarePlanDraft.findUnique({
        where: { id: draft.id },
      });
      if (!currentDraft) {
        throw new BadRequestException('Save a draft before publishing.');
      }

      const currentValues = currentDraft.valuesJson as Record<string, unknown>;
      if (!currentValues || typeof currentValues !== 'object' || Object.keys(currentValues).length === 0) {
        throw new BadRequestException('Care plan draft has no values to publish.');
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

      await tx.serviceUserCarePlanDraft.deleteMany({
        where: consumePublishedDraftWhere(currentDraft),
      });

      return created;
    });

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
      }),
      metadata: {
        serviceUserId,
        carePathwayFormId,
        instanceId: instance.id,
        versionNumber,
      },
      ...meta,
    });

    await this.acceptMatchingIaRecommendationsOnPublish({
      userId,
      serviceUserId,
      carePathwayFormId,
      carePathwayFormName: form.name,
      meta,
    });

    return this.getInstance(serviceUserId, carePathwayFormId);
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

    const triggerItems = await this.loadCarePlanTriggerItems(submission.id);
    const recommendations = await this.carePlanRules.resolveRecommendations(
      submission.id,
      triggerItems,
    );
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

  private async loadCarePlanTriggerItems(submissionId: string): Promise<CarePlanTriggerItem[]> {
    const answers = await this.prisma.initialAssessmentAnswer.findMany({
      where: { submissionId, carePlanTrigger: true },
      include: {
        question: {
          select: {
            id: true,
            questionText: true,
            metadata: true,
            section: {
              select: { id: true, title: true, sectionNumber: true, carePlanArea: true },
            },
          },
        },
      },
    });

    return answers
      .filter((a) => a.checked === true || a.booleanValue === true || Boolean(a.textValue?.trim()))
      .map((a) => {
        const meta = a.question.metadata;
        const specRef =
          meta &&
          typeof meta === 'object' &&
          !Array.isArray(meta) &&
          typeof (meta as { specRef?: unknown }).specRef === 'string'
            ? (meta as { specRef: string }).specRef
            : undefined;
        return {
          answerId: a.id,
          questionId: a.questionId,
          questionText: a.question.questionText,
          notes: a.notes,
          textValue: isSecureQuestionMetadata(a.question.metadata) ? null : a.textValue,
          section: a.question.section,
          carePlanArea: a.question.section.carePlanArea,
          specRef,
        };
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
      },
    });

    return {
      data: rows.map((row) => ({
        id: row.id,
        versionNumber: row.versionNumber,
        summary: row.summary,
        publishedAt: row.publishedAt.toISOString(),
        publishedById: row.publishedById,
        supersededAt: row.supersededAt?.toISOString() ?? null,
        isCurrent: row.supersededAt == null,
      })),
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

  async reviewQueue(params?: {
    status?: CarePlanReviewQueueStatusFilter;
    serviceUserId?: string;
    locationId?: string;
  }) {
    const rows = await this.prisma.serviceUserCarePlanInstance.findMany({
      where: {
        status: ServiceUserCarePlanInstanceStatus.PUBLISHED,
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

  async sendReviewReminders(params?: { triggeredByUserId?: string; dryRun?: boolean }) {
    const queue = await this.reviewQueue({ status: 'all' });
    const due = queue.data.filter(
      (item) => item.review.status === 'overdue' || item.review.status === 'due_soon',
    );
    let sent = 0;
    let skipped = 0;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const item of due) {
      const already = await this.prisma.notification.findFirst({
        where: {
          type: NotificationType.CARE_PLAN_REVIEW_DUE,
          recordId: item.instanceId,
          createdAt: { gte: since },
        },
        select: { id: true },
      });
      if (already) {
        skipped += 1;
        continue;
      }
      const recipientUserIds = await this.resolveCareTeamUserIds(item.serviceUserId);
      if (!recipientUserIds.length) {
        skipped += 1;
        continue;
      }
      if (params?.dryRun) {
        sent += 1;
        continue;
      }
      if (!this.notifications) {
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
          },
          createdById: params?.triggeredByUserId,
        });
        sent += 1;
      } catch (err) {
        this.logger.warn(`Care plan review reminder failed: ${(err as Error).message}`);
        skipped += 1;
      }
    }

    return { data: { sent, skipped, due: due.length } };
  }

  private async userIdForEmployee(employeeId: string): Promise<string | null> {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { personalDetail: { select: { email: true } } },
    });
    const email = emp?.personalDetail?.email?.trim();
    if (!email) return null;
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null, isActive: true },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async resolveCareTeamUserIds(serviceUserId: string): Promise<string[]> {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { keyWorkerId: true, namedNurseId: true },
    });
    if (!su) return [];
    const ids = new Set<string>();
    if (su.keyWorkerId) {
      const uid = await this.userIdForEmployee(su.keyWorkerId);
      if (uid) ids.add(uid);
    }
    if (su.namedNurseId) {
      const uid = await this.userIdForEmployee(su.namedNurseId);
      if (uid) ids.add(uid);
    }
    return [...ids];
  }
}
