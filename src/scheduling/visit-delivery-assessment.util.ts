/**
 * Per-visit delivery classification for CQC / ECM evidence.
 * Derived on read from planned/actual times, job/visit status, and optional attendance.
 */

export const VISIT_PLANNED_SHORT_MINUTES = 30;
/** Align with billing underrun threshold (actual materially shorter than planned). */
export const VISIT_ACTUAL_SHORT_THRESHOLD_MINUTES = 15;
/** Open visit without checkout beyond planned end by this many minutes → abnormally long. */
export const VISIT_ABNORMALLY_LONG_OPEN_GRACE_MINUTES = 60;
export const VISIT_PUNCTUALITY_DEFAULT_TOLERANCE_MINUTES = 15;

export type VisitLifecycleStatusCode =
  | 'SCHEDULED'
  | 'ASSIGNED'
  | 'EN_ROUTE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'MISSED'
  | 'CANCELLED'
  | 'CALLED_OFF'
  | 'UNPLANNED'
  | 'NEEDS_ATTENTION';

export type VisitTimingStatusCode =
  | 'ON_TIME'
  | 'EARLY_ARRIVAL'
  | 'LATE_START'
  | 'CRITICALLY_LATE'
  | 'NOT_ASSESSED';

export type VisitDurationExceptionCode =
  | 'PLANNED_SHORT_VISIT'
  | 'ACTUAL_SHORT_VISIT'
  | 'EARLY_END'
  | 'OVERRUN'
  | 'ABNORMALLY_LONG_OPEN'
  | 'ZERO_DURATION'
  | 'NEGATIVE_OR_INVALID_DURATION'
  | 'PARTIALLY_COMPLETED';

export type VisitDeliveryExceptionFlag = {
  code: string;
  label: string;
  severity: 'info' | 'warning' | 'critical';
  detail?: string;
};

export type VisitDeliveryAssessment = {
  lifecycleStatus: VisitLifecycleStatusCode;
  lifecycleLabel: string;
  timingStatus: VisitTimingStatusCode;
  timingLabel: string;
  /** Start variance minutes (actual − planned); null if not assessed. */
  startVarianceMinutes: number | null;
  endVarianceMinutes: number | null;
  plannedDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  toleranceMinutes: number;
  criticallyLateThresholdMinutes: number;
  durationExceptions: VisitDurationExceptionCode[];
  flags: VisitDeliveryExceptionFlag[];
  /** True when a structured timing/duration reason should be captured. */
  requiresExceptionReason: boolean;
};

export type VisitDeliveryAssessmentInput = {
  jobStatus: string;
  visitStatus?: string | null;
  allocatedCarers?: number;
  requiredCarers?: number;
  plannedStartIso?: string | null;
  plannedEndIso?: string | null;
  actualStartIso?: string | null;
  actualEndIso?: string | null;
  hasVisitPlanSlot?: boolean;
  timeCritical?: boolean | null;
  timeToleranceMinutes?: number | null;
  orgLateAlertMinutes?: number | null;
  orgGlobalToleranceMinutes?: number | null;
  /** Latest attendance event type if known (e.g. EN_ROUTE, CHECK_IN). */
  latestAttendanceEventType?: string | null;
  /** Wall-clock "now" for open-visit detection (tests inject). */
  now?: Date;
};

const LIFECYCLE_LABELS: Record<VisitLifecycleStatusCode, string> = {
  SCHEDULED: 'Scheduled',
  ASSIGNED: 'Assigned',
  EN_ROUTE: 'En route',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  PARTIALLY_COMPLETED: 'Partially completed',
  MISSED: 'Missed',
  CANCELLED: 'Cancelled',
  CALLED_OFF: 'Called off',
  UNPLANNED: 'Unplanned visit',
  NEEDS_ATTENTION: 'Needs attention',
};

const TIMING_LABELS: Record<VisitTimingStatusCode, string> = {
  ON_TIME: 'On time',
  EARLY_ARRIVAL: 'Early arrival',
  LATE_START: 'Late start',
  CRITICALLY_LATE: 'Critically late',
  NOT_ASSESSED: 'Not assessed',
};

const DURATION_LABELS: Record<VisitDurationExceptionCode, string> = {
  PLANNED_SHORT_VISIT: 'Planned short visit',
  ACTUAL_SHORT_VISIT: 'Actual short visit',
  EARLY_END: 'Early end',
  OVERRUN: 'Overrun / long visit',
  ABNORMALLY_LONG_OPEN: 'Abnormally long open visit',
  ZERO_DURATION: 'Zero-duration visit',
  NEGATIVE_OR_INVALID_DURATION: 'Negative / invalid duration',
  PARTIALLY_COMPLETED: 'Partially completed',
};

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function minutesBetween(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): number | null {
  const a = parseTime(startIso);
  const b = parseTime(endIso);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 60_000);
}

export function resolveVisitDeliveryToleranceMinutes(input: {
  timeCritical?: boolean | null;
  timeToleranceMinutes?: number | null;
  orgLateAlertMinutes?: number | null;
  orgGlobalToleranceMinutes?: number | null;
}): number {
  if (input.timeCritical) {
    const slotTol = input.timeToleranceMinutes;
    if (typeof slotTol === 'number' && Number.isFinite(slotTol) && slotTol >= 0) {
      return Math.floor(slotTol);
    }
  }
  const lateAlert = input.orgLateAlertMinutes;
  if (typeof lateAlert === 'number' && Number.isFinite(lateAlert) && lateAlert > 0) {
    return Math.floor(lateAlert);
  }
  const globalTol = input.orgGlobalToleranceMinutes;
  if (typeof globalTol === 'number' && Number.isFinite(globalTol) && globalTol > 0) {
    return Math.floor(globalTol);
  }
  return VISIT_PUNCTUALITY_DEFAULT_TOLERANCE_MINUTES;
}

function classifyLifecycle(input: VisitDeliveryAssessmentInput): VisitLifecycleStatusCode {
  const visit = (input.visitStatus ?? '').toUpperCase();
  const job = (input.jobStatus ?? '').toUpperCase();
  const combined = visit || job;

  if (combined === 'CANCELLED' || job === 'CANCELLED') return 'CANCELLED';
  if (combined === 'CALLED_OFF' || job === 'CALLED_OFF') return 'CALLED_OFF';
  if (combined === 'MISSED' || job === 'MISSED') return 'MISSED';
  if (combined === 'PARTIALLY_COMPLETED' || job === 'PARTIALLY_COMPLETED') {
    return 'PARTIALLY_COMPLETED';
  }
  if (combined === 'COMPLETED' || job === 'COMPLETED') {
    if (input.hasVisitPlanSlot === false) return 'UNPLANNED';
    return 'COMPLETED';
  }
  if (combined === 'NEEDS_ATTENTION' || job === 'NEEDS_ATTENTION') return 'NEEDS_ATTENTION';

  const attendance = (input.latestAttendanceEventType ?? '').toUpperCase();
  const hasCheckIn = Boolean(input.actualStartIso) || attendance === 'CHECK_IN';
  const hasCheckOut = Boolean(input.actualEndIso) || attendance === 'CHECK_OUT';

  if (
    combined === 'STARTED' ||
    job === 'IN_PROGRESS' ||
    (hasCheckIn && !hasCheckOut)
  ) {
    return 'IN_PROGRESS';
  }

  if (attendance === 'EN_ROUTE' && !hasCheckIn) return 'EN_ROUTE';

  const allocated = input.allocatedCarers ?? 0;
  if (
    allocated > 0 ||
    job === 'ALLOCATED' ||
    visit === 'PLANNED' && allocated > 0
  ) {
    if (job === 'DRAFT' || job === 'UNALLOCATED') {
      return allocated > 0 ? 'ASSIGNED' : 'SCHEDULED';
    }
    return 'ASSIGNED';
  }

  return 'SCHEDULED';
}

function classifyTiming(input: {
  startVarianceMinutes: number | null;
  toleranceMinutes: number;
  criticallyLateThresholdMinutes: number;
}): VisitTimingStatusCode {
  const { startVarianceMinutes: delta, toleranceMinutes: tol, criticallyLateThresholdMinutes } =
    input;
  if (delta == null) return 'NOT_ASSESSED';
  if (delta < -tol) return 'EARLY_ARRIVAL';
  if (delta > criticallyLateThresholdMinutes) return 'CRITICALLY_LATE';
  if (delta > tol) return 'LATE_START';
  return 'ON_TIME';
}

export function assessVisitDelivery(input: VisitDeliveryAssessmentInput): VisitDeliveryAssessment {
  const toleranceMinutes = resolveVisitDeliveryToleranceMinutes(input);
  const criticallyLateThresholdMinutes = Math.max(toleranceMinutes * 2, toleranceMinutes + 15);

  const plannedDurationMinutes = minutesBetween(input.plannedStartIso, input.plannedEndIso);
  const actualDurationMinutes = minutesBetween(input.actualStartIso, input.actualEndIso);
  const startVarianceMinutes = minutesBetween(input.plannedStartIso, input.actualStartIso);
  // For end variance we want actualEnd − plannedEnd (same helper with swapped semantics):
  const endVarianceMinutes = (() => {
    const plannedEnd = parseTime(input.plannedEndIso);
    const actualEnd = parseTime(input.actualEndIso);
    if (plannedEnd == null || actualEnd == null) return null;
    return Math.round((actualEnd - plannedEnd) / 60_000);
  })();

  const lifecycleStatus = classifyLifecycle(input);
  const timingStatus = classifyTiming({
    startVarianceMinutes,
    toleranceMinutes,
    criticallyLateThresholdMinutes,
  });

  const durationExceptions: VisitDurationExceptionCode[] = [];
  const flags: VisitDeliveryExceptionFlag[] = [];

  if (
    plannedDurationMinutes != null &&
    plannedDurationMinutes > 0 &&
    plannedDurationMinutes < VISIT_PLANNED_SHORT_MINUTES
  ) {
    durationExceptions.push('PLANNED_SHORT_VISIT');
    flags.push({
      code: 'PLANNED_SHORT_VISIT',
      label: DURATION_LABELS.PLANNED_SHORT_VISIT,
      severity: 'warning',
      detail: `Planned ${plannedDurationMinutes} min (below ${VISIT_PLANNED_SHORT_MINUTES} min NICE guidance)`,
    });
  }

  if (actualDurationMinutes != null) {
    if (actualDurationMinutes < 0) {
      durationExceptions.push('NEGATIVE_OR_INVALID_DURATION');
      flags.push({
        code: 'NEGATIVE_OR_INVALID_DURATION',
        label: DURATION_LABELS.NEGATIVE_OR_INVALID_DURATION,
        severity: 'critical',
        detail: 'Check-out is before check-in (timestamp or timezone issue)',
      });
    } else if (actualDurationMinutes === 0) {
      durationExceptions.push('ZERO_DURATION');
      flags.push({
        code: 'ZERO_DURATION',
        label: DURATION_LABELS.ZERO_DURATION,
        severity: 'critical',
        detail: 'Check-in and check-out are identical or zero length',
      });
    }
  }

  if (
    plannedDurationMinutes != null &&
    actualDurationMinutes != null &&
    actualDurationMinutes > 0
  ) {
    if (actualDurationMinutes > plannedDurationMinutes) {
      durationExceptions.push('OVERRUN');
      flags.push({
        code: 'OVERRUN',
        label: DURATION_LABELS.OVERRUN,
        severity: 'warning',
        detail: `${actualDurationMinutes - plannedDurationMinutes} min over planned`,
      });
    } else if (
      actualDurationMinutes < plannedDurationMinutes - VISIT_ACTUAL_SHORT_THRESHOLD_MINUTES
    ) {
      durationExceptions.push('ACTUAL_SHORT_VISIT');
      flags.push({
        code: 'ACTUAL_SHORT_VISIT',
        label: DURATION_LABELS.ACTUAL_SHORT_VISIT,
        severity: 'warning',
        detail: `${plannedDurationMinutes - actualDurationMinutes} min under planned`,
      });
    }
  }

  if (
    endVarianceMinutes != null &&
    endVarianceMinutes < -toleranceMinutes &&
    !durationExceptions.includes('ACTUAL_SHORT_VISIT')
  ) {
    durationExceptions.push('EARLY_END');
    flags.push({
      code: 'EARLY_END',
      label: DURATION_LABELS.EARLY_END,
      severity: 'warning',
      detail: `Ended ${Math.abs(endVarianceMinutes)} min before planned end`,
    });
  }

  if (lifecycleStatus === 'PARTIALLY_COMPLETED') {
    durationExceptions.push('PARTIALLY_COMPLETED');
    flags.push({
      code: 'PARTIALLY_COMPLETED',
      label: DURATION_LABELS.PARTIALLY_COMPLETED,
      severity: 'warning',
      detail: 'Some planned tasks or outcomes were not completed',
    });
  }

  const now = input.now ?? new Date();
  if (
    lifecycleStatus === 'IN_PROGRESS' &&
    input.actualStartIso &&
    !input.actualEndIso
  ) {
    const plannedEnd = parseTime(input.plannedEndIso);
    const openSince = parseTime(input.actualStartIso);
    if (plannedEnd != null && now.getTime() > plannedEnd + VISIT_ABNORMALLY_LONG_OPEN_GRACE_MINUTES * 60_000) {
      durationExceptions.push('ABNORMALLY_LONG_OPEN');
      flags.push({
        code: 'ABNORMALLY_LONG_OPEN',
        label: DURATION_LABELS.ABNORMALLY_LONG_OPEN,
        severity: 'critical',
        detail: `Still open more than ${VISIT_ABNORMALLY_LONG_OPEN_GRACE_MINUTES} min past planned end`,
      });
    } else if (
      openSince != null &&
      plannedDurationMinutes != null &&
      plannedDurationMinutes > 0 &&
      now.getTime() - openSince > (plannedDurationMinutes * 2 + VISIT_ABNORMALLY_LONG_OPEN_GRACE_MINUTES) * 60_000
    ) {
      durationExceptions.push('ABNORMALLY_LONG_OPEN');
      flags.push({
        code: 'ABNORMALLY_LONG_OPEN',
        label: DURATION_LABELS.ABNORMALLY_LONG_OPEN,
        severity: 'critical',
        detail: 'Open substantially longer than twice the planned duration',
      });
    }
  }

  if (timingStatus === 'CRITICALLY_LATE') {
    flags.unshift({
      code: 'CRITICALLY_LATE',
      label: TIMING_LABELS.CRITICALLY_LATE,
      severity: 'critical',
      detail:
        startVarianceMinutes != null
          ? `Started +${startVarianceMinutes} min (critical threshold ${criticallyLateThresholdMinutes} min)`
          : undefined,
    });
  } else if (timingStatus === 'LATE_START') {
    flags.unshift({
      code: 'LATE_START',
      label: TIMING_LABELS.LATE_START,
      severity: 'warning',
      detail:
        startVarianceMinutes != null ? `Started +${startVarianceMinutes} min` : undefined,
    });
  } else if (timingStatus === 'EARLY_ARRIVAL') {
    flags.unshift({
      code: 'EARLY_ARRIVAL',
      label: TIMING_LABELS.EARLY_ARRIVAL,
      severity: 'info',
      detail:
        startVarianceMinutes != null ? `Started ${startVarianceMinutes} min` : undefined,
    });
  }

  if (lifecycleStatus === 'MISSED') {
    flags.unshift({
      code: 'MISSED',
      label: LIFECYCLE_LABELS.MISSED,
      severity: 'critical',
      detail: 'No attendance and visit was not legitimately cancelled',
    });
  }

  const requiresExceptionReason =
    timingStatus === 'LATE_START' ||
    timingStatus === 'CRITICALLY_LATE' ||
    timingStatus === 'EARLY_ARRIVAL' ||
    durationExceptions.includes('OVERRUN') ||
    durationExceptions.includes('ACTUAL_SHORT_VISIT') ||
    durationExceptions.includes('EARLY_END') ||
    durationExceptions.includes('ZERO_DURATION') ||
    durationExceptions.includes('NEGATIVE_OR_INVALID_DURATION');

  return {
    lifecycleStatus,
    lifecycleLabel: LIFECYCLE_LABELS[lifecycleStatus],
    timingStatus,
    timingLabel: TIMING_LABELS[timingStatus],
    startVarianceMinutes,
    endVarianceMinutes,
    plannedDurationMinutes,
    actualDurationMinutes,
    toleranceMinutes,
    criticallyLateThresholdMinutes,
    durationExceptions,
    flags,
    requiresExceptionReason,
  };
}

export function assessVisitDeliveryFromJobLike(job: {
  status: string;
  requiredCarers?: number;
  allocatedCarers?: number;
  allocations?: Array<{ status?: string }>;
  scheduledStartDateTime?: string | null;
  scheduledEndDateTime?: string | null;
  actualStartDateTime?: string | null;
  actualEndDateTime?: string | null;
  visitPlan?: {
    slotId?: string | null;
    timeCritical?: boolean | null;
    timeToleranceMinutes?: number | null;
  } | null;
  visits?: Array<{
    status?: string | null;
    visitPlanSlotId?: string | null;
    scheduledStartDateTime?: string | null;
    scheduledEndDateTime?: string | null;
    actualStartDateTime?: string | null;
    actualEndDateTime?: string | null;
  }>;
  latestAttendanceEventType?: string | null;
  orgLateAlertMinutes?: number | null;
  orgGlobalToleranceMinutes?: number | null;
  now?: Date;
}): VisitDeliveryAssessment {
  const visit = job.visits?.[0];
  const activeAllocations =
    job.allocatedCarers ??
    job.allocations?.filter((a) => {
      const s = (a.status ?? '').toUpperCase();
      return s === 'ALLOCATED' || s === 'CONFIRMED' || s === 'PENDING_CONFIRMATION';
    }).length ??
    0;

  return assessVisitDelivery({
    jobStatus: job.status,
    visitStatus: visit?.status ?? null,
    allocatedCarers: activeAllocations,
    requiredCarers: job.requiredCarers,
    plannedStartIso: visit?.scheduledStartDateTime ?? job.scheduledStartDateTime,
    plannedEndIso: visit?.scheduledEndDateTime ?? job.scheduledEndDateTime,
    actualStartIso: visit?.actualStartDateTime ?? job.actualStartDateTime,
    actualEndIso: visit?.actualEndDateTime ?? job.actualEndDateTime,
    hasVisitPlanSlot: Boolean(job.visitPlan?.slotId ?? visit?.visitPlanSlotId),
    timeCritical: job.visitPlan?.timeCritical,
    timeToleranceMinutes: job.visitPlan?.timeToleranceMinutes,
    orgLateAlertMinutes: job.orgLateAlertMinutes,
    orgGlobalToleranceMinutes: job.orgGlobalToleranceMinutes,
    latestAttendanceEventType: job.latestAttendanceEventType,
    now: job.now,
  });
}
