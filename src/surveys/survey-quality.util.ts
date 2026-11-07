/**
 * Response quality checks (Phase 2 part 5). Responses are flagged for a person to look at, never removed or left out
 * of the figures automatically. FAST is decided when the answer is given (the answer page says how long it took; only
 * the flag is kept, never the time); STRAIGHT_LINE and DUPLICATE are worked out from the answers when shown.
 */
export const QUALITY_FLAGS = ['FAST', 'STRAIGHT_LINE', 'DUPLICATE'] as const;
export type QualityFlag = (typeof QUALITY_FLAGS)[number];

export const QUALITY_FLAG_LABELS: Record<QualityFlag, string> = {
  FAST: 'Answered very quickly',
  STRAIGHT_LINE: 'Same answer to every scale question',
  DUPLICATE: 'Same answers as another response',
};

/** Under this many seconds in all … */
export const FAST_MAX_SECONDS = 60;
/** … and under this many seconds for each question answered. */
export const FAST_SECONDS_PER_ANSWER = 2;
/** Straight-lining needs at least this many scale questions answered. */
export const STRAIGHT_LINE_MIN = 6;
/** A duplicate needs at least this many answers in common, one of them written. */
export const DUPLICATE_MIN_ANSWERS = 5;

/** FAST from how long the answer page was open; null / nonsense times flag nothing. The time itself is never kept. */
export function fastFlag(secondsTaken: unknown, answered: number): boolean {
  if (typeof secondsTaken !== 'number' || !Number.isFinite(secondsTaken) || secondsTaken < 0) return false;
  if (answered < 3) return false;
  return secondsTaken < FAST_MAX_SECONDS && secondsTaken < answered * FAST_SECONDS_PER_ANSWER;
}

export type QualityAnswer = {
  questionId: string;
  booleanValue?: boolean | null;
  textValue?: string | null;
  numberValue?: number | null;
  selectedOptions?: unknown;
  otherText?: string | null;
  comment?: string | null;
};

/**
 * Straight-lining: the same position on the scale for every scale question answered (at least STRAIGHT_LINE_MIN of
 * them). `scalePosition` gives an answer's position (null when not a scale answer, or "Don't know").
 */
export function straightLined(answers: ReadonlyArray<QualityAnswer>, scalePosition: (a: QualityAnswer) => number | null): boolean {
  const positions = answers.map(scalePosition).filter((p): p is number => p !== null);
  if (positions.length < STRAIGHT_LINE_MIN) return false;
  return positions.every((p) => p === positions[0]);
}

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : v);

/** A response's answers as one comparable signature, or null when too short to call a duplicate. */
export function duplicateSignature(answers: ReadonlyArray<QualityAnswer>): string | null {
  const parts = answers
    .map((a) => ({
      q: a.questionId,
      b: a.booleanValue ?? null,
      t: norm(a.textValue ?? null),
      n: a.numberValue ?? null,
      s: Array.isArray(a.selectedOptions) ? [...(a.selectedOptions as unknown[])].map(norm).sort() : null,
      o: norm(a.otherText ?? null),
      c: norm(a.comment ?? null),
    }))
    .filter((p) => p.b !== null || p.t || p.n !== null || (p.s && p.s.length) || p.o || p.c)
    .sort((x, y) => x.q.localeCompare(y.q));
  if (parts.length < DUPLICATE_MIN_ANSWERS) return null;
  const written = parts.some((p) => (typeof p.t === 'string' && p.t.length >= 10) || (typeof p.o === 'string' && p.o.length >= 10) || (typeof p.c === 'string' && p.c.length >= 10));
  if (!written) return null;
  return JSON.stringify(parts);
}

/** Response ids (of `responses`) that share their signature with another response. */
export function duplicateIds(responses: ReadonlyArray<{ id: string; answers: ReadonlyArray<QualityAnswer> }>): Set<string> {
  const bySig = new Map<string, string[]>();
  for (const r of responses) {
    const sig = duplicateSignature(r.answers);
    if (!sig) continue;
    bySig.set(sig, [...(bySig.get(sig) ?? []), r.id]);
  }
  return new Set([...bySig.values()].filter((ids) => ids.length > 1).flat());
}

/** Stored flags read safely (only known ones). */
export function readQualityFlags(v: unknown): QualityFlag[] {
  return Array.isArray(v) ? v.filter((f): f is QualityFlag => (QUALITY_FLAGS as readonly string[]).includes(f as string)) : [];
}
