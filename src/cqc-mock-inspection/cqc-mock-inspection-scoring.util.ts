/**
 * Mock CQC inspection scoring: quality statement scores → key question ratings → overall rating.
 *
 * The rules are data, kept per framework version (seed file `scoring`, stored in
 * CqcFrameworkVersion.scoringRules), so a new CQC framework brings its own rules:
 *  - each statement is scored on `scale` (1–4 in the single assessment framework);
 *  - a key question's score is the sum of its statement scores as a percentage of the most it could
 *    be; the first band (highest first) whose `abovePercent` the score is above gives the rating;
 *  - limiters cap a rating when any statement has a low score (CQC's rating principles);
 *  - the overall rating is the first `overallRules` entry that matches, else `overallDefault`.
 * Pure functions: no database, so the service, the screens and the tests share one calculation.
 */

export const CQC_RATINGS = [
  'OUTSTANDING',
  'GOOD',
  'REQUIRES_IMPROVEMENT',
  'INADEQUATE',
] as const;
export type CqcRating = (typeof CQC_RATINGS)[number];

export type CqcScoringRules = {
  scale: { score: number; label: string }[];
  keyQuestionBands: { rating: CqcRating; abovePercent: number }[];
  limiters: {
    whenRatingIn: CqcRating[];
    anyStatementScoreIn: number[];
    limitTo: CqcRating;
  }[];
  overallRules: {
    atLeast: number;
    keyQuestionRatingIn: CqcRating[];
    rating: CqcRating;
  }[];
  overallDefault: CqcRating;
};

export type StatementScore = {
  statementId: string;
  keyQuestionCode: string;
  score: number | null;
};

export type KeyQuestionResult = {
  keyQuestionCode: string;
  statementCount: number;
  scoredCount: number;
  /** Sum of the scores given so far, and the most those statements could score. */
  total: number;
  max: number;
  /** total / max as a percentage to one decimal place; null until a statement is scored. */
  percent: number | null;
  /** The band the percentage falls in, before limiters. */
  bandRating: CqcRating | null;
  rating: CqcRating | null;
  /** The limiter that lowered the rating, if any. */
  limitedFrom: CqcRating | null;
  complete: boolean;
};

export type InspectionResult = {
  keyQuestions: KeyQuestionResult[];
  /** Null until every statement is scored, and always null for a focused inspection. */
  overall: CqcRating | null;
  /**
   * False for a focused inspection (one that leaves out a key question of the framework): like CQC,
   * it rates the key questions it covers but gives no overall rating.
   */
  overallApplies: boolean;
  complete: boolean;
  unscoredStatementIds: string[];
};

const isRating = (v: unknown): v is CqcRating =>
  (CQC_RATINGS as readonly unknown[]).includes(v);
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Problems in a `scoring` block; empty when it can be used. */
export function scoringRulesProblems(value: unknown): string[] {
  if (!isObject(value)) return ['scoring must be an object'];
  const errors: string[] = [];
  const r = value as Partial<CqcScoringRules>;

  const scale = Array.isArray(r.scale) ? r.scale : [];
  if (scale.length < 2) errors.push('scale needs at least two scores');
  scale.forEach((s, i) => {
    if (
      !isObject(s) ||
      s.score !== i + 1 ||
      typeof s.label !== 'string' ||
      !s.label.trim()
    ) {
      errors.push(`scale[${i}] must be { score: ${i + 1}, label }`);
    }
  });
  const scores = new Set(scale.map((s) => s?.score));

  const bands = Array.isArray(r.keyQuestionBands) ? r.keyQuestionBands : [];
  if (!bands.length) errors.push('keyQuestionBands is required');
  bands.forEach((b, i) => {
    if (
      !isObject(b) ||
      !isRating(b.rating) ||
      typeof b.abovePercent !== 'number' ||
      b.abovePercent < 0 ||
      b.abovePercent >= 100
    ) {
      errors.push(
        `keyQuestionBands[${i}] must be { rating, abovePercent (0 to under 100) }`,
      );
    } else if (i > 0 && !(b.abovePercent < bands[i - 1].abovePercent)) {
      errors.push(
        'keyQuestionBands must run from the highest abovePercent to the lowest',
      );
    }
  });
  if (bands.length && bands[bands.length - 1]?.abovePercent !== 0)
    errors.push('the last key question band must be abovePercent 0');
  if (new Set(bands.map((b) => b?.rating)).size !== bands.length)
    errors.push('each rating may have one key question band');

  (Array.isArray(r.limiters) ? r.limiters : []).forEach((l, i) => {
    if (
      !isObject(l) ||
      !Array.isArray(l.whenRatingIn) ||
      !l.whenRatingIn.length ||
      !l.whenRatingIn.every(isRating) ||
      !Array.isArray(l.anyStatementScoreIn) ||
      !l.anyStatementScoreIn.length ||
      !l.anyStatementScoreIn.every((s) => scores.has(s)) ||
      !isRating(l.limitTo)
    ) {
      errors.push(
        `limiters[${i}] must be { whenRatingIn: ratings, anyStatementScoreIn: scale scores, limitTo: rating }`,
      );
    }
  });
  if (r.limiters !== undefined && !Array.isArray(r.limiters))
    errors.push('limiters must be a list');

  if (!Array.isArray(r.overallRules))
    errors.push('overallRules must be a list (may be empty)');
  (Array.isArray(r.overallRules) ? r.overallRules : []).forEach((o, i) => {
    if (
      !isObject(o) ||
      !Number.isInteger(o.atLeast) ||
      o.atLeast < 1 ||
      !Array.isArray(o.keyQuestionRatingIn) ||
      !o.keyQuestionRatingIn.length ||
      !o.keyQuestionRatingIn.every(isRating) ||
      !isRating(o.rating)
    ) {
      errors.push(
        `overallRules[${i}] must be { atLeast: 1 or more, keyQuestionRatingIn: ratings, rating }`,
      );
    }
  });
  if (!isRating(r.overallDefault))
    errors.push('overallDefault must be a rating');
  return errors;
}

/** The rules from CqcFrameworkVersion.scoringRules, or null when the version has none. Throws if invalid. */
export function parseScoringRules(value: unknown): CqcScoringRules | null {
  if (value === null || value === undefined) return null;
  const problems = scoringRulesProblems(value);
  if (problems.length)
    throw new Error(`CQC scoring rules are not valid: ${problems.join('; ')}`);
  const r = value as CqcScoringRules;
  return {
    scale: r.scale.map((s) => ({ score: s.score, label: s.label })),
    keyQuestionBands: r.keyQuestionBands.map((b) => ({
      rating: b.rating,
      abovePercent: b.abovePercent,
    })),
    limiters: (r.limiters ?? []).map((l) => ({
      whenRatingIn: [...l.whenRatingIn],
      anyStatementScoreIn: [...l.anyStatementScoreIn],
      limitTo: l.limitTo,
    })),
    overallRules: r.overallRules.map((o) => ({
      atLeast: o.atLeast,
      keyQuestionRatingIn: [...o.keyQuestionRatingIn],
      rating: o.rating,
    })),
    overallDefault: r.overallDefault,
  };
}

/** True when `score` is a whole number on the rules' scale. */
export type CheckAnswerValue = 'MET' | 'PARTIALLY_MET' | 'NOT_MET';

/**
 * A statement's 1–4 score from the answers to its checks: Met counts 1, Partially met ½, Not met 0,
 * and the share of the most it could get gives the score: all (100%) → 4, 75% or more → 3,
 * 50% or more → 2, less → 1. No score (null) until every check is answered.
 * `checks` are the statement's checks; `answers` the saved answers (by part and text).
 */
export function scoreFromChecks(
  checks: { part: string; text: string }[],
  answers: { part: string; text: string; answer: CheckAnswerValue }[],
): {
  score: number | null;
  answered: number;
  total: number;
  percent: number | null;
} {
  const byKey = new Map(
    answers.map((a) => [`${a.part}\u0000${a.text}`, a.answer]),
  );
  let answered = 0;
  let halves = 0; // In half points, so the sums stay whole numbers.
  for (const c of checks) {
    const a = byKey.get(`${c.part}\u0000${c.text}`);
    if (!a) continue;
    answered += 1;
    halves += a === 'MET' ? 2 : a === 'PARTIALLY_MET' ? 1 : 0;
  }
  const total = checks.length;
  const most = total * 2;
  if (!total || answered < total) {
    return { score: null, answered, total, percent: null };
  }
  const percent = Math.round((halves / most) * 1000) / 10;
  const score =
    halves === most
      ? 4
      : halves * 4 >= most * 3
        ? 3
        : halves * 2 >= most
          ? 2
          : 1;
  return { score, answered, total, percent };
}

export function isValidScore(
  rules: CqcScoringRules,
  score: unknown,
): score is number {
  return Number.isInteger(score) && rules.scale.some((s) => s.score === score);
}

/** One key question's rating from its statements' scores (null = not scored yet). */
export function keyQuestionResult(
  keyQuestionCode: string,
  scores: (number | null)[],
  rules: CqcScoringRules,
): KeyQuestionResult {
  const top = rules.scale[rules.scale.length - 1].score;
  const given = scores.filter((s): s is number => s !== null);
  for (const s of given) {
    if (!isValidScore(rules, s))
      throw new Error(
        `${keyQuestionCode}: ${String(s)} is not a score on the scale`,
      );
  }
  const total = given.reduce((a, b) => a + b, 0);
  const max = given.length * top;
  const exact = max ? (total / max) * 100 : null;
  const bandRating =
    exact === null
      ? null
      : (rules.keyQuestionBands.find((b) => exact > b.abovePercent)?.rating ??
        null);

  let rating = bandRating;
  let limitedFrom: CqcRating | null = null;
  if (bandRating) {
    const limiter = rules.limiters.find(
      (l) =>
        l.whenRatingIn.includes(bandRating) &&
        given.some((s) => l.anyStatementScoreIn.includes(s)),
    );
    if (limiter) {
      rating = limiter.limitTo;
      limitedFrom = bandRating;
    }
  }
  return {
    keyQuestionCode,
    statementCount: scores.length,
    scoredCount: given.length,
    total,
    max,
    percent: exact === null ? null : Math.round(exact * 10) / 10,
    bandRating,
    rating,
    limitedFrom,
    complete: scores.length > 0 && given.length === scores.length,
  };
}

/** The overall rating from the key question ratings. */
export function overallRating(
  keyQuestionRatings: CqcRating[],
  rules: CqcScoringRules,
): CqcRating {
  const rule = rules.overallRules.find(
    (o) =>
      keyQuestionRatings.filter((r) => o.keyQuestionRatingIn.includes(r))
        .length >= o.atLeast,
  );
  return rule?.rating ?? rules.overallDefault;
}

/**
 * Key question results (in `keyQuestionCodes` order) and, once every statement is scored, the
 * overall rating.
 */
export function inspectionResult(
  statements: StatementScore[],
  keyQuestionCodes: string[],
  rules: CqcScoringRules,
  /** Every key question of the framework; an overall rating needs all of them. Defaults to keyQuestionCodes. */
  frameworkKeyQuestionCodes: string[] = keyQuestionCodes,
): InspectionResult {
  const keyQuestions = keyQuestionCodes.map((code) =>
    keyQuestionResult(
      code,
      statements.filter((s) => s.keyQuestionCode === code).map((s) => s.score),
      rules,
    ),
  );
  const unscoredStatementIds = statements
    .filter((s) => s.score === null)
    .map((s) => s.statementId);
  const complete =
    statements.length > 0 &&
    !unscoredStatementIds.length &&
    keyQuestions.every((k) => k.complete);
  const covered = new Set(statements.map((s) => s.keyQuestionCode));
  const overallApplies = frameworkKeyQuestionCodes.every((code) =>
    covered.has(code),
  );
  return {
    keyQuestions,
    overallApplies,
    overall:
      complete && overallApplies
        ? overallRating(
            keyQuestions.map((k) => k.rating as CqcRating),
            rules,
          )
        : null,
    complete,
    unscoredStatementIds,
  };
}
