import { parseHm } from '../employee-working-patterns/working-pattern-time.util';

const HM = /^\d{2}:\d{2}$/;

/**
 * Clock distance between two "HH:mm" times, wrapping midnight (23:50 vs 00:10 = 20).
 * Null when either value is not "HH:mm".
 */
export function hmDifferenceMinutes(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b || !HM.test(a.trim()) || !HM.test(b.trim())) return null;
  const diff = Math.abs(parseHm(a) - parseHm(b));
  return Math.min(diff, 24 * 60 - diff);
}

/** Visits further apart than this are not treated as consecutive (e.g. last night's / tomorrow's). */
export const ADJACENT_VISIT_MAX_GAP_MS = 12 * 60 * 60_000;

/**
 * The carer's visit immediately before and after [jobStart, jobEnd], within
 * ADJACENT_VISIT_MAX_GAP_MS. Overlapping visits are ignored (the overlap rule covers them).
 */
export function adjacentVisits<T extends { start: Date; end: Date }>(
  visits: T[],
  jobStart: Date,
  jobEnd: Date,
): { previous: T | null; next: T | null } {
  let previous: T | null = null;
  let next: T | null = null;
  for (const v of visits) {
    if (v.end.getTime() <= jobStart.getTime()) {
      if (jobStart.getTime() - v.end.getTime() > ADJACENT_VISIT_MAX_GAP_MS) continue;
      if (!previous || v.end.getTime() > previous.end.getTime()) previous = v;
    } else if (v.start.getTime() >= jobEnd.getTime()) {
      if (v.start.getTime() - jobEnd.getTime() > ADJACENT_VISIT_MAX_GAP_MS) continue;
      if (!next || v.start.getTime() < next.start.getTime()) next = v;
    }
  }
  return { previous, next };
}
