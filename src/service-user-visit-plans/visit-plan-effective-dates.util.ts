import { parseVisitPlanDateOnly } from './visit-plan-pause.util';

export function visitPlanTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
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
