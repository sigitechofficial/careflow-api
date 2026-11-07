import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
  ReviewReminderSubject,
} from '@prisma/client';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { PrismaService } from '../prisma/prisma.service';
import { listCarePathwayAssessmentCatalogForms } from './assessment-catalogue.util';
import { IA_ASSESSMENT_TOOL_CATALOGUE } from './assessment-tool-registry';
import {
  computeAssessmentReviewState,
  listAssessmentReviewSchedules,
} from './assessment-review-schedule';
import { validateAssessmentConsentForCompletion } from './assessment-consent.util';
import {
  resolveCarePathwayFormName,
  reviewContextForAssessment,
} from './assessment-review-context.util';
import {
  autoLinkCarePathwayAssessmentCompletion,
  type AutoLinkedCarePlan,
} from './care-pathway-assessment-auto-link.util';
import { CreateServiceUserAssessmentCompletionDto } from './dto/create-service-user-assessment-completion.dto';
import { CreateCarePlanAssessmentLinkDto } from './dto/create-care-plan-assessment-link.dto';
import {
  buildAssessmentReviewQueueItem,
  filterReviewQueueItems,
  type AssessmentReviewQueueItem,
} from './assessment-review-queue.util';
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

/** Review queue rows read per query (the reminder job pages through all of them). */
const REVIEW_QUEUE_PAGE = 1000;

const completionUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
};

const completionInclude = {
  completedBy: { select: completionUserSelect },
  assessment: { select: { assessmentKey: true, title: true } },
} satisfies Prisma.ServiceUserAssessmentCompletionInclude;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ServiceUserAssessmentsService {
  private readonly logger = new Logger(ServiceUserAssessmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly orgSettings?: OrganisationGeneralSettingsService,
  ) {}

  /** Settings → Reviews & reminders (defaults when the settings service is not wired, e.g. in tests). */
  private async reviewSettings(): Promise<ReviewSettings> {
    return this.orgSettings ? this.orgSettings.getReviewSettings() : DEFAULT_REVIEW_SETTINGS;
  }

  /** Every assessment review schedule in force (built-in values with the organisation's overrides). */
  async reviewSchedules() {
    const settings = await this.reviewSettings();
    return { data: listAssessmentReviewSchedules(settings.assessmentIntervals) };
  }

  private async ensureServiceUser(serviceUserId: string) {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true },
    });
    if (!su) throw new NotFoundException('Service user not found');
  }

  private mapCompletion(row: Prisma.ServiceUserAssessmentCompletionGetPayload<{
    include: typeof completionInclude;
  }>) {
    return {
      id: row.id,
      assessmentId: row.assessmentId,
      assessmentKey: row.assessment.assessmentKey,
      assessmentTitle: row.assessment.title,
      source: row.source,
      sourceSubmissionId: row.sourceSubmissionId,
      sourceHolisticTabId: row.sourceHolisticTabId,
      carePathwayFormId: row.carePathwayFormId,
      carePlanInstanceId: row.carePlanInstanceId,
      completedAt: row.completedAt.toISOString(),
      completedById: row.completedById,
      completedBy: row.completedBy,
      summary: row.summary,
      snapshot: row.snapshot as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);

    const rows = await this.prisma.serviceUserAssessment.findMany({
      where: { serviceUserId },
      include: {
        completions: {
          orderBy: { completedAt: 'desc' },
          take: 1,
          include: completionInclude,
        },
        _count: { select: { completions: true } },
      },
      orderBy: { assessmentKey: 'asc' },
    });

    const { assessmentIntervals } = await this.reviewSettings();
    return {
      data: rows.map((row) => {
        const latest = row.completions[0] ? this.mapCompletion(row.completions[0]) : null;
        const snapshot =
          latest?.snapshot && typeof latest.snapshot === 'object' && !Array.isArray(latest.snapshot)
            ? (latest.snapshot as Record<string, unknown>)
            : null;
        const review = computeAssessmentReviewState({
          ...reviewContextForAssessment({
            assessmentKey: row.assessmentKey,
            assessmentTitle: row.title,
            snapshot,
          }),
          lastCompletedAt: latest?.completedAt ?? null,
          snapshot,
          overrides: assessmentIntervals,
        });

        return {
          id: row.id,
          serviceUserId: row.serviceUserId,
          assessmentKey: row.assessmentKey,
          title: row.title,
          carePathwayFormId: row.carePathwayFormId,
          completionCount: row._count.completions,
          latestCompletion: latest,
          review,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
    };
  }

  async getCatalogue() {
    const { forms, source } = await listCarePathwayAssessmentCatalogForms(this.prisma);

    return {
      data: {
        tools: IA_ASSESSMENT_TOOL_CATALOGUE,
        carePathwayForms: forms,
        carePathwayFormsSource: source,
      },
    };
  }

  async listCompletions(serviceUserId: string, assessmentKey: string) {
    await this.ensureServiceUser(serviceUserId);

    const assessment = await this.prisma.serviceUserAssessment.findFirst({
      where: { serviceUserId, assessmentKey },
      select: { id: true },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    const rows = await this.prisma.serviceUserAssessmentCompletion.findMany({
      where: { assessmentId: assessment.id },
      orderBy: { completedAt: 'desc' },
      include: completionInclude,
    });

    return { data: rows.map((row) => this.mapCompletion(row)) };
  }

  async getCompletion(serviceUserId: string, completionId: string) {
    await this.ensureServiceUser(serviceUserId);

    const row = await this.prisma.serviceUserAssessmentCompletion.findFirst({
      where: { id: completionId, assessment: { serviceUserId } },
      include: completionInclude,
    });
    if (!row) throw new NotFoundException('Assessment completion not found');

    const carePlanLinks = await this.loadCompletionCarePlanLinks(serviceUserId, completionId);

    return {
      data: {
        ...this.mapCompletion(row),
        carePlanLinks,
      },
    };
  }

  private async loadCompletionCarePlanLinks(serviceUserId: string, completionId: string) {
    const links = await this.prisma.carePlanAssessmentLink.findMany({
      where: { serviceUserId, completionId, deletedAt: null },
      orderBy: { linkedAt: 'desc' },
      select: { id: true, carePlanFormId: true, linkedAt: true },
    });
    if (!links.length) return [];

    const forms = await this.prisma.carePathwayForm.findMany({
      where: { id: { in: links.map((link) => link.carePlanFormId) }, deletedAt: null },
      select: { id: true, name: true },
    });
    const nameById = new Map(forms.map((form) => [form.id, form.name]));

    return links.map((link) => ({
      id: link.id,
      carePlanFormId: link.carePlanFormId,
      carePlanFormName: nameById.get(link.carePlanFormId) ?? null,
      linkedAt: link.linkedAt.toISOString(),
    }));
  }

  async createCompletion(
    userId: string,
    serviceUserId: string,
    assessmentKey: string,
    dto: CreateServiceUserAssessmentCompletionDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);

    let snapshot: Record<string, unknown> =
      dto.snapshot && typeof dto.snapshot === 'object' && !Array.isArray(dto.snapshot)
        ? { ...dto.snapshot }
        : {};
    let carePathwayFormId = dto.carePathwayFormId ?? null;

    if (!carePathwayFormId && UUID_RE.test(assessmentKey)) {
      carePathwayFormId = assessmentKey;
    }

    if (dto.repeatFromCompletionId) {
      const prior = await this.prisma.serviceUserAssessmentCompletion.findFirst({
        where: {
          id: dto.repeatFromCompletionId,
          assessment: { serviceUserId },
        },
        select: { snapshot: true, carePathwayFormId: true },
      });
      if (!prior) throw new NotFoundException('Prior completion not found');

      const priorSnap =
        prior.snapshot && typeof prior.snapshot === 'object' && !Array.isArray(prior.snapshot)
          ? (prior.snapshot as Record<string, unknown>)
          : {};
      snapshot = { ...priorSnap, ...snapshot };
      if (!carePathwayFormId) carePathwayFormId = prior.carePathwayFormId;
    }

    const title = dto.title?.trim();
    let assessment = await this.prisma.serviceUserAssessment.findFirst({
      where: { serviceUserId, assessmentKey },
    });

    if (!assessment) {
      if (!title) {
        throw new BadRequestException(
          'Assessment not found. Provide title to register a new assessment.',
        );
      }
      assessment = await this.prisma.serviceUserAssessment.create({
        data: {
          serviceUserId,
          assessmentKey,
          title,
          carePathwayFormId: carePathwayFormId ?? undefined,
        },
      });
    } else if (title || carePathwayFormId) {
      assessment = await this.prisma.serviceUserAssessment.update({
        where: { id: assessment.id },
        data: {
          ...(title ? { title } : {}),
          ...(carePathwayFormId ? { carePathwayFormId } : {}),
        },
      });
    }

    const summary = dto.summary?.trim();
    if (!summary) throw new BadRequestException('Summary is required');

    const consentError = validateAssessmentConsentForCompletion(snapshot, assessmentKey, 'MANUAL');
    if (consentError) throw new BadRequestException(consentError);

    const created = await this.prisma.serviceUserAssessmentCompletion.create({
      data: {
        assessmentId: assessment.id,
        source: 'MANUAL',
        carePathwayFormId,
        completedAt: new Date(),
        completedById: userId,
        summary,
        snapshot: snapshot as Prisma.InputJsonValue,
      },
      include: completionInclude,
    });

    const reviewContext = reviewContextForAssessment({
      assessmentKey,
      assessmentTitle: assessment.title,
      snapshot,
    });
    const review = computeAssessmentReviewState({
      ...reviewContext,
      lastCompletedAt: created.completedAt,
      snapshot,
      overrides: (await this.reviewSettings()).assessmentIntervals,
    });

    let autoLinkedCarePlans: AutoLinkedCarePlan[] = [];
    const carePathwayFormName = resolveCarePathwayFormName({
      assessmentKey,
      assessmentTitle: assessment.title,
      snapshot,
    });
    if (carePathwayFormName) {
      autoLinkedCarePlans = await autoLinkCarePathwayAssessmentCompletion(
        this.prisma,
        this.audit,
        {
          userId,
          serviceUserId,
          completionId: created.id,
          carePathwayFormName,
          assessmentKey,
          meta,
        },
      );
    }

    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.ASSESSMENT_COMPLETED,
      recordType: 'ServiceUserAssessmentCompletion',
      recordId: created.id,
      newValues: auditSnapshot({
        assessmentKey,
        summary,
        completedAt: created.completedAt.toISOString(),
        source: 'MANUAL',
      }),
      metadata: {
        serviceUserId,
        assessmentId: assessment.id,
        assessmentKey,
        repeatFromCompletionId: dto.repeatFromCompletionId ?? null,
        carePathwayFormId,
        nextReviewDueAt: review.nextReviewDueAt,
        reviewStatus: review.status,
        effectiveIntervalDays: review.effectiveIntervalDays,
        autoLinkedCarePlanIds: autoLinkedCarePlans.map((row) => row.carePlanFormId),
      },
      ...meta,
    });

    return {
      data: {
        ...this.mapCompletion(created),
        carePlanLinks: autoLinkedCarePlans.map((row) => ({
          id: row.linkId,
          carePlanFormId: row.carePlanFormId,
          carePlanFormName: row.carePlanFormName,
          autoLinked: true,
        })),
      },
    };
  }

  private mapCarePlanLink(row: {
    id: string;
    completionId: string;
    carePlanFormId: string;
    serviceUserId: string;
    linkedAt: Date;
    linkedById: string | null;
    completion: Prisma.ServiceUserAssessmentCompletionGetPayload<{ include: typeof completionInclude }>;
  }) {
    return {
      id: row.id,
      completionId: row.completionId,
      carePlanFormId: row.carePlanFormId,
      serviceUserId: row.serviceUserId,
      linkedAt: row.linkedAt.toISOString(),
      linkedById: row.linkedById,
      completion: this.mapCompletion(row.completion),
    };
  }

  async listCarePlanAssessmentLinks(serviceUserId: string, carePlanFormId: string) {
    await this.ensureServiceUser(serviceUserId);

    const rows = await this.prisma.carePlanAssessmentLink.findMany({
      where: { serviceUserId, carePlanFormId, deletedAt: null },
      orderBy: { linkedAt: 'desc' },
      include: {
        completion: { include: completionInclude },
      },
    });

    return { data: rows.map((row) => this.mapCarePlanLink(row)) };
  }

  async linkCompletionToCarePlan(
    userId: string,
    serviceUserId: string,
    carePlanFormId: string,
    dto: CreateCarePlanAssessmentLinkDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);

    const completion = await this.prisma.serviceUserAssessmentCompletion.findFirst({
      where: { id: dto.completionId, assessment: { serviceUserId } },
      include: completionInclude,
    });
    if (!completion) throw new NotFoundException('Assessment completion not found');

    const existing = await this.prisma.carePlanAssessmentLink.findFirst({
      where: {
        serviceUserId,
        carePlanFormId,
        completionId: dto.completionId,
        deletedAt: null,
      },
    });
    if (existing) {
      return { data: this.mapCarePlanLink({ ...existing, completion }) };
    }

    const created = await this.prisma.carePlanAssessmentLink.create({
      data: {
        serviceUserId,
        carePlanFormId,
        completionId: dto.completionId,
        linkedById: userId,
      },
      include: {
        completion: { include: completionInclude },
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.ASSESSMENT_LINKED,
      recordType: 'CarePlanAssessmentLink',
      recordId: created.id,
      newValues: auditSnapshot({
        completionId: dto.completionId,
        carePlanFormId,
        assessmentKey: completion.assessment.assessmentKey,
      }),
      metadata: {
        serviceUserId,
        completionId: dto.completionId,
        carePlanFormId,
        assessmentKey: completion.assessment.assessmentKey,
      },
      ...meta,
    });

    return { data: this.mapCarePlanLink(created) };
  }

  async unlinkCompletionFromCarePlan(
    userId: string,
    serviceUserId: string,
    linkId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);

    const link = await this.prisma.carePlanAssessmentLink.findFirst({
      where: { id: linkId, serviceUserId, deletedAt: null },
      include: {
        completion: { include: completionInclude },
      },
    });
    if (!link) throw new NotFoundException('Assessment link not found');

    await this.prisma.carePlanAssessmentLink.update({
      where: { id: linkId },
      data: { deletedAt: new Date() },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.ASSESSMENT_UNLINKED,
      recordType: 'CarePlanAssessmentLink',
      recordId: linkId,
      oldValues: auditSnapshot({
        completionId: link.completionId,
        carePlanFormId: link.carePlanFormId,
        assessmentKey: link.completion.assessment.assessmentKey,
      }),
      metadata: {
        serviceUserId,
        completionId: link.completionId,
        carePlanFormId: link.carePlanFormId,
        assessmentKey: link.completion.assessment.assessmentKey,
      },
      ...meta,
    });
  }

  async reviewQueue(opts?: {
    serviceUserId?: string;
    locationId?: string;
    overdueOnly?: boolean;
    alertsOnly?: boolean;
    settings?: ReviewSettings;
    now?: Date;
  }) {
    const { assessmentIntervals } = opts?.settings ?? (await this.reviewSettings());
    const items: AssessmentReviewQueueItem[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.reviewQueuePage(opts, cursor);
      items.push(...page.map((row) => this.toQueueItem(row, assessmentIntervals, opts?.now)));
      if (page.length < REVIEW_QUEUE_PAGE) break;
      cursor = page[page.length - 1]!.id;
    }

    const filtered = filterReviewQueueItems(items, {
      overdueOnly: opts?.overdueOnly,
      alertsOnly: opts?.alertsOnly,
    });

    filtered.sort((a, b) => {
      const rank = (s: AssessmentReviewQueueItem['review']['status']) =>
        s === 'overdue' ? 0 : s === 'due_soon' ? 1 : s === 'not_started' ? 2 : 3;
      const diff = rank(a.review.status) - rank(b.review.status);
      if (diff !== 0) return diff;
      const aDue = a.review.nextReviewDueAt ?? '';
      const bDue = b.review.nextReviewDueAt ?? '';
      return aDue.localeCompare(bDue);
    });

    return {
      data: filtered,
      meta: {
        total: filtered.length,
        overdueCount: filtered.filter((i) => i.review.status === 'overdue').length,
        dueSoonCount: filtered.filter((i) => i.review.status === 'due_soon').length,
      },
    };
  }

  private reviewQueuePage(
    opts: { serviceUserId?: string; locationId?: string } | undefined,
    cursor: string | undefined,
  ) {
    return this.prisma.serviceUserAssessment.findMany({
      where: {
        ...(opts?.serviceUserId ? { serviceUserId: opts.serviceUserId } : {}),
        serviceUser: {
          deletedAt: null,
          isActive: true,
          ...(opts?.locationId ? { locationId: opts.locationId } : {}),
        },
      },
      include: {
        serviceUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
          },
        },
        completions: {
          orderBy: { completedAt: 'desc' },
          take: 1,
          select: { id: true, completedAt: true, snapshot: true },
        },
      },
      orderBy: { id: 'asc' },
      take: REVIEW_QUEUE_PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }

  private toQueueItem(
    row: Awaited<ReturnType<ServiceUserAssessmentsService['reviewQueuePage']>>[number],
    overrides: ReviewSettings['assessmentIntervals'],
    now?: Date,
  ): AssessmentReviewQueueItem {
    const latest = row.completions[0];
    const snapshot =
      latest?.snapshot && typeof latest.snapshot === 'object' && !Array.isArray(latest.snapshot)
        ? (latest.snapshot as Record<string, unknown>)
        : null;
    const su = row.serviceUser;
    const serviceUserName = su
      ? (su.preferredName?.trim() || [su.firstName, su.lastName].filter(Boolean).join(' ').trim()) || null
      : null;

    return buildAssessmentReviewQueueItem({
      serviceUserId: row.serviceUserId,
      serviceUserName,
      assessmentId: row.id,
      assessmentKey: row.assessmentKey,
      assessmentTitle: row.title,
      latestCompletionId: latest?.id ?? null,
      latestCompletedAt: latest?.completedAt ?? null,
      snapshot,
      overrides,
      now,
    });
  }

  /**
   * Assessment review reminders: one when a review becomes due soon, then one on the first overdue
   * day and again every `reminderRepeatDays` while overdue (Settings → Reviews & reminders). Each
   * reminder is claimed in ReviewReminderLog first, so the hourly job and this endpoint never send
   * the same one twice.
   */
  async sendReviewReminders(params: {
    triggeredByUserId?: string;
    serviceUserId?: string;
    dryRun?: boolean;
    meta?: RequestAuditMeta;
    now?: Date;
  }) {
    const now = params.now ?? new Date();
    const settings = await this.reviewSettings();
    const queue = await this.reviewQueue({
      serviceUserId: params.serviceUserId,
      alertsOnly: true,
      settings,
      now,
    });

    let sent = 0;
    let skipped = 0;
    let alreadySent = 0;
    const preview: Array<{ serviceUserId: string; assessmentKey: string; kind: string; recipients: string[] }> = [];

    for (const item of queue.data) {
      const dueDate = item.review.nextReviewDueAt ? new Date(item.review.nextReviewDueAt) : null;
      const kind = reviewReminderKind(item.review.status, dueDate, now, settings.reminderRepeatDays);
      if (!kind || !dueDate) {
        skipped += 1;
        continue;
      }
      const claim = {
        subjectType: ReviewReminderSubject.ASSESSMENT,
        subjectId: item.assessmentId,
        serviceUserId: item.serviceUserId,
        dueDate,
        kind,
      };

      if (params.dryRun) {
        if (await reviewReminderAlreadySent(this.prisma, claim)) {
          alreadySent += 1;
          continue;
        }
        const recipients = await resolveCareTeamUserIds(this.prisma, item.serviceUserId);
        if (!recipients.length) {
          skipped += 1;
          continue;
        }
        preview.push({ serviceUserId: item.serviceUserId, assessmentKey: item.assessmentKey, kind, recipients });
        sent += 1;
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
        alreadySent += 1;
        continue;
      }

      const overdue = item.review.status === 'overdue';
      const statusLabel = overdue ? 'overdue' : 'due soon';
      const who = item.serviceUserName ?? 'Service user';
      try {
        await this.notifications.notifyUsers({
          recipientUserIds,
          type: NotificationType.ASSESSMENT_DUE_REMINDER,
          title: `Assessment review ${statusLabel}: ${item.assessmentTitle}`,
          message: `${who} — ${item.assessmentTitle} review is ${statusLabel}. Complete it from the care plan.`,
          module: NotificationModule.SERVICE_CARE,
          severity: overdue ? NotificationSeverity.WARNING : NotificationSeverity.INFO,
          recordType: 'ServiceUserAssessment',
          recordId: item.assessmentId,
          metadata: {
            serviceUserId: item.serviceUserId,
            assessmentKey: item.assessmentKey,
            reviewStatus: item.review.status,
            nextReviewDueAt: item.review.nextReviewDueAt,
            reminderKind: kind,
          },
          createdById: params.triggeredByUserId,
        });
      } catch (err) {
        await releaseReviewReminder(this.prisma, logId);
        this.logger.warn(`Assessment reminder failed: ${(err as Error).message}`);
        skipped += 1;
        continue;
      }
      await completeReviewReminder(this.prisma, logId, recipientUserIds);

      if (params.triggeredByUserId) {
        // Manual sends are audited against the person who pressed the button; the job's run is
        // recorded in JobRun and the reminder itself in ReviewReminderLog.
        await this.audit.logAudit({
          userId: params.triggeredByUserId,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.ASSESSMENT_REVIEW_REMINDER,
          recordType: 'ServiceUserAssessment',
          recordId: item.assessmentId,
          newValues: auditSnapshot({
            assessmentKey: item.assessmentKey,
            assessmentTitle: item.assessmentTitle,
            reviewStatus: item.review.status,
            nextReviewDueAt: item.review.nextReviewDueAt,
          }),
          metadata: {
            serviceUserId: item.serviceUserId,
            assessmentKey: item.assessmentKey,
            reviewStatus: item.review.status,
            reminderKind: kind,
            recipientUserIds,
            nextReviewDueAt: item.review.nextReviewDueAt,
          },
          ...params.meta,
        });
      }
      sent += 1;
    }

    return {
      data: {
        dryRun: params.dryRun ?? false,
        sent,
        skipped,
        alreadySent,
        queueTotal: queue.data.length,
        preview: params.dryRun ? preview : undefined,
      },
    };
  }
}
