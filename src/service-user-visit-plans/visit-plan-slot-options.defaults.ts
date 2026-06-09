import {
  VisitPlanMonthlyDayMode,
  VisitPlanMonthlyOrdinal,
  VisitPlanRepeatUnit,
  VisitPlanScheduleFrequency,
} from '@prisma/client';

export type VisitPlanSlotLinkFields = {
  linkedCarePlanFormIds: string[];
  assignedEmployeeIds: string[];
};

export const DEFAULT_SLOT_LINK_FIELDS: VisitPlanSlotLinkFields = {
  linkedCarePlanFormIds: [],
  assignedEmployeeIds: [],
};

export type VisitPlanSlotSchedulingOptions = {
  scheduleFrequency: VisitPlanScheduleFrequency;
  repeatEvery: number;
  repeatUnit: VisitPlanRepeatUnit;
  timeCritical: boolean;
  timeToleranceMinutes: number;
  durationMinutes: number | null;
  notesRequired: boolean;
  photoAllowed: boolean;
  shareOutcomeWithFamily: boolean;
  analysisArea: string | null;
  monthlyDayMode: VisitPlanMonthlyDayMode;
  monthlyDaysOfMonth: number[];
  monthlyPatternOrdinal: VisitPlanMonthlyOrdinal | null;
  monthlyPatternWeekday: number | null;
};

export const DEFAULT_SLOT_SCHEDULING_OPTIONS: VisitPlanSlotSchedulingOptions = {
  scheduleFrequency: VisitPlanScheduleFrequency.DAILY,
  repeatEvery: 1,
  repeatUnit: VisitPlanRepeatUnit.DAYS,
  timeCritical: false,
  timeToleranceMinutes: 30,
  durationMinutes: null,
  notesRequired: false,
  photoAllowed: false,
  shareOutcomeWithFamily: false,
  analysisArea: null,
  monthlyDayMode: VisitPlanMonthlyDayMode.BY_DATE,
  monthlyDaysOfMonth: [],
  monthlyPatternOrdinal: VisitPlanMonthlyOrdinal.FIRST,
  monthlyPatternWeekday: 1,
};

export function mergeSlotSchedulingOptions(
  input?: Partial<VisitPlanSlotSchedulingOptions> | null,
): VisitPlanSlotSchedulingOptions {
  return {
    scheduleFrequency: input?.scheduleFrequency ?? DEFAULT_SLOT_SCHEDULING_OPTIONS.scheduleFrequency,
    repeatEvery: input?.repeatEvery ?? DEFAULT_SLOT_SCHEDULING_OPTIONS.repeatEvery,
    repeatUnit: input?.repeatUnit ?? DEFAULT_SLOT_SCHEDULING_OPTIONS.repeatUnit,
    timeCritical: input?.timeCritical ?? DEFAULT_SLOT_SCHEDULING_OPTIONS.timeCritical,
    timeToleranceMinutes:
      input?.timeToleranceMinutes ?? DEFAULT_SLOT_SCHEDULING_OPTIONS.timeToleranceMinutes,
    durationMinutes:
      input?.durationMinutes !== undefined
        ? input.durationMinutes
        : DEFAULT_SLOT_SCHEDULING_OPTIONS.durationMinutes,
    notesRequired: input?.notesRequired ?? DEFAULT_SLOT_SCHEDULING_OPTIONS.notesRequired,
    photoAllowed: input?.photoAllowed ?? DEFAULT_SLOT_SCHEDULING_OPTIONS.photoAllowed,
    shareOutcomeWithFamily:
      input?.shareOutcomeWithFamily ?? DEFAULT_SLOT_SCHEDULING_OPTIONS.shareOutcomeWithFamily,
    analysisArea:
      input?.analysisArea !== undefined ? input.analysisArea : DEFAULT_SLOT_SCHEDULING_OPTIONS.analysisArea,
    monthlyDayMode: input?.monthlyDayMode ?? DEFAULT_SLOT_SCHEDULING_OPTIONS.monthlyDayMode,
    monthlyDaysOfMonth: input?.monthlyDaysOfMonth?.length
      ? [...new Set(input.monthlyDaysOfMonth)].filter((d) => d >= 1 && d <= 31).sort((a, b) => a - b)
      : DEFAULT_SLOT_SCHEDULING_OPTIONS.monthlyDaysOfMonth,
    monthlyPatternOrdinal:
      input?.monthlyPatternOrdinal ?? DEFAULT_SLOT_SCHEDULING_OPTIONS.monthlyPatternOrdinal,
    monthlyPatternWeekday:
      input?.monthlyPatternWeekday !== undefined && input.monthlyPatternWeekday !== null
        ? input.monthlyPatternWeekday
        : DEFAULT_SLOT_SCHEDULING_OPTIONS.monthlyPatternWeekday,
  };
}
