import { dayKeyInTimeZone } from '../common/utils/operational-day.util';

export type LeaveSpan = { from: Date; to: Date };

export type LeaveDayCounts = {
  /** Days in the year already past (before today). */
  taken: number;
  /** Days in the year from today onwards. */
  upcoming: number;
};

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekendYmd(ymd: string): boolean {
  const dow = new Date(`${ymd}T00:00:00.000Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Counts leave days inside [yearStart, yearEnd] (inclusive YYYY-MM-DD),
 * split into taken (before today) and upcoming (today onwards).
 * Overlapping spans count each calendar day once.
 */
export function countLeaveDays(input: {
  spans: LeaveSpan[];
  todayYmd: string;
  yearStartYmd: string;
  yearEndYmd: string;
  timeZone: string;
  includeWeekends: boolean;
}): LeaveDayCounts {
  const days = new Set<string>();
  for (const span of input.spans) {
    const from = dayKeyInTimeZone(span.from, input.timeZone);
    const to = dayKeyInTimeZone(span.to, input.timeZone);
    if (to < from) continue;
    let cursor = from < input.yearStartYmd ? input.yearStartYmd : from;
    const last = to > input.yearEndYmd ? input.yearEndYmd : to;
    while (cursor <= last) {
      if (input.includeWeekends || !isWeekendYmd(cursor)) days.add(cursor);
      cursor = addDaysYmd(cursor, 1);
    }
  }
  let taken = 0;
  let upcoming = 0;
  for (const day of days) {
    if (day < input.todayYmd) taken++;
    else upcoming++;
  }
  return { taken, upcoming };
}

/** Masks all but the last 3 characters (e.g. NI number) for on-screen display. */
export function maskTail(value: string | null | undefined, visible = 3): string | null {
  const v = value?.replace(/\s+/g, '').trim();
  if (!v) return null;
  if (v.length <= visible) return v;
  return `${'•'.repeat(v.length - visible)}${v.slice(-visible)}`;
}
