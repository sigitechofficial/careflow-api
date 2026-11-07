import {
  BACKFILL_DAYS_CEILING,
  clampOrgMaxBackfillDays,
  maxAllowedBackfillDays,
} from './visit-plan-slot-carer-resolve.util';

describe('visit-plan-slot-carer-resolve.util backfill limits', () => {
  describe('maxAllowedBackfillDays', () => {
    it('lets a slot left at 0 use the organisation limit', () => {
      expect(maxAllowedBackfillDays(0, 5, 14)).toBe(5);
      expect(maxAllowedBackfillDays(0, 20, 14)).toBe(14);
    });

    it('caps by the slot when the slot sets its own Max backfill days', () => {
      expect(maxAllowedBackfillDays(3, 10, 14)).toBe(3);
      expect(maxAllowedBackfillDays(30, 10, 14)).toBe(10);
    });

    it('returns 0 when backfill is off for the organisation or not requested', () => {
      expect(maxAllowedBackfillDays(7, 5, 0)).toBe(0);
      expect(maxAllowedBackfillDays(7, 0, 14)).toBe(0);
    });
  });

  describe('clampOrgMaxBackfillDays', () => {
    it('defaults to 14 and keeps the value within 0..ceiling', () => {
      expect(clampOrgMaxBackfillDays(undefined)).toBe(14);
      expect(clampOrgMaxBackfillDays(-3)).toBe(0);
      expect(clampOrgMaxBackfillDays(500)).toBe(BACKFILL_DAYS_CEILING);
      expect(clampOrgMaxBackfillDays(7.8)).toBe(7);
    });
  });
});
