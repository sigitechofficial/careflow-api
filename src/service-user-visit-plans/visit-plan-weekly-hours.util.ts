import { VisitPlanNightDuty } from '@prisma/client';
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
