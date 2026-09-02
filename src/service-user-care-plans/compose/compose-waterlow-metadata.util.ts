/**
 * IA Waterlow worksheet metadata on IA submissions (stored under submission.metadata.waterlow).
 * Loaded additively onto the compose IA snapshot; only the Pressure Ulcer compose reads it.
 * Other Care Plan engines ignore the field.
 */

export type CarePlanWaterlowComposeMetadata = {
  /** Stored Waterlow total, or a sum of enteredScores when `score` is absent. Null if unknown. */
  score: number | null;
};

function sumEnteredScores(enteredScores: unknown): number | null {
  if (!enteredScores || typeof enteredScores !== 'object' || Array.isArray(enteredScores)) {
    return null;
  }
  let total = 0;
  let any = false;
  for (const value of Object.values(enteredScores as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
      any = true;
    }
  }
  return any ? total : null;
}

/** Parse submission.metadata.waterlow for care-plan compose (IA snapshot attachment). */
export function readWaterlowFromSubmissionMetadata(
  metadata: unknown,
): CarePlanWaterlowComposeMetadata | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const waterlow = (metadata as Record<string, unknown>).waterlow;
  if (!waterlow || typeof waterlow !== 'object' || Array.isArray(waterlow)) return null;
  const row = waterlow as Record<string, unknown>;

  if (typeof row.score === 'number' && Number.isFinite(row.score)) {
    return { score: row.score };
  }

  return { score: sumEnteredScores(row.enteredScores) };
}

/**
 * Map an actual Waterlow score onto the Pressure Ulcer SELECT options
 * (Low / At risk / High / Very high). Score 0 is treated as incomplete (no band).
 */
export function mapWaterlowScoreToCarePlanBand(
  score: number,
): 'Low' | 'At risk' | 'High' | 'Very high' | null {
  if (!Number.isFinite(score) || score < 1) return null;
  if (score >= 20) return 'Very high';
  if (score >= 15) return 'High';
  if (score >= 10) return 'At risk';
  return 'Low';
}
