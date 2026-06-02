/**
 * Waterlow scoring — mirrors care-admin waterlow-scoring.ts (keep in sync).
 */

export type WaterlowMetadataLike = {
  gender?: number;
  age?: number;
  build?: number;
  appetite?: number;
  mobility?: number;
  continence?: number;
  neurological?: number;
  surgery?: number;
  medication?: number;
  weightLoss?: number;
  skinTypes?: string[];
  tissueMalnutrition?: string[];
  score?: number;
  carePlanRequired?: boolean;
  managerReviewSuggested?: boolean;
  nextReviewDate?: string | null;
  comments?: string;
  recommendation?: string;
  recommendationBy?: string;
  recommendationTo?: string;
  recommendationDate?: string | null;
  actionTaken?: string;
  factors?: Record<string, number>;
};

type WaterlowOption = { id: string; score: number };

const SKIN: WaterlowOption[] = [
  { id: 'healthy', score: 0 },
  { id: 'thin', score: 1 },
  { id: 'dry', score: 1 },
  { id: 'oedematous', score: 1 },
  { id: 'clammy', score: 1 },
  { id: 'previous_ulcer', score: 2 },
  { id: 'discoloured', score: 2 },
  { id: 'broken', score: 3 },
];

const TISSUE: WaterlowOption[] = [
  { id: 'smoking', score: 1 },
  { id: 'anaemia', score: 2 },
  { id: 'pvd', score: 5 },
  { id: 'single_organ', score: 5 },
  { id: 'multi_organ', score: 8 },
  { id: 'cachexia', score: 8 },
];

function sumMulti(ids: string[] | undefined, options: WaterlowOption[]): number {
  if (!ids?.length) return 0;
  const byId = new Map(options.map((o) => [o.id, o.score]));
  return ids.reduce((sum, id) => sum + (byId.get(id) ?? 0), 0);
}

function legacyScore(factors: Record<string, number> | undefined): number {
  if (!factors) return 0;
  return Object.values(factors).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
}

function hasNewFormat(meta: WaterlowMetadataLike): boolean {
  return (
    meta.gender != null ||
    meta.age != null ||
    meta.build != null ||
    meta.mobility != null ||
    (meta.skinTypes != null && meta.skinTypes.length > 0) ||
    (meta.tissueMalnutrition != null && meta.tissueMalnutrition.length > 0)
  );
}

export function computeWaterlowScore(meta: WaterlowMetadataLike | null | undefined): number {
  if (!meta) return 0;
  if (!hasNewFormat(meta) && meta.factors) {
    return legacyScore(meta.factors);
  }
  let total = 0;
  total += meta.gender ?? 0;
  total += meta.age ?? 0;
  total += meta.build ?? 0;
  total += meta.appetite ?? 0;
  total += meta.mobility ?? 0;
  total += meta.continence ?? 0;
  total += meta.neurological ?? 0;
  total += meta.surgery ?? 0;
  total += meta.medication ?? 0;
  total += meta.weightLoss ?? 0;
  total += sumMulti(meta.skinTypes, SKIN);
  total += sumMulti(meta.tissueMalnutrition, TISSUE);
  return total;
}

export function waterlowScoreFromMetadata(metadata: unknown): number {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 0;
  const wl = (metadata as Record<string, unknown>).waterlow;
  if (!wl || typeof wl !== 'object' || Array.isArray(wl)) return 0;
  const row = wl as WaterlowMetadataLike;
  if (typeof row.score === 'number' && !Number.isNaN(row.score)) {
    return row.score;
  }
  return computeWaterlowScore(row);
}

export function waterlowCarePlanRequired(score: number): boolean {
  return score >= 10;
}

export function enrichWaterlowMetadata(
  meta: WaterlowMetadataLike,
  managerReviewThreshold = 15,
): WaterlowMetadataLike {
  const score = computeWaterlowScore(meta);
  return {
    ...meta,
    score,
    carePlanRequired: waterlowCarePlanRequired(score),
    managerReviewSuggested: score >= managerReviewThreshold,
  };
}
