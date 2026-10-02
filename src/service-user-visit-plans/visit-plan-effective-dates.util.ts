import { parseVisitPlanDateOnly } from './visit-plan-pause.util';
import { operationalTodayIso } from '../common/utils/operational-day.util';

/**
 * Civil "today" as UTC midnight of the organisation operational calendar date.
 * `timeZone` must be the organisation timezone (OrganisationGeneralSettings.timezone).
 */
export function visitPlanTodayUtc(now: Date, timeZone: string): Date {
  return parseVisitPlanDateOnly(operationalTodayIso(now, timeZone), 'today');
}

export function parseOptionalVisitPlanDateOnly(
  value: string | undefined | null,
  field: string,
  defaultDate: Date,
): Date {
  if (!value?.trim()) return defaultDate;
  return parseVisitPlanDateOnly(value.trim(), field);
}

export function isCalendarDateBefore(day: Date, ref: Date): boolean {
  return day.getTime() < ref.getTime();
}

export function isCalendarDateAfter(day: Date, ref: Date): boolean {
  return day.getTime() > ref.getTime();
}

export function assertRetrospectiveReasonWhenBackdated(
  effectiveDay: Date,
  today: Date,
  retrospectiveReason: string | undefined | null,
): string {
  if (isCalendarDateBefore(effectiveDay, today) && !retrospectiveReason?.trim()) {
    throw new Error('retrospectiveReason is required when the effective date is in the past');
  }
  return retrospectiveReason?.trim() ?? '';
}
