import {
  computeReviewNextDue,
  deriveReviewStatus,
  withDerivedReviewStatus,
} from './employee-review-schedule.util';

describe('employee-review-schedule.util', () => {
  const now = new Date('2026-11-04T10:00:00.000Z');

  describe('computeReviewNextDue', () => {
    it('adds the review type interval to last done (supervision every 90 days)', () => {
      const next = computeReviewNextDue(new Date('2026-11-04T12:00:00.000Z'), 90);
      expect(next?.toISOString().slice(0, 10)).toBe('2027-02-02');
    });

    it('returns null without a last done date or interval', () => {
      expect(computeReviewNextDue(null, 90)).toBeNull();
      expect(computeReviewNextDue(new Date(), null)).toBeNull();
      expect(computeReviewNextDue(new Date(), 0)).toBeNull();
    });
  });

  describe('deriveReviewStatus', () => {
    it('is OVERDUE once the due day has passed', () => {
      expect(deriveReviewStatus({ nextDue: new Date('2026-11-03T12:00:00.000Z') }, now)).toBe('OVERDUE');
    });

    it('is DUE_SOON on the due day and within 14 days', () => {
      expect(deriveReviewStatus({ nextDue: new Date('2026-11-04T23:00:00.000Z') }, now)).toBe('DUE_SOON');
      expect(deriveReviewStatus({ nextDue: new Date('2026-11-18T12:00:00.000Z') }, now)).toBe('DUE_SOON');
    });

    it('is SCHEDULED further ahead', () => {
      expect(deriveReviewStatus({ nextDue: new Date('2026-11-19T12:00:00.000Z') }, now)).toBe('SCHEDULED');
    });

    it('is COMPLETED for a done one-off review and null when nothing is set', () => {
      expect(deriveReviewStatus({ lastDone: new Date('2026-10-01'), nextDue: null }, now)).toBe('COMPLETED');
      expect(deriveReviewStatus({}, now)).toBeNull();
    });
  });

  it('withDerivedReviewStatus replaces a stale stored status', () => {
    const row = { lastDone: null, nextDue: new Date('2026-10-01T12:00:00.000Z'), status: 'SCHEDULED' };
    expect(withDerivedReviewStatus(row, now).status).toBe('OVERDUE');
  });
});
