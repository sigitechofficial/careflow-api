import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataAccessType, InitialAssessmentStatus as PrismaStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { InitialAssessmentStatus } from './enums/initial-assessment-status.enum';
import { CreateInitialAssessmentSubmissionDto } from './dto/create-initial-assessment-submission.dto';
import { UpdateInitialAssessmentSubmissionDto } from './dto/update-initial-assessment-submission.dto';
import { InitialAssessmentQueryDto } from './dto/initial-assessment-query.dto';
import { SaveInitialAssessmentAnswersDto } from './dto/save-initial-assessment-answers.dto';
import { SubmitInitialAssessmentDto } from './dto/submit-initial-assessment.dto';
import { ReviewInitialAssessmentDto } from './dto/review-initial-assessment.dto';
import { UpdateInitialAssessmentStatusDto } from './dto/update-initial-assessment-status.dto';
import { InitialAssessmentNotificationHook } from './initial-assessment-notification.hook';

const submissionInclude = {
  template: { select: { id: true, name: true, version: true } },
  submittedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
  reviewedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
} satisfies Prisma.InitialAssessmentSubmissionInclude;

const EDITABLE_STATUSES: PrismaStatus[] = [PrismaStatus.DRAFT, PrismaStatus.IN_PROGRESS];

@Injectable()
export class InitialAssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: InitialAssessmentNotificationHook,
  ) {}

  private async ensureServiceUser(serviceUserId: string) {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
    });
    if (!su) throw new NotFoundException('Service user not found');
    return su;
  }

  private async resolveTemplate(templateId?: string) {
    if (templateId) {
      const t = await this.prisma.initialAssessmentTemplate.findFirst({
        where: { id: templateId, isActive: true, deletedAt: null },
      });
      if (!t) throw new NotFoundException('Initial assessment template not found');
      return t;
    }
    const t = await this.prisma.initialAssessmentTemplate.findFirst({
      where: { isDefault: true, isActive: true, deletedAt: null },
    });
    if (!t) throw new NotFoundException('Default initial assessment template not found');
    return t;
  }

  private async getSubmissionOrThrow(serviceUserId: string, submissionId: string) {
    const row = await this.prisma.initialAssessmentSubmission.findFirst({
      where: { id: submissionId, serviceUserId, deletedAt: null },
      include: submissionInclude,
    });
    if (!row) throw new NotFoundException('Initial assessment submission not found');
    return row;
  }

  private async logDataAccess(
    userId: string,
    params: {
      recordType: string;
      recordId: string;
      serviceUserId: string;
      submissionId?: string;
      templateId?: string;
      metadata?: Record<string, unknown>;
    },
    meta?: RequestAuditMeta,
  ) {
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.SERVICE_USER,
      recordType: params.recordType,
      recordId: params.recordId,
      accessType: DataAccessType.VIEW,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        serviceUserId: params.serviceUserId,
        submissionId: params.submissionId,
        templateId: params.templateId,
        ...params.metadata,
      },
    });
  }

  private mapSubmission(row: {
    id: string;
    serviceUserId: string;
    templateId: string;
    status: PrismaStatus;
    startedAt: Date | null;
    completedAt: Date | null;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    reviewNotes: string | null;
    overallNotes: string | null;
    createdAt: Date;
    updatedAt: Date;
    template?: { id: string; name: string; version: number };
    submittedBy?: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
    reviewedBy?: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
  }) {
    return {
      id: row.id,
      serviceUserId: row.serviceUserId,
      templateId: row.templateId,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNotes: row.reviewNotes,
      overallNotes: row.overallNotes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      template: row.template,
      submittedBy: row.submittedBy,
      reviewedBy: row.reviewedBy,
    };
  }

  async createSubmission(
    userId: string,
    serviceUserId: string,
    dto: CreateInitialAssessmentSubmissionDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const template = await this.resolveTemplate(dto.templateId);

    const activeDraft = await this.prisma.initialAssessmentSubmission.findFirst({
      where: {
        serviceUserId,
        templateId: template.id,
        deletedAt: null,
        status: { in: [PrismaStatus.DRAFT, PrismaStatus.IN_PROGRESS] },
      },
    });
    if (activeDraft) {
      throw new ConflictException(
        'An active draft or in-progress assessment already exists for this service user and template',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.initialAssessmentSubmission.create({
        data: {
          serviceUserId,
          templateId: template.id,
          status: PrismaStatus.DRAFT,
          startedAt: new Date(),
          overallNotes: dto.overallNotes?.trim() ?? null,
          createdById: userId,
        },
        include: submissionInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_SUBMISSION_CREATED,
        recordType: 'InitialAssessmentSubmission',
        recordId: created.id,
        newValues: auditSnapshot(created),
        metadata: { serviceUserId, templateId: template.id, status: created.status },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return {
        message: 'Initial assessment submission created',
        data: this.mapSubmission(created),
      };
    });
  }

  async getSubmissions(
    userId: string,
    serviceUserId: string,
    query: InitialAssessmentQueryDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.InitialAssessmentSubmissionWhereInput = {
      serviceUserId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status as PrismaStatus;
    if (query.templateId) where.templateId = query.templateId;
    if (query.createdById) where.createdById = query.createdById;
    if (query.reviewedById) where.reviewedById = query.reviewedById;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const d = new Date(query.dateTo);
        d.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = d;
      }
    }
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const orderBy = { [sortBy]: sortOrder } as Prisma.InitialAssessmentSubmissionOrderByWithRelationInput;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.initialAssessmentSubmission.count({ where }),
      this.prisma.initialAssessmentSubmission.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: submissionInclude,
      }),
    ]);

    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentSubmission',
        recordId: serviceUserId,
        serviceUserId,
        metadata: { list: true, count: total },
      },
      meta,
    );

    return {
      data: rows.map(r => this.mapSubmission(r)),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getLatestSubmission(userId: string, serviceUserId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    const row = await this.prisma.initialAssessmentSubmission.findFirst({
      where: { serviceUserId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: submissionInclude,
    });
    if (!row) throw new NotFoundException('No initial assessment submission found');
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentSubmission',
        recordId: row.id,
        serviceUserId,
        submissionId: row.id,
        templateId: row.templateId,
      },
      meta,
    );
    return { data: this.mapSubmission(row) };
  }

  async getSubmissionById(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentSubmission',
        recordId: row.id,
        serviceUserId,
        submissionId: row.id,
        templateId: row.templateId,
      },
      meta,
    );
    return { data: this.mapSubmission(row) };
  }

  async updateSubmission(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    dto: UpdateInitialAssessmentSubmissionDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new ForbiddenException('Cannot update a submitted or reviewed assessment');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.initialAssessmentSubmission.update({
        where: { id: submissionId },
        data: {
          overallNotes: dto.overallNotes !== undefined ? dto.overallNotes?.trim() ?? null : undefined,
          status:
            existing.status === PrismaStatus.DRAFT ? PrismaStatus.IN_PROGRESS : existing.status,
          updatedById: userId,
        },
        include: submissionInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_SUBMISSION_UPDATED,
        recordType: 'InitialAssessmentSubmission',
        recordId: updated.id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        metadata: { serviceUserId, templateId: existing.templateId, status: updated.status },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Submission updated', data: this.mapSubmission(updated) };
    });
  }

  async softDeleteSubmission(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.initialAssessmentSubmission.update({
        where: { id: submissionId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
        include: submissionInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_SUBMISSION_DELETED,
        recordType: 'InitialAssessmentSubmission',
        recordId: deleted.id,
        oldValues: auditSnapshot(existing),
        metadata: { serviceUserId, templateId: existing.templateId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Submission deleted', data: this.mapSubmission(deleted) };
    });
  }

  private async getTemplateQuestionIds(templateId: string): Promise<Set<string>> {
    const questions = await this.prisma.initialAssessmentQuestion.findMany({
      where: { section: { templateId, deletedAt: null }, deletedAt: null, isActive: true },
      select: { id: true, questionType: true, isRequired: true, riskFlag: true, carePlanTrigger: true },
    });
    return new Set(questions.map(q => q.id));
  }

  private isAnswered(
    q: { questionType: string; isRequired: boolean },
    answer?: {
      checked: boolean | null;
      booleanValue: boolean | null;
      textValue: string | null;
      numberValue: Prisma.Decimal | null;
      dateValue: Date | null;
      timeValue: string | null;
      selectedOptions: Prisma.JsonValue;
    },
  ): boolean {
    if (!answer) return false;
    if (q.questionType === 'CHECKBOX' || q.questionType === 'YES_NO') {
      return answer.checked === true || answer.booleanValue === true;
    }
    if (answer.textValue?.trim()) return true;
    if (answer.numberValue != null) return true;
    if (answer.dateValue) return true;
    if (answer.timeValue?.trim()) return true;
    if (answer.selectedOptions != null) {
      if (Array.isArray(answer.selectedOptions) && answer.selectedOptions.length > 0) return true;
      if (typeof answer.selectedOptions === 'object' && Object.keys(answer.selectedOptions as object).length > 0) {
        return true;
      }
    }
    return false;
  }

  async saveAnswers(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    dto: SaveInitialAssessmentAnswersDto,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    if (!EDITABLE_STATUSES.includes(submission.status)) {
      throw new ForbiddenException('Cannot save answers on a submitted or reviewed assessment');
    }

    const validIds = await this.getTemplateQuestionIds(submission.templateId);
    for (const a of dto.answers) {
      if (!validIds.has(a.questionId)) {
        throw new BadRequestException(`Question ${a.questionId} does not belong to this assessment template`);
      }
    }

    const questions = await this.prisma.initialAssessmentQuestion.findMany({
      where: { id: { in: dto.answers.map(a => a.questionId) } },
    });
    const questionMap = new Map(questions.map(q => [q.id, q]));

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.answers) {
        const q = questionMap.get(item.questionId)!;
        const isPositive =
          item.checked === true || item.booleanValue === true || Boolean(item.textValue?.trim());
        const riskFlag = q.riskFlag && isPositive;
        const carePlanTrigger = q.carePlanTrigger && isPositive;

        await tx.initialAssessmentAnswer.upsert({
          where: {
            submissionId_questionId: { submissionId, questionId: item.questionId },
          },
          create: {
            submissionId,
            questionId: item.questionId,
            checked: item.checked ?? null,
            booleanValue: item.booleanValue ?? null,
            textValue: item.textValue?.trim() ?? null,
            numberValue: item.numberValue != null ? item.numberValue : null,
            dateValue: item.dateValue ? new Date(item.dateValue) : null,
            timeValue: item.timeValue ?? null,
            selectedOptions:
              item.selectedOptions === undefined
                ? undefined
                : (item.selectedOptions as Prisma.InputJsonValue),
            notes: item.notes?.trim() ?? null,
            riskFlag,
            carePlanTrigger,
          },
          update: {
            checked: item.checked ?? null,
            booleanValue: item.booleanValue ?? null,
            textValue: item.textValue?.trim() ?? null,
            numberValue: item.numberValue != null ? item.numberValue : null,
            dateValue: item.dateValue ? new Date(item.dateValue) : null,
            timeValue: item.timeValue ?? null,
            selectedOptions:
              item.selectedOptions === undefined
                ? undefined
                : (item.selectedOptions as Prisma.InputJsonValue),
            notes: item.notes?.trim() ?? null,
            riskFlag,
            carePlanTrigger,
          },
        });
      }

      await tx.initialAssessmentSubmission.update({
        where: { id: submissionId },
        data: {
          status: PrismaStatus.IN_PROGRESS,
          updatedById: userId,
        },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_ANSWERS_SAVED,
        recordType: 'InitialAssessmentAnswer',
        recordId: submissionId,
        metadata: {
          serviceUserId,
          templateId: submission.templateId,
          submissionId,
          answerCount: dto.answers.length,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    });

    return { message: 'Answers saved', data: { submissionId, savedCount: dto.answers.length } };
  }

  async getAnswers(userId: string, serviceUserId: string, submissionId: string, meta?: RequestAuditMeta) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const answers = await this.prisma.initialAssessmentAnswer.findMany({
      where: { submissionId },
      include: {
        question: {
          select: {
            id: true,
            questionText: true,
            questionType: true,
            sectionId: true,
            riskFlag: true,
            carePlanTrigger: true,
          },
        },
      },
    });
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentAnswer',
        recordId: submissionId,
        serviceUserId,
        submissionId,
        templateId: submission.templateId,
      },
      meta,
    );
    return {
      data: answers.map(a => ({
        id: a.id,
        questionId: a.questionId,
        checked: a.checked,
        booleanValue: a.booleanValue,
        textValue: a.textValue,
        numberValue: a.numberValue != null ? Number(a.numberValue) : null,
        dateValue: a.dateValue?.toISOString() ?? null,
        timeValue: a.timeValue,
        selectedOptions: a.selectedOptions,
        notes: a.notes,
        riskFlag: a.riskFlag,
        carePlanTrigger: a.carePlanTrigger,
        question: a.question,
      })),
    };
  }

  async submitAssessment(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    dto: SubmitInitialAssessmentDto,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    if (!EDITABLE_STATUSES.includes(submission.status)) {
      throw new BadRequestException('Assessment is not in a submittable state');
    }

    const requiredQuestions = await this.prisma.initialAssessmentQuestion.findMany({
      where: {
        isRequired: true,
        isActive: true,
        deletedAt: null,
        section: { templateId: submission.templateId, deletedAt: null },
      },
    });
    const answers = await this.prisma.initialAssessmentAnswer.findMany({ where: { submissionId } });
    const answerMap = new Map(answers.map(a => [a.questionId, a]));
    const missing = requiredQuestions.filter(q => !this.isAnswered(q, answerMap.get(q.id)));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Required questions not answered: ${missing.map(q => q.questionText).slice(0, 5).join('; ')}${missing.length > 5 ? '…' : ''}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.initialAssessmentSubmission.update({
        where: { id: submissionId },
        data: {
          status: PrismaStatus.SUBMITTED,
          submittedAt: new Date(),
          submittedById: userId,
          overallNotes:
            dto.notes !== undefined
              ? dto.notes.trim()
              : submission.overallNotes,
          updatedById: userId,
        },
        include: submissionInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_SUBMITTED,
        recordType: 'InitialAssessmentSubmission',
        recordId: updated.id,
        newValues: auditSnapshot(updated),
        metadata: { serviceUserId, templateId: submission.templateId, status: updated.status },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return updated;
    });

    await this.notifications.onSubmitted({ submissionId, serviceUserId, submittedById: userId });

    return { message: 'Initial assessment submitted', data: this.mapSubmission(result) };
  }

  async reviewAssessment(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    dto: ReviewInitialAssessmentDto,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    if (submission.status !== PrismaStatus.SUBMITTED) {
      throw new BadRequestException('Only submitted assessments can be reviewed');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.initialAssessmentSubmission.update({
        where: { id: submissionId },
        data: {
          status: dto.status as PrismaStatus,
          reviewedAt: new Date(),
          reviewedById: userId,
          reviewNotes: dto.reviewNotes?.trim() ?? null,
          updatedById: userId,
        },
        include: submissionInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_REVIEWED,
        recordType: 'InitialAssessmentSubmission',
        recordId: updated.id,
        newValues: auditSnapshot(updated),
        metadata: { serviceUserId, templateId: submission.templateId, status: updated.status },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return updated;
    });

    await this.notifications.onReviewed({ submissionId, serviceUserId, reviewedById: userId });

    return { message: 'Initial assessment reviewed', data: this.mapSubmission(result) };
  }

  async updateStatus(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    dto: UpdateInitialAssessmentStatusDto,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.initialAssessmentSubmission.update({
        where: { id: submissionId },
        data: { status: dto.status as PrismaStatus, updatedById: userId },
        include: submissionInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_STATUS_CHANGED,
        recordType: 'InitialAssessmentSubmission',
        recordId: updated.id,
        oldValues: { status: submission.status },
        newValues: { status: updated.status, reason: dto.reason },
        metadata: { serviceUserId, templateId: submission.templateId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return updated;
    });
    return { message: 'Status updated', data: this.mapSubmission(result) };
  }

  private async getFlaggedAnswers(submissionId: string, flag: 'risk' | 'carePlan') {
    const submission = await this.prisma.initialAssessmentSubmission.findFirst({
      where: { id: submissionId, deletedAt: null },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    const answers = await this.prisma.initialAssessmentAnswer.findMany({
      where: {
        submissionId,
        ...(flag === 'risk' ? { riskFlag: true } : { carePlanTrigger: true }),
      },
      include: {
        question: {
          select: {
            id: true,
            questionText: true,
            questionType: true,
            riskFlag: true,
            carePlanTrigger: true,
            section: { select: { id: true, title: true, sectionNumber: true, carePlanArea: true } },
          },
        },
      },
    });

    return answers
      .filter(a => a.checked === true || a.booleanValue === true || Boolean(a.textValue?.trim()))
      .map(a => ({
        answerId: a.id,
        questionId: a.questionId,
        questionText: a.question.questionText,
        notes: a.notes,
        textValue: a.textValue,
        section: a.question.section,
        carePlanArea: a.question.section.carePlanArea,
      }));
  }

  async getSummary(userId: string, serviceUserId: string, submissionId: string, meta?: RequestAuditMeta) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const [answers, sections] = await Promise.all([
      this.prisma.initialAssessmentAnswer.count({ where: { submissionId } }),
      this.prisma.initialAssessmentSection.count({
        where: { templateId: submission.templateId, deletedAt: null },
      }),
    ]);
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentSummary',
        recordId: submissionId,
        serviceUserId,
        submissionId,
        templateId: submission.templateId,
      },
      meta,
    );
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_SUMMARY_VIEWED,
      recordType: 'InitialAssessmentSummary',
      recordId: submissionId,
      metadata: { serviceUserId, submissionId, templateId: submission.templateId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return {
      data: {
        submission: this.mapSubmission(submission),
        answeredCount: answers,
        sectionCount: sections,
        status: submission.status,
      },
    };
  }

  async getRiskSummary(userId: string, serviceUserId: string, submissionId: string, meta?: RequestAuditMeta) {
    await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const items = await this.getFlaggedAnswers(submissionId, 'risk');
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentSummary',
        recordId: submissionId,
        serviceUserId,
        submissionId,
        metadata: { type: 'risk' },
      },
      meta,
    );
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_RISK_SUMMARY_VIEWED,
      recordType: 'InitialAssessmentSummary',
      recordId: submissionId,
      metadata: { serviceUserId, submissionId, riskCount: items.length },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { data: { items, count: items.length } };
  }

  async getCarePlanTriggers(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const items = await this.getFlaggedAnswers(submissionId, 'carePlan');
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentSummary',
        recordId: submissionId,
        serviceUserId,
        submissionId,
        metadata: { type: 'carePlanTriggers' },
      },
      meta,
    );
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_CARE_PLAN_TRIGGERS_VIEWED,
      recordType: 'InitialAssessmentSummary',
      recordId: submissionId,
      metadata: { serviceUserId, submissionId, triggerCount: items.length },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { data: { items, count: items.length } };
  }
}
