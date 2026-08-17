import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  formatHmInTimeZone,
} from '../common/utils/operational-day.util';

export function parseHm(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function timeWindowsOverlap(
  visitStart: string,
  visitEnd: string,
  patternStart: string | null,
  patternEnd: string | null,
): boolean {
  if (!patternStart || !patternEnd) return true;
  const vs = parseHm(visitStart);
  let ve = parseHm(visitEnd);
  let ps = parseHm(patternStart);
  let pe = parseHm(patternEnd);
  if (ve <= vs) ve += 24 * 60;
  if (pe <= ps) pe += 24 * 60;
  return vs < pe && ve > ps;
}

/**
 * True when the whole visit window sits inside the employee working window.
 * Matches Schedule Jobs board rules (not merely overlapping the pattern).
 */
export function visitTimeFitsWithinPattern(
  visitStart: string,
  visitEnd: string,
  patternStart: string | null,
  patternEnd: string | null,
): boolean {
  if (!patternStart && !patternEnd) return true;
  if (!patternStart || !patternEnd) return true;

  const vs = parseHm(visitStart);
  let ve = parseHm(visitEnd);
  let ps = parseHm(patternStart);
  let pe = parseHm(patternEnd);
  if (ve <= vs) ve += 24 * 60;
  if (pe <= ps) pe += 24 * 60;
  return vs >= ps && ve <= pe;
}

export type VisitPatternTimeMismatch = {
  minutesBeforeStart: number;
  minutesAfterEnd: number;
};

export function visitPatternTimeMismatch(
  visitStart: string,
  visitEnd: string,
  patternStart: string | null,
  patternEnd: string | null,
): VisitPatternTimeMismatch | null {
  if (!patternStart || !patternEnd) return null;
  if (visitTimeFitsWithinPattern(visitStart, visitEnd, patternStart, patternEnd)) return null;

  const vs = parseHm(visitStart);
  let ve = parseHm(visitEnd);
  let ps = parseHm(patternStart);
  let pe = parseHm(patternEnd);
  if (ve <= vs) ve += 24 * 60;
  if (pe <= ps) pe += 24 * 60;

  return {
    minutesBeforeStart: vs < ps ? ps - vs : 0,
    minutesAfterEnd: ve > pe ? ve - pe : 0,
  };
}

export function formatMinutesAsDuration(minutes: number): string {
  if (minutes <= 0) return '0 minutes';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} minute${mins === 1 ? '' : 's'}`;
  if (mins === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} hour${hours === 1 ? '' : 's'} ${mins} minute${mins === 1 ? '' : 's'}`;
}

export function formatVisitPatternTimeMismatchMessage(
  dayLabel: string,
  mismatch: VisitPatternTimeMismatch,
  patternStart: string,
  patternEnd: string,
): string {
  const offsetParts: string[] = [];
  if (mismatch.minutesBeforeStart > 0) {
    offsetParts.push(`${formatMinutesAsDuration(mismatch.minutesBeforeStart)} before`);
  }
  if (mismatch.minutesAfterEnd > 0) {
    offsetParts.push(`${formatMinutesAsDuration(mismatch.minutesAfterEnd)} after`);
  }

  if (!offsetParts.length) {
    return `On ${dayLabel}, your visit is outside your working pattern (${patternStart}–${patternEnd})`;
  }

  const offsetText =
    offsetParts.length === 1 ? offsetParts[0] : `${offsetParts[0]} and ${offsetParts[1]}`;

  return `On ${dayLabel}, your visit is ${offsetText} your working pattern (${patternStart}–${patternEnd})`;
}

export function hmFromJobDate(
  date: Date,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  return formatHmInTimeZone(date, timeZone);
}
