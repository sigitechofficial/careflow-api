/**
 * Answer retention in a ready-made survey's privacy notice (Phase 2 part 7). Read when the library is loaded and stored
 * with the library details (libraryMeta.retention), so the survey job never has to guess from the wording. Used by
 * src/surveys/survey-platform.util.ts.
 */
/**
 * Where a retention period starts. FROM_CLOSE: when the survey (or period / copy) closes. FROM_ANSWER: when each answer
 * was given ("after this call", "after you answer"), so answers go one by one while the survey stays open.
 */
export type RetentionBasis = 'FROM_CLOSE' | 'FROM_ANSWER';
export type RetentionRule = { months: number; basis: RetentionBasis };

/**
 * Notice wording that counts from the answer, not the close: "after this call" / "after the call", "after your review",
 * "after this conversation", "after you answer", "after we receive them" and "after this check" (a quality check
 * call). "after this check-in closes", "after the survey closes" and "after this survey" count from the close.
 */
const FROM_ANSWER_WORDING = /^\s*,?\s*after (?:(?:this|the) call|your review|this conversation|you answer|we receive (?:them|it|your answers)|this check(?![- ]in))\b/i;

/** The retention rule a privacy notice states ("We keep your answers for 1 year after the survey closes"), or null. */
export function parseRetentionNotice(notice: unknown): RetentionRule | null {
  if (typeof notice !== 'string') return null;
  const m = /keep (?:your|the|these|individual|all)?\s*(?:individual\s+)?answers for (\d+|one|two|three|six) (year|month)s?/i.exec(notice);
  if (!m) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, six: 6 };
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : words[m[1].toLowerCase()];
  const months = m[2].toLowerCase() === 'year' ? n * 12 : n;
  if (!Number.isInteger(months) || months < 1) return null;
  const rest = notice.slice(m.index + m[0].length).replace(/^\s*in CareFlow/i, '');
  return { months, basis: FROM_ANSWER_WORDING.test(rest) ? 'FROM_ANSWER' : 'FROM_CLOSE' };
}

