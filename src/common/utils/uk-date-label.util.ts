/** UK care-app date labels. Calendar parts are UTC (same as employee-app schedule). */

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

/** Combine a UK date label (`"23 Sep 2026"`) and time (`"14:30"`) into a UTC Date.
 *  Falls back to `fallback` when either part is missing or unparseable. */
export function parseUkDateTimeLabel(
  dateLabel: string | null | undefined,
  timeLabel: string | null | undefined,
  fallback: Date,
): Date {
  if (!dateLabel) return fallback;
  const d = parseUkDateLabel(dateLabel);
  if (!d) return fallback;
  if (timeLabel) {
    const tm = /^(\d{1,2}):(\d{2})$/.exec(timeLabel.trim());
    if (tm) {
      d.setUTCHours(Number(tm[1]), Number(tm[2]), 0, 0);
    }
  }
  return d;
}
