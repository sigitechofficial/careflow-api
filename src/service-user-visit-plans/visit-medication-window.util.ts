/**
 * Match a medication dueTime (HH:mm) to a visit window.
 * Inclusive bounds. Overnight windows (end <= start) span midnight.
 */

const HM_RE = /^(\d{1,2}):(\d{2})$/;

export function parseHmToMinutes(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const m = HM_RE.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatMinutesToHm(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * True when dueTime falls inside [windowStart, windowEnd] inclusive.
 * If windowEnd <= windowStart (and both set), treat as overnight (e.g. 22:00–06:00).
 */
export function dueTimeFallsInHmWindow(
  dueTime: string | null | undefined,
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
): boolean {
  const due = parseHmToMinutes(dueTime);
  const start = parseHmToMinutes(windowStart);
  const end = parseHmToMinutes(windowEnd);
  if (due == null || start == null || end == null) return false;

  if (end < start) {
    // Overnight: e.g. 22:00–06:00 → due in [22:00, 24:00) or [00:00, 06:00]
    return due >= start || due <= end;
  }
  return due >= start && due <= end;
}

/** Instant compare: dueTime on visitDay in TZ must lie in [windowStart, windowEnd]. */
export function dueTimeFallsInVisitInstantWindow(input: {
  dueTime: string | null | undefined;
  visitDayIso: string;
  windowStart: Date;
  windowEnd: Date;
  combineDateAndHm: (dayIso: string, hm: string, timeZone: string) => Date;
  timeZone: string;
}): boolean {
  const hm = input.dueTime?.trim();
  if (!hm || !HM_RE.test(hm)) return false;
  const dueInstant = input.combineDateAndHm(input.visitDayIso, hm, input.timeZone);
  if (!Number.isFinite(dueInstant.getTime())) return false;
  const t = dueInstant.getTime();
  let start = input.windowStart.getTime();
  let end = input.windowEnd.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  // Overnight job: end before/equal start → push end +1 day
  if (end <= start) end += 86400000;
  return t >= start && t <= end;
}

export function pickScheduleInVisitWindow<
  T extends { dueTime: string | null; round?: { code: string } | null },
>(
  schedules: T[],
  windowStartHm: string | null | undefined,
  windowEndHm: string | null | undefined,
): T | null {
  if (!schedules.length) return null;
  return (
    schedules.find((s) => dueTimeFallsInHmWindow(s.dueTime, windowStartHm, windowEndHm)) ?? null
  );
}
