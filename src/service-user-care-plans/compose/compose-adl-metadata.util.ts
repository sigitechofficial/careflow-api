/**
 * ADL worksheet metadata on IA submissions (stored under submission.metadata.adl).
 * Shape aligned with care-admin adl-scoring.ts / initial-assessment-adl.util.ts.
 */

export type AdlWorksheetRowMetadata = {
  id: string;
  activity: string;
  score: number;
  notes?: string;
};

export type AdlComposeMetadata = {
  rows: AdlWorksheetRowMetadata[];
  additionalComments?: string | null;
  fallsAssessmentCompleted?: boolean | null;
  fallsAssessmentDate?: string | null;
  fallsScreeningRequested?: boolean | null;
  mobilityAidsRequired?: boolean | null;
  mobilityAidsList?: string | null;
};

function isAdlScoreValid(score: unknown): score is number {
  return typeof score === 'number' && !Number.isNaN(score) && score >= 0 && score <= 4;
}

function normalizeAdlRow(row: unknown): AdlWorksheetRowMetadata | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) return null;
  const activity = typeof record.activity === 'string' ? record.activity : id;
  const score = isAdlScoreValid(record.score) ? record.score : 0;
  const notes = typeof record.notes === 'string' ? record.notes : undefined;
  return { id, activity, score, ...(notes !== undefined ? { notes } : {}) };
}

/** Parse submission.metadata.adl for care-plan compose (IA snapshot attachment). */
export function readAdlMetadataFromSubmissionMetadata(
  metadata: unknown,
): AdlComposeMetadata | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const adl = (metadata as Record<string, unknown>).adl;
  if (!adl || typeof adl !== 'object' || Array.isArray(adl)) return null;
  const row = adl as Record<string, unknown>;
  const rawRows = row.rows;
  if (!Array.isArray(rawRows)) return null;

  const rows = rawRows
    .map(normalizeAdlRow)
    .filter((r): r is AdlWorksheetRowMetadata => r != null);
  if (rows.length === 0) return null;

  return {
    rows,
    additionalComments:
      typeof row.additionalComments === 'string' ? row.additionalComments : null,
    fallsAssessmentCompleted:
      typeof row.fallsAssessmentCompleted === 'boolean' ? row.fallsAssessmentCompleted : null,
    fallsAssessmentDate:
      typeof row.fallsAssessmentDate === 'string' ? row.fallsAssessmentDate : null,
    fallsScreeningRequested:
      typeof row.fallsScreeningRequested === 'boolean' ? row.fallsScreeningRequested : null,
    mobilityAidsRequired:
      typeof row.mobilityAidsRequired === 'boolean' ? row.mobilityAidsRequired : null,
    mobilityAidsList: typeof row.mobilityAidsList === 'string' ? row.mobilityAidsList : null,
  };
}
