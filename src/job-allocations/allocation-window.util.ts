/**
 * Resolve per-carer assignment timing vs the parent job/visit window.
 * Null allocation times inherit the visit envelope (backward compatible).
 */

export type VisitWindow = {
  scheduledStartDateTime: Date;
  scheduledEndDateTime: Date | null;
  estimatedDurationMinutes?: number | null;
};

export type AllocationTiming = {
  scheduledStartDateTime: Date | null;
  scheduledEndDateTime: Date | null;
  durationMinutes?: number | null;
};

export type ResolvedAllocationWindow = {
  start: Date;
  end: Date;
  durationMinutes: number;
  /** True when both allocation start and end were stored (not inherited). */
  hasExplicitTiming: boolean;
};

function defaultEndFromStart(
  start: Date,
  estimatedDurationMinutes: number | null | undefined,
): Date {
  return new Date(start.getTime() + (estimatedDurationMinutes ?? 60) * 60_000);
}

/** Overall visit/job envelope. */
export function resolveVisitWindow(visit: VisitWindow): { start: Date; end: Date } {
  const start = visit.scheduledStartDateTime;
  const end =
    visit.scheduledEndDateTime ??
    defaultEndFromStart(start, visit.estimatedDurationMinutes);
  return { start, end };
}

/** Per-carer window: allocation times if both set, else visit envelope. */
export function resolveAllocationWindow(
  allocation: AllocationTiming | null | undefined,
  visit: VisitWindow,
): ResolvedAllocationWindow {
  const envelope = resolveVisitWindow(visit);
  const hasExplicitTiming = Boolean(
    allocation?.scheduledStartDateTime && allocation?.scheduledEndDateTime,
  );
  if (!hasExplicitTiming) {
    return {
      start: envelope.start,
      end: envelope.end,
      durationMinutes: Math.max(
        1,
        Math.round((envelope.end.getTime() - envelope.start.getTime()) / 60_000),
      ),
      hasExplicitTiming: false,
    };
  }
  const start = allocation!.scheduledStartDateTime!;
  const end = allocation!.scheduledEndDateTime!;
  const durationMinutes =
    allocation?.durationMinutes != null && allocation.durationMinutes > 0
      ? allocation.durationMinutes
      : Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
  return { start, end, durationMinutes, hasExplicitTiming: true };
}

export function durationMinutesBetween(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
}

/** Same instant (ms precision) for inherit detection. */
export function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}

/**
 * Assignment still uses the previous visit window (or has no times) → safe to
 * auto-update when the visit window changes.
 */
export function isInheritedAllocationTiming(
  allocation: AllocationTiming,
  previousVisit: VisitWindow,
): boolean {
  if (!allocation.scheduledStartDateTime || !allocation.scheduledEndDateTime) {
    return true;
  }
  const prev = resolveVisitWindow(previousVisit);
  return (
    sameInstant(allocation.scheduledStartDateTime, prev.start) &&
    sameInstant(allocation.scheduledEndDateTime, prev.end)
  );
}

export type AllocationTimingValidationError = {
  field: 'scheduledStartDateTime' | 'scheduledEndDateTime' | 'timing';
  message: string;
};

/**
 * Validate assignment timing against the visit envelope.
 * Returns error list (empty = valid).
 */
export function validateAllocationTimingWithinVisit(params: {
  assignmentStart: Date;
  assignmentEnd: Date;
  visitStart: Date;
  visitEnd: Date;
  carerLabel?: string;
}): AllocationTimingValidationError[] {
  const errors: AllocationTimingValidationError[] = [];
  const label = params.carerLabel ? ` for ${params.carerLabel}` : '';

  if (!(params.assignmentStart instanceof Date) || Number.isNaN(params.assignmentStart.getTime())) {
    errors.push({
      field: 'scheduledStartDateTime',
      message: `Assignment start time${label} is required`,
    });
  }
  if (!(params.assignmentEnd instanceof Date) || Number.isNaN(params.assignmentEnd.getTime())) {
    errors.push({
      field: 'scheduledEndDateTime',
      message: `Assignment end time${label} is required`,
    });
  }
  if (errors.length) return errors;

  if (params.assignmentEnd.getTime() <= params.assignmentStart.getTime()) {
    errors.push({
      field: 'scheduledEndDateTime',
      message: `Assignment end time${label} must be later than start time`,
    });
  }
  if (params.assignmentStart.getTime() < params.visitStart.getTime()) {
    errors.push({
      field: 'scheduledStartDateTime',
      message: `Assignment start time${label} must be within the visit window`,
    });
  }
  if (params.assignmentEnd.getTime() > params.visitEnd.getTime()) {
    errors.push({
      field: 'scheduledEndDateTime',
      message: `Assignment end time${label} must be within the visit window`,
    });
  }
  return errors;
}

/** Resolve actual worked window: allocation actuals if both set, else visit actuals. */
export function resolveAllocationActualWindow(
  allocation: {
    actualStartDateTime?: Date | null;
    actualEndDateTime?: Date | null;
  } | null | undefined,
  visitActual: {
    actualStartDateTime: Date | null;
    actualEndDateTime: Date | null;
  },
): { start: Date | null; end: Date | null; hasExplicitActual: boolean } {
  const hasExplicitActual = Boolean(
    allocation?.actualStartDateTime && allocation?.actualEndDateTime,
  );
  if (hasExplicitActual) {
    return {
      start: allocation!.actualStartDateTime!,
      end: allocation!.actualEndDateTime!,
      hasExplicitActual: true,
    };
  }
  return {
    start: visitActual.actualStartDateTime,
    end: visitActual.actualEndDateTime,
    hasExplicitActual: false,
  };
}

/** True if two half-open intervals [aStart,aEnd) and [bStart,bEnd) overlap. */
export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}
