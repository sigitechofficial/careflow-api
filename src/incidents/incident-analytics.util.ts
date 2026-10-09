import {
  dayKeyInTimeZone,
  hourInTimeZone,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { weekdayIndexInTimeZone } from '../scheduling/schedule-date-range.util';

/**
 * Where an incident falls on the organisation's calendar. occurredAt is stored in UTC, so the UTC
 * hour / weekday / month would put e.g. 00:30 BST on 1 Oct into September.
 */
export function analyticsCalendarParts(
  instant: Date,
  timeZone: string,
): { hour: number; weekday: number; monthKey: string } {
  return {
    hour: hourInTimeZone(instant, timeZone),
    weekday: weekdayIndexInTimeZone(instant, timeZone),
    monthKey: dayKeyInTimeZone(instant, timeZone).slice(0, 7),
  };
}

/** The last `n` calendar months (YYYY-MM, oldest first), ending with the current org month. */
export function lastMonthKeys(n: number, now: Date, timeZone: string): string[] {
  const [y, m] = operationalTodayIso(now, timeZone).split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
