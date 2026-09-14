import { parseVisitPlanDateOnly } from './visit-plan-pause.util';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  operationalTodayIso,
} from '../common/utils/operational-day.util';

/** Civil "today" as UTC midnight of the organisation operational calendar date. */
export function visitPlanTodayUtc(
  now = new Date(),
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): Date {
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
