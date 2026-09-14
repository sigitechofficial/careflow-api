/**
 * Care-delivery operational calendar — SEED-LOCAL MIRROR.
 *
 * This is a verbatim copy of `src/common/utils/operational-day.util.ts`. The seed runner runs
 * as raw TypeScript via `ts-node prisma/seed.ts`, but the production deploy artifact ships only
 * `dist/` (compiled app) — NOT `src/`. A previous `../../../src/common/utils/operational-day.util`
 * import here crashed `prisma db seed` at module-load time on the server ("Cannot find module
 * '.../src/common/utils/operational-day.util'"), which silently skipped ALL seeding (including
 * care-plan form templates). Keeping a self-contained copy under `prisma/` removes that
 * cross-boundary dependency so the seed no longer needs `src/` to be shipped.
 *
 * KEEP IN SYNC with `src/common/utils/operational-day.util.ts` (pure, dependency-free date logic
 * that rarely changes). If you edit one, mirror the change in the other.
 */

export const DEFAULT_OPERATIONAL_TIMEZONE = 'Asia/Karachi';

/** Resolve org ops TZ from settings (falls back to Asia/Karachi). */
export function getOperationalTimeZone(_orgTimezone?: string | null): string {
  const trimmed = _orgTimezone?.trim();
  return trimmed || DEFAULT_OPERATIONAL_TIMEZONE;
}

/** Operational calendar day as YYYY-MM-DD in the given IANA timezone. */
export function operationalTodayIso(
  now = new Date(),
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Calendar day of an instant in the operational timezone (YYYY-MM-DD). */
export function dayKeyInTimeZone(
  instant: Date,
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  return operationalTodayIso(instant, timeZone);
}

/** Clock-face HH:mm for an instant in the operational timezone. */
export function formatHmInTimeZone(
  instant: Date,
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

/** Clock-face HH:mm:ss for an instant in the operational timezone. */
export function formatHmsInTimeZone(
  instant: Date,
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const second = parts.find((p) => p.type === 'second')?.value ?? '00';
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;
}

/**
 * UTC clock-face HH:mm — only for legacy fake-UTC wall-clock storage.
 * Prefer formatHmInTimeZone with organisation timezone for true-UTC instants.
 */
export function formatHmUtc(instant: Date): string {
  return formatHmInTimeZone(instant, 'UTC');
}

/** Hour (0–23) of an instant in the operational timezone. */
export function hourInTimeZone(
  instant: Date,
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): number {
  const hm = formatHmInTimeZone(instant, timeZone);
  return Number(hm.slice(0, 2)) || 0;
}

/** Add calendar days to a YYYY-MM-DD label (UTC date arithmetic on the label). */
export function addDaysToOperationalIso(iso: string, delta: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/**
 * Inclusive UTC instant bounds for an operational calendar day.
 * Used when filtering DateTime columns by "visits on this ops day".
 */
export function operationalDayBounds(
  dateIso: string,
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): { start: Date; end: Date; date: string } {
  const day = dateIso.slice(0, 10);
  const start = startOfOperationalDayUtc(day, timeZone);
  const next = addOneCalendarDay(day);
  const endExclusive = startOfOperationalDayUtc(next, timeZone);
  const end = new Date(endExclusive.getTime() - 1);
  return { start, end, date: day };
}

/**
 * Convert an operational calendar day + local HH:mm wall clock in `timeZone`
 * into the true UTC instant (e.g. London BST 07:00 → 06:00Z).
 */
export function combineOperationalDateAndHm(
  dayIso: string,
  hm: string,
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): Date {
  const day = dayIso.slice(0, 10);
  const match = /^(\d{2}):(\d{2})$/.exec(hm.trim());
  if (!match) {
    return new Date(Number.NaN);
  }
  const targetMinutes = Number(match[1]) * 60 + Number(match[2]);
  const dayStart = startOfOperationalDayUtc(day, timeZone);
  let guess = dayStart.getTime() + targetMinutes * 60_000;

  for (let i = 0; i < 8; i++) {
    const instant = new Date(guess);
    const shownDay = dayKeyInTimeZone(instant, timeZone);
    const shownHm = formatHmInTimeZone(instant, timeZone);
    const [sh, sm] = shownHm.split(':').map(Number);
    const shownMinutes = (sh ?? 0) * 60 + (sm ?? 0);
    let deltaMin = targetMinutes - shownMinutes;
    if (shownDay < day) deltaMin += 24 * 60;
    else if (shownDay > day) deltaMin -= 24 * 60;
    if (deltaMin === 0) return instant;
    guess += deltaMin * 60_000;
  }

  return new Date(guess);
}

function addOneCalendarDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * UTC instant of local midnight on `day` in `timeZone`.
 * Finds the UTC ms where the TZ calendar first shows `day`.
 */
export function startOfOperationalDayUtc(day: string, timeZone: string): Date {
  let guess = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(guess)) {
    return new Date(`${day}T00:00:00.000Z`);
  }
  for (let i = 0; i < 48; i++) {
    const key = dayKeyInTimeZone(new Date(guess), timeZone);
    if (key === day) {
      let t = guess;
      while (dayKeyInTimeZone(new Date(t - 60_000), timeZone) === day) {
        t -= 60_000;
      }
      while (dayKeyInTimeZone(new Date(t - 1000), timeZone) === day) {
        t -= 1000;
      }
      return new Date(t);
    }
    if (key < day) {
      guess += 60 * 60_000;
    } else {
      guess -= 60 * 60_000;
    }
  }
  return new Date(`${day}T00:00:00.000Z`);
}
