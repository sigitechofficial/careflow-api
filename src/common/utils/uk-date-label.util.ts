/** UK care-app date labels. Calendar parts are UTC (same as employee-app schedule). */
import { combineOperationalDateAndHm, formatHmInTimeZone } from './operational-day.util';

export const UK_MONTHS = [
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

export const UK_WEEKDAYS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

/** `2 Sep 2026` */
export function formatUkDateLabel(date: Date): string {
  return `${date.getUTCDate()} ${UK_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** `Wed 2 Sep 2026` or `Wed 2 Sep` when `year` is false. */
export function formatUkWeekdayDate(date: Date, opts?: { year?: boolean }): string {
  const weekday = UK_WEEKDAYS[date.getUTCDay()];
  const body = `${date.getUTCDate()} ${UK_MONTHS[date.getUTCMonth()]}`;
  if (opts?.year === false) return `${weekday} ${body}`;
  return `${weekday} ${body} ${date.getUTCFullYear()}`;
}

/** `Sep 2026` */
export function formatUkMonthLabel(date: Date): string {
  return `${UK_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatUkMonthShort(date: Date): string {
  return UK_MONTHS[date.getUTCMonth()];
}

export function formatUkWeekdayShort(date: Date): string {
  return UK_WEEKDAYS[date.getUTCDay()];
}

/** `2 Sep 2026` from `YYYY-MM-DD`. */
export function formatUkDateLabelFromYmd(ymd: string): string | null {
  const date = parseUtcYmd(ymd);
  return date ? formatUkDateLabel(date) : null;
}

/** `Sep 2026` from `YYYY-MM`. */
export function formatUkMonthLabelFromKey(key: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${UK_MONTHS[month - 1]} ${match[1]}`;
}

/** `2 Sep 2026 – 15 Sep 2026` */
export function formatUkDateRangeLabel(from: Date | string, to: Date | string): string {
  const start = typeof from === 'string' ? parseUtcYmd(from) : from;
  const end = typeof to === 'string' ? parseUtcYmd(to) : to;
  if (!start || !end) return `${from} – ${to}`;
  return `${formatUkDateLabel(start)} – ${formatUkDateLabel(end)}`;
}

/** `2 Sep 2026, 14:30` */
export function formatUkDateTimeLabel(date: Date, hm: string): string {
  return `${formatUkDateLabel(date)}, ${hm}`;
}

function parseUtcYmd(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Parse `"23 Sep 2026"` back into a UTC Date (midnight). Returns null on bad input. */
export function parseUkDateLabel(label: string): Date | null {
  const match = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(label.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const monthIdx = UK_MONTHS.indexOf(match[2] as (typeof UK_MONTHS)[number]);
  const year = Number(match[3]);
  if (monthIdx < 0 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, monthIdx, day));
}

/** `23 Sep 2026`, `23/09/2026`, `23-09-2026` or `2026-09-23` → `2026-09-23` (null when invalid). */
function parseFlexibleUkDay(label: string): string | null {
  const v = label.trim();
  let y: number, m: number, d: number;
  const named = parseUkDateLabel(v);
  if (named) return named.toISOString().slice(0, 10);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else if (ymd) [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** `14:30`, `9:05`, `2:30 pm` → `HH:mm` (null when invalid). */
function parseFlexibleHm(label: string): string | null {
  const t = /^(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s*m\.?)?$/i.exec(label.trim());
  if (!t) return null;
  let h = Number(t[1]);
  const min = Number(t[2]);
  const meridiem = t[3]?.toLowerCase();
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    if (meridiem === 'p' && h !== 12) h += 12;
    if (meridiem === 'a' && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Carer-entered incident date + time → UTC instant, reading the wall clock in `timeZone`
 * (organisation time — not UTC). Unparseable date → `fallback`; missing/unparseable time →
 * the fallback's time of day on that date; a future result → `fallback` (never reject the report).
 */
export function parseCarerDateTimeInZone(
  dateLabel: string | null | undefined,
  timeLabel: string | null | undefined,
  timeZone: string,
  fallback: Date,
): Date {
  const day = dateLabel ? parseFlexibleUkDay(dateLabel) : null;
  if (!day) return fallback;
  const hm = (timeLabel && parseFlexibleHm(timeLabel)) || formatHmInTimeZone(fallback, timeZone);
  const at = combineOperationalDateAndHm(day, hm, timeZone);
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 60_000) return fallback;
  return at;
}
