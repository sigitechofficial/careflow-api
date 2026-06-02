import type { CarePlanRecommendation } from './initial-assessment-care-plan.util';

export type CarePlanRecommendationStatus = 'pending' | 'accepted' | 'declined';

export type StoredCarePlanDecision = {
  decision: 'accepted' | 'declined';
  reason: string | null;
  decidedAt: string;
  decidedById: string;
};

export type CarePlanRecommendationWithDecision = CarePlanRecommendation & {
  status: CarePlanRecommendationStatus;
  declineReason?: string | null;
  decidedAt?: string | null;
};

export function readCarePlanDecisions(metadata: unknown): Record<string, StoredCarePlanDecision> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const raw = (metadata as { carePlanDecisions?: unknown }).carePlanDecisions;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, StoredCarePlanDecision> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    if (row.decision !== 'accepted' && row.decision !== 'declined') continue;
    if (typeof row.decidedAt !== 'string' || typeof row.decidedById !== 'string') continue;
    out[id] = {
      decision: row.decision,
      reason: typeof row.reason === 'string' ? row.reason : null,
      decidedAt: row.decidedAt,
      decidedById: row.decidedById,
    };
  }
  return out;
}

export function applyCarePlanDecisions(
  recommendations: CarePlanRecommendation[],
  decisions: Record<string, StoredCarePlanDecision>,
): CarePlanRecommendationWithDecision[] {
  return recommendations.map((rec) => {
    const stored = decisions[rec.id];
    if (!stored) return { ...rec, status: 'pending' as const };
    return {
      ...rec,
      status: stored.decision,
      declineReason: stored.reason,
      decidedAt: stored.decidedAt,
    };
  });
}
