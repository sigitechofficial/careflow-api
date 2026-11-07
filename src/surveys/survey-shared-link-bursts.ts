import { formatUkDateLabel } from '../common/utils/uk-date-label.util';

/**
 * Answers through shared links, counted by day (SurveySharedLinkDay: the day and a number, nothing
 * else). Results warn when one day had far more than usual: a link may have been passed around, or
 * someone may be answering many times (ballot-stuffing). The counts never say who answered.
 */
export const BURST_MIN_ANSWERS = 10;
/** A day with at least this many times the average of the other days. */
export const BURST_FACTOR = 3;
/** A survey with answers on one day only: warn from this many (a team meeting can easily give 10). */
export const SINGLE_DAY_BURST = 30;

export type SharedLinkBurst = { day: string; answers: number };

/** The days that look unusual, oldest first. `days`: day (YYYY-MM-DD) → answers (periods added together). */
export function sharedLinkBursts(days: ReadonlyMap<string, number>): SharedLinkBurst[] {
  const entries = [...days.entries()].filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 1) {
    const [day, answers] = entries[0];
    return answers >= SINGLE_DAY_BURST ? [{ day, answers }] : [];
  }
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  return entries
    .filter(([, n]) => {
      if (n < BURST_MIN_ANSWERS) return false;
      const othersAverage = (total - n) / (entries.length - 1);
      return n >= BURST_FACTOR * othersAverage;
    })
    .map(([day, answers]) => ({ day, answers }));
}

export function sharedLinkBurstNote(bursts: readonly SharedLinkBurst[]): string | null {
  if (!bursts.length) return null;
  const days = bursts.map((b) => `${b.answers} on ${formatUkDateLabel(new Date(`${b.day}T00:00:00Z`))}`).join(', ');
  return `Unusually many answers came through the shared link on some days (${days}). If you did not expect this (for example a team meeting or a newsletter going out), some answers may have been sent more than once or by people the survey is not for.`;
}
