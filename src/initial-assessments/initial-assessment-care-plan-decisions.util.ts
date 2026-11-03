import type { CarePlanRecommendation } from './initial-assessment-care-plan.util';

export type CarePlanRecommendationStatus = 'pending' | 'accepted' | 'declined' | 'deferred';

export type StoredCarePlanDecision = {
  decision: 'accepted' | 'declined' | 'deferred';
  reason: string | null;
  decidedAt: string;
  decidedById: string;
  /** Resolved care pathway form — stored on accept so active care plans do not re-guess by name. */
  carePathwayFormId?: string;
  carePathwayFormName?: string;
  title?: string;
  carePlanArea?: string;
  /** Care plan instance created or linked on accept; carried over if the decision later changes. */
  carePlanInstanceId?: string;
  /** Set when an accepted, linked recommendation is later declined or deferred. */
  linkedCarePlanReviewRequired?: boolean;
};

export type CarePlanRecommendationWithDecision = CarePlanRecommendation & {
  status: CarePlanRecommendationStatus;
  declineReason?: string | null;
  /** Reason recorded with the decision (decline, defer, or optional accept note). */
  decisionReason?: string | null;
  decidedAt?: string | null;
  carePlanInstanceId?: string | null;
  linkedCarePlanReviewRequired?: boolean;
};

export function readCarePlanDecisions(metadata: unknown): Record<string, StoredCarePlanDecision> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const raw = (metadata as { carePlanDecisions?: unknown }).carePlanDecisions;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, StoredCarePlanDecision> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    if (row.decision !== 'accepted' && row.decision !== 'declined' && row.decision !== 'deferred') continue;
    if (typeof row.decidedAt !== 'string' || typeof row.decidedById !== 'string') continue;
    out[id] = {
      decision: row.decision,
      reason: typeof row.reason === 'string' ? row.reason : null,
      decidedAt: row.decidedAt,
      decidedById: row.decidedById,
      carePathwayFormId:
        typeof row.carePathwayFormId === 'string' ? row.carePathwayFormId : undefined,
      carePathwayFormName:
        typeof row.carePathwayFormName === 'string' ? row.carePathwayFormName : undefined,
      title: typeof row.title === 'string' ? row.title : undefined,
      carePlanArea: typeof row.carePlanArea === 'string' ? row.carePlanArea : undefined,
      carePlanInstanceId:
        typeof row.carePlanInstanceId === 'string' ? row.carePlanInstanceId : undefined,
      linkedCarePlanReviewRequired: row.linkedCarePlanReviewRequired === true ? true : undefined,
    };
  }
  return out;
}

/**
 * The decision that applies to a recommendation: one stored under its own id, else the most recent
 * one stored under an id it absorbed (`aliasIds`) — so merging never reopens a declined
 * recommendation or forgets an accepted one.
 */
export function effectiveCarePlanDecision(
  rec: Pick<CarePlanRecommendation, 'id' | 'aliasIds'>,
  decisions: Record<string, StoredCarePlanDecision>,
): StoredCarePlanDecision | undefined {
  const own = decisions[rec.id];
  if (own) return own;
  return (rec.aliasIds ?? [])
    .map((id) => decisions[id])
    .filter((d): d is StoredCarePlanDecision => Boolean(d))
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
}

/** Find a recommendation by its id or by any id merged into it. */
export function findCarePlanRecommendation<T extends Pick<CarePlanRecommendation, 'id' | 'aliasIds'>>(
  recommendations: T[],
  recommendationId: string,
): T | undefined {
  return (
    recommendations.find((r) => r.id === recommendationId) ??
    recommendations.find((r) => r.aliasIds?.includes(recommendationId))
  );
}

export function applyCarePlanDecisions(
  recommendations: CarePlanRecommendation[],
  decisions: Record<string, StoredCarePlanDecision>,
): CarePlanRecommendationWithDecision[] {
  return recommendations.map((rec) => {
    const stored = effectiveCarePlanDecision(rec, decisions);
    if (!stored) return { ...rec, status: 'pending' as const };
    return {
      ...rec,
      status: stored.decision,
      declineReason: stored.decision === 'declined' ? stored.reason : null,
      decisionReason: stored.reason,
      decidedAt: stored.decidedAt,
      ...(stored.carePlanInstanceId ? { carePlanInstanceId: stored.carePlanInstanceId } : {}),
      ...(stored.linkedCarePlanReviewRequired ? { linkedCarePlanReviewRequired: true } : {}),
    };
  });
}

const DECISION_LABEL: Record<StoredCarePlanDecision['decision'], string> = {
  accepted: 'accepted',
  declined: 'declined',
  deferred: 'deferred',
};

/**
 * Checks a manager decision against the one already recorded. Decline and defer need a reason. A
 * deferred (or pending) recommendation can be decided freely; changing an accepted or declined
 * decision is a correction and needs a reason. Repeating the same accepted/declined decision is
 * refused so a recorded decision is never silently rewritten.
 * Returns an error message, or null when the change is allowed.
 */
export function carePlanDecisionChangeError(input: {
  prior: StoredCarePlanDecision | undefined;
  next: StoredCarePlanDecision['decision'];
  reason: string | undefined;
}): string | null {
  const reason = input.reason?.trim() ?? '';
  if (input.next === 'declined' && reason.length < 3) {
    return 'A decline reason is required (min 3 characters)';
  }
  if (input.next === 'deferred' && reason.length < 3) {
    return 'A reason for deferring is required (min 3 characters)';
  }
  const prior = input.prior?.decision;
  if (prior === 'accepted' || prior === 'declined') {
    if (prior === input.next) {
      return `This recommendation is already ${DECISION_LABEL[prior]}`;
    }
    if (reason.length < 3) {
      return `A reason is required to change a ${DECISION_LABEL[prior]} recommendation (min 3 characters)`;
    }
  }
  return null;
}
