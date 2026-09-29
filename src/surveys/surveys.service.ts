import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SurveyQuestionType,
  SurveyRecurrence,
  SurveyStatus,
  SurveyTargetKind,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';
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

const DEFAULT_LIKERT_OPTIONS = [
  'Strongly agree',
  'Agree',
  'Neutral',
  'Disagree',
  'Strongly disagree',
];

@Injectable()
export class SurveysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: ListSurveysQueryDto) {
    const where: Prisma.SurveyWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.targetKind) where.targetKind = query.targetKind;

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
          shareToken: r.shareToken,
          questionCount: r._count.questions,
          recipientCount: recipients,
          completedCount: completed,
          responseRate: recipients > 0 ? Math.round((completed / recipients) * 100) : 0,
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
    const [recipientCount, responseCount] = await Promise.all([
      this.prisma.surveyRecipient.count({ where: { surveyId: id } }),
      this.prisma.surveyResponse.count({ where: { recipient: { surveyId: id } } }),
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
        shareToken: row.shareToken,
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
   * Send an employee survey: generate a recipient row per employee and mark the
   * survey ACTIVE. Employees-first — SERVICE_USER targeting is not wired yet.
   * If dto.distributeAt is in the future, queue the send instead.
   * With recurrence, each due run clones this survey and sends the clone.
   */
  async send(userId: string, surveyId: string, dto: SendSurveyDto, meta?: RequestAuditMeta) {
    const survey = await this.requireSurvey(surveyId);
    if (survey.targetKind !== SurveyTargetKind.EMPLOYEE) {
      throw new BadRequestException('Only employee surveys can be sent (service-user surveys are not enabled yet)');
    }
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
            status: updated.status,
            scheduled: true,
            distributeAt: updated.distributeAt?.toISOString() ?? null,
            recurrence: updated.recurrence ?? null,
          },
        };
      }
    }

    let employeeIds = dto.employeeIds ?? [];
    if (employeeIds.length === 0) {
      const empWhere: Prisma.EmployeeWhereInput = { deletedAt: null };
      if (survey.locationIds.length > 0) {
        empWhere.employment = { locationId: { in: survey.locationIds } };
      }
      const employees = await this.prisma.employee.findMany({
        where: empWhere,
        select: { id: true },
      });
      employeeIds = employees.map((e) => e.id);
    }
    if (employeeIds.length === 0) {
      throw new BadRequestException('No employees to send this survey to');
    }

    const existing = await this.prisma.surveyRecipient.findMany({
      where: { surveyId, employeeId: { in: employeeIds } },
      select: { employeeId: true },
    });
    const already = new Set(existing.map((r) => r.employeeId));
    const toCreate = employeeIds.filter((id) => !already.has(id));

    const now = new Date();
    if (toCreate.length) {
      await this.prisma.surveyRecipient.createMany({
        data: toCreate.map((employeeId) => ({
          surveyId,
          targetKind: SurveyTargetKind.EMPLOYEE,
          employeeId,
          token: randomUUID(),
          status: 'SENT' as const,
          sentAt: now,
          createdById: userId || null,
        })),
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

    await this.audit.logAudit({
      userId: userId || undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_SENT,
      recordType: 'Survey',
      recordId: surveyId,
      newValues: { sent: toCreate.length, skippedExisting: already.size, status: updated.status },
      metadata: { surveyId },
      ...meta,
    });

    return {
      message: `Survey sent to ${toCreate.length} employee(s)`,
      data: {
        sent: toCreate.length,
        skippedExisting: already.size,
        status: updated.status,
        scheduled: false,
        distributeAt: survey.distributeAt?.toISOString() ?? null,
        recurrence: survey.recurrence ?? null,
      },
    };
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

  /** Basic results rollup: recipient/response counts by status.
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
    const [recipients, completed] = await Promise.all([
      this.prisma.surveyRecipient.count({ where }),
      this.prisma.surveyRecipient.count({ where: { ...where, status: 'COMPLETED' } }),
    ]);
    return {
      message: 'Survey results',
      data: {
        recipients,
        completed,
        responseRate: recipients > 0 ? Math.round((completed / recipients) * 100) : 0,
        includesPeriodRuns: surveyIds.length > 1,
      },
    };
  }

  /** Admin: submitted responses with answers (respects anonymous surveys). */
  async listResponses(surveyId: string) {
    const survey = await this.requireSurvey(surveyId);
    const rows = await this.prisma.surveyResponse.findMany({
      where: { recipient: { surveyId } },
      orderBy: { submittedAt: 'desc' },
      include: {
        recipient: { select: { id: true, employeeId: true } },
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

    const employeeIds = survey.isAnonymous
      ? []
      : rows
          .map((r) => r.recipient.employeeId)
          .filter((id): id is string => Boolean(id));
    const employees =
      employeeIds.length === 0
        ? []
        : await this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true } },
            },
          });
    const nameById = new Map(
      employees.map((e) => {
        const first = e.personalDetail?.firstName?.trim() ?? '';
        const last = e.personalDetail?.lastName?.trim() ?? '';
        const name = `${first} ${last}`.trim();
        return [e.id, name || 'Employee'] as const;
      }),
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
          if (survey.isAnonymous) {
            respondentLabel = `Anonymous respondent #${seq}`;
          } else if (row.recipient.employeeId) {
            employeeId = row.recipient.employeeId;
            respondentLabel = nameById.get(row.recipient.employeeId) ?? 'Employee';
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
            answerCount: answers.length,
            answers,
          };
        }),
      },
    };
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

  /** Admin: recipients with per-person share tokens for copy-link. */
  async listRecipients(surveyId: string) {
    await this.requireSurvey(surveyId);
    const rows = await this.prisma.surveyRecipient.findMany({
      where: { surveyId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        token: true,
        status: true,
        employeeId: true,
        sentAt: true,
        createdAt: true,
        response: { select: { submittedAt: true } },
      },
    });

    const employeeIds = rows
      .map((r) => r.employeeId)
      .filter((id): id is string => Boolean(id));
    const employees =
      employeeIds.length === 0
        ? []
        : await this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true } },
            },
          });
    const nameById = new Map(
      employees.map((e) => {
        const first = e.personalDetail?.firstName?.trim() ?? '';
        const last = e.personalDetail?.lastName?.trim() ?? '';
        const name = `${first} ${last}`.trim();
        return [e.id, name || 'Employee'] as const;
      }),
    );

    return {
      message: 'Survey recipients',
      data: rows.map((r) => ({
        id: r.id,
        token: r.token,
        status: r.status,
        employeeId: r.employeeId,
        employeeName: r.employeeId ? (nameById.get(r.employeeId) ?? 'Employee') : null,
        sentAt: r.sentAt?.toISOString() ?? null,
        submittedAt: r.response?.submittedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
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
      return this.buildPublicForm(byShare, {
        alreadyCompleted: false,
        linkKind: 'share',
      });
    }

    const recipient = await this.requireRecipientByToken(cleaned);
    const survey = recipient.survey;
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
    opts: { alreadyCompleted: boolean; linkKind: 'share' | 'recipient' },
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
        questions: questions.map((q) => ({
          id: q.id,
          questionText: q.questionText,
          helpText: q.helpText,
          questionType: q.questionType,
          options: this.normalizeOptions(q.questionType, q.options),
          config: q.config,
          isRequired: q.isRequired,
          sortOrder: q.sortOrder,
        })),
      },
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

  private async submitRecipientResponse(
    recipient: {
      id: string;
      status: string;
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

    const { questions, answerByQuestion } = await this.validateAnswers(survey.id, dto);
    const now = new Date();

    let response;
    try {
      response = await this.prisma.$transaction(async (tx) => {
        const created = await tx.surveyResponse.create({
          data: {
            recipientId: recipient.id,
            submittedById: null,
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
