/**
 * Insight across surveys (Phase 2 part 5): which periods or copies ("units") may be shown, the figure for a question
 * in one unit, pooled totals, and the small-group suppression of the branch heatmap. Pure helpers; the figures
 * themselves always come from the Results engine (SurveysService), so every reporting rule there still applies.
 */
import { MIN_ANONYMOUS_GROUP_SIZE } from './survey-breakdown.util';

/** Why a unit is not shown. */
export type UnitHiddenReason = 'TOO_FEW' | 'NOT_CLOSED';

export type UnitFacts = {
  /** Answers counted in the figures (written out, not held back). */
  responsesInFigures: number;
  /** The unit's reporting threshold (0 = none). */
  threshold: number;
  /** Closed (or its end date passed). */
  closed: boolean;
  /** Anonymous, or answers can be given without a name: no live point that ticks up as answers arrive. */
  unlinkedPossible: boolean;
};

/**
 * Whether one unit's figures may be shown beside others. At least one answer and the threshold; on surveys where an
 * answer can be linked to no one, only once the unit has closed. A hidden unit is also left out of every total
 * (secondary suppression: the total minus the shown units would give it).
 */
export function unitHiddenReason(u: UnitFacts): UnitHiddenReason | null {
  if (u.responsesInFigures <= 0 || u.responsesInFigures < Math.max(1, u.threshold)) return 'TOO_FEW';
  if (u.unlinkedPossible && !u.closed) return 'NOT_CLOSED';
  return null;
}

export const UNIT_HIDDEN_NOTES: Record<UnitHiddenReason, string> = {
  TOO_FEW: 'Too few answers to show',
  NOT_CLOSED: 'Shown once it closes',
};

/** One question's figure in one unit. */
export type QuestionPoint =
  | { kind: 'TOP_TWO'; percent: number | null; positive: number; base: number }
  | { kind: 'YES'; percent: number | null; positive: number; base: number }
  | { kind: 'AVERAGE'; average: number | null; count: number };

/** The parts of a Results question summary a point is made from. */
export type SummaryLike = {
  questionType: string;
  answerCount: number;
  topTwo?: { positive: number; base: number; percent: number | null } | null;
  options?: Array<{ label: string; count: number; notCounted?: boolean }>;
  countedAnswers?: number;
  numeric?: { average: number | null } | null;
  lookupDetails?: unknown;
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

/** The figure for a question summary: top-two share for scales, share "Yes", or the average. Null for other kinds. */
export function pointOf(s: SummaryLike): QuestionPoint | null {
  if (s.topTwo && s.topTwo.base > 0) {
    return { kind: 'TOP_TWO', percent: s.topTwo.percent, positive: s.topTwo.positive, base: s.topTwo.base };
  }
  if (s.questionType === 'YES_NO' && s.options) {
    const yes = s.options.find((o) => o.label === 'Yes')?.count ?? 0;
    const no = s.options.find((o) => o.label === 'No')?.count ?? 0;
    const base = yes + no;
    return base > 0 ? { kind: 'YES', percent: pct(yes, base), positive: yes, base } : null;
  }
  if ((s.questionType === 'RATING' || s.questionType === 'NUMBER') && s.numeric && s.numeric.average !== null) {
    return { kind: 'AVERAGE', average: s.numeric.average, count: s.answerCount };
  }
  return null;
}

/** Points of the same kind pooled into one (shown units only). */
export function poolPoints(points: ReadonlyArray<QuestionPoint | null | undefined>): QuestionPoint | null {
  const present = points.filter((p): p is QuestionPoint => Boolean(p));
  if (!present.length) return null;
  const kind = present[0].kind;
  const same = present.filter((p) => p.kind === kind);
  if (kind === 'AVERAGE') {
    let sum = 0;
    let count = 0;
    for (const p of same as Array<Extract<QuestionPoint, { kind: 'AVERAGE' }>>) {
      if (p.average === null) continue;
      sum += p.average * p.count;
      count += p.count;
    }
    return { kind, average: count ? Math.round((sum / count) * 100) / 100 : null, count };
  }
  let positive = 0;
  let base = 0;
  for (const p of same as Array<Extract<QuestionPoint, { kind: 'TOP_TWO' | 'YES' }>>) {
    positive += p.positive;
    base += p.base;
  }
  return { kind, percent: pct(positive, base), positive, base };
}

/** A question's line across units: the same wording and type (a reworded question starts a new line). */
export function questionLineKey(q: { questionType: string; questionText: string }): string {
  return `${q.questionType}|${q.questionText.trim().replace(/\s+/g, ' ')}`;
}

/** Calendar year of a unit (the period key's year, else the opening date, else when it was made). */
export function unitYear(u: { opensAt?: Date | string | null; periodKey?: string | null; createdAt?: Date | string | null }): number | null {
  const from = (v: Date | string | null | undefined) => (v ? new Date(v).getUTCFullYear() : null);
  const key = u.periodKey?.match(/^(\d{4})/);
  // The period it covers wins (a February period can be made, and open, in the January before).
  // A draft with neither (never opened, no period) belongs to no year: it is left out of years and the 360 report.
  return (key ? Number(key[1]) : null) ?? from(u.opensAt);
}

// ─── Branch heatmap: small-group suppression ─────────────────────────────

/** Smallest group shown in the heatmap: the reporting threshold, never under 5. */
export function heatmapMinimum(threshold: number): number {
  return Math.max(MIN_ANONYMOUS_GROUP_SIZE, threshold);
}

export const OTHER_BRANCHES_KEY = 'other';

export type ColumnCount = { key: string; label: string; responses: number };
export type ColumnPlan = {
  /** Branches shown on their own. */
  shown: ColumnCount[];
  /** Branches combined into "Other branches" (null when there is none to show). */
  other: { keys: string[]; responses: number } | null;
  /** Branches not shown at all (only when the combined group would still be too small and nothing can join it). */
  hidden: string[];
};

/**
 * Which branches get a column. A branch under the minimum joins "Other branches"; when those combined are still under
 * the minimum, the smallest shown branch joins them too (complementary suppression), so the combined column is never
 * small and no single small branch can be worked out from the overall figure. With nothing to join, they are hidden.
 */
export function planColumns(columns: ReadonlyArray<ColumnCount>, min: number): ColumnPlan {
  const present = [...columns].filter((c) => c.responses > 0).sort((a, b) => b.responses - a.responses || a.label.localeCompare(b.label));
  const large = present.filter((c) => c.responses >= min);
  const small = present.filter((c) => c.responses < min);
  const smallTotal = small.reduce((n, c) => n + c.responses, 0);
  if (!small.length) return { shown: large, other: null, hidden: [] };
  if (smallTotal >= min) return { shown: large, other: { keys: small.map((c) => c.key), responses: smallTotal }, hidden: [] };
  if (large.length >= 2) {
    // The smallest large branch joins the small ones: the combined column then has at least `min`.
    const joiner = large[large.length - 1];
    return {
      shown: large.slice(0, -1),
      other: { keys: [...small.map((c) => c.key), joiner.key], responses: smallTotal + joiner.responses },
      hidden: [],
    };
  }
  // One large branch (or none): combining would make "Other" the overall minus one shown branch; hide the small ones,
  // and with one large branch hide it too (it would equal the overall figure minus the hidden small ones).
  return { shown: [], other: null, hidden: present.map((c) => c.key) };
}

/**
 * One question row: cells (answer counts per column) under the minimum are hidden; when the hidden cells hold some
 * answers but fewer than the minimum, the smallest shown cell is hidden too, so the overall figure minus the shown
 * cells never gives a small group. Returns the keys of the cells to hide.
 */
export function cellsToHide(cells: ReadonlyArray<{ key: string; base: number }>, min: number): Set<string> {
  const hide = new Set(cells.filter((c) => c.base < min).map((c) => c.key));
  const hiddenAnswers = cells.filter((c) => hide.has(c.key)).reduce((n, c) => n + c.base, 0);
  if (hiddenAnswers > 0 && hiddenAnswers < min) {
    const next = cells.filter((c) => !hide.has(c.key)).sort((a, b) => a.base - b.base)[0];
    if (next) hide.add(next.key);
    else for (const c of cells) hide.add(c.key);
  }
  return hide;
}
