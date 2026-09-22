import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SurveyStatus, SurveyTargetKind } from '@prisma/client';
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

    return {
      message: 'Surveys',
      data: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        targetKind: r.targetKind,
        status: r.status,
        isAnonymous: r.isAnonymous,
        opensAt: r.opensAt?.toISOString() ?? null,
        closesAt: r.closesAt?.toISOString() ?? null,
        questionCount: r._count.questions,
        recipientCount: r._count.recipients,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
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

    let employeeIds = dto.employeeIds ?? [];
    if (employeeIds.length === 0) {
      const employees = await this.prisma.employee.findMany({
        where: { deletedAt: null },
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
          createdById: userId,
        })),
        skipDuplicates: true,
      });
    }

    const updated = await this.prisma.survey.update({
      where: { id: surveyId },
      data: { status: SurveyStatus.ACTIVE, updatedById: userId },
    });

    await this.audit.logAudit({
      userId,
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
      data: { sent: toCreate.length, skippedExisting: already.size, status: updated.status },
    };
  }

  /** Basic results rollup: recipient/response counts by status. */
  async results(surveyId: string) {
    await this.requireSurvey(surveyId);
    const [recipients, completed] = await Promise.all([
      this.prisma.surveyRecipient.count({ where: { surveyId } }),
      this.prisma.surveyRecipient.count({ where: { surveyId, status: 'COMPLETED' } }),
    ]);
    return {
      message: 'Survey results',
      data: {
        recipients,
        completed,
        responseRate: recipients > 0 ? Math.round((completed / recipients) * 100) : 0,
      },
    };
  }
}
