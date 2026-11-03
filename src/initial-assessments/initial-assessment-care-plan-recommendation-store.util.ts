import {
  InitialAssessmentCarePlanRecommendationStatus as StoredStatus,
  Prisma,
} from '@prisma/client';
import type { CarePlanRecommendation } from './initial-assessment-care-plan.util';
import {
  effectiveCarePlanDecision,
  type StoredCarePlanDecision,
} from './initial-assessment-care-plan-decisions.util';

export type StoredRecommendationRow = {
  id: string;
  legacyRecommendationId: string;
  carePathwayFormId: string | null;
  status: StoredStatus;
  evidenceJson: Prisma.JsonValue;
};

export type RecommendationPersistencePlan = {
  create: Array<{
    legacyRecommendationId: string;
    carePathwayFormId: string | null;
    sourceType: string;
    evidenceJson: Prisma.InputJsonValue;
    sortOrder: number;
    status: StoredStatus;
    decisionReason: string | null;
    decidedById: string | null;
    decidedAt: Date | null;
  }>;
  /** Pending rows whose evidence is refreshed from the new calculation. */
  refresh: Array<{
    id: string;
    carePathwayFormId: string | null;
    sourceType: string;
    evidenceJson: Prisma.InputJsonValue;
  }>;
};

function evidenceOf(rec: CarePlanRecommendation): Prisma.InputJsonValue {
  // Decision state lives in the decision fields / metadata, never in the evidence snapshot.
  return { ...rec, status: 'pending' };
}

export function storedStatusForDecision(
  decision: StoredCarePlanDecision | undefined,
): StoredStatus {
  if (decision?.decision === 'accepted') return StoredStatus.ACCEPTED;
  if (decision?.decision === 'declined') return StoredStatus.DECLINED;
  if (decision?.decision === 'deferred') return StoredStatus.DEFERRED;
  return StoredStatus.PENDING;
}

/** A stored row in the shape the API has always returned (decision state is applied afterwards). */
export function recommendationFromStoredRow(
  row: StoredRecommendationRow,
): CarePlanRecommendation {
  const evidence =
    row.evidenceJson &&
    typeof row.evidenceJson === 'object' &&
    !Array.isArray(row.evidenceJson)
      ? (row.evidenceJson as unknown as Partial<CarePlanRecommendation>)
      : {};
  return {
    carePlanArea: '',
    sectionNumber: 0,
    sectionTitle: '',
    title: '',
    triggerCount: 0,
    triggers: [],
    ...evidence,
    id: row.legacyRecommendationId,
    status: 'pending',
    ...(row.carePathwayFormId
      ? { carePathwayFormId: row.carePathwayFormId }
      : {}),
  };
}

/**
 * Which recommendations to store for a submission. A recommendation already stored — under its own
 * id, an alias, or for the same care plan form — is never duplicated. Accepted or declined rows are
 * never touched; pending rows stored under the same id get the latest evidence. Stored rows that
 * are no longer calculated are kept.
 */
export function planRecommendationPersistence(input: {
  recommendations: CarePlanRecommendation[];
  existing: StoredRecommendationRow[];
  decisions: Record<string, StoredCarePlanDecision>;
}): RecommendationPersistencePlan {
  const plan: RecommendationPersistencePlan = { create: [], refresh: [] };
  const claimed = [...input.existing];
  let nextSort = input.existing.length;

  for (const rec of input.recommendations) {
    const ids = new Set([rec.id, ...(rec.aliasIds ?? [])]);
    const match =
      claimed.find((row) => row.legacyRecommendationId === rec.id) ??
      claimed.find((row) => ids.has(row.legacyRecommendationId)) ??
      (rec.carePathwayFormId
        ? claimed.find((row) => row.carePathwayFormId === rec.carePathwayFormId)
        : undefined);

    if (match) {
      if (
        match.status === StoredStatus.PENDING &&
        match.legacyRecommendationId === rec.id
      ) {
        plan.refresh.push({
          id: match.id,
          carePathwayFormId: rec.carePathwayFormId ?? null,
          sourceType: rec.source ?? 'legacy',
          evidenceJson: evidenceOf(rec),
        });
      }
      continue;
    }

    const decision = effectiveCarePlanDecision(rec, input.decisions);
    const status = storedStatusForDecision(decision);
    plan.create.push({
      legacyRecommendationId: rec.id,
      carePathwayFormId: rec.carePathwayFormId ?? null,
      sourceType: rec.source ?? 'legacy',
      evidenceJson: evidenceOf(rec),
      sortOrder: nextSort++,
      status,
      decisionReason:
        status === StoredStatus.PENDING ? null : (decision?.reason ?? null),
      decidedById:
        status === StoredStatus.PENDING
          ? null
          : (decision?.decidedById ?? null),
      decidedAt:
        status === StoredStatus.PENDING || !decision?.decidedAt
          ? null
          : new Date(decision.decidedAt),
    });
    claimed.push({
      id: '',
      legacyRecommendationId: rec.id,
      carePathwayFormId: rec.carePathwayFormId ?? null,
      status,
      evidenceJson: null,
    });
  }
  return plan;
}
