import {
  assertRetrospectiveReasonWhenBackdated,
  isCalendarDateAfter,
  isCalendarDateBefore,
  parseOptionalVisitPlanDateOnly,
  visitPlanTodayUtc,
} from './visit-plan-effective-dates.util';

describe('visit-plan-effective-dates.util', () => {
  const today = visitPlanTodayUtc();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  it('parseOptionalVisitPlanDateOnly defaults when empty', () => {
    expect(parseOptionalVisitPlanDateOnly('', 'effectiveTo', today).getTime()).toBe(today.getTime());
  });

  it('isCalendarDateBefore / After', () => {
    expect(isCalendarDateBefore(yesterday, today)).toBe(true);
    expect(isCalendarDateAfter(tomorrow, today)).toBe(true);
  });

  it('assertRetrospectiveReasonWhenBackdated requires reason for past dates', () => {
    expect(() => assertRetrospectiveReasonWhenBackdated(yesterday, today, '')).toThrow(
      'retrospectiveReason is required',
    );
    expect(assertRetrospectiveReasonWhenBackdated(yesterday, today, 'Discovered on ward round')).toBe(
      'Discovered on ward round',
    );
    expect(assertRetrospectiveReasonWhenBackdated(today, today, '')).toBe('');
  });
});
