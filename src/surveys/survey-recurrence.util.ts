import { SurveyRecurrence } from '@prisma/client';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  combineOperationalDateAndHm,
  dayKeyInTimeZone,
  formatHmInTimeZone,
} from '../common/utils/operational-day.util';

/**
 * Recurring surveys run on the organisation's operational calendar (Europe/London by default):
 * the local send time stays the same across BST/GMT changes, and monthly / quarterly / yearly
 * runs keep the first run's day of month, clamped to the month end (31 Jan → 28/29 Feb → 31 Mar).
 */

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

type LocalDate = { y: number; m: number; d: number };

const pad2 = (n: number) => String(n).padStart(2, '0');

function localDate(at: Date, timeZone: string): LocalDate {
  const [y, m, d] = dayKeyInTimeZone(at, timeZone).split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonthsClamped(date: LocalDate, months: number): LocalDate {
  const index = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { y, m, d: Math.min(date.d, daysInMonth(y, m)) };
}

function addDays(date: LocalDate, days: number): LocalDate {
  const dt = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function toInstant(date: LocalDate, hm: string, timeZone: string): Date {
  return combineOperationalDateAndHm(`${date.y}-${pad2(date.m)}-${pad2(date.d)}`, hm, timeZone);
}

const MONTHS_PER_STEP: Record<SurveyRecurrence, number> = {
  [SurveyRecurrence.WEEKLY]: 0,
  [SurveyRecurrence.MONTHLY]: 1,
  [SurveyRecurrence.QUARTERLY]: 3,
  [SurveyRecurrence.YEARLY]: 12,
};

/** Longest possible step (plus a DST hour), used to start the search for the next run. */
const MAX_STEP_MS: Record<SurveyRecurrence, number> = {
  [SurveyRecurrence.WEEKLY]: (7 * 24 + 1) * 3_600_000,
  [SurveyRecurrence.MONTHLY]: (31 * 24 + 1) * 3_600_000,
  [SurveyRecurrence.QUARTERLY]: (92 * 24 + 1) * 3_600_000,
  [SurveyRecurrence.YEARLY]: (366 * 24 + 1) * 3_600_000,
};

/** The `step`-th run counted from `anchor` (step 0 is the anchor), at the anchor's local time. */
export function surveyRunAt(
  anchor: Date,
  recurrence: SurveyRecurrence,
  step: number,
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): Date {
  const start = localDate(anchor, timeZone);
  const hm = formatHmInTimeZone(anchor, timeZone);
  const date =
    recurrence === SurveyRecurrence.WEEKLY
      ? addDays(start, 7 * step)
      : addMonthsClamped(start, MONTHS_PER_STEP[recurrence] * step);
  return toInstant(date, hm, timeZone);
}

/**
 * Next run strictly after both `after` (the run just done) and `now`, always counted from the
 * anchor so month-end clamping never drifts the day of month.
 */
export function nextSurveyDistributeAt(
  anchor: Date,
  recurrence: SurveyRecurrence,
  after: Date,
  now: Date = new Date(),
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): Date {
  const floor = Math.max(after.getTime(), now.getTime());
  let step = Math.max(1, Math.floor((floor - anchor.getTime()) / MAX_STEP_MS[recurrence]));
  for (let guard = 0; guard < 10_000; guard += 1, step += 1) {
    const at = surveyRunAt(anchor, recurrence, step, timeZone);
    if (at.getTime() > floor) return at;
  }
  throw new Error('Could not work out the next survey run');
}

/** Same local time `days` calendar days later (DST-safe). */
export function addOperationalDays(
  at: Date,
  days: number,
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): Date {
  return toInstant(addDays(localDate(at, timeZone), days), formatHmInTimeZone(at, timeZone), timeZone);
}

/** Stable key for the period a run covers — one period copy per key per recurring survey. */
export function surveyPeriodKey(
  at: Date,
  recurrence: SurveyRecurrence,
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  const { y, m, d } = localDate(at, timeZone);
  switch (recurrence) {
    case SurveyRecurrence.WEEKLY:
      return `${y}-${pad2(m)}-${pad2(d)}`;
    case SurveyRecurrence.MONTHLY:
      return `${y}-${pad2(m)}`;
    case SurveyRecurrence.QUARTERLY:
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case SurveyRecurrence.YEARLY:
      return String(y);
    default:
      return `${y}-${pad2(m)}`;
  }
}

/** UK date label for a period copy's title: "5 Nov 2026", "Nov 2026", "Q4 2026", "2026". */
export function surveyPeriodLabel(
  at: Date,
  recurrence: SurveyRecurrence,
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  const { y, m, d } = localDate(at, timeZone);
  switch (recurrence) {
    case SurveyRecurrence.WEEKLY:
      return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
    case SurveyRecurrence.MONTHLY:
      return `${MONTH_NAMES[m - 1]} ${y}`;
    case SurveyRecurrence.QUARTERLY:
      return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
    case SurveyRecurrence.YEARLY:
      return String(y);
    default:
      return `${MONTH_NAMES[m - 1]} ${y}`;
  }
}

/** UK date + 24h time in the operational timezone, e.g. "5 Nov 2026, 09:00". */
export function formatSurveyDateTime(at: Date, timeZone = DEFAULT_OPERATIONAL_TIMEZONE): string {
  const { y, m, d } = localDate(at, timeZone);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}, ${formatHmInTimeZone(at, timeZone)}`;
}

export function recurrenceLabel(recurrence: SurveyRecurrence): string {
  switch (recurrence) {
    case SurveyRecurrence.WEEKLY:
      return 'Weekly';
    case SurveyRecurrence.MONTHLY:
      return 'Monthly';
    case SurveyRecurrence.QUARTERLY:
      return 'Quarterly';
    case SurveyRecurrence.YEARLY:
      return 'Yearly';
    default:
      return 'Recurring';
  }
}
