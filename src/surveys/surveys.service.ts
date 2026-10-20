import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
  SurveyQuestionType,
  SurveyRecurrence,
  SurveyRespondentRelation,
  SurveyResponseChannel,
  SurveyStatus,
  SurveyTargetKind,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { FcmPushService } from '../notifications/fcm-push.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IDENTITY_ROLE } from '../common/org-scope/org-scope.types';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';
import { DuplicateSurveyDto } from './dto/duplicate-survey.dto';
import {
  CreateSurveyQuestionDto,
  UpdateSurveyQuestionDto,
} from './dto/survey-question.dto';
import { SendSurveyDto } from './dto/send-survey.dto';
import { ListSurveysQueryDto } from './dto/list-surveys-query.dto';
import {
  SubmitSurveyResponseDto,
  SurveyAnswerItemDto,
} from './dto/submit-survey-response.dto';
import {
  nextSurveyDistributeAt,
  surveyPeriodLabel,
} from './survey-recurrence.util';
import {
  RecordSurveyResponseDto,
  STAFF_RECORDED_CHANNELS,
  UpdateRecordedSurveyResponseDto,
} from './dto/record-survey-response.dto';

const isStaffRecordedChannel = (channel: SurveyResponseChannel) =>
  (STAFF_RECORDED_CHANNELS as readonly string[]).includes(channel);

const DEFAULT_LIKERT_OPTIONS = [
  'Strongly agree',
  'Agree',
  'Neutral',
  'Disagree',
  'Strongly disagree',
];

/** Service users who are no longer receiving care are never surveyed. */
const SURVEY_EXCLUDED_SERVICE_USER_STATUSES = [
  'DISCHARGED',
  'DECEASED',
  'INACTIVE',
] as const;

@Injectable()
export class SurveysService {
  private readonly logger = new Logger(SurveysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly push: FcmPushService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListSurveysQueryDto) {
    const where: Prisma.SurveyWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.targetKind) where.targetKind = query.targetKind;
    if (query.isTemplate !== undefined) where.isTemplate = query.isTemplate === 'true';

    const rows = await this.prisma.survey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { questions: { where: { deletedAt: null } }, recipients: true } },
      },
    });

    const surveyIds = rows.map((r) => r.id);
    const completedBySurvey =
      surveyIds.length === 0
        ? []
        : await this.prisma.surveyRecipient.groupBy({
            by: ['surveyId'],
            where: { surveyId: { in: surveyIds }, status: 'COMPLETED' },
            _count: { _all: true },
          });
    const completedMap = new Map(
      completedBySurvey.map((row) => [row.surveyId, row._count._all] as const),
    );
    const creatorMap = await this.loadUserNameMap(
      rows.map((r) => r.createdById).filter((id): id is string => Boolean(id)),
    );

    return {
      message: 'Surveys',
      data: rows.map((r) => {
        const recipients = r._count.recipients;
        const completed = completedMap.get(r.id) ?? 0;
        return {
          id: r.id,
          title: r.title,
          description: r.description,
          targetKind: r.targetKind,
          status: r.status,
          isAnonymous: r.isAnonymous,
          opensAt: r.opensAt?.toISOString() ?? null,
          closesAt: r.closesAt?.toISOString() ?? null,
          publishedAt: r.publishedAt?.toISOString() ?? null,
          distributeAt: r.distributeAt?.toISOString() ?? null,
          distributedAt: r.distributedAt?.toISOString() ?? null,
          recurrence: r.recurrence ?? null,
          clonedFromId: r.clonedFromId ?? null,
          locationIds: r.locationIds,
          roleIds: r.roleIds,
          isTemplate: r.isTemplate,
          shareToken: r.shareToken,
          questionCount: r._count.questions,
          recipientCount: recipients,
          completedCount: completed,
          responseRate: recipients > 0 ? Math.round((completed / recipients) * 100) : 0,
          createdById: r.createdById ?? null,
          createdByName: r.createdById ? (creatorMap.get(r.createdById) ?? null) : null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
    };
  }

  private async requireSurvey(id: string) {
    const row = await this.prisma.survey.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Survey not found');
    return row;
  }

  async getById(id: string) {
    const row = await this.requireSurvey(id);
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId: id, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    const [recipientCount, responseCount, creatorMap] = await Promise.all([
      this.prisma.surveyRecipient.count({ where: { surveyId: id } }),
      this.prisma.surveyResponse.count({ where: { recipient: { surveyId: id } } }),
      this.loadUserNameMap(row.createdById ? [row.createdById] : []),
    ]);

    return {
      message: 'Survey',
      data: {
        id: row.id,
        title: row.title,
        description: row.description,
        targetKind: row.targetKind,
        status: row.status,
        isAnonymous: row.isAnonymous,
        opensAt: row.opensAt?.toISOString() ?? null,
        closesAt: row.closesAt?.toISOString() ?? null,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        distributeAt: row.distributeAt?.toISOString() ?? null,
        distributedAt: row.distributedAt?.toISOString() ?? null,
        recurrence: row.recurrence ?? null,
        clonedFromId: row.clonedFromId ?? null,
        locationIds: row.locationIds,
        roleIds: row.roleIds,
        isTemplate: row.isTemplate,
        shareToken: row.shareToken,
        createdById: row.createdById ?? null,
        createdByName: row.createdById ? (creatorMap.get(row.createdById) ?? null) : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        recipientCount,
        responseCount,
        questions: questions.map((q) => ({
          id: q.id,
          questionText: q.questionText,
          helpText: q.helpText,
          questionType: q.questionType,
          options: q.options,
          config: q.config,
          isRequired: q.isRequired,
          sortOrder: q.sortOrder,
        })),
      },
    };
  }

  async create(userId: string, dto: CreateSurveyDto, meta?: RequestAuditMeta) {
    const created = await this.prisma.survey.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        targetKind: dto.targetKind ?? SurveyTargetKind.EMPLOYEE,
        isAnonymous: dto.isAnonymous ?? false,
        opensAt: dto.opensAt ? new Date(dto.opensAt) : null,
        closesAt: dto.closesAt ? new Date(dto.closesAt) : null,
        distributeAt: dto.distributeAt ? new Date(dto.distributeAt) : null,
        recurrence: dto.recurrence ?? null,
        locationIds: dto.locationIds ?? [],
        roleIds: dto.roleIds ?? [],
        isTemplate: dto.isTemplate ?? false,
        createdById: userId,
        updatedById: userId,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_CREATED,
      recordType: 'Survey',
      recordId: created.id,
      newValues: auditSnapshot(created),
      ...meta,
    });

    return { message: 'Survey created', data: created };
  }

  /**
   * Duplicate any survey (template or an existing one) with all its questions as a new DRAFT,
   * so it can be edited and sent independently. Schedule, status and responses are not copied.
   */
  async duplicate(
    userId: string,
    id: string,
    overrides?: DuplicateSurveyDto,
    meta?: RequestAuditMeta,
  ) {
    const source = await this.requireSurvey(id);
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId: id, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });

    const title = overrides?.title?.trim() || `${source.title} (Copy)`;
    const targetKind = overrides?.targetKind ?? source.targetKind;
    const isAnonymous = overrides?.isAnonymous ?? source.isAnonymous;
    // Location only applies to employee / service-user surveys; roles only to employee surveys.
    const locationIds = targetKind === SurveyTargetKind.PUBLIC ? [] : source.locationIds;
    const roleIds =
      targetKind === SurveyTargetKind.EMPLOYEE ? (overrides?.roleIds ?? source.roleIds) : [];

    const created = await this.prisma.survey.create({
      data: {
        title: title.slice(0, 200),
        description: source.description,
        targetKind,
        isAnonymous,
        locationIds,
        roleIds,
        status: SurveyStatus.DRAFT,
        createdById: userId,
        updatedById: userId,
        questions: {
          create: questions.map((q) => ({
            questionText: q.questionText,
            helpText: q.helpText,
            questionType: q.questionType,
            options: q.options === null ? Prisma.JsonNull : q.options,
            config: q.config === null ? Prisma.JsonNull : q.config,
            isRequired: q.isRequired,
            sortOrder: q.sortOrder,
            isActive: q.isActive,
          })),
        },
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_CREATED,
      recordType: 'Survey',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: { duplicatedFromId: id, questionCount: questions.length },
      ...meta,
    });

    return { message: 'Survey duplicated', data: created };
  }

  async update(userId: string, id: string, dto: UpdateSurveyDto, meta?: RequestAuditMeta) {
    const existing = await this.requireSurvey(id);

    const updated = await this.prisma.survey.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        targetKind: dto.targetKind,
        isAnonymous: dto.isAnonymous,
        status: dto.status,
        opensAt: dto.opensAt === undefined ? undefined : dto.opensAt ? new Date(dto.opensAt) : null,
        closesAt:
          dto.closesAt === undefined ? undefined : dto.closesAt ? new Date(dto.closesAt) : null,
        distributeAt:
          dto.distributeAt === undefined
            ? undefined
            : dto.distributeAt
              ? new Date(dto.distributeAt)
              : null,
        recurrence: dto.recurrence === undefined ? undefined : dto.recurrence ?? null,
        locationIds: dto.locationIds,
        roleIds: dto.roleIds,
        isTemplate: dto.isTemplate,
        updatedById: userId,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_UPDATED,
      recordType: 'Survey',
      recordId: id,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });

    return { message: 'Survey updated', data: updated };
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.requireSurvey(id);
    await this.prisma.survey.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId, updatedById: userId },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_DELETED,
      recordType: 'Survey',
      recordId: id,
      oldValues: auditSnapshot(existing),
      ...meta,
    });

    return { message: 'Survey deleted', data: { id } };
  }

  /**
   * Publish a survey for public sharing: requires ≥1 question, sets ACTIVE,
   * stamps publishedAt, returns the share token.
   */
  async publish(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.requireSurvey(id);
    const questionCount = await this.prisma.surveyQuestion.count({
      where: { surveyId: id, deletedAt: null },
    });
    if (questionCount === 0) {
      throw new BadRequestException('Add at least one question before publishing the survey');
    }

    const now = new Date();
    const updated = await this.prisma.survey.update({
      where: { id },
      data: {
        status: SurveyStatus.ACTIVE,
        publishedAt: existing.publishedAt ?? now,
        updatedById: userId,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_UPDATED,
      recordType: 'Survey',
      recordId: id,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      metadata: { publishedForShare: true },
      ...meta,
    });

    return {
      message: 'Survey published',
      data: {
        id: updated.id,
        status: updated.status,
        publishedAt: updated.publishedAt?.toISOString() ?? null,
        shareToken: updated.shareToken,
      },
    };
  }

  async addQuestion(
    userId: string,
    surveyId: string,
    dto: CreateSurveyQuestionDto,
    meta?: RequestAuditMeta,
  ) {
    await this.requireSurvey(surveyId);
    const created = await this.prisma.surveyQuestion.create({
      data: {
        surveyId,
        questionText: dto.questionText.trim(),
        helpText: dto.helpText?.trim() || null,
        questionType: dto.questionType,
        options: (dto.options as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        config: (dto.config as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        isRequired: dto.isRequired ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_QUESTION_CREATED,
      recordType: 'SurveyQuestion',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: { surveyId },
      ...meta,
    });

    return { message: 'Question added', data: created };
  }

  async updateQuestion(
    userId: string,
    surveyId: string,
    questionId: string,
    dto: UpdateSurveyQuestionDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.surveyQuestion.findFirst({
      where: { id: questionId, surveyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Question not found');

    const updated = await this.prisma.surveyQuestion.update({
      where: { id: questionId },
      data: {
        questionText: dto.questionText?.trim(),
        helpText: dto.helpText === undefined ? undefined : dto.helpText?.trim() || null,
        questionType: dto.questionType,
        options: dto.options === undefined ? undefined : (dto.options as Prisma.InputJsonValue),
        config: dto.config === undefined ? undefined : (dto.config as Prisma.InputJsonValue),
        isRequired: dto.isRequired,
        sortOrder: dto.sortOrder,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_QUESTION_UPDATED,
      recordType: 'SurveyQuestion',
      recordId: questionId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      metadata: { surveyId },
      ...meta,
    });

    return { message: 'Question updated', data: updated };
  }

  async removeQuestion(
    userId: string,
    surveyId: string,
    questionId: string,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.surveyQuestion.findFirst({
      where: { id: questionId, surveyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Question not found');

    await this.prisma.surveyQuestion.update({
      where: { id: questionId },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_QUESTION_DELETED,
      recordType: 'SurveyQuestion',
      recordId: questionId,
      oldValues: auditSnapshot(existing),
      metadata: { surveyId },
      ...meta,
    });

    return { message: 'Question removed', data: { id: questionId } };
  }

  /**
   * Send a survey: one recipient row per active employee, or per service user with portal
   * access, then mark the survey ACTIVE and deliver (push/email) in the background.
   * If dto.distributeAt is in the future, queue the send instead.
   * With recurrence, each due run clones this survey and sends the clone.
   */
  async send(
    userId: string,
    surveyId: string,
    dto: SendSurveyDto,
    meta?: RequestAuditMeta,
    requestOrigin?: string,
  ) {
    const survey = await this.requireSurvey(surveyId);
    if (survey.targetKind === SurveyTargetKind.PUBLIC) {
      throw new BadRequestException(
        'Public surveys are answered through the shareable link — there is no recipient list to send to. Publish it and copy the link.',
      );
    }
    const forServiceUsers = survey.targetKind === SurveyTargetKind.SERVICE_USER;
    const questionCount = await this.prisma.surveyQuestion.count({
      where: { surveyId, deletedAt: null },
    });
    if (questionCount === 0) {
      throw new BadRequestException('Add at least one question before sending the survey');
    }

    if (dto.distributeAt) {
      const when = new Date(dto.distributeAt);
      if (Number.isNaN(when.getTime())) {
        throw new BadRequestException('Invalid distribution date');
      }
      if (when.getTime() > Date.now() + 15_000) {
        const recurrence =
          dto.recurrence !== undefined ? dto.recurrence : (survey.recurrence ?? null);
        const updated = await this.prisma.survey.update({
          where: { id: surveyId },
          data: {
            distributeAt: when,
            distributedAt: null,
            recurrence,
            updatedById: userId || undefined,
          },
        });
        await this.audit.logAudit({
          userId: userId || undefined,
          module: AuditModule.SURVEY,
          action: AuditAction.SURVEY_UPDATED,
          recordType: 'Survey',
          recordId: surveyId,
          oldValues: auditSnapshot(survey),
          newValues: {
            distributeAt: updated.distributeAt,
            recurrence: updated.recurrence,
          },
          metadata: { scheduledDistribution: true, recurring: Boolean(recurrence) },
          ...meta,
        });
        return {
          message: recurrence
            ? 'Recurring survey distribution scheduled'
            : 'Survey distribution scheduled',
          data: {
            sent: 0,
            skippedExisting: 0,
            skippedNoPortal: 0,
            status: updated.status,
            scheduled: true,
            distributeAt: updated.distributeAt?.toISOString() ?? null,
            recurrence: updated.recurrence ?? null,
          },
        };
      }
    }

    const locationIds = dto.locationIds ?? survey.locationIds;
    let targetIds: string[];
    let skippedNoPortal = 0;
    if (forServiceUsers) {
      // Service users answer in the portal, so only those with an enabled portal account receive it.
      const suWhere: Prisma.ServiceUserWhereInput = {
        deletedAt: null,
        NOT: {
          status: {
            is: { code: { in: [...SURVEY_EXCLUDED_SERVICE_USER_STATUSES] } },
          },
        },
      };
      if (locationIds.length > 0) suWhere.locationId = { in: locationIds };
      const [eligible, inScope] = await Promise.all([
        this.prisma.serviceUser.findMany({
          where: {
            ...suWhere,
            portalAccount: { is: { isEnabled: true, deletedAt: null } },
          },
          select: { id: true },
        }),
        this.prisma.serviceUser.count({ where: suWhere }),
      ]);
      targetIds = eligible.map((s) => s.id);
      skippedNoPortal = inScope - targetIds.length;
      if (targetIds.length === 0) {
        throw new BadRequestException(
          'No service users with portal access to send this survey to. Give them a portal account first.',
        );
      }
    } else {
      // Only active employees: explicit picks are filtered too, so inactive staff never receive it.
      const roleIds = dto.roleIds ?? survey.roleIds;
      const empWhere: Prisma.EmployeeWhereInput = {
        deletedAt: null,
        isActive: true,
      };
      if (dto.employeeIds?.length) {
        empWhere.id = { in: dto.employeeIds };
      } else {
        const employmentWhere: Prisma.EmployeeEmploymentWhereInput = {};
        if (locationIds.length > 0) employmentWhere.locationId = { in: locationIds };
        // roleIds holds Job Title ids (HR, managers, etc.) — targets employees by job title.
        if (roleIds.length > 0) employmentWhere.jobTitleId = { in: roleIds };
        if (Object.keys(employmentWhere).length > 0) {
          empWhere.employment = employmentWhere;
        }
      }
      const employees = await this.prisma.employee.findMany({
        where: empWhere,
        select: { id: true },
      });
      targetIds = employees.map((e) => e.id);
      if (targetIds.length === 0) {
        throw new BadRequestException(
          'No active employees to send this survey to',
        );
      }
    }

    const existing = await this.prisma.surveyRecipient.findMany({
      where: forServiceUsers
        ? { surveyId, serviceUserId: { in: targetIds } }
        : { surveyId, employeeId: { in: targetIds } },
      select: { employeeId: true, serviceUserId: true },
    });
    const already = new Set(
      existing.map((r) => (forServiceUsers ? r.serviceUserId : r.employeeId)),
    );
    const toCreate = targetIds.filter((id) => !already.has(id));

    const now = new Date();
    const created = toCreate.map((id) => ({
      surveyId,
      targetKind: survey.targetKind,
      employeeId: forServiceUsers ? null : id,
      serviceUserId: forServiceUsers ? id : null,
      token: randomUUID(),
      status: 'SENT' as const,
      sentAt: now,
      createdById: userId || null,
    }));
    if (created.length) {
      await this.prisma.surveyRecipient.createMany({
        data: created,
        skipDuplicates: true,
      });
    }

    const updated = await this.prisma.survey.update({
      where: { id: surveyId },
      data: {
        status: SurveyStatus.ACTIVE,
        publishedAt: survey.publishedAt ?? now,
        distributedAt: now,
        updatedById: userId || undefined,
      },
    });

    // Delivery runs in the background — a failed email/push never fails the send.
    if (created.length) {
      void this.deliverToRecipients(survey, created, requestOrigin).catch(
        (err) =>
          this.logger.warn(
            `Survey ${surveyId} delivery failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
      );
    }

    await this.audit.logAudit({
      userId: userId || undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_SENT,
      recordType: 'Survey',
      recordId: surveyId,
      newValues: {
        sent: toCreate.length,
        skippedExisting: already.size,
        skippedNoPortal,
        status: updated.status,
      },
      metadata: { surveyId, targetKind: survey.targetKind },
      ...meta,
    });

    const audience = forServiceUsers ? 'service user(s)' : 'employee(s)';
    return {
      message: `Survey sent to ${toCreate.length} ${audience}`,
      data: {
        sent: toCreate.length,
        skippedExisting: already.size,
        skippedNoPortal,
        status: updated.status,
        scheduled: false,
        distributeAt: survey.distributeAt?.toISOString() ?? null,
        recurrence: survey.recurrence ?? null,
      },
    };
  }

  /** Admin web app origin for links: ADMIN_APP_URL, else the (validated) request Origin. */
  private resolveAppBaseUrl(requestOrigin?: string): string | null {
    const configured = this.config.get<string>('app.adminAppUrl', '');
    if (configured) return configured;
    const origin = requestOrigin?.trim().replace(/\/+$/, '');
    return origin && /^https?:\/\/[^/\s]+$/i.test(origin) ? origin : null;
  }

  /**
   * Employees: carer-app push + email, each with their personal survey link.
   * Service users: email telling them a survey is waiting in their portal.
   */
  private async deliverToRecipients(
    survey: { id: string; title: string; targetKind: SurveyTargetKind },
    recipients: Array<{
      token: string;
      employeeId: string | null;
      serviceUserId: string | null;
    }>,
    requestOrigin?: string,
  ): Promise<void> {
    const base = this.resolveAppBaseUrl(requestOrigin);
    if (!base) {
      this.logger.warn(
        `Survey ${survey.id}: ADMIN_APP_URL is not set — emails and push are sent without a link.`,
      );
    }

    if (survey.targetKind === SurveyTargetKind.SERVICE_USER) {
      const accounts = await this.prisma.serviceUserPortalAccount.findMany({
        where: {
          serviceUserId: {
            in: recipients
              .map((r) => r.serviceUserId)
              .filter((id): id is string => Boolean(id)),
          },
          isEnabled: true,
          deletedAt: null,
        },
        select: {
          email: true,
          serviceUser: { select: { firstName: true, preferredName: true } },
        },
      });
      for (const a of accounts) {
        const name =
          a.serviceUser.preferredName?.trim() || a.serviceUser.firstName;
        await this.safeMail(survey.id, {
          to: a.email,
          subject: `New survey in your portal: ${survey.title}`,
          text: [
            `Hello ${name},`,
            '',
            `Your care team would like your feedback in the survey "${survey.title}".`,
            base
              ? `Log in to your portal to answer it: ${base}/portal/surveys`
              : 'Log in to your service user portal and open Surveys to answer it.',
            '',
            'A family member or representative can answer on your behalf.',
            '',
            'Thank you.',
          ].join('\n'),
        });
      }
      return;
    }

    const employeeIds = recipients
      .map((r) => r.employeeId)
      .filter((id): id is string => Boolean(id));
    const details = await this.prisma.employeePersonalDetail.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { employeeId: true, firstName: true, email: true },
    });
    const detailById = new Map(details.map((d) => [d.employeeId, d]));
    for (const r of recipients) {
      if (!r.employeeId) continue;
      const link = base ? `${base}/survey/${r.token}` : null;
      try {
        await this.push.sendToEmployees([r.employeeId], {
          title: 'New survey',
          body: `Please complete "${survey.title}".`,
          data: {
            type: 'SURVEY',
            surveyId: survey.id,
            token: r.token,
            ...(link ? { url: link } : {}),
          },
        });
      } catch (err) {
        this.logger.warn(
          `Survey ${survey.id} push to employee ${r.employeeId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const detail = detailById.get(r.employeeId);
      if (!detail?.email) continue;
      await this.safeMail(survey.id, {
        to: detail.email,
        subject: `Survey: ${survey.title}`,
        text: [
          `Hi ${detail.firstName},`,
          '',
          `You have been asked to complete the survey "${survey.title}".`,
          link
            ? `Open your survey: ${link}`
            : 'Please ask your office for your survey link.',
          '',
          'This link is personal to you — please do not share it.',
          '',
          'Thank you.',
        ].join('\n'),
      });
    }
  }

  private async safeMail(
    surveyId: string,
    input: { to: string; subject: string; text: string },
  ) {
    try {
      await this.mail.send(input);
    } catch (err) {
      this.logger.warn(
        `Survey ${surveyId} email to ${input.to} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Clone a recurring template into a fresh period survey (questions copied). */
  private async cloneSurveyForPeriod(
    template: {
      id: string;
      title: string;
      description: string | null;
      targetKind: SurveyTargetKind;
      isAnonymous: boolean;
      opensAt: Date | null;
      closesAt: Date | null;
      locationIds: string[];
      roleIds: string[];
      recurrence: SurveyRecurrence;
      createdById: string | null;
    },
    periodAt: Date,
    actorId: string,
  ) {
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId: template.id, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    if (questions.length === 0) {
      throw new BadRequestException('Add at least one question before sending the survey');
    }

    const label = surveyPeriodLabel(periodAt, template.recurrence);
    const title = `${template.title} — ${label}`.slice(0, 200);

    let opensAt: Date | null = periodAt;
    let closesAt: Date | null = null;
    if (template.opensAt && template.closesAt) {
      const durationMs = template.closesAt.getTime() - template.opensAt.getTime();
      if (durationMs > 0) {
        closesAt = new Date(periodAt.getTime() + durationMs);
      }
    }

    const created = await this.prisma.survey.create({
      data: {
        title,
        description: template.description,
        targetKind: template.targetKind,
        isAnonymous: template.isAnonymous,
        opensAt,
        closesAt,
        locationIds: template.locationIds,
        roleIds: template.roleIds,
        clonedFromId: template.id,
        status: SurveyStatus.DRAFT,
        createdById: actorId || template.createdById || undefined,
        updatedById: actorId || template.createdById || undefined,
        questions: {
          create: questions.map((q) => ({
            questionText: q.questionText,
            helpText: q.helpText,
            questionType: q.questionType,
            options: q.options === null ? Prisma.JsonNull : q.options,
            config: q.config === null ? Prisma.JsonNull : q.config,
            isRequired: q.isRequired,
            sortOrder: q.sortOrder,
            isActive: q.isActive,
          })),
        },
      },
    });

    return created;
  }

  /** Cron: send due one-shot surveys, or clone+send recurring templates. */
  async runDueDistributions() {
    const now = new Date();
    const due = await this.prisma.survey.findMany({
      where: {
        deletedAt: null,
        distributedAt: null,
        distributeAt: { lte: now },
        status: { not: SurveyStatus.CLOSED },
        clonedFromId: null,
      },
      orderBy: { distributeAt: 'asc' },
      take: 25,
    });

    const out: Array<{ surveyId: string; ok: boolean; detail: string }> = [];
    for (const survey of due) {
      const actorId = survey.createdById ?? survey.updatedById ?? survey.id;
      const periodAt = survey.distributeAt ?? now;

      try {
        if (survey.recurrence) {
          const clone = await this.cloneSurveyForPeriod(
            {
              id: survey.id,
              title: survey.title,
              description: survey.description,
              targetKind: survey.targetKind,
              isAnonymous: survey.isAnonymous,
              opensAt: survey.opensAt,
              closesAt: survey.closesAt,
              locationIds: survey.locationIds,
              roleIds: survey.roleIds,
              recurrence: survey.recurrence,
              createdById: survey.createdById,
            },
            periodAt,
            actorId,
          );
          const res = await this.send(actorId, clone.id, {});
          const nextAt = nextSurveyDistributeAt(periodAt, survey.recurrence, now);
          await this.prisma.survey.update({
            where: { id: survey.id },
            data: {
              distributeAt: nextAt,
              distributedAt: null,
              updatedById: actorId || undefined,
            },
          });
          out.push({
            surveyId: survey.id,
            ok: true,
            detail: `cloned ${clone.id}, sent ${res.data.sent}, next ${nextAt.toISOString()}`,
          });
        } else {
          const res = await this.send(actorId, survey.id, {});
          out.push({
            surveyId: survey.id,
            ok: true,
            detail: `sent ${res.data.sent}, skipped ${res.data.skippedExisting}`,
          });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Distribution failed';
        out.push({ surveyId: survey.id, ok: false, detail: message });
        if (!message.includes('Add at least one question')) {
          if (survey.recurrence && survey.distributeAt) {
            // Skip this period so the job does not retry every minute.
            const nextAt = nextSurveyDistributeAt(survey.distributeAt, survey.recurrence, now);
            await this.prisma.survey.update({
              where: { id: survey.id },
              data: { distributeAt: nextAt, distributedAt: null },
            });
          } else {
            await this.prisma.survey.update({
              where: { id: survey.id },
              data: { distributedAt: now },
            });
          }
        }
      }
    }
    return out;
  }

  /** Basic results rollup: recipient/response counts by status + per-question summary.
   * Recurring templates include recipients from all period clones.
   */
  async results(surveyId: string) {
    const survey = await this.requireSurvey(surveyId);
    const surveyIds = [surveyId];
    if (survey.recurrence && !survey.clonedFromId) {
      const clones = await this.prisma.survey.findMany({
        where: { clonedFromId: surveyId, deletedAt: null },
        select: { id: true },
      });
      surveyIds.push(...clones.map((c) => c.id));
    }

    const where = { surveyId: { in: surveyIds } };
    const [recipients, completed, questions, answers] = await Promise.all([
      this.prisma.surveyRecipient.count({ where }),
      this.prisma.surveyRecipient.count({ where: { ...where, status: 'COMPLETED' } }),
      this.prisma.surveyQuestion.findMany({
        where: { surveyId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.surveyAnswer.findMany({
        where: { response: { recipient: { surveyId: { in: surveyIds } } } },
        include: {
          question: {
            select: {
              id: true,
              surveyId: true,
              questionText: true,
              questionType: true,
              sortOrder: true,
              options: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      message: 'Survey results',
      data: {
        recipients,
        completed,
        responseRate: recipients > 0 ? Math.round((completed / recipients) * 100) : 0,
        includesPeriodRuns: surveyIds.length > 1,
        questionSummaries: this.buildQuestionSummaries(questions, answers),
      },
    };
  }

  private async loadUserNameMap(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    for (const u of users) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
      map.set(u.id, name || u.email || 'User');
    }
    return map;
  }

  private buildQuestionSummaries(
    questions: Array<{
      id: string;
      questionText: string;
      questionType: SurveyQuestionType;
      sortOrder: number;
      options: Prisma.JsonValue;
    }>,
    answers: Array<{
      booleanValue: boolean | null;
      textValue: string | null;
      numberValue: Prisma.Decimal | null;
      selectedOptions: Prisma.JsonValue;
      question: {
        id: string;
        surveyId: string;
        questionText: string;
        questionType: SurveyQuestionType;
        sortOrder: number;
        options: Prisma.JsonValue;
      };
    }>,
  ) {
    const byKey = new Map<string, typeof answers>();
    for (const a of answers) {
      const key = `${a.question.sortOrder}::${a.question.questionType}::${a.question.questionText}`;
      const list = byKey.get(key) ?? [];
      list.push(a);
      byKey.set(key, list);
    }

    return questions.map((q) => {
      const key = `${q.sortOrder}::${q.questionType}::${q.questionText}`;
      const qAnswers = byKey.get(key) ?? [];
      const answerCount = qAnswers.length;
      const base = {
        questionId: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        sortOrder: q.sortOrder,
        answerCount,
      };

      if (
        q.questionType === SurveyQuestionType.YES_NO ||
        q.questionType === SurveyQuestionType.SINGLE_SELECT ||
        q.questionType === SurveyQuestionType.MULTI_SELECT ||
        q.questionType === SurveyQuestionType.LIKERT
      ) {
        const counts = new Map<string, number>();
        if (q.questionType === SurveyQuestionType.YES_NO) {
          counts.set('Yes', 0);
          counts.set('No', 0);
          for (const a of qAnswers) {
            if (a.booleanValue === true) counts.set('Yes', (counts.get('Yes') ?? 0) + 1);
            else if (a.booleanValue === false) counts.set('No', (counts.get('No') ?? 0) + 1);
          }
        } else {
          const configured =
            q.questionType === SurveyQuestionType.LIKERT
              ? this.normalizeOptions(q.questionType, q.options) ?? []
              : this.asStringArray(q.options);
          for (const opt of configured) counts.set(opt, 0);
          for (const a of qAnswers) {
            const selected = Array.isArray(a.selectedOptions)
              ? a.selectedOptions.filter((v): v is string => typeof v === 'string')
              : [];
            for (const opt of selected) {
              counts.set(opt, (counts.get(opt) ?? 0) + 1);
            }
          }
        }
        const options = [...counts.entries()].map(([label, count]) => ({
          label,
          count,
          percent: answerCount > 0 ? Math.round((count / answerCount) * 100) : 0,
        }));
        return { ...base, options };
      }

      if (
        q.questionType === SurveyQuestionType.NUMBER ||
        q.questionType === SurveyQuestionType.RATING
      ) {
        const nums = qAnswers
          .map((a) => (a.numberValue === null || a.numberValue === undefined ? null : Number(a.numberValue)))
          .filter((n): n is number => n !== null && !Number.isNaN(n));
        const sum = nums.reduce((acc, n) => acc + n, 0);
        return {
          ...base,
          numeric: {
            average: nums.length ? Math.round((sum / nums.length) * 100) / 100 : null,
            min: nums.length ? Math.min(...nums) : null,
            max: nums.length ? Math.max(...nums) : null,
          },
        };
      }

      const textSamples = qAnswers
        .map((a) => a.textValue?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 5);
      return { ...base, textSamples };
    });
  }

  /** Admin: submitted responses with answers (respects anonymous surveys). */
  async listResponses(surveyId: string) {
    const survey = await this.requireSurvey(surveyId);
    const rows = await this.prisma.surveyResponse.findMany({
      where: { recipient: { surveyId } },
      orderBy: { submittedAt: 'desc' },
      include: {
        recipient: {
          select: { id: true, employeeId: true, serviceUserId: true },
        },
        answers: {
          include: {
            question: {
              select: {
                id: true,
                questionText: true,
                questionType: true,
                sortOrder: true,
              },
            },
          },
        },
      },
    });

    const nameById = survey.isAnonymous
      ? new Map<string, string>()
      : await this.loadRecipientNames(rows.map((r) => r.recipient));
    const recorderIds = [
      ...new Set(rows.map((r) => r.recordedById).filter((id): id is string => Boolean(id))),
    ];
    const recorders = recorderIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: recorderIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const recorderName = new Map(
      recorders.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]),
    );

    const chronological = [...rows].sort(
      (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime(),
    );
    const indexById = new Map(chronological.map((r, i) => [r.id, i + 1]));

    return {
      message: 'Survey responses',
      data: {
        isAnonymous: survey.isAnonymous,
        total: rows.length,
        responses: rows.map((row) => {
          const seq = indexById.get(row.id) ?? 1;
          let respondentLabel: string;
          let employeeId: string | null = null;
          let serviceUserId: string | null = null;
          const hideIdentity = survey.isAnonymous || row.isAnonymous;
          if (hideIdentity) {
            respondentLabel = `Anonymous respondent #${seq}`;
          } else if (row.recipient.employeeId) {
            employeeId = row.recipient.employeeId;
            respondentLabel = nameById.get(row.recipient.employeeId) ?? 'Employee';
          } else if (row.recipient.serviceUserId) {
            serviceUserId = row.recipient.serviceUserId;
            respondentLabel =
              nameById.get(row.recipient.serviceUserId) ?? 'Service user';
          } else {
            respondentLabel = `Open-link respondent #${seq}`;
          }

          const answers = [...row.answers]
            .sort((a, b) => a.question.sortOrder - b.question.sortOrder)
            .map((a) => ({
              questionId: a.question.id,
              questionText: a.question.questionText,
              questionType: a.question.questionType,
              booleanValue: a.booleanValue,
              textValue: a.textValue,
              numberValue:
                a.numberValue === null || a.numberValue === undefined
                  ? null
                  : Number(a.numberValue),
              selectedOptions: Array.isArray(a.selectedOptions)
                ? (a.selectedOptions as string[])
                : null,
              displayValue: this.formatAnswerDisplay({
                questionType: a.question.questionType,
                booleanValue: a.booleanValue,
                textValue: a.textValue,
                numberValue:
                  a.numberValue === null || a.numberValue === undefined
                    ? null
                    : Number(a.numberValue),
                selectedOptions: a.selectedOptions,
              }),
            }));

          return {
            id: row.id,
            submittedAt: row.submittedAt.toISOString(),
            respondentLabel,
            employeeId,
            serviceUserId,
            respondentRelation: row.respondentRelation,
            // Who answered on the service user's behalf — hidden on anonymous surveys / responses.
            respondentName: hideIdentity ? null : row.respondentName,
            channel: row.channel,
            isAnonymous: row.isAnonymous,
            recordedByName: row.recordedById ? (recorderName.get(row.recordedById) ?? null) : null,
            contactedAt: row.contactedAt?.toISOString() ?? null,
            contactNumber: hideIdentity ? null : row.contactNumber,
            contactNotes: row.contactNotes,
            consentGiven: row.consentGiven,
            // Only staff-recorded responses can be corrected; people's own answers never change.
            canEdit: isStaffRecordedChannel(row.channel),
            answerCount: answers.length,
            answers,
          };
        }),
      },
    };
  }

  /** People this survey can be recorded for (its target), with their recipient status. */
  async listRecordCandidates(surveyId: string, search?: string) {
    const survey = await this.requireSurvey(surveyId);
    const q = search?.trim();
    const forServiceUsers = survey.targetKind === SurveyTargetKind.SERVICE_USER;
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

    let people: Array<{ id: string; name: string }>;
    if (forServiceUsers) {
      const rows = await this.prisma.serviceUser.findMany({
        where: {
          deletedAt: null,
          NOT: { status: { is: { code: { in: [...SURVEY_EXCLUDED_SERVICE_USER_STATUSES] } } } },
          ...(survey.locationIds.length ? { locationId: { in: survey.locationIds } } : {}),
          ...(q
            ? {
                OR: [
                  { firstName: contains(q) },
                  { lastName: contains(q) },
                  { serviceUserNumber: contains(q) },
                ],
              }
            : {}),
        },
        select: { id: true, firstName: true, lastName: true, serviceUserNumber: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 25,
      });
      people = rows.map((r) => {
        const name = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || 'Service user';
        return { id: r.id, name: r.serviceUserNumber ? `${name} (${r.serviceUserNumber})` : name };
      });
    } else {
      const employmentScope: Prisma.EmployeeEmploymentWhereInput = {};
      if (survey.locationIds.length) employmentScope.locationId = { in: survey.locationIds };
      // roleIds holds Job Title ids.
      if (survey.roleIds.length) employmentScope.jobTitleId = { in: survey.roleIds };
      const rows = await this.prisma.employee.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          ...(Object.keys(employmentScope).length ? { employment: employmentScope } : {}),
          ...(q
            ? { personalDetail: { OR: [{ firstName: contains(q) }, { lastName: contains(q) }] } }
            : {}),
        },
        select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
        take: 25,
      });
      people = rows
        .map((r) => ({
          id: r.id,
          name:
            `${r.personalDetail?.firstName ?? ''} ${r.personalDetail?.lastName ?? ''}`.trim() ||
            'Employee',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    const ids = people.map((p) => p.id);
    const recipients = ids.length
      ? await this.prisma.surveyRecipient.findMany({
          where: forServiceUsers
            ? { surveyId, serviceUserId: { in: ids } }
            : { surveyId, employeeId: { in: ids } },
          select: {
            employeeId: true,
            serviceUserId: true,
            status: true,
            response: { select: { id: true } },
          },
        })
      : [];
    const recipientByPerson = new Map(
      recipients.map((r) => [(forServiceUsers ? r.serviceUserId : r.employeeId) as string, r]),
    );

    return {
      message: 'Survey record candidates',
      data: people.map((p) => {
        const recipient = recipientByPerson.get(p.id);
        return {
          id: p.id,
          name: p.name,
          recipientStatus: recipient?.status ?? null,
          hasResponse: Boolean(recipient?.response),
        };
      }),
    };
  }

  /**
   * Office staff record a response collected by telephone, from paper or in person —
   * for a named person (their survey becomes Completed) or anonymously (linked to no one).
   */
  async recordResponse(
    userId: string,
    surveyId: string,
    dto: RecordSurveyResponseDto,
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.requireSurvey(surveyId);
    if (survey.status === SurveyStatus.DRAFT) {
      throw new BadRequestException('Publish the survey before recording responses');
    }
    const forServiceUsers = survey.targetKind === SurveyTargetKind.SERVICE_USER;
    const anonymous = Boolean(dto.isAnonymous);
    if (!anonymous && !dto.personId) {
      throw new BadRequestException(
        `Choose the ${forServiceUsers ? 'service user' : 'employee'} or record the response as anonymous`,
      );
    }
    const isTelephone = dto.channel === SurveyResponseChannel.TELEPHONE;
    if (isTelephone && dto.consentGiven !== true) {
      throw new BadRequestException('Confirm the person agreed to answer over the phone');
    }

    const relation = dto.respondentRelation ?? null;
    const respondentName =
      anonymous || !relation || relation === SurveyRespondentRelation.SELF
        ? null
        : dto.respondentName?.trim() || null;

    let existingRecipient: { id: string; response: { id: string } | null } | null = null;
    if (!anonymous) {
      const personId = dto.personId!;
      const person = forServiceUsers
        ? await this.prisma.serviceUser.findFirst({
            where: { id: personId, deletedAt: null },
            select: { id: true },
          })
        : await this.prisma.employee.findFirst({
            where: { id: personId, deletedAt: null },
            select: { id: true },
          });
      if (!person) {
        throw new NotFoundException(forServiceUsers ? 'Service user not found' : 'Employee not found');
      }
      existingRecipient = await this.prisma.surveyRecipient.findFirst({
        where: forServiceUsers ? { surveyId, serviceUserId: personId } : { surveyId, employeeId: personId },
        select: { id: true, response: { select: { id: true } } },
      });
      if (existingRecipient?.response) {
        throw new BadRequestException(
          'This person has already answered this survey. Edit the recorded response instead.',
        );
      }
    }

    const { questions, answerByQuestion } = await this.validateAnswers(surveyId, dto);
    const now = new Date();

    let response;
    try {
      response = await this.prisma.$transaction(async (tx) => {
        const recipientId = existingRecipient
          ? (
              await tx.surveyRecipient.update({
                where: { id: existingRecipient.id },
                data: { status: 'COMPLETED' },
              })
            ).id
          : (
              await tx.surveyRecipient.create({
                data: {
                  surveyId,
                  targetKind: survey.targetKind,
                  employeeId: !anonymous && !forServiceUsers ? dto.personId! : null,
                  serviceUserId: !anonymous && forServiceUsers ? dto.personId! : null,
                  token: randomUUID(),
                  status: 'COMPLETED',
                  sentAt: now,
                  createdById: userId || null,
                },
              })
            ).id;

        return tx.surveyResponse.create({
          data: {
            recipientId,
            submittedById: null,
            respondentRelation: relation,
            respondentName,
            channel: dto.channel as SurveyResponseChannel,
            recordedById: userId || null,
            isAnonymous: anonymous,
            contactedAt: dto.contactedAt ? new Date(dto.contactedAt) : isTelephone ? now : null,
            // The number would identify an anonymous respondent.
            contactNumber: anonymous ? null : dto.contactNumber?.trim() || null,
            contactNotes: dto.contactNotes?.trim() || null,
            consentGiven: isTelephone ? true : null,
            submittedAt: now,
            answers: { create: this.mapAnswersForCreate(questions, answerByQuestion) },
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('This person has already answered this survey.');
      }
      throw e;
    }

    await this.audit.logAudit({
      userId: userId || undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_RESPONSE_RECORDED,
      recordType: 'SurveyResponse',
      recordId: response.id,
      newValues: {
        surveyId,
        channel: dto.channel,
        isAnonymous: anonymous,
        respondentRelation: relation,
        answerCount: dto.answers.length,
      },
      metadata: { surveyId },
      ...meta,
    });

    return {
      message: 'Survey response recorded',
      data: { id: response.id, submittedAt: now.toISOString() },
    };
  }

  /** Correct a staff-recorded response; the reason and before / after answers go to the audit log. */
  async updateRecordedResponse(
    userId: string,
    surveyId: string,
    responseId: string,
    dto: UpdateRecordedSurveyResponseDto,
    meta?: RequestAuditMeta,
  ) {
    await this.requireSurvey(surveyId);
    const answerInclude = {
      answers: {
        include: { question: { select: { questionText: true, questionType: true, sortOrder: true } } },
      },
    } as const;
    const existing = await this.prisma.surveyResponse.findFirst({
      where: { id: responseId, recipient: { surveyId } },
      include: answerInclude,
    });
    if (!existing) throw new NotFoundException('Survey response not found');
    if (!isStaffRecordedChannel(existing.channel)) {
      throw new BadRequestException(
        'Only responses recorded by staff (telephone, paper or in person) can be edited.',
      );
    }

    const { questions, answerByQuestion } = await this.validateAnswers(surveyId, dto);
    const relation = dto.respondentRelation ?? null;
    const respondentName =
      existing.isAnonymous || !relation || relation === SurveyRespondentRelation.SELF
        ? null
        : dto.respondentName?.trim() || null;

    const snapshot = (rows: typeof existing.answers) =>
      [...rows]
        .sort((a, b) => a.question.sortOrder - b.question.sortOrder)
        .map((a) => ({
          question: a.question.questionText,
          answer: this.formatAnswerDisplay({
            questionType: a.question.questionType,
            booleanValue: a.booleanValue,
            textValue: a.textValue,
            numberValue: a.numberValue == null ? null : Number(a.numberValue),
            selectedOptions: a.selectedOptions,
          }),
        }));
    const before = snapshot(existing.answers);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.surveyAnswer.deleteMany({ where: { responseId } });
      return tx.surveyResponse.update({
        where: { id: responseId },
        data: {
          respondentRelation: relation,
          respondentName,
          contactedAt: dto.contactedAt ? new Date(dto.contactedAt) : existing.contactedAt,
          contactNumber: existing.isAnonymous ? null : dto.contactNumber?.trim() || null,
          contactNotes: dto.contactNotes?.trim() || null,
          answers: { create: this.mapAnswersForCreate(questions, answerByQuestion) },
        },
        include: answerInclude,
      });
    });

    const reason = dto.reason.trim();
    await this.audit.logAudit({
      userId: userId || undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_RESPONSE_UPDATED,
      recordType: 'SurveyResponse',
      recordId: responseId,
      description: reason,
      oldValues: { answers: before },
      newValues: { answers: snapshot(updated.answers) },
      metadata: { surveyId, reason, channel: existing.channel },
      ...meta,
    });

    return { message: 'Survey response updated', data: { id: responseId } };
  }

  private formatAnswerDisplay(input: {
    questionType: SurveyQuestionType;
    booleanValue: boolean | null;
    textValue: string | null;
    numberValue: number | null;
    selectedOptions: unknown;
  }): string {
    switch (input.questionType) {
      case SurveyQuestionType.YES_NO:
        if (input.booleanValue === true) return 'Yes';
        if (input.booleanValue === false) return 'No';
        return '—';
      case SurveyQuestionType.SINGLE_SELECT:
      case SurveyQuestionType.LIKERT:
      case SurveyQuestionType.MULTI_SELECT: {
        const opts = Array.isArray(input.selectedOptions)
          ? input.selectedOptions.filter((v): v is string => typeof v === 'string')
          : [];
        return opts.length ? opts.join(', ') : '—';
      }
      case SurveyQuestionType.TEXT:
      case SurveyQuestionType.TEXTAREA:
        return input.textValue?.trim() || '—';
      case SurveyQuestionType.NUMBER:
      case SurveyQuestionType.RATING:
        return input.numberValue === null || Number.isNaN(input.numberValue)
          ? '—'
          : String(input.numberValue);
      default:
        return '—';
    }
  }

  /** Admin: who the survey was sent to and whether each person has completed it. */
  async listRecipients(surveyId: string) {
    const survey = await this.requireSurvey(surveyId);
    const rows = await this.prisma.surveyRecipient.findMany({
      where: { surveyId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        token: true,
        status: true,
        employeeId: true,
        serviceUserId: true,
        sentAt: true,
        createdAt: true,
        response: {
          select: {
            submittedAt: true,
            respondentRelation: true,
            respondentName: true,
          },
        },
      },
    });
    const nameById = await this.loadRecipientNames(rows);

    return {
      message: 'Survey recipients',
      data: rows.map((r) => ({
        id: r.id,
        token: r.token,
        status: r.status,
        employeeId: r.employeeId,
        employeeName: r.employeeId ? (nameById.get(r.employeeId) ?? 'Employee') : null,
        serviceUserId: r.serviceUserId,
        serviceUserName: r.serviceUserId
          ? (nameById.get(r.serviceUserId) ?? 'Service user')
          : null,
        sentAt: r.sentAt?.toISOString() ?? null,
        submittedAt: r.response?.submittedAt?.toISOString() ?? null,
        respondentRelation: r.response?.respondentRelation ?? null,
        respondentName: survey.isAnonymous
          ? null
          : (r.response?.respondentName ?? null),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Display names for employee / service-user recipients, keyed by their id. */
  private async loadRecipientNames(
    recipients: Array<{
      employeeId: string | null;
      serviceUserId: string | null;
    }>,
  ): Promise<Map<string, string>> {
    const employeeIds = recipients
      .map((r) => r.employeeId)
      .filter((id): id is string => Boolean(id));
    const serviceUserIds = recipients
      .map((r) => r.serviceUserId)
      .filter((id): id is string => Boolean(id));
    const [employees, serviceUsers] = await Promise.all([
      employeeIds.length
        ? this.prisma.employeePersonalDetail.findMany({
            where: { employeeId: { in: employeeIds } },
            select: { employeeId: true, firstName: true, lastName: true },
          })
        : [],
      serviceUserIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: serviceUserIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
    ]);
    const map = new Map<string, string>();
    for (const e of employees) {
      map.set(
        e.employeeId,
        `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || 'Employee',
      );
    }
    for (const su of serviceUsers) {
      map.set(
        su.id,
        `${su.firstName ?? ''} ${su.lastName ?? ''}`.trim() || 'Service user',
      );
    }
    return map;
  }

  /** Portal: surveys sent to this service user (open ones first). */
  async listForServiceUserPortal(serviceUserId: string) {
    const rows = await this.prisma.surveyRecipient.findMany({
      where: {
        serviceUserId,
        survey: { deletedAt: null, status: { not: SurveyStatus.DRAFT } },
      },
      orderBy: { sentAt: 'desc' },
      select: {
        token: true,
        status: true,
        sentAt: true,
        survey: {
          select: {
            title: true,
            description: true,
            status: true,
            opensAt: true,
            closesAt: true,
          },
        },
        response: { select: { submittedAt: true, respondentRelation: true } },
      },
    });

    const items = rows.map((r) => {
      const completed = Boolean(r.response) || r.status === 'COMPLETED';
      const availability = this.evaluateAvailability(r.survey, completed);
      const state: 'OPEN' | 'UNAVAILABLE' | 'COMPLETED' = completed
        ? 'COMPLETED'
        : availability.canSubmit
          ? 'OPEN'
          : 'UNAVAILABLE';
      return {
        token: r.token,
        title: r.survey.title,
        description: r.survey.description,
        sentAt: r.sentAt?.toISOString() ?? null,
        opensAt: r.survey.opensAt?.toISOString() ?? null,
        closesAt: r.survey.closesAt?.toISOString() ?? null,
        state,
        unavailableReason: completed ? null : availability.reason,
        completedAt: r.response?.submittedAt?.toISOString() ?? null,
        respondentRelation: r.response?.respondentRelation ?? null,
      };
    });
    const order = { OPEN: 0, UNAVAILABLE: 1, COMPLETED: 2 } as const;
    items.sort((a, b) => order[a.state] - order[b.state]);
    return { message: 'Portal surveys', data: items };
  }

  /**
   * Carer app: surveys sent to the signed-in employee. Open surveys carry their
   * questions so the app can keep them for answering offline.
   */
  async listForEmployeeApp(employeeId: string) {
    const rows = await this.prisma.surveyRecipient.findMany({
      where: {
        employeeId,
        targetKind: SurveyTargetKind.EMPLOYEE,
        survey: { deletedAt: null, status: { not: SurveyStatus.DRAFT } },
      },
      orderBy: { sentAt: 'desc' },
      select: {
        token: true,
        status: true,
        sentAt: true,
        survey: {
          select: {
            id: true,
            title: true,
            description: true,
            isAnonymous: true,
            status: true,
            opensAt: true,
            closesAt: true,
          },
        },
        response: { select: { submittedAt: true } },
      },
    });

    const items = rows.map((r) => {
      const completed = Boolean(r.response) || r.status === 'COMPLETED';
      const availability = this.evaluateAvailability(r.survey, completed);
      const state: 'OPEN' | 'UNAVAILABLE' | 'COMPLETED' = completed
        ? 'COMPLETED'
        : availability.canSubmit
          ? 'OPEN'
          : 'UNAVAILABLE';
      return { r, state, reason: completed ? null : availability.reason };
    });

    const openSurveyIds = [
      ...new Set(items.filter((i) => i.state === 'OPEN').map((i) => i.r.survey.id)),
    ];
    const questions = openSurveyIds.length
      ? await this.prisma.surveyQuestion.findMany({
          where: { surveyId: { in: openSurveyIds }, deletedAt: null, isActive: true },
          orderBy: { sortOrder: 'asc' },
        })
      : [];
    const formQuestions = questions.map((q) => ({
      surveyId: q.surveyId,
      question: this.toFormQuestion(q),
    }));
    const questionsBySurvey = new Map<string, (typeof formQuestions)[number]['question'][]>();
    for (const { surveyId, question } of formQuestions) {
      const list = questionsBySurvey.get(surveyId) ?? [];
      list.push(question);
      questionsBySurvey.set(surveyId, list);
    }

    const data = items.map(({ r, state, reason }) => ({
      token: r.token,
      title: r.survey.title,
      description: r.survey.description,
      isAnonymous: r.survey.isAnonymous,
      sentAt: r.sentAt?.toISOString() ?? null,
      opensAt: r.survey.opensAt?.toISOString() ?? null,
      closesAt: r.survey.closesAt?.toISOString() ?? null,
      state,
      unavailableReason: reason,
      completedAt: r.response?.submittedAt?.toISOString() ?? null,
      questions: state === 'OPEN' ? (questionsBySurvey.get(r.survey.id) ?? []) : [],
    }));
    const order = { OPEN: 0, UNAVAILABLE: 1, COMPLETED: 2 } as const;
    data.sort((a, b) => order[a.state] - order[b.state]);
    return { message: 'My surveys', data };
  }

  /** Carer app: one of the employee's own surveys (marks it started, like opening the link). */
  async getEmployeeAppForm(employeeId: string, token: string) {
    await this.requireEmployeeRecipient(employeeId, token);
    return this.getPublicByToken(token);
  }

  /**
   * Carer app: submit answers for one of the employee's own surveys.
   * Already answered (e.g. via the email link, or a replayed offline send) → 409.
   */
  async submitEmployeeAppResponse(
    employeeId: string,
    token: string,
    dto: SubmitSurveyResponseDto,
    meta?: RequestAuditMeta,
  ) {
    const recipient = await this.requireEmployeeRecipient(employeeId, token);
    if (recipient.response || recipient.status === 'COMPLETED') {
      throw new ConflictException('You have already completed this survey.');
    }
    return this.submitRecipientResponse(recipient, dto, meta);
  }

  private async requireEmployeeRecipient(employeeId: string, token: string) {
    const recipient = await this.requireRecipientByToken(token);
    if (
      recipient.employeeId !== employeeId ||
      recipient.targetKind !== SurveyTargetKind.EMPLOYEE
    ) {
      throw new NotFoundException('Survey link not found');
    }
    return recipient;
  }

  /** Portal: the answers the signed-in service user (or their representative) submitted. */
  async getPortalSurveyAnswers(serviceUserId: string, token: string) {
    return this.loadOwnSurveyAnswers({ token: token?.trim(), serviceUserId });
  }

  /** Carer app: the answers the signed-in employee submitted for one of their surveys. */
  async getEmployeeAppAnswers(employeeId: string, token: string) {
    return this.loadOwnSurveyAnswers({
      token: token?.trim(),
      employeeId,
      targetKind: SurveyTargetKind.EMPLOYEE,
    });
  }

  private async loadOwnSurveyAnswers(where: Prisma.SurveyRecipientWhereInput) {
    const recipient = await this.prisma.surveyRecipient.findFirst({
      where: {
        ...where,
        survey: { deletedAt: null },
      },
      select: {
        survey: { select: { title: true } },
        response: {
          select: {
            submittedAt: true,
            respondentRelation: true,
            respondentName: true,
            answers: {
              select: {
                booleanValue: true,
                textValue: true,
                numberValue: true,
                selectedOptions: true,
                question: {
                  select: {
                    id: true,
                    questionText: true,
                    questionType: true,
                    sortOrder: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!recipient?.response)
      throw new NotFoundException('No submitted answers found for this survey');
    const { response } = recipient;
    const answers = [...response.answers]
      .sort((a, b) => a.question.sortOrder - b.question.sortOrder)
      .map((a) => ({
        questionId: a.question.id,
        questionText: a.question.questionText,
        displayValue: this.formatAnswerDisplay({
          questionType: a.question.questionType,
          booleanValue: a.booleanValue,
          textValue: a.textValue,
          numberValue:
            a.numberValue === null || a.numberValue === undefined
              ? null
              : Number(a.numberValue),
          selectedOptions: a.selectedOptions,
        }),
      }));
    return {
      message: 'Your survey answers',
      data: {
        title: recipient.survey.title,
        submittedAt: response.submittedAt.toISOString(),
        respondentRelation: response.respondentRelation,
        respondentName: response.respondentName,
        answers,
      },
    };
  }

  /** Public: load survey form by survey share token OR recipient token. */
  async getPublicByToken(token: string) {
    const cleaned = token?.trim();
    if (!cleaned) throw new NotFoundException('Survey link not found');

    const byShare = await this.prisma.survey.findFirst({
      where: { shareToken: cleaned, deletedAt: null },
    });
    if (byShare) {
      if (byShare.targetKind === SurveyTargetKind.SERVICE_USER) {
        throw new NotFoundException(
          'This survey is only available in the service user portal.',
        );
      }
      return this.buildPublicForm(byShare, {
        alreadyCompleted: false,
        linkKind: 'share',
      });
    }

    const recipient = await this.requireRecipientByToken(cleaned);
    const survey = recipient.survey;
    const forServiceUser =
      recipient.targetKind === SurveyTargetKind.SERVICE_USER;
    const su =
      forServiceUser && recipient.serviceUserId
        ? await this.prisma.serviceUser.findFirst({
            where: { id: recipient.serviceUserId },
            select: { firstName: true, lastName: true },
          })
        : null;
    const alreadyCompleted = Boolean(recipient.response) || recipient.status === 'COMPLETED';

    if (
      !alreadyCompleted &&
      (recipient.status === 'SENT' || recipient.status === 'PENDING')
    ) {
      await this.prisma.surveyRecipient.update({
        where: { id: recipient.id },
        data: { status: 'STARTED' },
      });
    }

    return this.buildPublicForm(survey, {
      alreadyCompleted,
      linkKind: 'recipient',
      askRespondent: forServiceUser,
      forName: su ? `${su.firstName} ${su.lastName}`.trim() : null,
    });
  }

  /** Public: submit answers via survey share token OR recipient token. */
  async submitPublicResponse(
    token: string,
    dto: SubmitSurveyResponseDto,
    meta?: RequestAuditMeta,
  ) {
    const cleaned = token?.trim();
    if (!cleaned) throw new NotFoundException('Survey link not found');

    const byShare = await this.prisma.survey.findFirst({
      where: { shareToken: cleaned, deletedAt: null },
    });
    if (byShare) {
      if (byShare.targetKind === SurveyTargetKind.SERVICE_USER) {
        throw new NotFoundException(
          'This survey is only available in the service user portal.',
        );
      }
      return this.submitOpenShareResponse(byShare, dto, meta);
    }

    const recipient = await this.requireRecipientByToken(cleaned);
    return this.submitRecipientResponse(recipient, dto, meta);
  }

  private async buildPublicForm(
    survey: {
      id: string;
      title: string;
      description: string | null;
      isAnonymous: boolean;
      status: SurveyStatus;
      opensAt: Date | null;
      closesAt: Date | null;
    },
    opts: {
      alreadyCompleted: boolean;
      linkKind: 'share' | 'recipient';
      /** Service-user links: ask who is answering (self / family member / representative). */
      askRespondent?: boolean;
      /** Service-user links: whose survey this is, so family / representatives can see. */
      forName?: string | null;
    },
  ) {
    const availability = this.evaluateAvailability(survey, opts.alreadyCompleted);
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId: survey.id, deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    return {
      message: 'Public survey',
      data: {
        title: survey.title,
        description: survey.description,
        isAnonymous: survey.isAnonymous,
        status: survey.status,
        opensAt: survey.opensAt?.toISOString() ?? null,
        closesAt: survey.closesAt?.toISOString() ?? null,
        alreadyCompleted: opts.alreadyCompleted,
        canSubmit: availability.canSubmit,
        unavailableReason: availability.reason,
        linkKind: opts.linkKind,
        askRespondent: opts.askRespondent ?? false,
        forName: opts.forName ?? null,
        questions: questions.map((q) => this.toFormQuestion(q)),
      },
    };
  }

  private toFormQuestion(q: {
    id: string;
    questionText: string;
    helpText: string | null;
    questionType: SurveyQuestionType;
    options: Prisma.JsonValue;
    config: Prisma.JsonValue;
    isRequired: boolean;
    sortOrder: number;
  }) {
    return {
      id: q.id,
      questionText: q.questionText,
      helpText: q.helpText,
      questionType: q.questionType,
      options: this.normalizeOptions(q.questionType, q.options),
      config: q.config,
      isRequired: q.isRequired,
      sortOrder: q.sortOrder,
    };
  }

  private async submitOpenShareResponse(
    survey: {
      id: string;
      status: SurveyStatus;
      opensAt: Date | null;
      closesAt: Date | null;
      isAnonymous: boolean;
      targetKind: SurveyTargetKind;
    },
    dto: SubmitSurveyResponseDto,
    meta?: RequestAuditMeta,
  ) {
    const availability = this.evaluateAvailability(survey, false);
    if (!availability.canSubmit) {
      throw new BadRequestException(availability.reason ?? 'This survey is not accepting responses');
    }

    const { questions, answerByQuestion } = await this.validateAnswers(survey.id, dto);
    const now = new Date();

    const response = await this.prisma.$transaction(async (tx) => {
      const recipient = await tx.surveyRecipient.create({
        data: {
          surveyId: survey.id,
          targetKind: survey.targetKind,
          employeeId: null,
          token: randomUUID(),
          status: 'COMPLETED',
          sentAt: now,
        },
      });

      return tx.surveyResponse.create({
        data: {
          recipientId: recipient.id,
          submittedById: null,
          submittedAt: now,
          answers: {
            create: this.mapAnswersForCreate(questions, answerByQuestion),
          },
        },
      });
    });

    await this.audit.logAudit({
      userId: undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_RESPONSE_SUBMITTED,
      recordType: 'SurveyResponse',
      recordId: response.id,
      newValues: {
        surveyId: survey.id,
        answerCount: dto.answers.length,
        isAnonymous: survey.isAnonymous,
        linkKind: 'share',
      },
      metadata: { surveyId: survey.id },
      ...meta,
    });

    return {
      message: 'Survey response submitted',
      data: { id: response.id, submittedAt: now.toISOString() },
    };
  }

  /**
   * In-app notification to office users who can see survey results
   * (surveys.read / surveys.manage, plus Super Admin). Anonymous surveys never name the carer.
   */
  private async notifyOfficeOfEmployeeResponse(surveyId: string, employeeId: string | null) {
    const recipientUserIds = await this.surveyResultsUserIds();
    if (!recipientUserIds.length) return;

    const [survey, completed, total] = await Promise.all([
      this.prisma.survey.findUnique({
        where: { id: surveyId },
        select: { title: true, isAnonymous: true },
      }),
      this.prisma.surveyRecipient.count({ where: { surveyId, status: 'COMPLETED' } }),
      this.prisma.surveyRecipient.count({ where: { surveyId } }),
    ]);
    if (!survey) return;

    let who = 'A carer';
    if (!survey.isAnonymous && employeeId) {
      const detail = await this.prisma.employeePersonalDetail.findFirst({
        where: { employeeId },
        select: { firstName: true, lastName: true },
      });
      const name = `${detail?.firstName ?? ''} ${detail?.lastName ?? ''}`.trim();
      if (name) who = name;
    }

    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.SYSTEM_MESSAGE,
      module: NotificationModule.EMPLOYEE,
      severity: NotificationSeverity.INFO,
      title: `Survey response — ${survey.title}`,
      message: `${who} completed "${survey.title}"${
        survey.isAnonymous ? ' (anonymous survey)' : ''
      }. ${completed} of ${total} responded.`,
      recordType: 'Survey',
      recordId: surveyId,
      metadata: {
        href: `/surveys/${surveyId}/responses`,
        surveyId,
        eventType: 'SURVEY_RESPONSE_SUBMITTED',
      },
    });
  }

  private async surveyResultsUserIds(): Promise<string[]> {
    const [perms, superAdmin] = await Promise.all([
      this.prisma.permission.findMany({
        where: {
          key: { in: ['surveys.read', 'surveys.manage'] },
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      }),
      this.prisma.role.findMany({
        where: { name: IDENTITY_ROLE.SUPER_ADMIN, deletedAt: null, isActive: true },
        select: { id: true },
      }),
    ]);
    const roleLinks = perms.length
      ? await this.prisma.rolePermission.findMany({
          where: { permissionId: { in: perms.map((p) => p.id) }, role: { deletedAt: null } },
          select: { roleId: true },
        })
      : [];
    const roleIds = [
      ...new Set([...roleLinks.map((r) => r.roleId), ...superAdmin.map((r) => r.id)]),
    ];
    if (!roleIds.length) return [];
    const userRoles = await this.prisma.userRole.findMany({
      where: { roleId: { in: roleIds }, user: { deletedAt: null, isActive: true } },
      select: { userId: true },
    });
    return [...new Set(userRoles.map((ur) => ur.userId))];
  }

  private async submitRecipientResponse(
    recipient: {
      id: string;
      status: string;
      targetKind: SurveyTargetKind;
      employeeId: string | null;
      response: { id: string; submittedAt: Date } | null;
      survey: {
        id: string;
        status: SurveyStatus;
        opensAt: Date | null;
        closesAt: Date | null;
        isAnonymous: boolean;
      };
    },
    dto: SubmitSurveyResponseDto,
    meta?: RequestAuditMeta,
  ) {
    const survey = recipient.survey;
    const alreadyCompleted = Boolean(recipient.response) || recipient.status === 'COMPLETED';
    const availability = this.evaluateAvailability(survey, alreadyCompleted);
    if (!availability.canSubmit) {
      throw new BadRequestException(availability.reason ?? 'This survey is not accepting responses');
    }

    if (dto.respondentRelation === SurveyRespondentRelation.STAFF) {
      throw new BadRequestException('Please choose who is answering this survey');
    }
    let respondentRelation: SurveyRespondentRelation | null = null;
    let respondentName: string | null = null;
    if (recipient.targetKind === SurveyTargetKind.SERVICE_USER) {
      if (!dto.respondentRelation) {
        throw new BadRequestException(
          'Please choose who is answering this survey',
        );
      }
      respondentRelation = dto.respondentRelation;
      respondentName =
        respondentRelation === SurveyRespondentRelation.SELF
          ? null
          : dto.respondentName?.trim() || null;
    }

    const { questions, answerByQuestion } = await this.validateAnswers(survey.id, dto);
    const now = new Date();

    let response;
    try {
      response = await this.prisma.$transaction(async (tx) => {
        const created = await tx.surveyResponse.create({
          data: {
            recipientId: recipient.id,
            submittedById: null,
            respondentRelation,
            respondentName,
            channel:
              recipient.targetKind === SurveyTargetKind.SERVICE_USER
                ? SurveyResponseChannel.PORTAL
                : SurveyResponseChannel.ONLINE,
            submittedAt: now,
            answers: {
              create: this.mapAnswersForCreate(questions, answerByQuestion),
            },
          },
        });

        await tx.surveyRecipient.update({
          where: { id: recipient.id },
          data: { status: 'COMPLETED' },
        });

        return created;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('You have already completed this survey.');
      }
      throw e;
    }

    await this.audit.logAudit({
      userId: undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_RESPONSE_SUBMITTED,
      recordType: 'SurveyResponse',
      recordId: response.id,
      newValues: {
        surveyId: survey.id,
        recipientId: recipient.id,
        answerCount: dto.answers.length,
        isAnonymous: survey.isAnonymous,
        linkKind: 'recipient',
      },
      metadata: { surveyId: survey.id },
      ...meta,
    });

    // Carer answered (app or email link) — tell the office. Never fails the submit.
    if (recipient.targetKind === SurveyTargetKind.EMPLOYEE) {
      void this.notifyOfficeOfEmployeeResponse(survey.id, recipient.employeeId).catch(
        (err) =>
          this.logger.warn(
            `Survey ${survey.id} response notification failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
      );
    }

    return {
      message: 'Survey response submitted',
      data: { id: response.id, submittedAt: now.toISOString() },
    };
  }

  private async validateAnswers(surveyId: string, dto: SubmitSurveyResponseDto) {
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId, deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (questions.length === 0) {
      throw new BadRequestException('This survey has no questions');
    }

    const questionById = new Map(questions.map((q) => [q.id, q]));
    const answerByQuestion = new Map<string, SurveyAnswerItemDto>();
    for (const answer of dto.answers) {
      if (!questionById.has(answer.questionId)) {
        throw new BadRequestException(`Unknown question: ${answer.questionId}`);
      }
      if (answerByQuestion.has(answer.questionId)) {
        throw new BadRequestException('Duplicate answer for the same question');
      }
      answerByQuestion.set(answer.questionId, answer);
    }

    for (const question of questions) {
      const answer = answerByQuestion.get(question.id);
      if (question.isRequired && !this.hasAnswerValue(question.questionType, answer)) {
        throw new BadRequestException(`Answer required for: ${question.questionText}`);
      }
      if (answer && this.hasAnswerValue(question.questionType, answer)) {
        this.assertAnswerMatchesType(question, answer);
      }
    }

    return { questions, answerByQuestion };
  }

  private mapAnswersForCreate(
    questions: { id: string; questionType: SurveyQuestionType }[],
    answerByQuestion: Map<string, SurveyAnswerItemDto>,
  ) {
    const questionById = new Map(questions.map((q) => [q.id, q]));
    return questions
      .map((q) => answerByQuestion.get(q.id))
      .filter((a): a is SurveyAnswerItemDto => Boolean(a))
      .filter((a) => this.hasAnswerValue(questionById.get(a.questionId)!.questionType, a))
      .map((a) => ({
        questionId: a.questionId,
        booleanValue: a.booleanValue ?? null,
        textValue: a.textValue?.trim() || null,
        numberValue:
          a.numberValue === undefined || a.numberValue === null
            ? null
            : new Prisma.Decimal(a.numberValue),
        selectedOptions:
          a.selectedOptions === undefined
            ? Prisma.JsonNull
            : (a.selectedOptions as Prisma.InputJsonValue),
      }));
  }

  private async requireRecipientByToken(token: string) {
    const cleaned = token?.trim();
    if (!cleaned) throw new NotFoundException('Survey link not found');

    const recipient = await this.prisma.surveyRecipient.findUnique({
      where: { token: cleaned },
      include: {
        survey: true,
        response: { select: { id: true, submittedAt: true } },
      },
    });
    if (!recipient || recipient.survey.deletedAt) {
      throw new NotFoundException('Survey link not found');
    }
    return recipient;
  }

  private evaluateAvailability(
    survey: {
      status: SurveyStatus;
      opensAt: Date | null;
      closesAt: Date | null;
    },
    alreadyCompleted: boolean,
  ): { canSubmit: boolean; reason: string | null } {
    if (alreadyCompleted) {
      return { canSubmit: false, reason: 'You have already completed this survey.' };
    }
    if (survey.status === SurveyStatus.DRAFT) {
      return { canSubmit: false, reason: 'This survey has not been published yet.' };
    }
    if (survey.status === SurveyStatus.CLOSED) {
      return { canSubmit: false, reason: 'This survey is closed.' };
    }
    const now = Date.now();
    if (survey.opensAt && survey.opensAt.getTime() > now) {
      return { canSubmit: false, reason: 'This survey is not open yet.' };
    }
    if (survey.closesAt && survey.closesAt.getTime() < now) {
      return { canSubmit: false, reason: 'This survey has ended.' };
    }
    return { canSubmit: true, reason: null };
  }

  private normalizeOptions(questionType: SurveyQuestionType, options: unknown): string[] | null {
    if (questionType === SurveyQuestionType.LIKERT) {
      const fromDb = this.asStringArray(options);
      return fromDb.length ? fromDb : DEFAULT_LIKERT_OPTIONS;
    }
    if (
      questionType === SurveyQuestionType.SINGLE_SELECT ||
      questionType === SurveyQuestionType.MULTI_SELECT
    ) {
      return this.asStringArray(options);
    }
    return null;
  }

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string');
  }

  private hasAnswerValue(
    questionType: SurveyQuestionType,
    answer: SurveyAnswerItemDto | undefined,
  ): boolean {
    if (!answer) return false;
    switch (questionType) {
      case SurveyQuestionType.YES_NO:
        return typeof answer.booleanValue === 'boolean';
      case SurveyQuestionType.SINGLE_SELECT:
      case SurveyQuestionType.LIKERT:
      case SurveyQuestionType.MULTI_SELECT:
        return Array.isArray(answer.selectedOptions) && answer.selectedOptions.length > 0;
      case SurveyQuestionType.TEXT:
      case SurveyQuestionType.TEXTAREA:
        return Boolean(answer.textValue?.trim());
      case SurveyQuestionType.NUMBER:
      case SurveyQuestionType.RATING:
        return typeof answer.numberValue === 'number' && !Number.isNaN(answer.numberValue);
      default:
        return false;
    }
  }

  private assertAnswerMatchesType(
    question: { questionText: string; questionType: SurveyQuestionType; options: unknown; config: unknown },
    answer: SurveyAnswerItemDto,
  ) {
    const label = question.questionText;
    switch (question.questionType) {
      case SurveyQuestionType.YES_NO: {
        if (typeof answer.booleanValue !== 'boolean') {
          throw new BadRequestException(`Yes/No answer required for: ${label}`);
        }
        return;
      }
      case SurveyQuestionType.SINGLE_SELECT:
      case SurveyQuestionType.LIKERT: {
        const opts = this.normalizeOptions(question.questionType, question.options) ?? [];
        const selected = answer.selectedOptions ?? [];
        if (selected.length !== 1 || !opts.includes(selected[0]!)) {
          throw new BadRequestException(`Invalid choice for: ${label}`);
        }
        return;
      }
      case SurveyQuestionType.MULTI_SELECT: {
        const opts = this.normalizeOptions(question.questionType, question.options) ?? [];
        const selected = answer.selectedOptions ?? [];
        if (!selected.length || selected.some((s) => !opts.includes(s))) {
          throw new BadRequestException(`Invalid choices for: ${label}`);
        }
        return;
      }
      case SurveyQuestionType.TEXT:
      case SurveyQuestionType.TEXTAREA: {
        if (!answer.textValue?.trim()) {
          throw new BadRequestException(`Text answer required for: ${label}`);
        }
        return;
      }
      case SurveyQuestionType.NUMBER:
      case SurveyQuestionType.RATING: {
        if (typeof answer.numberValue !== 'number' || Number.isNaN(answer.numberValue)) {
          throw new BadRequestException(`Number answer required for: ${label}`);
        }
        if (question.questionType === SurveyQuestionType.RATING) {
          const config =
            question.config && typeof question.config === 'object'
              ? (question.config as Record<string, unknown>)
              : {};
          const min = typeof config.min === 'number' ? config.min : 0;
          const max = typeof config.max === 'number' ? config.max : 10;
          if (answer.numberValue < min || answer.numberValue > max) {
            throw new BadRequestException(`Rating must be between ${min} and ${max} for: ${label}`);
          }
        }
        return;
      }
      default:
        throw new BadRequestException(`Unsupported question type for: ${label}`);
    }
  }
}
