import {
  visitPlanCarerEmployeeIds,
  visitPlanCarerSyncFromDateTime,
} from './visit-plan-slot-carer-sync.util';

describe('visit-plan-slot-carer-sync.util', () => {
  describe('visitPlanCarerEmployeeIds', () => {
    it('prefers carer windows over legacy assignedEmployeeIds', () => {
      expect(
        visitPlanCarerEmployeeIds(
          [{ employeeId: 'window-id' }],
          ['legacy-id'],
          1,
        ),
      ).toEqual(['window-id']);
    });

    it('falls back to assignedEmployeeIds when carer windows are empty', () => {
      expect(visitPlanCarerEmployeeIds([], ['legacy-id', 'extra-id'], 1)).toEqual(['legacy-id']);
    });
  });

  describe('visitPlanCarerSyncFromDateTime', () => {
    it('uses start of the requested UTC day when fromDate is provided', () => {
      expect(visitPlanCarerSyncFromDateTime('2026-06-19').toISOString()).toBe('2026-06-19T00:00:00.000Z');
    });
  });
});
