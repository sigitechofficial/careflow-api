import type { Prisma } from '@prisma/client';
import type {
  CarePlanFieldProvenance,
  ComposePlanResult,
} from './compose/compose-context.types';
import { mergeProvenanceIntoComposedFrom } from './compose/compose-provenance.util';
import { sanitizeCarePlanDraftValuesForSave } from './compose/care-plan-draft-sanitize.util';
import { ensureDraftValuesNextReviewDate } from './care-plan-review-schedule';

type ComposeOutput = Pick<
  ComposePlanResult,
  'values' | 'composedFrom' | 'gaps' | 'suggestionMode'
> & {
  provenance?: Record<string, CarePlanFieldProvenance>;
};

export type AcceptedRecommendationDraft = {
  valuesJson: Prisma.InputJsonValue;
  composedFromJson: Prisma.InputJsonValue | undefined;
  gapsJson: Prisma.InputJsonValue | undefined;
  /** False when compose could not be tied to the accepted assessment; the draft is then left empty. */
  prefilled: boolean;
  prefillSkippedReason?: string;
};

/**
 * First draft for a care plan created by accepting an IA recommendation — the same values the
 * "Create Plan" button saves. Compose always reads the service user's latest assessment, so the
 * draft is only pre-filled when compose reports it used the accepted assessment; otherwise it is
 * created empty rather than filled from a different assessment.
 */
export function buildAcceptedRecommendationDraft(input: {
  compose: ComposeOutput;
  formName: string;
  reviewFrequencyMonths: number | null;
  submissionId: string;
  recommendationId: string;
  now?: Date;
}): AcceptedRecommendationDraft {
  const now = input.now ?? new Date();
  const composedFrom = input.compose.composedFrom ?? {};
  const sourceSubmissionId =
    typeof composedFrom.iaSubmissionId === 'string'
      ? composedFrom.iaSubmissionId
      : null;
  const prefilled = sourceSubmissionId === input.submissionId;

  // Explicit suggestion mode never auto-fills fields (suggestions are reviewed in the editor).
  const composedValues =
    prefilled && input.compose.suggestionMode !== 'explicit'
      ? (input.compose.values ?? {})
      : {};
  const sanitized = sanitizeCarePlanDraftValuesForSave(
    input.formName,
    composedValues,
  ) as Record<string, unknown>;
  const values = ensureDraftValuesNextReviewDate(sanitized, {
    existingNextReviewDueAt: null,
    reviewFrequencyMonths: input.reviewFrequencyMonths,
    from: now,
  });

  const acceptedRecommendation = {
    submissionId: input.submissionId,
    recommendationId: input.recommendationId,
    acceptedAt: now.toISOString(),
  };

  if (!prefilled) {
    return {
      valuesJson: values as Prisma.InputJsonValue,
      composedFromJson: { acceptedRecommendation },
      gapsJson: undefined,
      prefilled: false,
      prefillSkippedReason: sourceSubmissionId
        ? 'A newer initial assessment is on file, so the draft was not pre-filled from the accepted one.'
        : 'Compose did not identify the initial assessment it used, so the draft was not pre-filled.',
    };
  }

  return {
    valuesJson: values as Prisma.InputJsonValue,
    composedFromJson: {
      ...mergeProvenanceIntoComposedFrom(
        composedFrom,
        input.compose.provenance ?? {},
      ),
      acceptedRecommendation,
    },
    gapsJson: input.compose.gaps ?? undefined,
    prefilled: true,
  };
}
