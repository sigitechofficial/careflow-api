import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { InitialAssessmentTemplatesService } from '../initial-assessment-templates/initial-assessment-templates.service';
import { InitialAssessmentsService } from '../initial-assessments/initial-assessments.service';
import { InitialAssessmentStatus } from '../initial-assessments/enums/initial-assessment-status.enum';
import {
  buildAutofillAnswers,
  buildHolisticWorksheetMetadata,
  mergeMetadataPatch,
  type IaAutofillLevel,
  type TemplateQuestion,
} from './ia-autofill-build.util';

const IA_AUTOFILL_LEVEL_DETAIL: Record<IaAutofillLevel, string> = {
  low: ' Stable / normal condition — required fields, low-risk flags; submitted incomplete where allowed.',
  normal:
    ' Moderate condition — required fields and hubs; submitted incomplete where allowed.',
  critical:
    ' Very critical condition — all 14 sections with elevated safeguarding, falls, wounds, and scores.',
};

@Injectable()
export class IaApiAutofillService {
  private readonly logger = new Logger(IaApiAutofillService.name);

  constructor(
    private readonly assessments: InitialAssessmentsService,
    private readonly templates: InitialAssessmentTemplatesService,
  ) {}

  async run(
    userId: string,
    serviceUserId: string,
    level: IaAutofillLevel,
    meta?: RequestAuditMeta,
  ): Promise<{ message: string }> {
    const templateRes = await this.templates.getDefaultTemplate();
    const template = templateRes.data;

    const listRes = await this.assessments.getSubmissions(
      userId,
      serviceUserId,
      { limit: 20, sortOrder: 'desc' },
      meta,
    );
    let submission =
      listRes.data.find((s) => s.status === 'IN_PROGRESS' || s.status === 'DRAFT') ?? listRes.data[0];

    if (!submission) {
      try {
        const created = await this.assessments.createSubmission(userId, serviceUserId, {}, meta);
        submission = created.data;
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
        const retry = await this.assessments.getSubmissions(
          userId,
          serviceUserId,
          { limit: 20, sortOrder: 'desc' },
          meta,
        );
        submission =
          retry.data.find((s) => s.status === 'IN_PROGRESS' || s.status === 'DRAFT') ?? retry.data[0];
        if (!submission) throw err;
      }
    } else if (submission.status !== 'IN_PROGRESS' && submission.status !== 'DRAFT') {
      const reopened = await this.assessments.updateStatus(
        userId,
        serviceUserId,
        submission.id,
        {
          status: InitialAssessmentStatus.IN_PROGRESS,
          reason: 'API autofill reopen for testing',
        },
        meta,
      );
      submission = reopened.data;
    }

    const freshRes = await this.assessments.getSubmissionById(userId, serviceUserId, submission.id, meta);
    const fresh = freshRes.data;
    const existingMeta =
      fresh.metadata && typeof fresh.metadata === 'object' && !Array.isArray(fresh.metadata)
        ? (fresh.metadata as Record<string, unknown>)
        : {};

    const answerCountRes = await this.assessments.getAnswers(userId, serviceUserId, submission.id, meta);
    const existingAnswerCount = answerCountRes.data?.length ?? 0;
    const needsCorrectionReason =
      existingMeta.correctionRequired === true ||
      typeof existingMeta.reopenedAt === 'string' ||
      (existingAnswerCount > 0 && (fresh.status === 'IN_PROGRESS' || fresh.status === 'DRAFT'));
    const correctionReason = needsCorrectionReason
      ? 'API autofill after manager reopen for testing.'
      : undefined;

    const allQuestions: TemplateQuestion[] = (template.sections ?? []).flatMap((section) =>
      (section.questions ?? []).map((q) => ({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        isRequired: q.isRequired,
        sortOrder: q.sortOrder,
        metadata:
          q.metadata && typeof q.metadata === 'object' && !Array.isArray(q.metadata)
            ? (q.metadata as Record<string, unknown>)
            : null,
        options: q.options ?? undefined,
        sectionNumber: section.sectionNumber,
      })),
    );

    const answers = buildAutofillAnswers(allQuestions, level);
    const chunkSize = 40;
    for (let i = 0; i < answers.length; i += chunkSize) {
      await this.assessments.saveAnswers(
        userId,
        serviceUserId,
        submission.id,
        {
          answers: answers.slice(i, i + chunkSize),
          ...(correctionReason ? { correctionReason } : {}),
        },
        meta,
      );
    }

    const metaPatch = buildHolisticWorksheetMetadata(level);
    await this.assessments.updateSubmission(
      userId,
      serviceUserId,
      submission.id,
      { metadata: mergeMetadataPatch(existingMeta, metaPatch) },
      meta,
    );

    await this.trySubmit(userId, serviceUserId, submission.id, level, meta);

    this.logger.log(`IA API autofill (${level}) finished for ${serviceUserId} submission ${submission.id}`);
    return {
      message: `Initial assessment autofill (${level}) completed for this service user.${IA_AUTOFILL_LEVEL_DETAIL[level]}`,
    };
  }

  private async trySubmit(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    level: IaAutofillLevel,
    meta?: RequestAuditMeta,
  ): Promise<void> {
    const submit = async (skipIncomplete: boolean) => {
      await this.assessments.submitAssessment(
        userId,
        serviceUserId,
        submissionId,
        { skipIncompleteValidation: skipIncomplete },
        meta,
      );
    };

    if (level === 'low') {
      try {
        await submit(false);
      } catch {
        await submit(true);
      }
      return;
    }
    if (level === 'normal') {
      try {
        await submit(true);
      } catch {
        // Leave in progress if submit still blocked.
      }
      return;
    }
    try {
      await submit(false);
    } catch {
      await submit(true);
    }
  }
}
