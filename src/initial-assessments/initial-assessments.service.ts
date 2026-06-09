import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CarePathwayFormType,
  DataAccessType,
  InitialAssessmentStatus as PrismaStatus,
  Prisma,
} from '@prisma/client';
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
import { expandAnswersWithCrossFieldSync } from './initial-assessment-cross-field-sync.util';
import {
  partitionSubmitValidationBlocks,
  validateInitialAssessmentSubmission,
  waterlowScoreFromMetadata,
} from './initial-assessment-validation.util';
import { buildAutoActionsFromSubmission } from './initial-assessment-action-generation.util';
import { buildAutoRiskRecordsFromSubmission, calculateRiskLevel } from './initial-assessment-risk-generation.util';
import {
  bodyMapMetadataPatch,
  bodyMapRequiredFromSubmission,
  ensureBodyMapBaseline,
  existingBodyMapRecordId,
} from './initial-assessment-body-map.util';
import { InitialAssessmentCarePlanRulesService } from './initial-assessment-care-plan-rules.service';
import { buildCarePlanRecommendations } from './initial-assessment-care-plan.util';
import {
  applyCarePlanDecisions,
  readCarePlanDecisions,
} from './initial-assessment-care-plan-decisions.util';
import { resolveCarePlanFormFromCatalogue } from './initial-assessment-care-plan-area-map.util';
import { ServiceUserVisitPlansService } from '../service-user-visit-plans/service-user-visit-plans.service';
import { CarePlanRecommendationDecision } from './dto/initial-assessment-care-plan-decision.dto';
import type { InitialAssessmentReviewQueueQueryDto } from './dto/initial-assessment-review-queue-query.dto';
import {
  batchHasAnswerCorrections,
  comparableAnswerValue,
} from './initial-assessment-answer-format.util';
import { getInitialAssessmentAgencySettings } from './initial-assessment-agency-settings.util';
import { syncEmergencyContactAnswerFromProfile } from './initial-assessment-contacts-sync.util';
import {
  careActivationBlockedFromValidation,
  evaluateCareActivation,
} from './initial-assessment-care-activation.util';
import {
  buildClinicalMetadataPatch,
  buildFallsAssessmentSnapshot,
  buildMedicationListSnapshot,
  buildVitalsSnapshot,
  parseStoredClinicalMetadata,
  syncFallsToObservation,
  syncVitalsToObservations,
} from './initial-assessment-clinical.util';
import {
  CreateInitialAssessmentActionDto,
  UpdateInitialAssessmentActionDto,
} from './dto/initial-assessment-action.dto';
import {
  CreateInitialAssessmentRiskRecordDto,
  UpdateInitialAssessmentRiskRecordDto,
} from './dto/initial-assessment-risk-record.dto';
import { UploadInitialAssessmentAttachmentDto } from './dto/initial-assessment-attachment.dto';
import { initialAssessmentFilePublicUrl } from './initial-assessment-upload.util';
import {
  InitialAssessmentActionPriority,
  InitialAssessmentActionStatus,
  InitialAssessmentAttachmentCategory,
  InitialAssessmentRiskLevel,
  InitialAssessmentRiskStatus,
} from '@prisma/client';
import {
  decryptSecureText,
  encryptSecureText,
  isSecureQuestionMetadata,
  maskSecureAnswer,
} from './initial-assessment-secure-field.util';
import {
  buildInitialAssessmentHtml,
  initialAssessmentHtmlFilename,
} from './initial-assessment-html.util';
import { embedOrganisationLogoForExport } from './initial-assessment-export-logo.util';
import {
  buildInitialAssessmentPdf,
  initialAssessmentPdfFilename,
} from './initial-assessment-pdf.util';
import { buildInitialAssessmentPdfData, type InitialAssessmentPdfData } from './initial-assessment-pdf-data.util';
import { buildSignOffSnapshot } from './initial-assessment-sign-off.util';
import { enrichWaterlowMetadata } from './initial-assessment-waterlow.util';

const submissionUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
} as const;

const submissionInclude = {
  template: { select: { id: true, name: true, version: true } },
  submittedBy: { select: submissionUserSelect },
  reviewedBy: { select: submissionUserSelect },
  createdBy: { select: submissionUserSelect },
  updatedBy: { select: submissionUserSelect },
} satisfies Prisma.InitialAssessmentSubmissionInclude;

const EDITABLE_STATUSES: PrismaStatus[] = [PrismaStatus.DRAFT, PrismaStatus.IN_PROGRESS];

@Injectable()
export class InitialAssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: InitialAssessmentNotificationHook,
    private readonly carePlanRules: InitialAssessmentCarePlanRulesService,
    private readonly visitPlans: ServiceUserVisitPlansService,
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
    metadata?: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
    template?: { id: string; name: string; version: number };
    submittedBy?: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
    reviewedBy?: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
    createdBy?: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
    updatedBy?: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
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
      metadata:
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {},
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      template: row.template,
      submittedBy: row.submittedBy,
      reviewedBy: row.reviewedBy,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
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
      const existingMeta =
        existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
          ? (existing.metadata as Record<string, unknown>)
          : {};
      let mergedMeta: Record<string, unknown> | undefined;
      if (dto.metadata !== undefined) {
        mergedMeta = { ...existingMeta, ...dto.metadata };
        const prevComments =
          existingMeta.sectionComments &&
          typeof existingMeta.sectionComments === 'object' &&
          !Array.isArray(existingMeta.sectionComments)
            ? (existingMeta.sectionComments as Record<string, string>)
            : {};
        const nextComments =
          dto.metadata.sectionComments &&
          typeof dto.metadata.sectionComments === 'object' &&
          !Array.isArray(dto.metadata.sectionComments)
            ? (dto.metadata.sectionComments as Record<string, unknown>)
            : null;
        if (nextComments) {
          const mergedComments = { ...prevComments };
          for (const [k, v] of Object.entries(nextComments)) {
            if (v === '' || v === null) delete mergedComments[k];
            else mergedComments[k] = v as string;
          }
          mergedMeta.sectionComments = mergedComments;
        }
      }

      const updated = await tx.initialAssessmentSubmission.update({
        where: { id: submissionId },
        data: {
          overallNotes: dto.overallNotes !== undefined ? dto.overallNotes?.trim() ?? null : undefined,
          metadata: mergedMeta as Prisma.InputJsonValue,
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

    const submissionMeta =
      typeof submission.metadata === 'object' && submission.metadata && !Array.isArray(submission.metadata)
        ? (submission.metadata as Record<string, unknown>)
        : {};
    const correctionRequired = submissionMeta.correctionRequired === true;
    const correctionReason = dto.correctionReason?.trim() ?? '';

    const validIds = await this.getTemplateQuestionIds(submission.templateId);
    const allTemplateQuestions = await this.prisma.initialAssessmentQuestion.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        section: { templateId: submission.templateId, deletedAt: null },
      },
      select: { id: true, questionText: true, questionType: true, metadata: true },
    });

    const expandedAnswers = expandAnswersWithCrossFieldSync(allTemplateQuestions, dto.answers);

    for (const a of expandedAnswers) {
      if (!validIds.has(a.questionId)) {
        throw new BadRequestException(`Question ${a.questionId} does not belong to this assessment template`);
      }
    }

    const questions = await this.prisma.initialAssessmentQuestion.findMany({
      where: { id: { in: expandedAnswers.map(a => a.questionId) } },
    });
    const questionMap = new Map(questions.map(q => [q.id, q]));

    const existingAnswers = await this.prisma.initialAssessmentAnswer.findMany({
      where: {
        submissionId,
        questionId: { in: expandedAnswers.map(a => a.questionId) },
      },
    });
    const existingAnswerMap = new Map(existingAnswers.map(a => [a.questionId, a]));

    const hasCorrections = batchHasAnswerCorrections({
      items: expandedAnswers,
      questionMap,
      existingAnswerMap,
    });
    if (correctionRequired && hasCorrections && correctionReason.length < 10) {
      throw new BadRequestException(
        'A correction reason (min 10 characters) is required when changing answers after reopen',
      );
    }

    const answerCorrections: Array<{
      questionId: string;
      questionText: string;
      oldValue: string | null;
      newValue: string | null;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of expandedAnswers) {
        const q = questionMap.get(item.questionId)!;
        const isSecure = isSecureQuestionMetadata(q.metadata);
        const textValue = isSecure
          ? item.textValue === undefined
            ? (existingAnswerMap.get(item.questionId)?.textValue ?? null)
            : encryptSecureText(item.textValue)
          : (item.textValue?.trim() ?? null);
        const isPositive =
          item.checked === true ||
          item.booleanValue === true ||
          Boolean(textValue?.trim());
        const riskFlag = q.riskFlag && isPositive;
        const carePlanTrigger = q.carePlanTrigger && isPositive;

        const existing = existingAnswerMap.get(item.questionId);
        const nextRow = {
          checked: item.checked ?? null,
          booleanValue: item.booleanValue ?? null,
          textValue,
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
        };

        if (correctionRequired && existing) {
          const oldValue = comparableAnswerValue(q, existing);
          const newValue = comparableAnswerValue(q, {
            checked: nextRow.checked,
            booleanValue: nextRow.booleanValue,
            textValue: nextRow.textValue,
            numberValue:
              nextRow.numberValue != null
                ? (nextRow.numberValue as unknown as Prisma.Decimal)
                : null,
            dateValue: nextRow.dateValue,
            timeValue: nextRow.timeValue,
            selectedOptions: (nextRow.selectedOptions ?? null) as Prisma.JsonValue,
            notes: nextRow.notes,
          });
          if (oldValue !== newValue) {
            answerCorrections.push({
              questionId: q.id,
              questionText: q.questionText,
              oldValue,
              newValue,
            });
          }
        }

        await tx.initialAssessmentAnswer.upsert({
          where: {
            submissionId_questionId: { submissionId, questionId: item.questionId },
          },
          create: {
            submissionId,
            questionId: item.questionId,
            ...nextRow,
          },
          update: nextRow,
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
          correctionRequired,
          ...(correctionReason ? { correctionReason } : {}),
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      for (const correction of answerCorrections) {
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.INITIAL_ASSESSMENT_ANSWER_CORRECTED,
          recordType: 'InitialAssessmentAnswer',
          recordId: submissionId,
          oldValues: { value: correction.oldValue },
          newValues: { value: correction.newValue },
          metadata: {
            serviceUserId,
            submissionId,
            questionId: correction.questionId,
            questionText: correction.questionText,
            correctionReason,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      }
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
            metadata: true,
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
      data: answers.map(a => {
        const base = {
          id: a.id,
          questionId: a.questionId,
          checked: a.checked,
          booleanValue: a.booleanValue,
          numberValue: a.numberValue != null ? Number(a.numberValue) : null,
          dateValue: a.dateValue?.toISOString() ?? null,
          timeValue: a.timeValue,
          selectedOptions: a.selectedOptions,
          notes: a.notes,
          riskFlag: a.riskFlag,
          carePlanTrigger: a.carePlanTrigger,
          question: a.question,
        };
        if (isSecureQuestionMetadata(a.question.metadata)) {
          return { ...base, ...maskSecureAnswer(a.textValue) };
        }
        return { ...base, textValue: a.textValue };
      }),
    };
  }

  async revealSecureFieldAnswer(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    questionId: string,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const question = await this.prisma.initialAssessmentQuestion.findFirst({
      where: {
        id: questionId,
        section: { templateId: submission.templateId, deletedAt: null },
        deletedAt: null,
      },
    });
    if (!question) throw new NotFoundException('Question not found');
    if (!isSecureQuestionMetadata(question.metadata)) {
      throw new BadRequestException('Question is not a secure field');
    }

    const answer = await this.prisma.initialAssessmentAnswer.findUnique({
      where: { submissionId_questionId: { submissionId, questionId } },
    });
    if (!answer?.textValue?.trim()) {
      return { data: { questionId, textValue: null } };
    }

    const textValue = decryptSecureText(answer.textValue);
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_SECURE_FIELD_REVEALED,
      recordType: 'InitialAssessmentAnswer',
      recordId: answer.id,
      metadata: {
        serviceUserId,
        submissionId,
        templateId: submission.templateId,
        questionId,
        questionText: question.questionText,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { data: { questionId, textValue } };
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

    const questions = await this.prisma.initialAssessmentQuestion.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        section: { templateId: submission.templateId, deletedAt: null },
      },
      select: {
        id: true,
        questionText: true,
        questionType: true,
        isRequired: true,
        metadata: true,
        section: { select: { sectionNumber: true } },
      },
    });
    await syncEmergencyContactAnswerFromProfile(this.prisma, {
      serviceUserId,
      submissionId,
      questions,
    });
    const answers = await this.prisma.initialAssessmentAnswer.findMany({ where: { submissionId } });
    const agencySettings = getInitialAssessmentAgencySettings();
    const validation = validateInitialAssessmentSubmission({
      status: submission.status,
      questions,
      answers,
      metadata: submission.metadata,
      agencySettings,
    });
    const skipIncomplete = dto.skipIncompleteValidation === true;
    const { hardBlocks, skippableBlocks } = partitionSubmitValidationBlocks(validation.blocks);
    const canSubmitIncomplete =
      validation.canSubmitIncomplete ??
      (hardBlocks.length === 0 && skippableBlocks.length > 0);
    if (!validation.canSubmit) {
      const allowIncomplete = skipIncomplete && canSubmitIncomplete;
      if (!allowIncomplete) {
        const previewSource =
          skipIncomplete && hardBlocks.length > 0 ? hardBlocks : validation.blocks;
        const preview = previewSource
          .slice(0, 5)
          .map((b) => b.message)
          .join('; ');
        const suffix =
          previewSource.length > 5
            ? '…'
            : skipIncomplete && hardBlocks.length > 0
              ? ' — fix these before submitting incomplete.'
              : '';
        throw new BadRequestException(preview ? `${preview}${suffix}` : 'Submission validation failed');
      }
    }

    const managerReviewRequired =
      validation.warnings.some((w) => w.message.toLowerCase().includes('manager review')) ||
      validation.warnings.some((w) => w.message.toLowerCase().includes('safeguarding')) ||
      waterlowScoreFromMetadata(submission.metadata) >= agencySettings.managerReviewWaterlowThreshold;

    const bodyMapNeed = bodyMapRequiredFromSubmission({ questions, answers });
    const careActivationBlocked = careActivationBlockedFromValidation(validation.blocks);

    const result = await this.prisma.$transaction(async (tx) => {
      let submissionMetadata: Prisma.InputJsonValue = {
        ...(typeof submission.metadata === 'object' && submission.metadata && !Array.isArray(submission.metadata)
          ? submission.metadata
          : {}),
        managerReviewRequired,
        careActivationBlocked,
      } as Prisma.InputJsonValue;

      if (bodyMapNeed.required) {
        const baseline = await ensureBodyMapBaseline(tx, {
          userId,
          serviceUserId,
          submissionId,
          recordType: bodyMapNeed.recordType,
          existingRecordId: existingBodyMapRecordId(submission.metadata),
        });
        if (baseline) {
          submissionMetadata = bodyMapMetadataPatch(submissionMetadata, {
            required: true,
            recordId: baseline.recordId,
            created: baseline.created,
            submissionId,
          });
        }
      }

      const capturedAt = new Date();
      const clinicalBase = buildClinicalMetadataPatch({
        submissionId,
        questions,
        answers,
        metadata: submission.metadata,
        capturedAt,
      });
      const medications = await buildMedicationListSnapshot(tx, {
        serviceUserId,
        questions,
        answers,
        capturedAt,
      });

      let vitals = clinicalBase.vitals;
      if (vitals) {
        const observationIds = await syncVitalsToObservations(tx, {
          serviceUserId,
          userId,
          submissionId,
          vitals,
        });
        vitals = { ...vitals, observationIds };
      }

      let falls = clinicalBase.falls;
      const fallsObservationId = await syncFallsToObservation(tx, {
        serviceUserId,
        userId,
        submissionId,
        falls,
      });
      if (fallsObservationId) {
        falls = { ...falls, observationId: fallsObservationId };
      }

      const signOffQuestions = questions.filter((q) => q.section.sectionNumber === 14);
      const signOff = buildSignOffSnapshot({
        questions: signOffQuestions,
        answers,
        submittedAt: capturedAt,
      });

      const metaBase: Record<string, unknown> =
        typeof submissionMetadata === 'object' && submissionMetadata && !Array.isArray(submissionMetadata)
          ? {
              ...(submissionMetadata as Record<string, unknown>),
              ...(skipIncomplete ? { submittedWithIncompleteFields: true } : {}),
            }
          : skipIncomplete
            ? { submittedWithIncompleteFields: true }
            : {};
      const existingWaterlow = metaBase.waterlow;
      const waterlow =
        existingWaterlow && typeof existingWaterlow === 'object' && !Array.isArray(existingWaterlow)
          ? enrichWaterlowMetadata(
              existingWaterlow as Parameters<typeof enrichWaterlowMetadata>[0],
              agencySettings.managerReviewWaterlowThreshold,
            )
          : undefined;

      submissionMetadata = {
        ...metaBase,
        vitals: vitals ?? undefined,
        medications,
        falls,
        signOff,
        correctionRequired: false,
        ...(waterlow ? { waterlow } : {}),
      } as Prisma.InputJsonValue;

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
          metadata: submissionMetadata,
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
      await this.syncAutoActions(tx, {
        submissionId,
        serviceUserId,
        templateId: submission.templateId,
        metadata: submissionMetadata as Prisma.JsonValue,
        userId,
      });
      await this.syncAutoRiskRecords(tx, {
        submissionId,
        serviceUserId,
        templateId: submission.templateId,
        metadata: submissionMetadata as Prisma.JsonValue,
        userId,
      });
      return updated;
    });

    const serviceUser = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { firstName: true, lastName: true, preferredName: true },
    });
    const serviceUserName = serviceUser
      ? [serviceUser.preferredName ?? serviceUser.firstName, serviceUser.lastName].filter(Boolean).join(' ')
      : undefined;

    await this.notifications.onSubmitted({
      submissionId,
      serviceUserId,
      serviceUserName,
      submittedById: userId,
      managerReviewRequired,
      notifyManagers: agencySettings.notifyManagersOnHighRiskSubmit,
    });

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
      const prevMeta =
        typeof submission.metadata === 'object' && submission.metadata && !Array.isArray(submission.metadata)
          ? (submission.metadata as Record<string, unknown>)
          : {};
      const nextMeta: Record<string, unknown> = { ...prevMeta };
      if (dto.status === PrismaStatus.REVIEWED) {
        if (dto.approvedForCareStart !== undefined) {
          nextMeta.approvedForCareStart = dto.approvedForCareStart;
        }
        if (dto.careStartConditions !== undefined) {
          nextMeta.careStartConditions = dto.careStartConditions.trim() || null;
        }
      }

      const updated = await tx.initialAssessmentSubmission.update({
        where: { id: submissionId },
        data: {
          status: dto.status as PrismaStatus,
          reviewedAt: new Date(),
          reviewedById: userId,
          reviewNotes: dto.reviewNotes?.trim() ?? null,
          metadata: nextMeta as Prisma.InputJsonValue,
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

    if (dto.status === PrismaStatus.REVIEWED && dto.approvedForCareStart === true) {
      await this.visitPlans.createDraftFromAssessment(userId, serviceUserId, submissionId, meta);
    }

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
    const priorMeta =
      typeof submission.metadata === 'object' && submission.metadata && !Array.isArray(submission.metadata)
        ? (submission.metadata as Record<string, unknown>)
        : {};
    const reopening =
      dto.status === InitialAssessmentStatus.IN_PROGRESS &&
      (submission.status === PrismaStatus.SUBMITTED || submission.status === PrismaStatus.REVIEWED);
    const nextMetadata = reopening
      ? ({
          ...priorMeta,
          correctionRequired: true,
          lastReopenReason: dto.reason?.trim() ?? null,
          reopenedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue)
      : undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.initialAssessmentSubmission.update({
        where: { id: submissionId },
        data: {
          status: dto.status as PrismaStatus,
          updatedById: userId,
          ...(nextMetadata !== undefined ? { metadata: nextMetadata } : {}),
        },
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
            metadata: true,
          },
        },
      },
    });

    return answers
      .filter(a => a.checked === true || a.booleanValue === true || Boolean(a.textValue?.trim()))
      .map(a => {
        const meta = a.question.metadata;
        const specRef =
          meta && typeof meta === 'object' && !Array.isArray(meta) && typeof (meta as { specRef?: unknown }).specRef === 'string'
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

  async getClinicalSnapshot(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const stored = parseStoredClinicalMetadata(submission.metadata);
    const isFrozen = submission.status === PrismaStatus.SUBMITTED || submission.status === PrismaStatus.REVIEWED;

    if (isFrozen && (stored.vitals || stored.medications || stored.falls)) {
      await this.logDataAccess(
        userId,
        {
          recordType: 'InitialAssessmentClinical',
          recordId: submissionId,
          serviceUserId,
          submissionId,
          templateId: submission.templateId,
        },
        meta,
      );
      return {
        data: {
          frozen: true,
          vitals: stored.vitals,
          medications: stored.medications,
          falls: stored.falls,
        },
      };
    }

    const questions = await this.prisma.initialAssessmentQuestion.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        section: { templateId: submission.templateId, deletedAt: null },
      },
      select: { id: true, questionText: true, metadata: true },
    });
    const answers = await this.prisma.initialAssessmentAnswer.findMany({
      where: { submissionId },
      select: {
        questionId: true,
        checked: true,
        booleanValue: true,
        textValue: true,
        numberValue: true,
        dateValue: true,
      },
    });

    const vitals =
      stored.vitals ??
      buildVitalsSnapshot({
        submissionId,
        questions,
        answers,
      });
    const falls =
      stored.falls ??
      buildFallsAssessmentSnapshot({
        questions,
        answers,
        metadata: submission.metadata,
      });
    const medications =
      stored.medications ??
      (await buildMedicationListSnapshot(this.prisma, {
        serviceUserId,
        questions,
        answers,
      }));

    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentClinical',
        recordId: submissionId,
        serviceUserId,
        submissionId,
        templateId: submission.templateId,
        metadata: { preview: !isFrozen },
      },
      meta,
    );

    return {
      data: {
        frozen: isFrozen,
        vitals,
        medications,
        falls,
      },
    };
  }

  async getAcceptedCarePlans(userId: string, serviceUserId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);

    const submissions = await this.prisma.initialAssessmentSubmission.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        status: { in: [PrismaStatus.SUBMITTED, PrismaStatus.REVIEWED] },
      },
      select: { id: true, metadata: true },
      orderBy: { submittedAt: 'desc' },
    });

    const carePlanCatalogue = await this.prisma.carePathwayForm.findMany({
      where: { formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
      select: { id: true, name: true, pictureUrl: true },
    });

    const byFormId = new Map<
      string,
      { formId: string; formName: string; pictureUrl: string | null; acceptedAt: string; carePlanArea: string }
    >();
    const unresolved: Array<{
      recommendationId: string;
      title: string;
      carePlanArea: string;
      acceptedAt: string;
    }> = [];
    let acceptedRecommendationCount = 0;

    for (const submission of submissions) {
      const decisions = readCarePlanDecisions(submission.metadata);
      const triggerItems = await this.getFlaggedAnswers(submission.id, 'carePlan');
      const recommendations = await this.carePlanRules.resolveRecommendations(
        submission.id,
        triggerItems,
      );
      const withDecisions = applyCarePlanDecisions(recommendations, decisions);
      const recById = new Map(withDecisions.map((r) => [r.id, r]));

      const processAccepted = (
        recommendationId: string,
        acceptedAt: string,
        stored: (typeof decisions)[string] | undefined,
        rec: (typeof withDecisions)[number] | undefined,
      ) => {
        acceptedRecommendationCount += 1;
        const catalogueRow =
          stored?.carePathwayFormId != null
            ? carePlanCatalogue.find((f) => f.id === stored.carePathwayFormId)
            : resolveCarePlanFormFromCatalogue(
                carePlanCatalogue,
                stored?.carePlanArea ?? rec?.carePlanArea ?? '',
                stored?.carePathwayFormName ?? rec?.carePathwayFormName,
              );
        const formId =
          stored?.carePathwayFormId ?? rec?.carePathwayFormId ?? catalogueRow?.id;

        if (!formId) {
          unresolved.push({
            recommendationId,
            title: stored?.title ?? rec?.title ?? recommendationId,
            carePlanArea: stored?.carePlanArea ?? rec?.carePlanArea ?? 'Unknown',
            acceptedAt,
          });
          return;
        }

        const formName =
          stored?.carePathwayFormName ??
          rec?.carePathwayFormName ??
          catalogueRow?.name ??
          stored?.carePlanArea ??
          rec?.carePlanArea ??
          'Care plan';
        const pictureUrl =
          carePlanCatalogue.find((f) => f.id === formId)?.pictureUrl ?? null;
        const existing = byFormId.get(formId);
        if (!existing || acceptedAt > existing.acceptedAt) {
          byFormId.set(formId, {
            formId,
            formName,
            pictureUrl,
            acceptedAt,
            carePlanArea: stored?.carePlanArea ?? rec?.carePlanArea ?? formName,
          });
        }
      };

      for (const [recommendationId, stored] of Object.entries(decisions)) {
        if (stored.decision !== 'accepted') continue;
        processAccepted(recommendationId, stored.decidedAt, stored, recById.get(recommendationId));
      }
    }

    const items = [...byFormId.values()].sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));

    await this.logDataAccess(
      userId,
      {
        recordType: 'ServiceUserAcceptedCarePlans',
        recordId: serviceUserId,
        serviceUserId,
      },
      meta,
    );

    return {
      message: 'Accepted care plans loaded',
      data: { items, acceptedRecommendationCount, unresolved },
    };
  }

  async getSummary(userId: string, serviceUserId: string, submissionId: string, meta?: RequestAuditMeta) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const [answeredCount, sectionCount, riskItems, triggerItems, openActionsCount] = await Promise.all([
      this.prisma.initialAssessmentAnswer.count({ where: { submissionId } }),
      this.prisma.initialAssessmentSection.count({
        where: { templateId: submission.templateId, deletedAt: null },
      }),
      this.getFlaggedAnswers(submissionId, 'risk'),
      this.getFlaggedAnswers(submissionId, 'carePlan'),
      this.prisma.initialAssessmentAction.count({
        where: {
          submissionId,
          status: { in: ['OPEN', 'IN_PROGRESS'] as const },
        },
      }),
    ]);

    const submissionMeta =
      typeof submission.metadata === 'object' && submission.metadata && !Array.isArray(submission.metadata)
        ? (submission.metadata as Record<string, unknown>)
        : {};
    const managerReviewRequired = submissionMeta.managerReviewRequired === true;
    const clinical = parseStoredClinicalMetadata(submission.metadata);
    const carePlanDecisions = readCarePlanDecisions(submission.metadata);
    const carePlanRecommendations = applyCarePlanDecisions(
      await this.carePlanRules.resolveRecommendations(submissionId, triggerItems),
      carePlanDecisions,
    );
    const agencySettings = getInitialAssessmentAgencySettings();
    const careActivation = evaluateCareActivation({
      status: submission.status,
      metadata: submission.metadata,
    });

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
        answeredCount,
        sectionCount,
        status: submission.status,
        riskCount: riskItems.length,
        carePlanTriggerCount: triggerItems.length,
        openActionsCount,
        managerReviewRequired,
        clinical,
        carePlanRecommendations,
        agencySettings,
        careActivation,
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

  async validateSubmission(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentSubmission',
        recordId: submissionId,
        serviceUserId,
        submissionId,
        templateId: submission.templateId,
        metadata: { action: 'validate' },
      },
      meta,
    );

    const questions = await this.prisma.initialAssessmentQuestion.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        section: { templateId: submission.templateId, deletedAt: null },
      },
      select: {
        id: true,
        questionText: true,
        questionType: true,
        isRequired: true,
        metadata: true,
        section: { select: { sectionNumber: true } },
      },
    });

    await syncEmergencyContactAnswerFromProfile(this.prisma, {
      serviceUserId,
      submissionId,
      questions,
    });

    const answers = await this.prisma.initialAssessmentAnswer.findMany({
      where: { submissionId },
      select: {
        questionId: true,
        checked: true,
        booleanValue: true,
        textValue: true,
        numberValue: true,
        dateValue: true,
        timeValue: true,
        selectedOptions: true,
      },
    });

    const result = validateInitialAssessmentSubmission({
      status: submission.status,
      questions,
      answers,
      metadata: submission.metadata,
      agencySettings: getInitialAssessmentAgencySettings(),
    });

    const riskRows = await this.prisma.initialAssessmentRiskRecord.findMany({
      where: { submissionId },
      select: {
        description: true,
        controlMeasures: true,
        reviewDate: true,
        riskLevel: true,
        status: true,
        sourceSectionNumber: true,
      },
    });
    for (const risk of riskRows) {
      if (risk.status === 'CLOSED') continue;
      if (!risk.controlMeasures?.trim()) {
        result.warnings.push({
          message: `Risk matrix: add control measures for “${risk.description.slice(0, 80)}${risk.description.length > 80 ? '…' : ''}”`,
          sectionNumber: risk.sourceSectionNumber ?? 13,
          blocking: false,
        });
      }
      if (!risk.reviewDate) {
        result.warnings.push({
          message: `Risk matrix: set review date for “${risk.description.slice(0, 60)}…”`,
          sectionNumber: risk.sourceSectionNumber ?? 13,
          blocking: false,
        });
      }
      if (risk.riskLevel === InitialAssessmentRiskLevel.HIGH && risk.status === InitialAssessmentRiskStatus.OPEN) {
        result.warnings.push({
          message: `High risk level open — manager review recommended (${risk.description.slice(0, 60)}…)`,
          sectionNumber: risk.sourceSectionNumber ?? 13,
          blocking: false,
        });
      }
    }

    return { data: result };
  }

  private mapAction(row: {
    id: string;
    submissionId: string;
    serviceUserId: string;
    title: string;
    actionType: string;
    priority: string;
    status: string;
    dueDate: Date | null;
    notes: string | null;
    sourceSectionNumber: number | null;
    sourceQuestionId: string | null;
    sourceQuestionText: string | null;
    assignedToId: string | null;
    autoGenerated: boolean;
    createdAt: Date;
    updatedAt: Date;
    assignedTo?: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
  }) {
    return {
      id: row.id,
      submissionId: row.submissionId,
      serviceUserId: row.serviceUserId,
      title: row.title,
      actionType: row.actionType,
      priority: row.priority,
      status: row.status,
      dueDate: row.dueDate?.toISOString() ?? null,
      notes: row.notes,
      sourceSectionNumber: row.sourceSectionNumber,
      sourceQuestionId: row.sourceQuestionId,
      sourceQuestionText: row.sourceQuestionText,
      assignedToId: row.assignedToId,
      autoGenerated: row.autoGenerated,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      assignedTo: row.assignedTo
        ? {
            id: row.assignedTo.id,
            email: row.assignedTo.email,
            firstName: row.assignedTo.firstName,
            lastName: row.assignedTo.lastName,
          }
        : null,
    };
  }

  private async syncAutoActions(
    tx: Prisma.TransactionClient,
    params: {
      submissionId: string;
      serviceUserId: string;
      templateId: string;
      metadata: Prisma.JsonValue;
      userId: string;
    },
  ) {
    const existing = await tx.initialAssessmentAction.findMany({
      where: { submissionId: params.submissionId, autoGenerated: true },
      select: { sourceQuestionId: true, actionType: true },
    });
    const existingKeys = new Set(
      existing.map((e) => `${e.sourceQuestionId ?? 'none'}:${e.actionType}`),
    );

    const questions = await tx.initialAssessmentQuestion.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        section: { templateId: params.templateId, deletedAt: null },
      },
      select: {
        id: true,
        questionText: true,
        riskFlag: true,
        carePlanTrigger: true,
        metadata: true,
        section: { select: { sectionNumber: true } },
      },
    });

    const answers = await tx.initialAssessmentAnswer.findMany({
      where: { submissionId: params.submissionId },
      select: { questionId: true, checked: true, booleanValue: true },
    });

    const drafts = buildAutoActionsFromSubmission({
      questions,
      answers,
      metadata: params.metadata,
    });

    for (const draft of drafts) {
      const key = `${draft.sourceQuestionId ?? 'none'}:${draft.actionType}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      await tx.initialAssessmentAction.create({
        data: {
          submissionId: params.submissionId,
          serviceUserId: params.serviceUserId,
          title: draft.title,
          actionType: draft.actionType,
          priority: draft.priority,
          status: InitialAssessmentActionStatus.OPEN,
          dueDate: draft.dueDate,
          sourceSectionNumber: draft.sourceSectionNumber,
          sourceQuestionId: draft.sourceQuestionId,
          sourceQuestionText: draft.sourceQuestionText,
          autoGenerated: true,
          createdById: params.userId,
          updatedById: params.userId,
        },
      });
    }
  }

  private async syncAutoRiskRecords(
    tx: Prisma.TransactionClient,
    params: {
      submissionId: string;
      serviceUserId: string;
      templateId: string;
      metadata: Prisma.JsonValue;
      userId: string;
    },
  ) {
    const existing = await tx.initialAssessmentRiskRecord.findMany({
      where: { submissionId: params.submissionId, autoGenerated: true },
      select: { sourceQuestionId: true, riskType: true },
    });
    const existingKeys = new Set(
      existing.map((e) => `${e.sourceQuestionId ?? 'none'}:${e.riskType}`),
    );

    const questions = await tx.initialAssessmentQuestion.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        section: { templateId: params.templateId, deletedAt: null },
      },
      select: {
        id: true,
        questionText: true,
        riskFlag: true,
        carePlanTrigger: true,
        metadata: true,
        section: { select: { sectionNumber: true } },
      },
    });

    const answers = await tx.initialAssessmentAnswer.findMany({
      where: { submissionId: params.submissionId },
      select: {
        questionId: true,
        checked: true,
        booleanValue: true,
        riskFlag: true,
        selectedOptions: true,
      },
    });

    const drafts = buildAutoRiskRecordsFromSubmission({
      questions,
      answers,
      metadata: params.metadata,
    });

    for (const draft of drafts) {
      const key = `${draft.sourceQuestionId ?? 'none'}:${draft.riskType}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      await tx.initialAssessmentRiskRecord.create({
        data: {
          submissionId: params.submissionId,
          serviceUserId: params.serviceUserId,
          riskType: draft.riskType,
          description: draft.description,
          likelihood: draft.likelihood,
          severity: draft.severity,
          riskLevel: draft.riskLevel,
          reviewDate: draft.reviewDate,
          sourceSectionNumber: draft.sourceSectionNumber,
          sourceQuestionId: draft.sourceQuestionId,
          sourceQuestionText: draft.sourceQuestionText,
          autoGenerated: true,
          status: InitialAssessmentRiskStatus.OPEN,
          createdById: params.userId,
          updatedById: params.userId,
        },
      });
    }
  }

  async listActions(userId: string, serviceUserId: string, submissionId: string, meta?: RequestAuditMeta) {
    await this.getSubmissionOrThrow(serviceUserId, submissionId);
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentAction',
        recordId: submissionId,
        serviceUserId,
        submissionId,
        metadata: { list: true },
      },
      meta,
    );
    const rows = await this.prisma.initialAssessmentAction.findMany({
      where: { submissionId },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        assignedTo: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return { data: rows.map((r) => this.mapAction(r)) };
  }

  async createAction(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    dto: CreateInitialAssessmentActionDto,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const row = await this.prisma.initialAssessmentAction.create({
      data: {
        submissionId,
        serviceUserId,
        title: dto.title.trim(),
        actionType: dto.actionType,
        priority: dto.priority ?? InitialAssessmentActionPriority.MEDIUM,
        status: InitialAssessmentActionStatus.OPEN,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes?.trim() ?? null,
        assignedToId: dto.assignedToId ?? null,
        autoGenerated: false,
        createdById: userId,
        updatedById: userId,
      },
      include: {
        assignedTo: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentAction',
        recordId: row.id,
        serviceUserId,
        submissionId,
        templateId: submission.templateId,
      },
      meta,
    );
    return { data: this.mapAction(row) };
  }

  async updateAction(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    actionId: string,
    dto: UpdateInitialAssessmentActionDto,
    meta?: RequestAuditMeta,
  ) {
    await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const existing = await this.prisma.initialAssessmentAction.findFirst({
      where: { id: actionId, submissionId },
    });
    if (!existing) throw new NotFoundException('Initial assessment action not found');

    const row = await this.prisma.initialAssessmentAction.update({
      where: { id: actionId },
      data: {
        title: dto.title?.trim(),
        priority: dto.priority,
        status: dto.status,
        dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
        notes: dto.notes !== undefined ? dto.notes?.trim() ?? null : undefined,
        assignedToId: dto.assignedToId !== undefined ? dto.assignedToId : undefined,
        updatedById: userId,
      },
      include: {
        assignedTo: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentAction',
        recordId: row.id,
        serviceUserId,
        submissionId,
      },
      meta,
    );
    return { data: this.mapAction(row) };
  }

  async regenerateActions(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    await this.prisma.$transaction(async (tx) => {
      await this.syncAutoActions(tx, {
        submissionId,
        serviceUserId,
        templateId: submission.templateId,
        metadata: submission.metadata,
        userId,
      });
    });
    return this.listActions(userId, serviceUserId, submissionId, meta);
  }

  private mapAttachment(row: {
    id: string;
    submissionId: string;
    serviceUserId: string;
    category: InitialAssessmentAttachmentCategory;
    label: string | null;
    sectionNumber: number | null;
    fileName: string;
    originalName: string;
    fileUrl: string;
    mimeType: string;
    fileSize: number;
    uploadedById: string;
    createdAt: Date;
    updatedAt: Date;
    uploadedBy?: { id: string; email: string; firstName: string | null; lastName: string | null };
  }) {
    return {
      id: row.id,
      submissionId: row.submissionId,
      serviceUserId: row.serviceUserId,
      category: row.category,
      label: row.label,
      sectionNumber: row.sectionNumber,
      fileName: row.fileName,
      originalName: row.originalName,
      fileUrl: row.fileUrl,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      uploadedById: row.uploadedById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      uploadedBy: row.uploadedBy
        ? {
            id: row.uploadedBy.id,
            email: row.uploadedBy.email,
            firstName: row.uploadedBy.firstName,
            lastName: row.uploadedBy.lastName,
          }
        : null,
    };
  }

  async listAttachments(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.getSubmissionOrThrow(serviceUserId, submissionId);
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentAttachment',
        recordId: submissionId,
        serviceUserId,
        submissionId,
        metadata: { list: true },
      },
      meta,
    );
    const rows = await this.prisma.initialAssessmentAttachment.findMany({
      where: { submissionId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        uploadedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return { data: rows.map(r => this.mapAttachment(r)) };
  }

  async uploadAttachment(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    dto: UploadInitialAssessmentAttachmentDto,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    if (!EDITABLE_STATUSES.includes(submission.status)) {
      throw new ForbiddenException('Cannot add attachments to a submitted or reviewed assessment');
    }
    if (!file) throw new BadRequestException('File is required');

    const fileUrl = initialAssessmentFilePublicUrl(submissionId, file.filename);
    const row = await this.prisma.initialAssessmentAttachment.create({
      data: {
        submissionId,
        serviceUserId,
        category: dto.category,
        label: dto.label?.trim() ?? null,
        sectionNumber: dto.sectionNumber ?? null,
        fileName: file.filename,
        originalName: file.originalname,
        fileUrl,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedById: userId,
      },
      include: {
        uploadedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_ATTACHMENT_UPLOADED,
      recordType: 'InitialAssessmentAttachment',
      recordId: row.id,
      newValues: auditSnapshot({
        id: row.id,
        category: row.category,
        originalName: row.originalName,
        mimeType: row.mimeType,
        fileSize: row.fileSize,
      }),
      metadata: { serviceUserId, submissionId, templateId: submission.templateId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { data: this.mapAttachment(row) };
  }

  async deleteAttachment(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    attachmentId: string,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    if (!EDITABLE_STATUSES.includes(submission.status)) {
      throw new ForbiddenException('Cannot remove attachments from a submitted or reviewed assessment');
    }
    const existing = await this.prisma.initialAssessmentAttachment.findFirst({
      where: { id: attachmentId, submissionId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Attachment not found');

    await this.prisma.initialAssessmentAttachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_ATTACHMENT_DELETED,
      recordType: 'InitialAssessmentAttachment',
      recordId: attachmentId,
      oldValues: auditSnapshot({
        id: existing.id,
        category: existing.category,
        originalName: existing.originalName,
      }),
      metadata: { serviceUserId, submissionId, templateId: submission.templateId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Attachment removed' };
  }

  private mapRiskRecord(row: {
    id: string;
    submissionId: string;
    serviceUserId: string;
    riskType: string;
    description: string;
    likelihood: string;
    severity: string;
    riskLevel: string;
    controlMeasures: string | null;
    residualRisk: string | null;
    reviewDate: Date | null;
    status: string;
    sourceSectionNumber: number | null;
    sourceQuestionId: string | null;
    sourceQuestionText: string | null;
    responsiblePersonId: string | null;
    autoGenerated: boolean;
    createdAt: Date;
    updatedAt: Date;
    responsiblePerson?: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
  }) {
    return {
      id: row.id,
      submissionId: row.submissionId,
      serviceUserId: row.serviceUserId,
      riskType: row.riskType,
      description: row.description,
      likelihood: row.likelihood,
      severity: row.severity,
      riskLevel: row.riskLevel,
      controlMeasures: row.controlMeasures,
      residualRisk: row.residualRisk,
      reviewDate: row.reviewDate?.toISOString() ?? null,
      status: row.status,
      sourceSectionNumber: row.sourceSectionNumber,
      sourceQuestionId: row.sourceQuestionId,
      sourceQuestionText: row.sourceQuestionText,
      responsiblePersonId: row.responsiblePersonId,
      autoGenerated: row.autoGenerated,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      responsiblePerson: row.responsiblePerson
        ? {
            id: row.responsiblePerson.id,
            email: row.responsiblePerson.email,
            firstName: row.responsiblePerson.firstName,
            lastName: row.responsiblePerson.lastName,
          }
        : null,
    };
  }

  async listRiskRecords(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.getSubmissionOrThrow(serviceUserId, submissionId);
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentRiskRecord',
        recordId: submissionId,
        serviceUserId,
        submissionId,
        metadata: { list: true },
      },
      meta,
    );
    const rows = await this.prisma.initialAssessmentRiskRecord.findMany({
      where: { submissionId },
      orderBy: [{ riskLevel: 'desc' }, { reviewDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        responsiblePerson: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return { data: rows.map((r) => this.mapRiskRecord(r)) };
  }

  async createRiskRecord(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    dto: CreateInitialAssessmentRiskRecordDto,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const riskLevel = calculateRiskLevel(dto.likelihood, dto.severity);
    const row = await this.prisma.initialAssessmentRiskRecord.create({
      data: {
        submissionId,
        serviceUserId,
        riskType: dto.riskType,
        description: dto.description.trim(),
        likelihood: dto.likelihood,
        severity: dto.severity,
        riskLevel,
        controlMeasures: dto.controlMeasures?.trim() ?? null,
        residualRisk: dto.residualRisk ?? null,
        reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : null,
        responsiblePersonId: dto.responsiblePersonId ?? null,
        autoGenerated: false,
        status: InitialAssessmentRiskStatus.OPEN,
        createdById: userId,
        updatedById: userId,
      },
      include: {
        responsiblePerson: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentRiskRecord',
        recordId: row.id,
        serviceUserId,
        submissionId,
        templateId: submission.templateId,
      },
      meta,
    );
    return { data: this.mapRiskRecord(row) };
  }

  async updateRiskRecord(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    riskRecordId: string,
    dto: UpdateInitialAssessmentRiskRecordDto,
    meta?: RequestAuditMeta,
  ) {
    await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const existing = await this.prisma.initialAssessmentRiskRecord.findFirst({
      where: { id: riskRecordId, submissionId },
    });
    if (!existing) throw new NotFoundException('Risk record not found');

    const likelihood = dto.likelihood ?? existing.likelihood;
    const severity = dto.severity ?? existing.severity;
    const riskLevel =
      dto.likelihood !== undefined || dto.severity !== undefined
        ? calculateRiskLevel(likelihood, severity)
        : existing.riskLevel;

    const row = await this.prisma.initialAssessmentRiskRecord.update({
      where: { id: riskRecordId },
      data: {
        riskType: dto.riskType,
        description: dto.description?.trim(),
        likelihood: dto.likelihood,
        severity: dto.severity,
        riskLevel,
        controlMeasures: dto.controlMeasures !== undefined ? dto.controlMeasures?.trim() ?? null : undefined,
        residualRisk: dto.residualRisk !== undefined ? dto.residualRisk : undefined,
        reviewDate:
          dto.reviewDate !== undefined ? (dto.reviewDate ? new Date(dto.reviewDate) : null) : undefined,
        status: dto.status,
        responsiblePersonId:
          dto.responsiblePersonId !== undefined ? dto.responsiblePersonId : undefined,
        updatedById: userId,
      },
      include: {
        responsiblePerson: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    await this.logDataAccess(
      userId,
      {
        recordType: 'InitialAssessmentRiskRecord',
        recordId: row.id,
        serviceUserId,
        submissionId,
      },
      meta,
    );
    return { data: this.mapRiskRecord(row) };
  }

  private resolvePublicAssetUrl(
    path: string | null | undefined,
    publicOrigin: string | null | undefined,
  ): string | null {
    const raw = path?.trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (!publicOrigin?.trim()) return null;
    const base = publicOrigin.replace(/\/$/, '');
    return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
  }

  private async buildSubmissionExportData(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    includeSecureFields: boolean,
    publicOrigin?: string | null,
    options?: { embedOrganisationLogo?: boolean },
  ): Promise<{ pdfData: InitialAssessmentPdfData; templateId: string }> {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const serviceUser = await this.ensureServiceUser(serviceUserId);

    const [sectionRows, answers, actions, risks, company, exporter] = await Promise.all([
      this.prisma.initialAssessmentSection.findMany({
        where: { templateId: submission.templateId, deletedAt: null },
        orderBy: { sectionNumber: 'asc' },
        select: {
          sectionNumber: true,
          title: true,
          questions: {
            where: { isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              questionText: true,
              questionType: true,
              options: true,
              metadata: true,
              sortOrder: true,
            },
          },
        },
      }),
      this.prisma.initialAssessmentAnswer.findMany({ where: { submissionId } }),
      this.prisma.initialAssessmentAction.findMany({
        where: {
          submissionId,
          status: { in: ['OPEN', 'IN_PROGRESS'] as const },
        },
        orderBy: { dueDate: 'asc' },
        select: { title: true, priority: true, status: true, dueDate: true },
      }),
      this.prisma.initialAssessmentRiskRecord.findMany({
        where: { submissionId },
        orderBy: { createdAt: 'desc' },
        select: { description: true, riskLevel: true, riskType: true },
        take: 50,
      }),
      this.prisma.companyProfile.findFirst({
        select: {
          displayName: true,
          companyName: true,
          displayLogoUrl: true,
          companyLogoUrl: true,
        },
      }),
      this.prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { firstName: true, lastName: true, email: true },
      }),
    ]);

    const signOffQuestions = sectionRows
      .filter((s) => s.sectionNumber === 14)
      .flatMap((s) => s.questions.map((q) => ({ id: q.id, questionText: q.questionText, metadata: q.metadata })));

    const submittedByName = submission.submittedBy
      ? [submission.submittedBy.firstName, submission.submittedBy.lastName].filter(Boolean).join(' ').trim() ||
        submission.submittedBy.email
      : null;
    const reviewedByName = submission.reviewedBy
      ? [submission.reviewedBy.firstName, submission.reviewedBy.lastName].filter(Boolean).join(' ').trim() ||
        submission.reviewedBy.email
      : null;
    const generatedByName = exporter
      ? [exporter.firstName, exporter.lastName].filter(Boolean).join(' ').trim() || exporter.email
      : null;

    const logoRelative = company?.displayLogoUrl ?? company?.companyLogoUrl;
    const organisationLogoUrl = options?.embedOrganisationLogo
      ? (await embedOrganisationLogoForExport(
          company?.displayLogoUrl,
          company?.companyLogoUrl,
        )) ?? this.resolvePublicAssetUrl(logoRelative, publicOrigin)
      : this.resolvePublicAssetUrl(logoRelative, publicOrigin);

    const pdfData = buildInitialAssessmentPdfData({
      organisationName: company?.displayName ?? company?.companyName ?? null,
      organisationLogoUrl,
      companyLegalName: company?.companyName ?? null,
      productBrandName: 'CareAdmin',
      serviceUser: {
        firstName: serviceUser.firstName,
        lastName: serviceUser.lastName,
        preferredName: serviceUser.preferredName,
        serviceUserNumber: serviceUser.serviceUserNumber,
        dateOfBirth: serviceUser.dateOfBirth,
      },
      template: submission.template,
      submission: {
        id: submission.id,
        status: submission.status,
        submittedAt: submission.submittedAt,
        reviewedAt: submission.reviewedAt,
        reviewNotes: submission.reviewNotes,
        metadata: submission.metadata,
      },
      submittedByName,
      reviewedByName,
      generatedByName,
      includeSecureFields,
      sectionRows: sectionRows.map((s) => ({
        sectionNumber: s.sectionNumber,
        title: s.title,
        questions: s.questions,
      })),
      answers,
      actions,
      risks,
      signOffQuestions,
    });

    return { pdfData, templateId: submission.templateId };
  }

  async exportSubmissionPdf(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    includeSecureFields: boolean,
    meta?: RequestAuditMeta,
    publicOrigin?: string | null,
  ) {
    const { pdfData, templateId } = await this.buildSubmissionExportData(
      userId,
      serviceUserId,
      submissionId,
      includeSecureFields,
      publicOrigin,
      { embedOrganisationLogo: true },
    );

    const pdf = await buildInitialAssessmentPdf(pdfData);
    const filename = initialAssessmentPdfFilename(pdfData);

    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.PDF_EXPORTED,
      recordType: 'InitialAssessmentSubmission',
      recordId: submissionId,
      metadata: {
        serviceUserId,
        submissionId,
        templateId,
        includeSecureFields,
        format: 'pdf',
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { pdf, filename };
  }

  async exportSubmissionHtml(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    includeSecureFields: boolean,
    meta?: RequestAuditMeta,
    publicOrigin?: string | null,
  ) {
    const { pdfData, templateId } = await this.buildSubmissionExportData(
      userId,
      serviceUserId,
      submissionId,
      includeSecureFields,
      publicOrigin,
      { embedOrganisationLogo: true },
    );

    const html = buildInitialAssessmentHtml(pdfData);
    const filename = initialAssessmentHtmlFilename(pdfData);

    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.PDF_EXPORTED,
      recordType: 'InitialAssessmentSubmission',
      recordId: submissionId,
      metadata: {
        serviceUserId,
        submissionId,
        templateId,
        includeSecureFields,
        format: 'html',
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { html, filename };
  }

  async regenerateRiskRecords(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    await this.prisma.$transaction(async (tx) => {
      await this.syncAutoRiskRecords(tx, {
        submissionId,
        serviceUserId,
        templateId: submission.templateId,
        metadata: submission.metadata,
        userId,
      });
    });
    return this.listRiskRecords(userId, serviceUserId, submissionId, meta);
  }

  async reviewQueue(
    userId: string,
    query: InitialAssessmentReviewQueueQueryDto,
    meta?: RequestAuditMeta,
  ) {
    const now = new Date();
    const overdueActionsOnly = query.overdueActionsOnly === true;

    const rows = await this.prisma.initialAssessmentSubmission.findMany({
      where: {
        deletedAt: null,
        ...(overdueActionsOnly
          ? {
              actions: {
                some: {
                  status: { in: ['OPEN', 'IN_PROGRESS'] },
                  dueDate: { lte: now },
                },
              },
            }
          : {
              OR: [
                { status: PrismaStatus.SUBMITTED },
                {
                  actions: {
                    some: {
                      status: { in: ['OPEN', 'IN_PROGRESS'] },
                      dueDate: { lte: now },
                    },
                  },
                },
              ],
            }),
      },
      include: {
        serviceUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            serviceUserNumber: true,
          },
        },
        submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        template: { select: { id: true, name: true, version: true } },
        _count: {
          select: {
            actions: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } },
            riskRecords: { where: { status: 'OPEN' } },
          },
        },
      },
      orderBy: [{ submittedAt: 'asc' }, { updatedAt: 'asc' }],
      take: 200,
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_SUMMARY_VIEWED,
      recordType: 'InitialAssessmentReviewQueue',
      recordId: 'review-queue',
      metadata: { overdueActionsOnly, count: rows.length },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: {
        submissions: rows.map((row) => {
          const metaObj =
            typeof row.metadata === 'object' && row.metadata && !Array.isArray(row.metadata)
              ? (row.metadata as Record<string, unknown>)
              : {};
          const managerReviewRequired = metaObj.managerReviewRequired === true;
          const careActivationBlocked = metaObj.careActivationBlocked === true;
          const queueReasons = [
            row.status === PrismaStatus.SUBMITTED ? 'Awaiting manager review' : null,
            managerReviewRequired ? 'Manager review required' : null,
            careActivationBlocked ? 'Care activation blocked' : null,
            row._count.actions > 0 ? `${row._count.actions} open action(s)` : null,
            row._count.riskRecords > 0 ? `${row._count.riskRecords} open risk(s)` : null,
          ].filter(Boolean) as string[];

          const su = row.serviceUser;
          const serviceUserName = [su.preferredName, su.firstName, su.lastName]
            .filter(Boolean)
            .join(' ')
            .trim();

          return {
            id: row.id,
            serviceUserId: row.serviceUserId,
            serviceUserName: serviceUserName || 'Service user',
            serviceUserNumber: su.serviceUserNumber,
            status: row.status,
            submittedAt: row.submittedAt?.toISOString() ?? null,
            managerReviewRequired,
            openActionsCount: row._count.actions,
            openRiskCount: row._count.riskRecords,
            templateVersion: row.template.version,
            queueReasons,
          };
        }),
        total: rows.length,
      },
    };
  }

  async decideCarePlanRecommendation(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    recommendationId: string,
    dto: { decision: CarePlanRecommendationDecision; reason?: string },
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    if (submission.status !== PrismaStatus.REVIEWED) {
      throw new BadRequestException(
        'Care plan decisions are only allowed after manager review is complete',
      );
    }

    const triggerItems = await this.getFlaggedAnswers(submissionId, 'carePlan');
    const recommendations = await this.carePlanRules.resolveRecommendations(submissionId, triggerItems);
    const target = recommendations.find((r) => r.id === recommendationId);
    if (!target) {
      throw new NotFoundException('Care plan recommendation not found');
    }

    if (dto.decision === CarePlanRecommendationDecision.DECLINED) {
      const reason = dto.reason?.trim() ?? '';
      if (reason.length < 3) {
        throw new BadRequestException('A decline reason is required (min 3 characters)');
      }
    }

    const priorMeta =
      typeof submission.metadata === 'object' && submission.metadata && !Array.isArray(submission.metadata)
        ? (submission.metadata as Record<string, unknown>)
        : {};
    const priorDecisions = readCarePlanDecisions(submission.metadata);

    let resolvedFormId = target.carePathwayFormId;
    let resolvedFormName = target.carePathwayFormName;
    if (dto.decision === CarePlanRecommendationDecision.ACCEPTED) {
      const catalogue = await this.prisma.carePathwayForm.findMany({
        where: { formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
        select: { id: true, name: true },
      });
      const row = resolveCarePlanFormFromCatalogue(
        catalogue,
        target.carePlanArea,
        target.carePathwayFormName,
      );
      resolvedFormId = target.carePathwayFormId ?? row?.id;
      resolvedFormName = target.carePathwayFormName ?? row?.name;
    }

    const nextDecision = {
      decision: dto.decision,
      reason:
        dto.decision === CarePlanRecommendationDecision.DECLINED ? (dto.reason?.trim() ?? null) : null,
      decidedAt: new Date().toISOString(),
      decidedById: userId,
      ...(dto.decision === CarePlanRecommendationDecision.ACCEPTED
        ? {
            carePathwayFormId: resolvedFormId,
            carePathwayFormName: resolvedFormName,
            title: target.title,
            carePlanArea: target.carePlanArea,
          }
        : {}),
    };

    let managerReviewRequired = priorMeta.managerReviewRequired === true;
    if (dto.decision === CarePlanRecommendationDecision.DECLINED) {
      const highRiskCount = await this.prisma.initialAssessmentRiskRecord.count({
        where: {
          submissionId,
          status: 'OPEN',
          riskLevel: { in: ['HIGH'] },
        },
      });
      if (highRiskCount > 0) {
        managerReviewRequired = true;
      }
    }

    const nextMetadata = {
      ...priorMeta,
      managerReviewRequired,
      carePlanDecisions: {
        ...priorDecisions,
        [recommendationId]: nextDecision,
      },
    } as Prisma.InputJsonValue;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.initialAssessmentSubmission.update({
        where: { id: submissionId },
        data: { metadata: nextMetadata, updatedById: userId },
        include: submissionInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_CARE_PLAN_DECISION,
        recordType: 'InitialAssessmentSubmission',
        recordId: submissionId,
        newValues: {
          recommendationId,
          carePlanArea: target.carePlanArea,
          decision: dto.decision,
          reason: nextDecision.reason,
        },
        metadata: { serviceUserId, submissionId, recommendationId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return row;
    });

    const merged = applyCarePlanDecisions(recommendations, readCarePlanDecisions(updated.metadata));
    return {
      message: 'Care plan recommendation updated',
      data: {
        submission: this.mapSubmission(updated),
        recommendation: merged.find((r) => r.id === recommendationId) ?? null,
      },
    };
  }

  async exportCqcEvidence(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.getSubmissionOrThrow(serviceUserId, submissionId);
    const serviceUser = await this.ensureServiceUser(serviceUserId);

    const [riskItems, triggerItems, openActions, openRisks, auditRows] = await Promise.all([
      this.getFlaggedAnswers(submissionId, 'risk'),
      this.getFlaggedAnswers(submissionId, 'carePlan'),
      this.prisma.initialAssessmentAction.findMany({
        where: { submissionId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
        take: 50,
      }),
      this.prisma.initialAssessmentRiskRecord.findMany({
        where: { submissionId, status: 'OPEN' },
        orderBy: [{ riskLevel: 'desc' }, { reviewDate: 'asc' }],
        take: 50,
      }),
      this.prisma.auditLog.findMany({
        where: {
          module: AuditModule.SERVICE_USER,
          OR: [
            { recordId: submissionId },
            { metadata: { path: ['submissionId'], equals: submissionId } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          action: true,
          createdAt: true,
          userId: true,
          oldValues: true,
          newValues: true,
          metadata: true,
        },
      }),
    ]);

    const submissionMeta =
      typeof submission.metadata === 'object' && submission.metadata && !Array.isArray(submission.metadata)
        ? (submission.metadata as Record<string, unknown>)
        : {};
    const carePlanRecommendations = applyCarePlanDecisions(
      await this.carePlanRules.resolveRecommendations(submissionId, triggerItems),
      readCarePlanDecisions(submission.metadata),
    );
    const clinical = parseStoredClinicalMetadata(submission.metadata);
    const waterlowTotal = waterlowScoreFromMetadata(submission.metadata);

    const pack = {
      format: 'initial-assessment-cqc-evidence-v1',
      generatedAt: new Date().toISOString(),
      serviceUser: {
        id: serviceUser.id,
        name: [serviceUser.preferredName, serviceUser.firstName, serviceUser.lastName]
          .filter(Boolean)
          .join(' ')
          .trim(),
        serviceUserNumber: serviceUser.serviceUserNumber,
        dateOfBirth: serviceUser.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      },
      submission: {
        id: submission.id,
        status: submission.status,
        submittedAt: submission.submittedAt?.toISOString() ?? null,
        reviewedAt: submission.reviewedAt?.toISOString() ?? null,
        managerReviewRequired: submissionMeta.managerReviewRequired === true,
        careActivationBlocked: submissionMeta.careActivationBlocked === true,
        templateVersion: submission.template.version,
      },
      summary: {
        riskFlagCount: riskItems.length,
        carePlanTriggerCount: triggerItems.length,
        openActionsCount: openActions.length,
        openRiskCount: openRisks.length,
        waterlowScore: waterlowTotal > 0 ? waterlowTotal : null,
      },
      carePlanRecommendations,
      openActions: openActions.map((a) => ({
        id: a.id,
        title: a.title,
        actionType: a.actionType,
        priority: a.priority,
        status: a.status,
        dueDate: a.dueDate?.toISOString().slice(0, 10) ?? null,
      })),
      openRisks: openRisks.map((r) => ({
        id: r.id,
        riskType: r.riskType,
        description: r.description,
        riskLevel: r.riskLevel,
        reviewDate: r.reviewDate?.toISOString().slice(0, 10) ?? null,
      })),
      clinical: {
        vitals: clinical.vitals,
        falls: clinical.falls,
        waterlow: submissionMeta.waterlow ?? null,
      },
      auditExcerpt: auditRows.map((row) => ({
        id: row.id,
        action: row.action,
        at: row.createdAt.toISOString(),
        userId: row.userId,
        metadata: row.metadata,
      })),
    };

    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_CQC_EVIDENCE_EXPORTED,
      recordType: 'InitialAssessmentSubmission',
      recordId: submissionId,
      metadata: { serviceUserId, submissionId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { data: pack };
  }
}
