/**
 * ECM timing engine (BE1.5).
 * Four independent measurements — do not collapse start-only or duration-only.
 *
 * Start variance   = actual start − planned start   (+ late / − early)
 * End variance     = actual end − planned end
 * Actual duration  = actual end − actual start
 * Duration variance = actual duration − planned duration
 */

export const ECM_PLATFORM_DEFAULTS = {
  lateArrivalToleranceMinutes: 15,
  veryLateThresholdMinutes: 30,
  earlyArrivalToleranceMinutes: 10,
  shortVisitToleranceMinutes: 5,
  /** Also allow short if under this % of planned duration (max of minutes vs %). */
  shortVisitTolerancePercent: 10,
  longVisitToleranceMinutes: 15,
  excessiveOverrunMinutes: 45,
  missedVisitThresholdMinutes: 60,
  geofenceRadiusMeters: 100,
  thresholdRuleVersion: 'platform-v1',
} as const;

export type EcmArrivalClassificationCode =
  | 'EARLY_ARRIVAL'
  | 'ON_TIME'
  | 'LATE_ARRIVAL'
  | 'VERY_LATE_ARRIVAL'
  | 'NOT_ASSESSED';

export type EcmDepartureClassificationCode =
  | 'EARLY_DEPARTURE'
  | 'ON_TIME'
  | 'LATE_DEPARTURE'
  | 'NOT_ASSESSED';

export type EcmDurationClassificationCode =
  | 'SHORT_VISIT'
  | 'ON_TIME'
  | 'LONG_VISIT'
  | 'EXCESSIVE_OVERRUN'
  | 'NOT_ASSESSED';

export type EcmMissedClassificationCode =
  | 'NONE'
  | 'POTENTIAL_MISSED'
  | 'ATTENDANCE_VERIFICATION_PENDING'
  | 'CONFIRMED_MISSED'
  | 'FALSE_ECM_ALERT'
  | 'DISPUTED';

export type EcmTimingThresholds = {
  lateArrivalToleranceMinutes: number;
  veryLateThresholdMinutes: number;
  earlyArrivalToleranceMinutes: number;
  shortVisitToleranceMinutes: number;
  shortVisitTolerancePercent: number;
  longVisitToleranceMinutes: number;
  excessiveOverrunMinutes: number;
  missedVisitThresholdMinutes: number;
};

export type EcmTimingInput = {
  plannedStart: Date;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  earliestPermittedStart?: Date | null;
  latestPermittedStart?: Date | null;
  minPermittedDurationMinutes?: number | null;
  maxPermittedDurationMinutes?: number | null;
  thresholds: EcmTimingThresholds;
  /** Wall clock for open / missed detection. */
  now?: Date;
  /** Provider has confirmed care was not delivered. */
  confirmedMissed?: boolean;
  /** Carer claims attendance but ECM evidence missing. */
  attendanceClaimedWithoutEvidence?: boolean;
  /** Investigation concluded ECM failed but care occurred. */
  falseEcmAlert?: boolean;
  /** Conflicting evidence. */
  disputed?: boolean;
};

export type EcmTimingResult = {
  plannedDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  startVarianceMinutes: number | null;
  endVarianceMinutes: number | null;
  durationVarianceMinutes: number | null;
  arrivalClassification: EcmArrivalClassificationCode;
  departureClassification: EcmDepartureClassificationCode;
  durationClassification: EcmDurationClassificationCode;
  missedClassification: EcmMissedClassificationCode;
  /** Human-readable combo e.g. "Late but full duration". */
  timingSummary: string;
};

function minutesDelta(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  const a = from.getTime();
  const b = to.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 60_000);
}

function plannedDurationMinutes(
  plannedStart: Date,
  plannedEnd: Date | null,
): number | null {
  return minutesDelta(plannedStart, plannedEnd);
}

export function classifyArrival(input: {
  startVarianceMinutes: number | null;
  actualStart: Date | null;
  plannedStart: Date;
  earliestPermittedStart?: Date | null;
  latestPermittedStart?: Date | null;
  lateArrivalToleranceMinutes: number;
  veryLateThresholdMinutes: number;
  earlyArrivalToleranceMinutes: number;
}): EcmArrivalClassificationCode {
  if (!input.actualStart) return 'NOT_ASSESSED';

  // Prefer explicit arrival window when provided.
  if (input.earliestPermittedStart || input.latestPermittedStart) {
    const t = input.actualStart.getTime();
    if (input.earliestPermittedStart && t < input.earliestPermittedStart.getTime()) {
      return 'EARLY_ARRIVAL';
    }
    if (input.latestPermittedStart && t > input.latestPermittedStart.getTime()) {
      const lateBy = Math.round(
        (t - input.latestPermittedStart.getTime()) / 60_000,
      );
      const veryLateAfter =
        input.veryLateThresholdMinutes - input.lateArrivalToleranceMinutes;
      if (lateBy > Math.max(0, veryLateAfter)) return 'VERY_LATE_ARRIVAL';
      return 'LATE_ARRIVAL';
    }
    return 'ON_TIME';
  }

  const delta = input.startVarianceMinutes;
  if (delta == null) return 'NOT_ASSESSED';
  if (delta < -input.earlyArrivalToleranceMinutes) return 'EARLY_ARRIVAL';
  if (delta > input.veryLateThresholdMinutes) return 'VERY_LATE_ARRIVAL';
  if (delta > input.lateArrivalToleranceMinutes) return 'LATE_ARRIVAL';
  return 'ON_TIME';
}

export function classifyDeparture(input: {
  endVarianceMinutes: number | null;
  lateArrivalToleranceMinutes: number;
}): EcmDepartureClassificationCode {
  const delta = input.endVarianceMinutes;
  if (delta == null) return 'NOT_ASSESSED';
  if (delta < -input.lateArrivalToleranceMinutes) return 'EARLY_DEPARTURE';
  if (delta > input.lateArrivalToleranceMinutes) return 'LATE_DEPARTURE';
  return 'ON_TIME';
}

export function classifyDuration(input: {
  plannedDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  durationVarianceMinutes: number | null;
  minPermittedDurationMinutes?: number | null;
  maxPermittedDurationMinutes?: number | null;
  shortVisitToleranceMinutes: number;
  shortVisitTolerancePercent: number;
  longVisitToleranceMinutes: number;
  excessiveOverrunMinutes: number;
}): EcmDurationClassificationCode {
  const actual = input.actualDurationMinutes;
  const planned = input.plannedDurationMinutes;
  if (actual == null || planned == null || planned <= 0) return 'NOT_ASSESSED';

  const percentFloor = Math.ceil((planned * input.shortVisitTolerancePercent) / 100);
  const shortFloor =
    input.minPermittedDurationMinutes != null && input.minPermittedDurationMinutes > 0
      ? input.minPermittedDurationMinutes
      : planned - Math.max(input.shortVisitToleranceMinutes, percentFloor);

  const longCeiling =
    input.maxPermittedDurationMinutes != null && input.maxPermittedDurationMinutes > 0
      ? input.maxPermittedDurationMinutes
      : planned + input.longVisitToleranceMinutes;

  const excessiveCeiling = planned + input.excessiveOverrunMinutes;

  if (actual < shortFloor) return 'SHORT_VISIT';
  if (actual > excessiveCeiling) return 'EXCESSIVE_OVERRUN';
  if (actual > longCeiling) return 'LONG_VISIT';
  return 'ON_TIME';
}

export function classifyMissed(input: {
  actualStart: Date | null;
  plannedStart: Date;
  missedVisitThresholdMinutes: number;
  now: Date;
  confirmedMissed?: boolean;
  attendanceClaimedWithoutEvidence?: boolean;
  falseEcmAlert?: boolean;
  disputed?: boolean;
}): EcmMissedClassificationCode {
  if (input.disputed) return 'DISPUTED';
  if (input.falseEcmAlert) return 'FALSE_ECM_ALERT';
  if (input.confirmedMissed) return 'CONFIRMED_MISSED';
  if (input.attendanceClaimedWithoutEvidence) {
    return 'ATTENDANCE_VERIFICATION_PENDING';
  }
  if (input.actualStart) return 'NONE';

  const elapsed = Math.round(
    (input.now.getTime() - input.plannedStart.getTime()) / 60_000,
  );
  if (elapsed >= input.missedVisitThresholdMinutes) {
    return 'POTENTIAL_MISSED';
  }
  return 'NONE';
}

function buildTimingSummary(result: {
  arrivalClassification: EcmArrivalClassificationCode;
  durationClassification: EcmDurationClassificationCode;
  departureClassification: EcmDepartureClassificationCode;
}): string {
  const parts: string[] = [];
  if (result.arrivalClassification === 'ON_TIME') parts.push('On-time arrival');
  else if (result.arrivalClassification !== 'NOT_ASSESSED') {
    parts.push(result.arrivalClassification.replace(/_/g, ' ').toLowerCase());
  }
  if (result.durationClassification === 'ON_TIME') parts.push('full duration');
  else if (result.durationClassification === 'SHORT_VISIT') parts.push('short duration');
  else if (result.durationClassification === 'LONG_VISIT') parts.push('long duration');
  else if (result.durationClassification === 'EXCESSIVE_OVERRUN') {
    parts.push('excessive overrun');
  }
  if (result.departureClassification === 'EARLY_DEPARTURE') parts.push('early departure');
  else if (result.departureClassification === 'LATE_DEPARTURE') parts.push('late departure');
  return parts.length > 0 ? parts.join('; ') : 'Not assessed';
}

export function evaluateEcmTiming(input: EcmTimingInput): EcmTimingResult {
  const now = input.now ?? new Date();
  const planned = plannedDurationMinutes(input.plannedStart, input.plannedEnd);
  const actual = minutesDelta(input.actualStart, input.actualEnd);
  const startVariance = minutesDelta(input.plannedStart, input.actualStart);
  const endVariance = minutesDelta(input.plannedEnd, input.actualEnd);
  const durationVariance =
    planned != null && actual != null ? actual - planned : null;

  const t = input.thresholds;
  const arrivalClassification = classifyArrival({
    startVarianceMinutes: startVariance,
    actualStart: input.actualStart,
    plannedStart: input.plannedStart,
    earliestPermittedStart: input.earliestPermittedStart,
    latestPermittedStart: input.latestPermittedStart,
    lateArrivalToleranceMinutes: t.lateArrivalToleranceMinutes,
    veryLateThresholdMinutes: t.veryLateThresholdMinutes,
    earlyArrivalToleranceMinutes: t.earlyArrivalToleranceMinutes,
  });

  const departureClassification = classifyDeparture({
    endVarianceMinutes: endVariance,
    lateArrivalToleranceMinutes: t.lateArrivalToleranceMinutes,
  });

  const durationClassification = classifyDuration({
    plannedDurationMinutes: planned,
    actualDurationMinutes: actual,
    durationVarianceMinutes: durationVariance,
    minPermittedDurationMinutes: input.minPermittedDurationMinutes,
    maxPermittedDurationMinutes: input.maxPermittedDurationMinutes,
    shortVisitToleranceMinutes: t.shortVisitToleranceMinutes,
    shortVisitTolerancePercent: t.shortVisitTolerancePercent,
    longVisitToleranceMinutes: t.longVisitToleranceMinutes,
    excessiveOverrunMinutes: t.excessiveOverrunMinutes,
  });

  const missedClassification = classifyMissed({
    actualStart: input.actualStart,
    plannedStart: input.plannedStart,
    missedVisitThresholdMinutes: t.missedVisitThresholdMinutes,
    now,
    confirmedMissed: input.confirmedMissed,
    attendanceClaimedWithoutEvidence: input.attendanceClaimedWithoutEvidence,
    falseEcmAlert: input.falseEcmAlert,
    disputed: input.disputed,
  });

  const result: EcmTimingResult = {
    plannedDurationMinutes: planned,
    actualDurationMinutes: actual,
    startVarianceMinutes: startVariance,
    endVarianceMinutes: endVariance,
    durationVarianceMinutes: durationVariance,
    arrivalClassification,
    departureClassification,
    durationClassification,
    missedClassification,
    timingSummary: '',
  };
  result.timingSummary = buildTimingSummary(result);
  return result;
}

/** Derive earliest/latest from planned start + tolerances when no explicit window. */
export function deriveArrivalWindow(
  plannedStart: Date,
  earlyToleranceMinutes: number,
  lateToleranceMinutes: number,
): { earliest: Date; latest: Date } {
  return {
    earliest: new Date(plannedStart.getTime() - earlyToleranceMinutes * 60_000),
    latest: new Date(plannedStart.getTime() + lateToleranceMinutes * 60_000),
  };
}
