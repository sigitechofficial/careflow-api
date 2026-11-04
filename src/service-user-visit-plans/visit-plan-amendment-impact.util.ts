import {
  addDaysToOperationalIso,
  combineOperationalDateAndHm,
  dayKeyInTimeZone,
} from '../common/utils/operational-day.util';

export type VisitPlanSlotSnapshot = {
  id?: string;
  slotCode: string;
  label?: string;
  daysOfWeek: number[];
  plannedStartTime: string;
  plannedEndTime: string;
  isEnabled: boolean;
  durationMinutes?: number | null;
  exceptions?: Array<{
    id?: string;
    exceptionDate: string;
    exceptionType: 'SKIP' | 'EXTRA';
    notes?: string;
  }>;
};

export type VisitPlanSnapshotShape = {
  slots: VisitPlanSlotSnapshot[];
};

export type AmendmentImpactActionType =
  | 'cancel_slot_disabled'
  | 'cancel_weekdays_removed'
  | 'reschedule_time'
  | 'skip_exception'
  | 'extra_exception'
  | 'carer_sync_info';

export type AmendmentImpactAction = {
  type: AmendmentImpactActionType;
  visitPlanSlotId: string;
  slotLabel: string;
  /** The visit's time before the change (HH:MM), so the change can be named in plain words. */
  startTime?: string;
  endTime?: string;
  removedWeekdays?: number[];
  newStartTime?: string;
  newEndTime?: string;
  exceptionDate?: string;
  jobCount?: number;
};

export function diffVisitPlanSnapshots(
  before: VisitPlanSnapshotShape,
  after: VisitPlanSnapshotShape,
): AmendmentImpactAction[] {
  const actions: AmendmentImpactAction[] = [];
  const beforeByCode = new Map(before.slots.map((s) => [s.slotCode, s]));

  for (const afterSlot of after.slots) {
    const beforeSlot = beforeByCode.get(afterSlot.slotCode);
    if (!beforeSlot) continue;
    const slotId = afterSlot.id ?? beforeSlot.id;
    if (!slotId) continue;
    const label = afterSlot.label ?? beforeSlot.label ?? afterSlot.slotCode;
    const times = { startTime: beforeSlot.plannedStartTime, endTime: beforeSlot.plannedEndTime };

    if (beforeSlot.isEnabled && !afterSlot.isEnabled) {
      actions.push({ type: 'cancel_slot_disabled', visitPlanSlotId: slotId, slotLabel: label, ...times });
      continue;
    }

    if (!afterSlot.isEnabled) continue;

    const removedWeekdays = beforeSlot.daysOfWeek.filter((d) => !afterSlot.daysOfWeek.includes(d));
    if (removedWeekdays.length) {
      actions.push({
        type: 'cancel_weekdays_removed',
        visitPlanSlotId: slotId,
        slotLabel: label,
        ...times,
        removedWeekdays,
      });
    }

    if (
      beforeSlot.plannedStartTime !== afterSlot.plannedStartTime ||
      beforeSlot.plannedEndTime !== afterSlot.plannedEndTime
    ) {
      actions.push({
        type: 'reschedule_time',
        visitPlanSlotId: slotId,
        slotLabel: label,
        ...times,
        newStartTime: afterSlot.plannedStartTime,
        newEndTime: afterSlot.plannedEndTime,
      });
    }

    const beforeSkips = new Set(
      (beforeSlot.exceptions ?? [])
        .filter((e) => e.exceptionType === 'SKIP')
        .map((e) => e.exceptionDate.slice(0, 10)),
    );
    for (const ex of afterSlot.exceptions ?? []) {
      if (ex.exceptionType === 'SKIP' && !beforeSkips.has(ex.exceptionDate.slice(0, 10))) {
        actions.push({
          type: 'skip_exception',
          visitPlanSlotId: slotId,
          slotLabel: label,
          ...times,
          exceptionDate: ex.exceptionDate.slice(0, 10),
        });
      }
      if (ex.exceptionType === 'EXTRA') {
        const beforeExtras = new Set(
          (beforeSlot.exceptions ?? [])
            .filter((e) => e.exceptionType === 'EXTRA')
            .map((e) => e.exceptionDate.slice(0, 10)),
        );
        if (!beforeExtras.has(ex.exceptionDate.slice(0, 10))) {
          actions.push({
            type: 'extra_exception',
            visitPlanSlotId: slotId,
            slotLabel: label,
            ...times,
            exceptionDate: ex.exceptionDate.slice(0, 10),
          });
        }
      }
    }
  }

  return actions;
}

/** Normalise HH:MM or HH:MM:SS to HH:mm. */
function toHm(timeStr: string): string {
  const [h, m] = timeStr.trim().split(':');
  return `${String(Number(h) || 0).padStart(2, '0')}:${String(Number(m) || 0).padStart(2, '0')}`;
}

/**
 * Apply an organisation-local wall-clock HH:MM (or HH:MM:SS) to an operational calendar day,
 * returning the true-UTC instant (DST-aware; e.g. London BST 08:00 → 07:00Z).
 */
export function applyTimeToOperationalDay(dayIso: string, timeStr: string, timeZone: string): Date {
  return combineOperationalDateAndHm(dayIso, toHm(timeStr), timeZone);
}

/**
 * New start/end for an existing (true-UTC) job when a slot's planned times change.
 * The job keeps its organisation-local calendar day; times are wall clock in `timeZone`.
 * End <= start means the visit runs overnight into the next local day.
 */
export function resolveEndFromStartAndTimes(
  jobStart: Date,
  startTime: string,
  endTime: string,
  timeZone: string,
): { start: Date; end: Date } {
  const dayIso = dayKeyInTimeZone(jobStart, timeZone);
  const start = applyTimeToOperationalDay(dayIso, startTime, timeZone);
  let end = applyTimeToOperationalDay(dayIso, endTime, timeZone);
  if (end.getTime() <= start.getTime()) {
    end = applyTimeToOperationalDay(addDaysToOperationalIso(dayIso, 1), endTime, timeZone);
  }
  return { start, end };
}
