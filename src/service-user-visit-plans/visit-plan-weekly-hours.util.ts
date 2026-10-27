import { VisitPlanNightDuty, VisitPlanSlotExceptionType } from '@prisma/client';
import {
  buildVisitPlanOccurrence,
  type SlotWithRelations,
} from './visit-plan-generate-occurrence.util';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
} from '../common/utils/operational-day.util';

/** How a double-up visit counts: every carer's time (COMBINED) or the visit window once (FIXED). */
export type MultiCarerHoursMode = 'COMBINED' | 'FIXED';

/** Weeks ahead checked, so every-2-weeks and monthly visits are always included. */
export const VISIT_PLAN_HOURS_CHECK_WEEKS = 12;

export type VisitPlanWeekHours = {
  /** Monday of the week (org timezone), YYYY-MM-DD. */
  weekStart: string;
  /** Visit hours counted against the service user's weekly contracted hours. */
  minutes: number;
  visits: number;
  /** Sleeping nights (sleep-in) in the week — their hours are included in `minutes`. */
  sleepInNights: number;
};

export type VisitPlanWeeklyHoursSummary = {
  mode: MultiCarerHoursMode;
  weeks: VisitPlanWeekHours[];
  /** The week with the most counted minutes (first one on a tie); null when nothing is planned. */
  heaviestWeek: VisitPlanWeekHours | null;
};

/** An extra visit cancelled through "Cancel visits" keeps its row and gets a SKIP on the same date. */
function isCancelledExtra(slot: SlotWithRelations, dayIso: string): boolean {
  return (slot.exceptions ?? []).some(
    (ex) =>
      ex.exceptionType === VisitPlanSlotExceptionType.SKIP &&
      ex.exceptionDate.toISOString().slice(0, 10) === dayIso,
  );
}

function utcDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function mondayOf(iso: string): string {
  const offset = (utcDay(iso).getUTCDay() + 6) % 7;
  return addDaysToOperationalIso(iso, -offset);
}

/**
 * Planned visit hours per week (Monday–Sunday) for one visit plan, using the same occurrence
 * rules as rota generation: days, every-N-weeks / monthly, slot start/end dates, one-off visits,
 * cancelled dates (SKIP) and extra visits (EXTRA).
 * - Double-up: COMBINED adds each carer's time (a carer not chosen yet counts the visit time);
 *   FIXED counts the visit window once.
 * - Every visit counts its full time, sleeping nights (sleep-in) and waking nights included.
 * - Visits cancelled on the rota are left out when `cancelledOnRota` is given; called-off visits still count.
 * - `additionalMinutesByDay` adds visits outside the plan that count too (special visits).
 */
export function computeVisitPlanWeeklyHours(params: {
  slots: SlotWithRelations[];
  planAnchor: Date;
  planEffectiveTo: Date | null;
  timeZone: string;
  mode: MultiCarerHoursMode;
  /** First day counted (org timezone, YYYY-MM-DD); earlier days of its week are skipped. Defaults to today. */
  fromIso?: string;
  weeks?: number;
  /** "slotId|YYYY-MM-DD" of visits cancelled on the rota: not counted (called-off visits still count). */
  cancelledOnRota?: Set<string>;
  /** Minutes per day (YYYY-MM-DD) from visits outside the plan that also count, e.g. special visits. */
  additionalMinutesByDay?: Map<string, number>;
}): VisitPlanWeeklyHoursSummary {
  const weekCount = params.weeks ?? VISIT_PLAN_HOURS_CHECK_WEEKS;
  const fromIso =
    params.fromIso ?? dayKeyInTimeZone(new Date(), params.timeZone);
  const firstMonday = mondayOf(fromIso);
  const weeks: VisitPlanWeekHours[] = [];

  for (let w = 0; w < weekCount; w++) {
    const weekStart = addDaysToOperationalIso(firstMonday, w * 7);
    const week: VisitPlanWeekHours = {
      weekStart,
      minutes: 0,
      visits: 0,
      sleepInNights: 0,
    };
    for (let d = 0; d < 7; d++) {
      const dayIso = addDaysToOperationalIso(weekStart, d);
      // Days already gone get no new visits from the plan, so they are not counted.
      if (dayIso < fromIso) continue;
      week.minutes += params.additionalMinutesByDay?.get(dayIso) ?? 0;
      const day = utcDay(dayIso);
      for (const slot of params.slots) {
        const occurrence = buildVisitPlanOccurrence(
          slot,
          day,
          params.planAnchor,
          params.planEffectiveTo,
          {
            timeZone: params.timeZone,
          },
        );
        if (!occurrence) continue;
        if (occurrence.isExtra && isCancelledExtra(slot, dayIso)) continue;
        if (params.cancelledOnRota?.has(`${slot.id}|${dayIso}`)) continue;
        week.visits += 1;
        // A sleeping night counts its full hours too; the number of them is kept for display.
        // An extra visit sits on a hidden normal host slot, so it is never seen as a sleep-in here.
        if (
          !occurrence.isExtra &&
          slot.nightDuty === VisitPlanNightDuty.SLEEPING_NIGHT
        ) {
          week.sleepInNights += 1;
        }
        week.minutes += occurrenceMinutes(occurrence, params.mode);
      }
    }
    weeks.push(week);
  }

  const heaviestWeek = weeks.reduce<VisitPlanWeekHours | null>(
    (best, week) =>
      week.minutes > 0 && (!best || week.minutes > best.minutes) ? week : best,
    null,
  );
  return { mode: params.mode, weeks, heaviestWeek };
}

/** Minutes one visit (a slot on a day) counts against the weekly hours; 0 when it does not happen. */
export function visitPlanOccurrenceMinutes(params: {
  slot: SlotWithRelations;
  dayIso: string;
  planAnchor: Date;
  planEffectiveTo: Date | null;
  timeZone: string;
  mode: MultiCarerHoursMode;
  cancelledOnRota?: Set<string>;
}): number {
  const occurrence = buildVisitPlanOccurrence(
    params.slot,
    utcDay(params.dayIso),
    params.planAnchor,
    params.planEffectiveTo,
    { timeZone: params.timeZone },
  );
  if (!occurrence) return 0;
  if (occurrence.isExtra && isCancelledExtra(params.slot, params.dayIso)) return 0;
  if (params.cancelledOnRota?.has(`${params.slot.id}|${params.dayIso}`)) return 0;
  return occurrenceMinutes(occurrence, params.mode);
}

function occurrenceMinutes(
  occurrence: NonNullable<ReturnType<typeof buildVisitPlanOccurrence>>,
  mode: MultiCarerHoursMode,
): number {
  if (mode === 'FIXED') return occurrence.durationMinutes;
  const chosen = occurrence.carerWindows.reduce(
    (sum, w) => sum + w.durationMinutes,
    0,
  );
  const notChosen = Math.max(
    0,
    occurrence.requiredCarers - occurrence.carerWindows.length,
  );
  return chosen + notChosen * occurrence.durationMinutes;
}
