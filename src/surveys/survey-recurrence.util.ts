import { SurveyRecurrence } from '@prisma/client';

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Advance one recurrence step from `from` (UTC calendar math). */
export function addSurveyRecurrence(from: Date, recurrence: SurveyRecurrence): Date {
  const next = new Date(from.getTime());
  switch (recurrence) {
    case SurveyRecurrence.WEEKLY:
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case SurveyRecurrence.MONTHLY:
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case SurveyRecurrence.QUARTERLY:
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case SurveyRecurrence.YEARLY:
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    default:
      break;
  }
  return next;
}

/** Keep advancing until the next run is strictly after `now`. */
export function nextSurveyDistributeAt(
  from: Date,
  recurrence: SurveyRecurrence,
  now: Date = new Date(),
): Date {
  let next = addSurveyRecurrence(from, recurrence);
  let guard = 0;
  while (next.getTime() <= now.getTime() && guard < 500) {
    next = addSurveyRecurrence(next, recurrence);
    guard += 1;
  }
  return next;
}

/** Title suffix for a period instance, e.g. "Sep 2026". */
export function surveyPeriodLabel(at: Date, recurrence: SurveyRecurrence): string {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  const d = at.getUTCDate();
  switch (recurrence) {
    case SurveyRecurrence.WEEKLY:
      return `${MONTH_NAMES[m]} ${d}, ${y}`;
    case SurveyRecurrence.MONTHLY:
      return `${MONTH_NAMES[m]} ${y}`;
    case SurveyRecurrence.QUARTERLY:
      return `Q${Math.floor(m / 3) + 1} ${y}`;
    case SurveyRecurrence.YEARLY:
      return String(y);
    default:
      return `${MONTH_NAMES[m]} ${y}`;
  }
}

export function recurrenceLabel(recurrence: SurveyRecurrence): string {
  switch (recurrence) {
    case SurveyRecurrence.WEEKLY:
      return 'Weekly';
    case SurveyRecurrence.MONTHLY:
      return 'Monthly';
    case SurveyRecurrence.QUARTERLY:
      return 'Quarterly';
    case SurveyRecurrence.YEARLY:
      return 'Yearly';
    default:
      return 'Recurring';
  }
}
