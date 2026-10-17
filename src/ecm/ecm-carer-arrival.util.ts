/**
 * Per-carer arrival on double-up visits. The visit row shows one actual start (the
 * first clock-in), which hides a carer who arrived late — so each carer is compared
 * to THEIR OWN planned start (assignment time, else the visit time), using the same
 * late tolerance the visit was evaluated with.
 */

export type CarerArrivalAllocation = {
  employeeId: string;
  /** Per-carer assignment start (null = inherits the visit time). */
  scheduledStartDateTime: Date | null;
  /** Carer-specific actuals (office completion writes these when no app events exist). */
  actualStartDateTime: Date | null;
  actualEndDateTime: Date | null;
};

export type CarerArrivalEvent = {
  employeeId: string;
  eventType: string;
  occurredAt: Date;
};

export type CarerArrival = {
  plannedStartDateTime: Date;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  /** Minutes after own planned start, set only when beyond the late tolerance. */
  lateArrivalMinutes: number | null;
  /** Past own planned start + tolerance with no clock-in while the others have clocked in. */
  notClockedIn: boolean;
};

export function computeCarerArrivals(input: {
  allocations: CarerArrivalAllocation[];
  events: CarerArrivalEvent[];
  visitPlannedStart: Date;
  lateArrivalToleranceMinutes: number;
  /** Completed outcome — only then may allocation actual ends stand in for a CHECK_OUT. */
  visitCompleted: boolean;
  /** Confirmed missed visits are not broken down per carer. */
  visitMissed: boolean;
  now: Date;
}): Map<string, CarerArrival> {
  const result = new Map<string, CarerArrival>();
  if (input.allocations.length < 2) return result;

  const toleranceMs = Math.max(0, input.lateArrivalToleranceMinutes) * 60_000;
  const firstCheckIn = new Map<string, Date>();
  const lastCheckOut = new Map<string, Date>();
  for (const e of input.events) {
    const t = e.occurredAt.getTime();
    if (e.eventType === 'CHECK_IN') {
      const prev = firstCheckIn.get(e.employeeId);
      if (!prev || t < prev.getTime()) firstCheckIn.set(e.employeeId, e.occurredAt);
    } else if (e.eventType === 'CHECK_OUT') {
      const prev = lastCheckOut.get(e.employeeId);
      if (!prev || t > prev.getTime()) lastCheckOut.set(e.employeeId, e.occurredAt);
    }
  }

  const rows = input.allocations.map((a) => ({
    employeeId: a.employeeId,
    planned: a.scheduledStartDateTime ?? input.visitPlannedStart,
    checkIn: firstCheckIn.get(a.employeeId) ?? a.actualStartDateTime ?? null,
    checkOut:
      lastCheckOut.get(a.employeeId) ??
      (input.visitCompleted ? a.actualEndDateTime : null) ??
      null,
  }));
  // Without any per-carer clock-in we cannot tell who is missing (e.g. office-only actuals).
  const anyoneClockedIn = rows.some((r) => r.checkIn != null);

  for (const r of rows) {
    const lateAfter = r.planned.getTime() + toleranceMs;
    const lateArrivalMinutes =
      !input.visitMissed && r.checkIn && r.checkIn.getTime() > lateAfter
        ? Math.round((r.checkIn.getTime() - r.planned.getTime()) / 60_000)
        : null;
    const notClockedIn =
      !input.visitMissed &&
      anyoneClockedIn &&
      r.checkIn == null &&
      input.now.getTime() > lateAfter;
    result.set(r.employeeId, {
      plannedStartDateTime: r.planned,
      checkInAt: r.checkIn,
      checkOutAt: r.checkOut,
      lateArrivalMinutes,
      notClockedIn,
    });
  }
  return result;
}
