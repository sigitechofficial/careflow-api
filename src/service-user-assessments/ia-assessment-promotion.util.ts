import { Prisma } from '@prisma/client';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { buildIaAssessmentCompletions } from './assessment-tool-registry';
import { computeAssessmentReviewState } from './assessment-review-schedule';
import { loadReviewSettings } from '../organisation-general-settings/review-settings.util';

type QuestionRow = {
  id: string;
  questionText: string;
  questionType: string;
  metadata: Prisma.JsonValue;
  section: { sectionNumber: number };
};

type AnswerRow = {
  questionId: string;
  checked: boolean | null;
  booleanValue: boolean | null;
  textValue: string | null;
  numberValue: Prisma.Decimal | null;
  dateValue: Date | null;
  timeValue: string | null;
  selectedOptions: Prisma.JsonValue;
};

export async function promoteIaAssessmentsOnSubmit(
  tx: Prisma.TransactionClient,
  params: {
    audit: AuditLogsService;
    serviceUserId: string;
    submissionId: string;
    submittedById: string;
    submittedAt: Date;
    metadata: Prisma.JsonValue | null | undefined;
    questions: QuestionRow[];
    answers: AnswerRow[];
  },
) {
  const completions = buildIaAssessmentCompletions({
    metadata: params.metadata,
    questions: params.questions,
    answers: params.answers,
  });

  if (!completions.length) return;
  const { assessmentIntervals } = await loadReviewSettings(tx);

  for (const completion of completions) {
    const assessment = await tx.serviceUserAssessment.upsert({
      where: {
        serviceUserId_assessmentKey: {
          serviceUserId: params.serviceUserId,
          assessmentKey: completion.assessmentKey,
        },
      },
      create: {
        serviceUserId: params.serviceUserId,
        assessmentKey: completion.assessmentKey,
        title: completion.title,
      },
      update: {
        title: completion.title,
      },
    });

    const promotionKey = `${params.submissionId}:${completion.assessmentKey}`;
    const existing = await tx.serviceUserAssessmentCompletion.findFirst({
      where: { promotionKey },
      select: { id: true },
    });
    if (existing) continue;

    const created = await tx.serviceUserAssessmentCompletion.create({
      data: {
        assessmentId: assessment.id,
        source: 'INITIAL_ASSESSMENT',
        sourceSubmissionId: params.submissionId,
        sourceHolisticTabId: completion.holisticTabId ?? null,
        completedAt: params.submittedAt,
        completedById: params.submittedById,
        summary: completion.summary,
        snapshot: completion.snapshot as Prisma.InputJsonValue,
        promotionKey,
      },
    });

    await params.audit.logAudit({
      tx,
      userId: params.submittedById,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.ASSESSMENT_PROMOTED,
      recordType: 'ServiceUserAssessmentCompletion',
      recordId: created.id,
      newValues: auditSnapshot({
        assessmentKey: completion.assessmentKey,
        summary: completion.summary,
        completedAt: params.submittedAt.toISOString(),
      }),
      metadata: {
        serviceUserId: params.serviceUserId,
        submissionId: params.submissionId,
        assessmentId: assessment.id,
        assessmentKey: completion.assessmentKey,
        source: 'INITIAL_ASSESSMENT',
        ...(() => {
          const review = computeAssessmentReviewState({
            assessmentKey: completion.assessmentKey,
            lastCompletedAt: params.submittedAt,
            snapshot: completion.snapshot,
            overrides: assessmentIntervals,
          });
          return {
            nextReviewDueAt: review.nextReviewDueAt,
            reviewStatus: review.status,
            effectiveIntervalDays: review.effectiveIntervalDays,
          };
        })(),
      },
    });
  }
}
