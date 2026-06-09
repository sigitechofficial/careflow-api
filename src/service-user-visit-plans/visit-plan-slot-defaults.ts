import { VisitPlanSlotCode } from '@prisma/client';
import { DEFAULT_DOM_CARE_SHIFT_DEFINITIONS } from '../organisation-general-settings/dom-care-shifts.util';
import {
  DEFAULT_SLOT_SCHEDULING_OPTIONS,
  mergeSlotSchedulingOptions,
} from './visit-plan-slot-options.defaults';

export const VISIT_PLAN_SLOT_ORDER: VisitPlanSlotCode[] = [
  'MORNING',
  'LUNCH',
  'TEA',
  'EVENING',
  'NIGHT',
];

const SLOT_TO_SHIFT_NAME: Record<VisitPlanSlotCode, string> = {
  MORNING: 'Morning Call',
  LUNCH: 'Lunch Call',
  TEA: 'Tea Call',
  EVENING: 'Evening Call',
  NIGHT: 'Night call',
};

const MED_ROUND_TO_SLOT: Record<string, VisitPlanSlotCode> = {
  MORNING: 'MORNING',
  MIDDAY: 'LUNCH',
  AFTERNOON: 'TEA',
  EVENING: 'EVENING',
  NIGHT: 'NIGHT',
};

export function slotLabel(code: VisitPlanSlotCode): string {
  return SLOT_TO_SHIFT_NAME[code] ?? code;
}

export function medRoundCodeToSlot(code: string): VisitPlanSlotCode | null {
  return MED_ROUND_TO_SLOT[code.toUpperCase()] ?? null;
}

export function defaultSlotTimes(code: VisitPlanSlotCode): { start: string; end: string; sortOrder: number } {
  const shiftName = SLOT_TO_SHIFT_NAME[code];
  const shift = DEFAULT_DOM_CARE_SHIFT_DEFINITIONS.find((s) => s.name === shiftName);
  if (!shift) {
    return { start: '08:00', end: '09:00', sortOrder: VISIT_PLAN_SLOT_ORDER.indexOf(code) };
  }
  return {
    start: shift.fromTime,
    end: shift.endsNextDay ? '07:00' : shift.toTime,
    sortOrder: shift.sortOrder,
  };
}

export function defaultVisitPlanSlots(): Array<{
  slotCode: VisitPlanSlotCode;
  daysOfWeek: number[];
  plannedStartTime: string;
  plannedEndTime: string;
  requiredCarers: number;
  isEnabled: boolean;
  medicationRoundCode: string | null;
  notes: string;
  sortOrder: number;
} & typeof DEFAULT_SLOT_SCHEDULING_OPTIONS> {
  return VISIT_PLAN_SLOT_ORDER.map((slotCode) => {
    const times = defaultSlotTimes(slotCode);
    return {
      slotCode,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 0],
      plannedStartTime: times.start,
      plannedEndTime: times.end,
      requiredCarers: 1,
      isEnabled: false,
      medicationRoundCode: null,
      notes: '',
      sortOrder: times.sortOrder,
      ...mergeSlotSchedulingOptions(null),
    };
  });
}

export const ALL_WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
