import { MedicationSchedulePattern } from '@prisma/client';
import {
  dueTimeFallsInHmWindow,
  parseHmToMinutes,
} from '../service-user-visit-plans/visit-medication-window.util';
import {
  resolveSchedulePattern,
  scheduleAppliesOnDay,
} from './medication-schedule-applies.util';

/** Medication columns needed to decide whether a dose is due on a visit day. */
export const VISIT_DUE_MEDICATION_SELECT = {
  startDate: true,
  endDate: true,
  schedulePattern: true,
  frequencyIntervalDays: true,
  monthlyDayOfMonth: true,
  monthlyAnchorToStartDate: true,
} as const;

export type VisitDueMedication = {
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  schedulePattern?: MedicationSchedulePattern | null;
  frequencyIntervalDays?: number | null;
  monthlyDayOfMonth?: number | null;
  monthlyAnchorToStartDate?: boolean | null;
};

export type VisitDueSchedule = {
  dueTime: string | null;
  daysOfWeek?: string[] | null;
};

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar date (YYYY-MM-DD) of a stored date-only column; any time part is ignored. */
function storedDayKey(value: Date | string | null | undefined): string | null {
  return toDate(value)?.toISOString().slice(0, 10) ?? null;
}

function addDaysToDayKey(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Calendar day a dose falls on for a visit. On an overnight visit (e.g. 22:00–06:00)
 * a due time before the visit start belongs to the next day.
 */
export function resolveDoseDayKey(
  visitDayKey: string,
  dueTime: string | null | undefined,
  window: { startHm: string; endHm: string },
): string {
  const due = parseHmToMinutes(dueTime);
  const start = parseHmToMinutes(window.startHm);
  const end = parseHmToMinutes(window.endHm);
  if (due == null || start == null || end == null) return visitDayKey;
  return end < start && due < start ? addDaysToDayKey(visitDayKey, 1) : visitDayKey;
}

/** Start and end dates are both inclusive, matching the office MAR chart. */
export function medicationActiveOnDayKey(med: VisitDueMedication, dayKey: string): boolean {
  const startKey = storedDayKey(med.startDate);
  if (startKey && startKey > dayKey) return false;
  const endKey = storedDayKey(med.endDate);
  if (endKey && endKey < dayKey) return false;
  return true;
}

/**
 * True when this administration time is due inside the visit window on the visit day:
 * the due time is in the window, the medicine is within its start/end dates, and the
 * pattern (daily / every N days / weekly / monthly) lands on that day.
 */
export function medicationScheduleDueOnVisit(input: {
  medication: VisitDueMedication;
  schedule: VisitDueSchedule;
  /** Weekdays from the medicine's other time slots, used when this slot has none. */
  medicationDaysOfWeek?: string[];
  /** Visit calendar day (YYYY-MM-DD) in the organisation timezone. */
  visitDayKey: string;
  window: { startHm: string; endHm: string };
}): boolean {
  const { medication, schedule, visitDayKey, window } = input;
  if (!dueTimeFallsInHmWindow(schedule.dueTime, window.startHm, window.endHm)) return false;
  if (!DAY_KEY_RE.test(visitDayKey)) return true;

  const doseDayKey = resolveDoseDayKey(visitDayKey, schedule.dueTime, window);
  if (!medicationActiveOnDayKey(medication, doseDayKey)) return false;

  const daysOfWeek = schedule.daysOfWeek?.length
    ? schedule.daysOfWeek
    : (input.medicationDaysOfWeek ?? []);
  const frequencyIntervalDays = Math.max(1, medication.frequencyIntervalDays ?? 1);
  const pattern = resolveSchedulePattern(
    medication.schedulePattern ?? null,
    daysOfWeek,
    frequencyIntervalDays,
  );
  // A weekly medicine saved with no weekday cannot be placed on a day. Keep it
  // visible every day rather than hide a dose the carer may need to give.
  if (pattern === MedicationSchedulePattern.WEEKLY && daysOfWeek.length === 0) return true;

  return scheduleAppliesOnDay({
    dayDate: new Date(`${doseDayKey}T00:00:00.000Z`),
    medicationStartDate: toDate(medication.startDate),
    schedulePattern: medication.schedulePattern ?? null,
    frequencyIntervalDays,
    daysOfWeek,
    monthlyDayOfMonth: medication.monthlyDayOfMonth ?? null,
    monthlyAnchorToStartDate: medication.monthlyAnchorToStartDate ?? true,
  });
}

/** Schedules of one medicine that are due on this visit (see `medicationScheduleDueOnVisit`). */
export function filterSchedulesDueOnVisit<S extends VisitDueSchedule>(
  medication: VisitDueMedication & { schedules: S[] },
  visitDayKey: string,
  window: { startHm: string; endHm: string },
): S[] {
  const medicationDaysOfWeek = [
    ...new Set(medication.schedules.flatMap((s) => s.daysOfWeek ?? [])),
  ];
  return medication.schedules.filter((schedule) =>
    medicationScheduleDueOnVisit({
      medication,
      schedule,
      medicationDaysOfWeek,
      visitDayKey,
      window,
    }),
  );
}
