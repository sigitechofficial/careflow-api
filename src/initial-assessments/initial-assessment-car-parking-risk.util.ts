import { InitialAssessmentRiskLevel, Prisma } from '@prisma/client';

const LIKELIHOOD_MATRIX_SCORE: Record<string, number> = {
  rare: 1,
  unlikely: 2,
  possible: 3,
  likely: 3,
  almost_certain: 3,
};

const SEVERITY_MATRIX_SCORE: Record<string, number> = {
  negligible: 1,
  minor: 2,
  moderate: 2,
  major: 3,
  catastrophic: 3,
};

function fieldKeyOf(metadata: Prisma.JsonValue): string | undefined {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const key = (metadata as Record<string, unknown>).fieldKey;
    return typeof key === 'string' ? key : undefined;
  }
  return undefined;
}

export function singleSelectOptionValue(selectedOptions: Prisma.JsonValue): string | undefined {
  if (Array.isArray(selectedOptions) && selectedOptions.length > 0) {
    return String(selectedOptions[0]);
  }
  if (typeof selectedOptions === 'string' && selectedOptions.trim()) {
    return selectedOptions.trim();
  }
  return undefined;
}

export function carParkingMatrixToRiskLevel(value: string): InitialAssessmentRiskLevel {
  const score =
    LIKELIHOOD_MATRIX_SCORE[value] ??
    SEVERITY_MATRIX_SCORE[value] ??
    null;
  if (score == null || score <= 1) return InitialAssessmentRiskLevel.LOW;
  if (score === 2) return InitialAssessmentRiskLevel.MEDIUM;
  return InitialAssessmentRiskLevel.HIGH;
}

export function carParkingRiskScore(likelihoodValue: string, severityValue: string): number | null {
  const l = LIKELIHOOD_MATRIX_SCORE[likelihoodValue];
  const s = SEVERITY_MATRIX_SCORE[severityValue];
  if (l == null || s == null) return null;
  return l * s;
}

export function findCarParkingMatrixQuestions<T extends { id: string; metadata: Prisma.JsonValue }>(
  questions: T[],
): { likelihood?: T; severity?: T } {
  let likelihood: T | undefined;
  let severity: T | undefined;
  for (const q of questions) {
    const key = fieldKeyOf(q.metadata);
    if (key === 'carParkingHarmLikelihood') likelihood = q;
    if (key === 'carParkingHarmSeverity') severity = q;
  }
  return { likelihood, severity };
}
