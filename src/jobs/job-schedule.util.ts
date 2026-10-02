/**
 * Next-occurrence maths for the catalogue's fixed schedules (no cron library needed).
 * Supported 5-field UTC crons: minute `*` | `*\/N` | `M`, hour `*` | `H`, day/month/weekday `*`.
 */
type FieldMatcher = (value: number) => boolean;

function parseField(field: string, max: number): FieldMatcher | null {
  if (field === '*') return () => true;
  const step = /^\*\/(\d+)$/.exec(field);
  if (step) {
    const n = Number(step[1]);
    return n >= 1 && n <= max ? (v) => v % n === 0 : null;
  }
  if (/^\d+$/.test(field)) {
    const fixed = Number(field);
    return fixed <= max ? (v) => v === fixed : null;
  }
  return null;
}

/** First UTC minute strictly after `after` matching `cron`, or null if the pattern is unsupported. */
export function nextUtcCronOccurrence(cron: string, after: Date): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5 || parts.slice(2).some((p) => p !== '*')) return null;
  const minute = parseField(parts[0], 59);
  const hour = parseField(parts[1], 23);
  if (!minute || !hour) return null;
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < 2 * 1440; i += 1) {
    const t = new Date(start + i * 60_000);
    if (minute(t.getUTCMinutes()) && hour(t.getUTCHours())) return t;
  }
  return null;
}

function hourInZone(date: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .find((p) => p.type === 'hour');
  return Number(part?.value ?? 0) % 24;
}

/** Next top of an hour after `after` whose local hour in `timeZone` is `hour` (DST-safe). */
export function nextDailyHourInTimeZone(
  hour: number,
  timeZone: string,
  after: Date,
): Date | null {
  const start = Math.floor(after.getTime() / 3_600_000) * 3_600_000 + 3_600_000;
  for (let i = 0; i < 49; i += 1) {
    const t = new Date(start + i * 3_600_000);
    if (hourInZone(t, timeZone) === hour) return t;
  }
  return null;
}
