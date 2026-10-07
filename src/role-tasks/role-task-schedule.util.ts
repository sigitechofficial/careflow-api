import { RoleTaskRecurrence } from '@prisma/client';
import { addDaysToOperationalIso } from '../common/utils/operational-day.util';

export type RoleTaskSchedule = {
  recurrence: RoleTaskRecurrence;
  /** YYYY-MM-DD — due date (one-off) or first possible due date (repeating). */
  startDate: string;
  weekday: number | null;
  dayOfMonth: number | null;
};

function lastDayOfMonth(iso: string): number {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isDue(schedule: RoleTaskSchedule, iso: string): boolean {
  switch (schedule.recurrence) {
    case RoleTaskRecurrence.DAILY:
      return true;
    case RoleTaskRecurrence.WEEKLY:
      return new Date(`${iso}T12:00:00.000Z`).getUTCDay() === schedule.weekday;
    case RoleTaskRecurrence.MONTHLY: {
      const day = Number(iso.slice(8, 10));
      return day === Math.min(schedule.dayOfMonth ?? 1, lastDayOfMonth(iso));
    }
    default:
      return iso === schedule.startDate;
  }
}

/**
 * Due dates (YYYY-MM-DD, inclusive range) for a role task schedule. Never before
 * `startDate`; capped at `limit` so a long-unopened daily task cannot explode.
 */
export function roleTaskDueDates(
  schedule: RoleTaskSchedule,
  from: string,
  until: string,
  limit = 62,
): string[] {
  const out: string[] = [];
  let day = from > schedule.startDate ? from : schedule.startDate;
  while (day <= until && out.length < limit) {
    if (isDue(schedule, day)) out.push(day);
    day = addDaysToOperationalIso(day, 1);
  }
  return out;
}

/** How far ahead a repeating task appears in "My tasks" (days). */
export function roleTaskLookaheadDays(recurrence: RoleTaskRecurrence): number {
  return recurrence === RoleTaskRecurrence.WEEKLY ||
    recurrence === RoleTaskRecurrence.MONTHLY
    ? 6
    : 0;
}
