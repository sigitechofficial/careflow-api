import type { CarePlanRecommendation } from '../initial-assessments/initial-assessment-care-plan.util';
import {
  readCarePlanDecisions,
  type StoredCarePlanDecision,
} from '../initial-assessments/initial-assessment-care-plan-decisions.util';
import {
  resolveCarePlanFormFromCatalogue,
  type CarePlanCatalogueRow,
} from '../initial-assessments/initial-assessment-care-plan-area-map.util';

/**
 * Find pending IA recommendations that target the care plan form being published.
 * Prefer carePathwayFormId; fall back to catalogue/area/name resolution (same as accept).
 */
export function recommendationsMatchingPublishedForm(
  recommendations: CarePlanRecommendation[],
  publishedFormId: string,
  publishedFormName: string,
  catalogue: CarePlanCatalogueRow[],
  existingDecisions: Record<string, StoredCarePlanDecision>,
): CarePlanRecommendation[] {
  return recommendations.filter((rec) => {
    const prior = existingDecisions[rec.id];
    if (prior?.decision === 'accepted' || prior?.decision === 'declined') return false;

    if (rec.carePathwayFormId && rec.carePathwayFormId === publishedFormId) return true;

    const resolved = resolveCarePlanFormFromCatalogue(
      catalogue,
      rec.carePlanArea,
      rec.carePathwayFormName,
    );
    if (resolved?.id === publishedFormId) return true;

    const recName = (rec.carePathwayFormName ?? '').trim().toLowerCase();
    if (recName && recName === publishedFormName.trim().toLowerCase()) return true;

    return false;
  });
}

export function buildAcceptedDecisionOnPublish(input: {
  userId: string;
  decidedAtIso: string;
  carePathwayFormId: string;
  carePathwayFormName: string;
  recommendation: CarePlanRecommendation;
}): StoredCarePlanDecision {
  return {
    decision: 'accepted',
    reason: null,
    decidedAt: input.decidedAtIso,
    decidedById: input.userId,
    carePathwayFormId: input.carePathwayFormId,
    carePathwayFormName: input.carePathwayFormName,
    title: input.recommendation.title,
    carePlanArea: input.recommendation.carePlanArea,
  };
}

/**
 * Merge accepted decisions into IA submission metadata (carePlanDecisions map).
 */
export function mergeCarePlanDecisionsIntoMetadata(
  metadata: unknown,
  additions: Record<string, StoredCarePlanDecision>,
): Record<string, unknown> {
  const priorMeta =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  const priorDecisions = readCarePlanDecisions(metadata);
  return {
    ...priorMeta,
    carePlanDecisions: {
      ...priorDecisions,
      ...additions,
    },
  };
}

/** Pending recommendations after applyCarePlanDecisions (for Recommended list assertions). */
export function pendingRecommendationFormNames(
  recommendations: Array<{ status: string; carePathwayFormName?: string; carePlanArea: string }>,
): string[] {
  return recommendations
    .filter((r) => r.status === 'pending')
    .map((r) => r.carePathwayFormName?.trim() || r.carePlanArea);
}
