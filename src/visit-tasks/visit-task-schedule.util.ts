import {
  VisitPlanMonthlyDayMode,
  VisitPlanMonthlyOrdinal,
  VisitPlanRepeatUnit,
  VisitPlanScheduleFrequency,
} from '@prisma/client';
import {
  visitPlanSlotMatchesDay,
  type VisitPlanSlotScheduleShape,
} from '../service-user-visit-plans/visit-plan-schedule-match.util';

export type VisitTaskScheduleShape = {
  daysOfWeek: number[];
  scheduleFrequency: VisitPlanScheduleFrequency;
  repeatEvery: number;
  repeatUnit: VisitPlanRepeatUnit;
  timeCritical: boolean;
  timeToleranceMinutes: number;
  monthlyDayMode: VisitPlanMonthlyDayMode;
  monthlyDaysOfMonth: number[];
  monthlyPatternOrdinal: VisitPlanMonthlyOrdinal | null;
  monthlyPatternWeekday: number | null;
};

export const DEFAULT_VISIT_TASK_SCHEDULE: VisitTaskScheduleShape = {
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  scheduleFrequency: VisitPlanScheduleFrequency.DAILY,
  repeatEvery: 1,
  repeatUnit: VisitPlanRepeatUnit.DAYS,
  timeCritical: false,
  timeToleranceMinutes: 30,
  monthlyDayMode: VisitPlanMonthlyDayMode.BY_DATE,
  monthlyDaysOfMonth: [],
  monthlyPatternOrdinal: VisitPlanMonthlyOrdinal.FIRST,
  monthlyPatternWeekday: 1,
};

function normalizeDaysOfWeek(days: number[] | null | undefined): number[] {
  if (!Array.isArray(days) || days.length === 0) {
    return [...DEFAULT_VISIT_TASK_SCHEDULE.daysOfWeek];
  }
  return [...new Set(days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
}

function normalizeMonthlyDays(days: number[] | null | undefined): number[] {
  if (!Array.isArray(days) || days.length === 0) return [];
  return [...new Set(days.filter((d) => d >= 1 && d <= 31))].sort((a, b) => a - b);
}

export function mergeVisitTaskSchedule(
  input?: Partial<VisitTaskScheduleShape> | null,
): VisitTaskScheduleShape {
  const frequency = input?.scheduleFrequency ?? DEFAULT_VISIT_TASK_SCHEDULE.scheduleFrequency;
  const repeatUnit =
    input?.repeatUnit ??
    (frequency === VisitPlanScheduleFrequency.MONTHLY
      ? VisitPlanRepeatUnit.MONTHS
      : frequency === VisitPlanScheduleFrequency.WEEKLY
        ? VisitPlanRepeatUnit.WEEKS
        : VisitPlanRepeatUnit.DAYS);

  return {
    daysOfWeek: normalizeDaysOfWeek(input?.daysOfWeek),
    scheduleFrequency: frequency,
    repeatEvery: Math.max(1, Math.min(365, Number(input?.repeatEvery) || 1)),
    repeatUnit,
    timeCritical: input?.timeCritical ?? DEFAULT_VISIT_TASK_SCHEDULE.timeCritical,
    timeToleranceMinutes: Math.max(
      0,
      Math.min(240, Number(input?.timeToleranceMinutes) ?? DEFAULT_VISIT_TASK_SCHEDULE.timeToleranceMinutes),
    ),
    monthlyDayMode: input?.monthlyDayMode ?? DEFAULT_VISIT_TASK_SCHEDULE.monthlyDayMode,
    monthlyDaysOfMonth: normalizeMonthlyDays(input?.monthlyDaysOfMonth),
    monthlyPatternOrdinal:
      input?.monthlyPatternOrdinal ?? DEFAULT_VISIT_TASK_SCHEDULE.monthlyPatternOrdinal,
    monthlyPatternWeekday:
      input?.monthlyPatternWeekday !== undefined && input.monthlyPatternWeekday !== null
        ? input.monthlyPatternWeekday
        : DEFAULT_VISIT_TASK_SCHEDULE.monthlyPatternWeekday,
  };
}

/** Whether this planned task is due on the visit calendar day (UTC). */
export function visitTaskMatchesDay(
  schedule: VisitTaskScheduleShape,
  day: Date,
  anchor: Date = day,
): boolean {
  const shape: VisitPlanSlotScheduleShape = {
    slotCode: 'visit-task',
    daysOfWeek: schedule.daysOfWeek.length
      ? schedule.daysOfWeek
      : DEFAULT_VISIT_TASK_SCHEDULE.daysOfWeek,
    scheduleFrequency: schedule.scheduleFrequency,
    repeatEvery: schedule.repeatEvery,
    monthlyDayMode: schedule.monthlyDayMode,
    monthlyDaysOfMonth: schedule.monthlyDaysOfMonth,
    monthlyPatternOrdinal: schedule.monthlyPatternOrdinal,
    monthlyPatternWeekday: schedule.monthlyPatternWeekday,
  };
  return visitPlanSlotMatchesDay(shape, day, anchor);
}

export function pickScheduleFromAssignment(row: {
  daysOfWeek: number[];
  scheduleFrequency: VisitPlanScheduleFrequency;
  repeatEvery: number;
  repeatUnit: VisitPlanRepeatUnit;
  timeCritical: boolean;
  timeToleranceMinutes: number;
  monthlyDayMode: VisitPlanMonthlyDayMode;
  monthlyDaysOfMonth: number[];
  monthlyPatternOrdinal: VisitPlanMonthlyOrdinal | null;
  monthlyPatternWeekday: number | null;
}): VisitTaskScheduleShape {
  return mergeVisitTaskSchedule(row);
}
