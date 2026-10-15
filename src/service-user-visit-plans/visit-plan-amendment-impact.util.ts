import { combineOperationalDateAndHm, operationalTodayIso } from '../common/utils/operational-day.util';
import { wallClockVisitEnd } from './visit-plan-slot-window.util';

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

    if (beforeSlot.isEnabled && !afterSlot.isEnabled) {
      actions.push({ type: 'cancel_slot_disabled', visitPlanSlotId: slotId, slotLabel: label });
      continue;
    }

    if (!afterSlot.isEnabled) continue;

    const removedWeekdays = beforeSlot.daysOfWeek.filter((d) => !afterSlot.daysOfWeek.includes(d));
    if (removedWeekdays.length) {
      actions.push({
        type: 'cancel_weekdays_removed',
        visitPlanSlotId: slotId,
        slotLabel: label,
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
            exceptionDate: ex.exceptionDate.slice(0, 10),
          });
        }
      }
    }
  }

  return actions;
}

/** Apply HH:MM (or HH:MM:SS) to a UTC calendar day from an existing job start. */
export function applyTimeToUtcDay(jobStart: Date, timeStr: string): Date {
  const [h, m, s] = timeStr.split(':').map((p) => Number(p) || 0);
  return new Date(
    Date.UTC(
      jobStart.getUTCFullYear(),
      jobStart.getUTCMonth(),
      jobStart.getUTCDate(),
      h,
      m,
      s || 0,
      0,
    ),
  );
}

export function resolveEndFromStartAndTimes(
  jobStart: Date,
  startTime: string,
  endTime: string,
): { start: Date; end: Date } {
  const start = applyTimeToUtcDay(jobStart, startTime);
  let end = applyTimeToUtcDay(jobStart, endTime);
  if (end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + 86400000);
  }
  return { start, end };
}

/**
 * New start/end for a rota visit when its plan time changes: `startTime` / `endTime` are
 * wall-clock times in the organisation timezone, applied on the visit's own operational day.
 * (Applying them as UTC moved visits an hour late during British Summer Time.)
 */
export function resolveOperationalStartEnd(
  jobStart: Date,
  startTime: string,
  endTime: string,
  timeZone: string,
): { start: Date; end: Date } {
  const hm = (value: string) => value.slice(0, 5);
  const dayIso = operationalTodayIso(jobStart, timeZone);
  const start = combineOperationalDateAndHm(dayIso, hm(startTime), timeZone);
  // An end at or before the start is on the next day, at that clock time (right on clock-change nights too).
  const end = wallClockVisitEnd(dayIso, hm(startTime), hm(endTime), timeZone);
  return { start, end };
}
