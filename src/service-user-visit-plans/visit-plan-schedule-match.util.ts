import {
  VisitPlanMonthlyDayMode,
  VisitPlanMonthlyOrdinal,
  VisitPlanScheduleFrequency,
} from '@prisma/client';

export type VisitPlanSlotScheduleShape = {
  slotCode: string;
  daysOfWeek: number[];
  scheduleFrequency: VisitPlanScheduleFrequency;
  repeatEvery: number;
  monthlyDayMode: VisitPlanMonthlyDayMode;
  monthlyDaysOfMonth: number[];
  monthlyPatternOrdinal: VisitPlanMonthlyOrdinal | null;
  monthlyPatternWeekday: number | null;
};

const DAY_MS = 86400000;

function utcMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

function weekdayOccurrencesInMonth(year: number, month: number, weekday: number): number[] {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const hits: number[] = [];
  for (let dom = 1; dom <= daysInMonth; dom++) {
    const d = new Date(Date.UTC(year, month, dom));
    if (d.getUTCDay() === weekday) hits.push(dom);
  }
  return hits;
}

function matchesMonthlyPattern(
  day: Date,
  ordinal: VisitPlanMonthlyOrdinal,
  weekday: number,
): boolean {
  const dom = day.getUTCDate();
  const occurrences = weekdayOccurrencesInMonth(day.getUTCFullYear(), day.getUTCMonth(), weekday);
  if (!occurrences.length) return false;
  if (ordinal === VisitPlanMonthlyOrdinal.LAST) {
    return dom === occurrences[occurrences.length - 1];
  }
  const index = {
    [VisitPlanMonthlyOrdinal.FIRST]: 0,
    [VisitPlanMonthlyOrdinal.SECOND]: 1,
    [VisitPlanMonthlyOrdinal.THIRD]: 2,
    [VisitPlanMonthlyOrdinal.FOURTH]: 3,
  }[ordinal];
  return index !== undefined && occurrences[index] === dom;
}

/** Whether a calendar day matches the slot's recurrence rules. */
export function visitPlanSlotMatchesDay(
  slot: VisitPlanSlotScheduleShape,
  day: Date,
  anchor: Date,
): boolean {
  const dow = day.getUTCDay();

  if (slot.scheduleFrequency === VisitPlanScheduleFrequency.MONTHLY) {
    const every = Math.max(1, slot.repeatEvery);
    const monthDiff = monthsBetween(utcMonthStart(anchor), utcMonthStart(day));
    if (monthDiff < 0 || monthDiff % every !== 0) return false;

    if (slot.monthlyDayMode === VisitPlanMonthlyDayMode.BY_DATE) {
      return slot.monthlyDaysOfMonth.includes(day.getUTCDate());
    }
    if (
      slot.monthlyDayMode === VisitPlanMonthlyDayMode.BY_PATTERN &&
      slot.monthlyPatternOrdinal != null &&
      slot.monthlyPatternWeekday != null
    ) {
      return matchesMonthlyPattern(day, slot.monthlyPatternOrdinal, slot.monthlyPatternWeekday);
    }
    return false;
  }

  if (slot.scheduleFrequency === VisitPlanScheduleFrequency.WEEKLY) {
    if (!slot.daysOfWeek.includes(dow)) return false;
    const every = Math.max(1, slot.repeatEvery);
    if (every === 1) return true;
    const anchorWeek = Math.floor(anchor.getTime() / DAY_MS / 7);
    const dayWeek = Math.floor(day.getTime() / DAY_MS / 7);
    const weekDiff = dayWeek - anchorWeek;
    return weekDiff >= 0 && weekDiff % every === 0;
  }

  // DAILY (default): optional repeat-every-N-days + days-of-week filter
  if (!slot.daysOfWeek.includes(dow)) return false;
  const every = Math.max(1, slot.repeatEvery);
  if (every === 1) return true;
  const daysDiff = Math.floor((day.getTime() - anchor.getTime()) / DAY_MS);
  return daysDiff >= 0 && daysDiff % every === 0;
}
