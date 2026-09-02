/**
 * IA Pain Assessment Tool metadata on IA submissions (submission.metadata.painAssessment).
 * Loaded additively onto the compose IA snapshot; only the Pain Management compose reads it.
 * Other Care Plan engines ignore the field.
 */
import {
  formatAbbeyCarePlanSuggestion,
  isAbbeyAssessmentComplete,
  painAssessmentFromMetadata,
  type PainAssessmentMetadataLike,
} from '../../initial-assessments/initial-assessment-abbey.util';

export type CarePlanPainAssessmentComposeMetadata = PainAssessmentMetadataLike;

export function readPainAssessmentFromSubmissionMetadata(
  metadata: unknown,
): CarePlanPainAssessmentComposeMetadata | null {
  const pain = painAssessmentFromMetadata(metadata);
  return pain ?? null;
}

export function abbeyCarePlanSuggestionText(
  pain: CarePlanPainAssessmentComposeMetadata | null | undefined,
): string | null {
  if (!isAbbeyAssessmentComplete(pain?.abbey)) return null;
  return formatAbbeyCarePlanSuggestion(pain ?? undefined);
}
