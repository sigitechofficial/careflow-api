import {
  assertRetrospectiveReasonWhenBackdated,
  isCalendarDateAfter,
  isCalendarDateBefore,
  parseOptionalVisitPlanDateOnly,
  visitPlanTodayUtc,
} from './visit-plan-effective-dates.util';

describe('visit-plan-effective-dates.util', () => {
  const today = visitPlanTodayUtc(new Date(), 'Europe/London');
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

  describe('visitPlanTodayUtc honours the organisation timezone', () => {
    it('London BST: 23:30 local on 2026-07-15 (22:30Z) is still the 15th', () => {
      const now = new Date('2026-07-15T22:30:00.000Z');
      expect(visitPlanTodayUtc(now, 'Europe/London').toISOString()).toBe('2026-07-15T00:00:00.000Z');
      // Karachi is already on the 16th (03:30 PKT).
      expect(visitPlanTodayUtc(now, 'Asia/Karachi').toISOString()).toBe('2026-07-16T00:00:00.000Z');
    });

    it('London BST: 00:30 local on 2026-07-16 (23:30Z on the 15th) is the 16th', () => {
      const now = new Date('2026-07-15T23:30:00.000Z');
      expect(visitPlanTodayUtc(now, 'Europe/London').toISOString()).toBe('2026-07-16T00:00:00.000Z');
    });

    it('London GMT: 2026-01-15 23:30Z is still the 15th; Karachi is the 16th', () => {
      const now = new Date('2026-01-15T23:30:00.000Z');
      expect(visitPlanTodayUtc(now, 'Europe/London').toISOString()).toBe('2026-01-15T00:00:00.000Z');
      expect(visitPlanTodayUtc(now, 'Asia/Karachi').toISOString()).toBe('2026-01-16T00:00:00.000Z');
    });

    it('DST transition days resolve to the London calendar date', () => {
      // 2026-03-29 00:30Z = 00:30 GMT (before 01:00Z spring-forward)
      expect(visitPlanTodayUtc(new Date('2026-03-29T00:30:00.000Z'), 'Europe/London').toISOString()).toBe(
        '2026-03-29T00:00:00.000Z',
      );
      // 2026-10-24 23:30Z = 00:30 BST on the 25th (fall-back day)
      expect(visitPlanTodayUtc(new Date('2026-10-24T23:30:00.000Z'), 'Europe/London').toISOString()).toBe(
        '2026-10-25T00:00:00.000Z',
      );
    });
  });
});
