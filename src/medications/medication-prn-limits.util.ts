import { dayKeyInTimeZone, formatHmInTimeZone } from '../common/utils/operational-day.util';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Optional limits the office sets on a PRN medicine. Any of them may be missing. */
export type PrnLimits = {
  minGapHours: number | null;
  maxDosesIn24Hours: number | null;
  maxDosePerTime: string | null;
};

export type PrnLimitStatus = 'ok' | 'too_soon' | 'max_reached';

export type PrnLimitEvaluation = {
  /** Doses given in the 24 hours up to `at`. */
  countIn24h: number;
  lastGivenAt: Date | null;
  tooSoon: boolean;
  maxReached: boolean;
  status: PrnLimitStatus;
  /** Earliest time another dose fits the limits; null when one fits now. */
  nextAllowedAt: Date | null;
};

export function prnLimitsFromMedication(med: {
  prnMinGapHours?: number | null;
  prnMaxDosesIn24Hours?: number | null;
  prnMaxDosePerTime?: string | null;
}): PrnLimits {
  return {
    minGapHours: med.prnMinGapHours ?? null,
    maxDosesIn24Hours: med.prnMaxDosesIn24Hours ?? null,
    maxDosePerTime: med.prnMaxDosePerTime?.trim() || null,
  };
}

/**
 * Where a PRN medicine stands against its limits at `at`: now, when showing the
 * medicine, or the time of a new dose, when saving one (pass the other doses only).
 * A rolling 24 hours is used, not the calendar day, so a dose late in the evening
 * still counts for a visit after midnight.
 */
export function evaluatePrnLimits(input: {
  limits: PrnLimits;
  givenAt: Date[];
  at: Date;
}): PrnLimitEvaluation {
  const at = input.at.getTime();
  const recent = input.givenAt
    .map((d) => d.getTime())
    .filter((t) => Number.isFinite(t) && t <= at && t > at - DAY_MS)
    .sort((a, b) => b - a);
  const last = recent[0] ?? null;
  const { minGapHours, maxDosesIn24Hours } = input.limits;

  const gapEndsAt = minGapHours != null && last != null ? last + minGapHours * HOUR_MS : null;
  const tooSoon = gapEndsAt != null && at < gapEndsAt;
  const maxReached = maxDosesIn24Hours != null && recent.length >= maxDosesIn24Hours;
  // Room for one more opens when the oldest of the last `max` doses is 24 hours old.
  const maxClearsAt =
    maxReached && maxDosesIn24Hours != null ? recent[maxDosesIn24Hours - 1]! + DAY_MS : null;

  const waits = [tooSoon ? gapEndsAt : null, maxClearsAt].filter(
    (t): t is number => t != null,
  );
  return {
    countIn24h: recent.length,
    lastGivenAt: last != null ? new Date(last) : null,
    tooSoon,
    maxReached,
    status: maxReached ? 'max_reached' : tooSoon ? 'too_soon' : 'ok',
    nextAllowedAt: waits.length ? new Date(Math.max(...waits)) : null,
  };
}

function hoursLabel(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

/** The limits as short lines for the carer; a limit that is not set gives null. */
export function prnLimitLabels(limits: PrnLimits): {
  minIntervalLabel: string | null;
  maxDoseLabel: string | null;
  maxPerTimeLabel: string | null;
} {
  const max = limits.maxDosesIn24Hours;
  return {
    minIntervalLabel:
      limits.minGapHours != null ? `Min ${hoursLabel(limits.minGapHours)} between doses` : null,
    maxDoseLabel: max != null ? `Max ${max} ${max === 1 ? 'dose' : 'doses'} in 24 hours` : null,
    maxPerTimeLabel: limits.maxDosePerTime ? `Max ${limits.maxDosePerTime} at one time` : null,
  };
}

/** Clock time in the organisation timezone, with "yesterday"/"tomorrow" when not today. */
export function prnClockLabel(instant: Date, now: Date, timeZone: string): string {
  const hm = formatHmInTimeZone(instant, timeZone);
  const day = dayKeyInTimeZone(instant, timeZone);
  const today = dayKeyInTimeZone(now, timeZone);
  if (day === today) return hm;
  if (day === dayKeyInTimeZone(new Date(now.getTime() - DAY_MS), timeZone)) {
    return `yesterday ${hm}`;
  }
  if (day === dayKeyInTimeZone(new Date(now.getTime() + DAY_MS), timeZone)) {
    return `tomorrow ${hm}`;
  }
  return `${day} ${hm}`;
}

/** One-line summary a carer sees on a PRN medicine, e.g. "Last given 08:00 · 2 of 4 in 24h". */
export function prnSummaryLine(input: {
  limits: PrnLimits;
  evaluation: PrnLimitEvaluation;
  now: Date;
  timeZone: string;
}): string {
  const { limits, evaluation } = input;
  if (!evaluation.lastGivenAt) return 'No dose in the last 24 hours';
  const last = `Last given ${prnClockLabel(evaluation.lastGivenAt, input.now, input.timeZone)}`;
  const count =
    limits.maxDosesIn24Hours != null
      ? `${evaluation.countIn24h} of ${limits.maxDosesIn24Hours} in 24h`
      : `${evaluation.countIn24h} in last 24h`;
  return `${last} · ${count}`;
}

/** Warning shown when another dose now would be outside the limits; null when it fits. */
export function prnWarningLine(input: {
  limits: PrnLimits;
  evaluation: PrnLimitEvaluation;
  now: Date;
  timeZone: string;
}): string | null {
  const { limits, evaluation } = input;
  if (evaluation.status === 'ok') return null;
  const next = evaluation.nextAllowedAt
    ? ` Next dose after ${prnClockLabel(evaluation.nextAllowedAt, input.now, input.timeZone)}.`
    : '';
  if (evaluation.maxReached) {
    return `Maximum reached: ${evaluation.countIn24h} of ${limits.maxDosesIn24Hours} in 24 hours.${next}`;
  }
  return `Too soon: minimum gap is ${hoursLabel(limits.minGapHours ?? 0)}.${next}`;
}

/**
 * Why a PRN dose given at `at` is outside the limits (stored on the record and sent
 * to the office); null when it is within them. `evaluation` covers the other doses.
 */
export function prnOverLimitDetail(input: {
  limits: PrnLimits;
  evaluation: PrnLimitEvaluation;
  at: Date;
}): string | null {
  const { limits, evaluation } = input;
  const parts: string[] = [];
  if (evaluation.tooSoon && evaluation.lastGivenAt && limits.minGapHours != null) {
    const sinceHours = (input.at.getTime() - evaluation.lastGivenAt.getTime()) / HOUR_MS;
    parts.push(
      `Given ${hoursLabel(sinceHours)} after the previous dose (minimum gap ${hoursLabel(limits.minGapHours)})`,
    );
  }
  if (evaluation.maxReached && limits.maxDosesIn24Hours != null) {
    parts.push(
      `Dose ${evaluation.countIn24h + 1} in 24 hours (maximum ${limits.maxDosesIn24Hours})`,
    );
  }
  return parts.length ? parts.join('; ') : null;
}
