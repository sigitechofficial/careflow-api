import {
  VisitPlanSlotCarerRole,
  VisitPlanSlotExceptionType,
  type VisitPlanSlot,
  type VisitPlanSlotCarerAssignment,
  type VisitPlanSlotException,
} from '@prisma/client';
import {
  findExtraException,
  resolveCarerAssignmentsForDay,
  visitPlanSlotOccurrenceOnDay,
  type VisitPlanSlotCarerAssignmentShape,
  type VisitPlanSlotExceptionShape,
} from './visit-plan-slot-carer-resolve.util';
import {
  envelopeWindow,
  resolveCarerWindows,
  resolveSlotVisitWindow,
  type ResolvedCarerWindow,
} from './visit-plan-slot-window.util';
import type { VisitPlanSlotScheduleShape } from './visit-plan-schedule-match.util';

export type SlotWithRelations = VisitPlanSlot & {
  carerAssignments?: VisitPlanSlotCarerAssignment[];
  exceptions?: VisitPlanSlotException[];
};

export type GeneratedOccurrence = {
  start: Date;
  end: Date;
  durationMinutes: number;
  requiredCarers: number;
  carerWindows: ResolvedCarerWindow[];
  isOvernight: boolean;
  isExtra: boolean;
};

function mapExceptions(rows: VisitPlanSlotException[] | undefined): VisitPlanSlotExceptionShape[] {
  return (rows ?? []).map((ex) => ({
    exceptionDate: ex.exceptionDate,
    exceptionType: ex.exceptionType,
  }));
}

function mapAssignments(rows: VisitPlanSlotCarerAssignment[] | undefined): VisitPlanSlotCarerAssignmentShape[] {
  return (rows ?? []).map((a) => ({
    dayOfWeek: a.dayOfWeek,
    employeeId: a.employeeId,
    role: a.role,
    durationMinutes: a.durationMinutes,
    plannedStartTime: a.plannedStartTime,
    plannedEndTime: a.plannedEndTime,
    sortOrder: a.sortOrder,
  }));
}

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function findExtraRow(slot: SlotWithRelations, day: Date): VisitPlanSlotException | null {
  return (
    slot.exceptions?.find(
      (ex) => ex.exceptionType === VisitPlanSlotExceptionType.EXTRA && utcDateKey(ex.exceptionDate) === utcDateKey(day),
    ) ?? null
  );
}

export function buildVisitPlanOccurrence(
  slot: SlotWithRelations,
  day: Date,
  planAnchor: Date,
  planEffectiveTo: Date | null,
): GeneratedOccurrence | null {
  const exceptions = mapExceptions(slot.exceptions);
  const extraRow = findExtraRow(slot, day);

  const scheduleShape: VisitPlanSlotScheduleShape = {
    slotCode: slot.slotCode,
    daysOfWeek: slot.daysOfWeek,
    scheduleFrequency: slot.scheduleFrequency,
    repeatEvery: slot.repeatEvery,
    monthlyDayMode: slot.monthlyDayMode,
    monthlyDaysOfMonth: slot.monthlyDaysOfMonth,
    monthlyPatternOrdinal: slot.monthlyPatternOrdinal,
    monthlyPatternWeekday: slot.monthlyPatternWeekday,
  };

  const shouldOccur =
    extraRow != null ||
    visitPlanSlotOccurrenceOnDay({
      slot: {
        ...scheduleShape,
        slotKind: slot.slotKind,
        slotEffectiveFrom: slot.slotEffectiveFrom,
        slotEffectiveTo: slot.slotEffectiveTo,
        oneOffDate: slot.oneOffDate,
        isEnabled: slot.isEnabled,
      },
      day,
      planAnchor,
      planEffectiveTo,
      exceptions,
    });

  if (!shouldOccur) return null;

  const requiredCarers = extraRow?.requiredCarers ?? slot.requiredCarers;

  const slotWindowInput = {
    plannedStartTime: extraRow?.plannedStartTime ?? slot.plannedStartTime,
    plannedEndTime: extraRow?.plannedEndTime ?? slot.plannedEndTime,
    durationMinutes: extraRow?.durationMinutes ?? slot.durationMinutes,
    slotKind: slot.slotKind,
  };

  const assignments = resolveCarerAssignmentsForDay(
    mapAssignments(slot.carerAssignments),
    day.getUTCDay(),
    requiredCarers,
    slot.assignedEmployeeIds ?? [],
  );

  const carerWindows = resolveCarerWindows(
    day,
    slotWindowInput,
    assignments.map((a) => ({
      employeeId: a.employeeId,
      role: a.role === VisitPlanSlotCarerRole.LEAD ? 'LEAD' : 'SECONDARY',
      durationMinutes: a.durationMinutes,
      plannedStartTime: a.plannedStartTime,
      plannedEndTime: a.plannedEndTime,
      sortOrder: a.sortOrder,
    })),
  );

  const slotWindow = resolveSlotVisitWindow(day, slotWindowInput);
  const envelope = envelopeWindow(slotWindow, carerWindows);

  return {
    start: envelope.start,
    end: envelope.end,
    durationMinutes: envelope.durationMinutes,
    requiredCarers: Math.max(1, requiredCarers),
    carerWindows,
    isOvernight: envelope.isOvernight,
    isExtra: extraRow != null,
  };
}
