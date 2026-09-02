/**
 * Abbey Pain Scale scoring — mirrors care-admin pain-assessment-scoring.ts (keep in sync).
 *
 * Six domains, each 0 | 1 | 2 | 3. Total 0–18.
 * Severity: 0–2 none, 3–7 mild, 8–13 moderate, 14+ severe.
 */

export type AbbeyScore = 0 | 1 | 2 | 3;

export type PainSeverityBand = 'none' | 'mild' | 'moderate' | 'severe';

export type PainType = 'chronic' | 'acute' | 'acute_on_chronic';

export type PainScaleUsed = 'nrs' | 'abbey' | 'both';

export type AbbeyPainScores = {
  vocalisation?: AbbeyScore;
  facialExpression?: AbbeyScore;
  bodyLanguage?: AbbeyScore;
  behaviouralChange?: AbbeyScore;
  physiologicalChange?: AbbeyScore;
  physicalChanges?: AbbeyScore;
};

export const ABBEY_DOMAIN_KEYS: (keyof AbbeyPainScores)[] = [
  'vocalisation',
  'facialExpression',
  'bodyLanguage',
  'behaviouralChange',
  'physiologicalChange',
  'physicalChanges',
];

export type AbbeyAssessmentMetadata = AbbeyPainScores & {
  total?: number;
  severityBand?: PainSeverityBand;
  painType?: PainType;
  dateCompleted?: string;
  assessorNameDesignation?: string;
};

export type PainAssessmentMetadataLike = {
  nrsScore?: number;
  scaleUsed?: PainScaleUsed;
  abbey?: AbbeyAssessmentMetadata;
};

export function isValidAbbeyScore(value: unknown): value is AbbeyScore {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** Single source of truth for Abbey total (0–18). Missing domains count as 0. */
export function computeAbbeyTotal(abbey: AbbeyPainScores | undefined): number {
  if (!abbey) return 0;
  return ABBEY_DOMAIN_KEYS.reduce((sum, key) => sum + (abbey[key] ?? 0), 0);
}

/** Single source of truth: 0–2 none, 3–7 mild, 8–13 moderate, 14+ severe. */
export function abbeySeverityFromTotal(total: number): PainSeverityBand {
  if (total <= 2) return 'none';
  if (total <= 7) return 'mild';
  if (total <= 13) return 'moderate';
  return 'severe';
}

/** Abbey is complete only when all six domains have a valid 0|1|2|3. All-zero is valid. */
export function isAbbeyAssessmentComplete(
  abbey: AbbeyPainScores | AbbeyAssessmentMetadata | undefined,
): boolean {
  if (!abbey) return false;
  return ABBEY_DOMAIN_KEYS.every((key) => isValidAbbeyScore(abbey[key]));
}

/** NRS is complete when a score is present in 0–10 inclusive. 0 is a valid score. */
export function isNrsAssessmentComplete(nrsScore: unknown): boolean {
  return (
    typeof nrsScore === 'number' && Number.isFinite(nrsScore) && nrsScore >= 0 && nrsScore <= 10
  );
}

/** Pain-tool complete if valid NRS OR complete Abbey. Both are not required. */
export function isPainToolComplete(pain: PainAssessmentMetadataLike | undefined): boolean {
  if (!pain) return false;
  return isNrsAssessmentComplete(pain.nrsScore) || isAbbeyAssessmentComplete(pain.abbey);
}

export function enrichAbbeyMetadata(
  abbey: AbbeyAssessmentMetadata | undefined,
): AbbeyAssessmentMetadata | undefined {
  if (!abbey) return undefined;
  const total = computeAbbeyTotal(abbey);
  return {
    ...abbey,
    total,
    severityBand: abbeySeverityFromTotal(total),
  };
}

function formatPainTypeLabel(painType: PainType | undefined): string | undefined {
  if (painType === 'acute_on_chronic') return 'acute on chronic';
  if (painType === 'chronic' || painType === 'acute') return painType;
  return undefined;
}

export function formatPainAssessmentHistorySummary(
  pain: PainAssessmentMetadataLike | undefined,
): string | null {
  if (!pain) return null;
  const parts: string[] = [];
  if (isNrsAssessmentComplete(pain.nrsScore)) {
    parts.push(`NRS ${pain.nrsScore}/10`);
  }
  if (isAbbeyAssessmentComplete(pain.abbey)) {
    const total = pain.abbey!.total ?? computeAbbeyTotal(pain.abbey);
    const band = abbeySeverityFromTotal(total);
    const typeLabel = formatPainTypeLabel(pain.abbey!.painType);
    parts.push(typeLabel ? `Abbey ${total}/18 (${band}), ${typeLabel}` : `Abbey ${total}/18 (${band})`);
  }
  const completed = pain.abbey?.dateCompleted?.trim();
  if (completed && parts.length > 0) {
    const day = completed.slice(0, 10);
    const d = new Date(`${day}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      parts.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));
    }
  }
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

export function formatAbbeyCarePlanSuggestion(
  pain: PainAssessmentMetadataLike | undefined,
): string | null {
  if (!isAbbeyAssessmentComplete(pain?.abbey)) return null;
  const abbey = pain!.abbey!;
  const total = abbey.total ?? computeAbbeyTotal(abbey);
  const band = abbeySeverityFromTotal(total);
  const typeLabel = formatPainTypeLabel(abbey.painType);
  const typePart = typeLabel ? `; ${typeLabel}` : '';
  return `Abbey ${total}/18 — ${band}${typePart} (IA Pain Assessment Tool)`;
}

export function isPainElevatedReview(pain: PainAssessmentMetadataLike | undefined): boolean {
  if (!pain) return false;
  if (isNrsAssessmentComplete(pain.nrsScore) && pain.nrsScore! >= 4) return true;
  if (!isAbbeyAssessmentComplete(pain.abbey)) return false;
  const total = pain.abbey!.total ?? computeAbbeyTotal(pain.abbey);
  return total >= 8;
}

function readPainFromUnknown(raw: unknown): PainAssessmentMetadataLike | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return raw as PainAssessmentMetadataLike;
}

export function painAssessmentFromMetadata(metadata: unknown): PainAssessmentMetadataLike | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  return readPainFromUnknown((metadata as Record<string, unknown>).painAssessment);
}

export function painAssessmentFromSnapshot(snapshot: unknown): PainAssessmentMetadataLike | undefined {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return undefined;
  return readPainFromUnknown((snapshot as Record<string, unknown>).painAssessment);
}
