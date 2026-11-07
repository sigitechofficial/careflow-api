/**
 * Anonymised sector benchmarks (Phase 3): the pure parts.
 *
 * An agency that opts in shares, for each ready-made survey question it asked unchanged, only the share of
 * positive answers over the last 12 months (closed surveys, whole per cent) and a size band, and only where at
 * least BENCHMARK_MIN_ANSWERS people answered. No answers, comments, names, branches or dates leave CareFlow.
 * The benchmark service shows a question's sector figures only once BENCHMARK_MIN_ORGANISATIONS agencies share
 * it, as the median and the middle half (quartiles), never a single agency's figure.
 */

/** Version of the data-sharing agreement an agency accepts (raise it when the wording changes). */
export const BENCHMARK_AGREEMENT_VERSION = 'CF-SBDSA-1';
/** Answers to one question an agency needs before it shares that question's figure. */
export const BENCHMARK_MIN_ANSWERS = 10;
/** Agencies that must share a question before anyone sees sector figures for it. */
export const BENCHMARK_MIN_ORGANISATIONS = 5;
/** The window shared: surveys closed within this many days. */
export const BENCHMARK_WINDOW_DAYS = 365;
/** A contribution not renewed within this many days is left out of sector figures. */
export const BENCHMARK_STALE_DAYS = 45;
export const BENCHMARK_BANDS = ['10-29', '30-99', '100+'] as const;
export type BenchmarkBand = (typeof BENCHMARK_BANDS)[number];
export const BENCHMARK_REFERENCE = /^SUR-[A-Z]{2,4}-\d{3}$/;
export const BENCHMARK_KEY = /^[A-Za-z0-9_.-]{1,80}$/;

export const BENCHMARK_AGREEMENT = [
  'We agree to share anonymised survey figures with the CareFlow sector benchmark, so we and other agencies can compare results with similar services.',
  'What is shared: for each ready-made survey question we asked without changing it, the share of positive answers over the last 12 months, from surveys that have closed, as a whole per cent, and a band for how many answered (10 to 29, 30 to 99, or 100 or more). A question is shared only when at least 10 people answered it.',
  'What is never shared: anyone’s answers or comments, names or contact details, branches, dates, or our own surveys and questions.',
  'Our name is never shown to other agencies. CareFlow knows which figures are ours only to run the benchmark, and does not use them for anything else.',
  'Sector figures for a question are shown only when at least 5 agencies share it, as the middle value and the middle half of agencies, never one agency’s figure. We see sector figures only while we share our own.',
  'We can stop sharing at any time: our figures are then removed from the benchmark at once.',
  'The figures are counts, not personal information, but our Data Protection Officer should read this before we agree.',
];

export type BenchmarkTally = { positive: number; base: number };
export type BenchmarkRow = { reference: string; questionKey: string; percent: number; band: BenchmarkBand };

export function benchmarkBand(base: number): BenchmarkBand {
  return base >= 100 ? '100+' : base >= 30 ? '30-99' : '10-29';
}

/** Our figures to share: one row per ready-made question with enough answers. Key: `${reference}|${questionKey}`. */
export function benchmarkRows(tallies: ReadonlyMap<string, BenchmarkTally>): BenchmarkRow[] {
  const rows: BenchmarkRow[] = [];
  for (const [k, t] of tallies) {
    if (t.base < BENCHMARK_MIN_ANSWERS) continue;
    const at = k.indexOf('|');
    rows.push({ reference: k.slice(0, at), questionKey: k.slice(at + 1), percent: Math.round((100 * t.positive) / t.base), band: benchmarkBand(t.base) });
  }
  return rows.sort((a, b) => a.reference.localeCompare(b.reference) || a.questionKey.localeCompare(b.questionKey));
}

/** Value at quantile q (0..1) of sorted numbers, interpolated, rounded to a whole per cent. */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo));
}

export type SectorFigure = { reference: string; questionKey: string; organisations: number; median: number; lowerQuartile: number; upperQuartile: number };

/** Sector figures from every agency's current contribution: only questions shared by enough agencies. */
export function sectorFigures(
  contributions: ReadonlyArray<{ contributorHash: string; reference: string; questionKey: string; percent: number }>,
  minOrganisations = BENCHMARK_MIN_ORGANISATIONS,
): SectorFigure[] {
  const byQuestion = new Map<string, Map<string, number>>();
  for (const c of contributions) {
    const k = `${c.reference}|${c.questionKey}`;
    const m = byQuestion.get(k) ?? new Map<string, number>();
    m.set(c.contributorHash, c.percent); // one figure per agency
    byQuestion.set(k, m);
  }
  const out: SectorFigure[] = [];
  for (const [k, m] of byQuestion) {
    if (m.size < minOrganisations) continue;
    const values = [...m.values()].sort((a, b) => a - b);
    const at = k.indexOf('|');
    out.push({
      reference: k.slice(0, at),
      questionKey: k.slice(at + 1),
      organisations: m.size,
      median: quantile(values, 0.5),
      lowerQuartile: quantile(values, 0.25),
      upperQuartile: quantile(values, 0.75),
    });
  }
  return out.sort((a, b) => a.reference.localeCompare(b.reference) || a.questionKey.localeCompare(b.questionKey));
}

/** Whether a question is asked exactly as in the ready-made survey (same type, wording and answers). */
export function sameAsLibrary(
  q: { questionType: string; questionText: string; options: unknown },
  lib: { questionType: string; questionText: string; options: unknown } | undefined,
): boolean {
  if (!lib) return false;
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
  return q.questionType === lib.questionType && norm(q.questionText) === norm(lib.questionText) && JSON.stringify(q.options ?? null) === JSON.stringify(lib.options ?? null);
}
