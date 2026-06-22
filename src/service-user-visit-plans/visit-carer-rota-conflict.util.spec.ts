import {
  CARER_ROTA_CONFLICT_MESSAGE,
  filterEmployeeIdsWithoutRotaConflict,
  formatCarerRotaConflictWarning,
  visitWindowFromSchedule,
} from './visit-carer-rota-conflict.util';

describe('visit-carer-rota-conflict.util', () => {
  describe('visitWindowFromSchedule', () => {
    it('uses end time when provided', () => {
      const start = new Date('2026-06-29T09:00:00.000Z');
      const end = new Date('2026-06-29T10:00:00.000Z');
      expect(visitWindowFromSchedule(start, end)).toEqual({ jobStart: start, jobEnd: end });
    });

    it('defaults to one hour when end time is missing', () => {
      const start = new Date('2026-06-29T09:00:00.000Z');
      const { jobStart, jobEnd } = visitWindowFromSchedule(start, null);
      expect(jobStart).toEqual(start);
      expect(jobEnd.getTime() - jobStart.getTime()).toBe(60 * 60 * 1000);
    });
  });

  describe('formatCarerRotaConflictWarning', () => {
    it('returns the standard message with carer name', () => {
      expect(formatCarerRotaConflictWarning('Jane Doe')).toBe(
        `Jane Doe: ${CARER_ROTA_CONFLICT_MESSAGE}`,
      );
    });

    it('includes conflicting job names when provided', () => {
      expect(formatCarerRotaConflictWarning('Jane Doe', ['Morning visit', 'Lunch call'])).toBe(
        `Jane Doe: ${CARER_ROTA_CONFLICT_MESSAGE} (Morning visit, Lunch call)`,
      );
    });
  });

  describe('filterEmployeeIdsWithoutRotaConflict', () => {
    it('excludes double-booked carers and collects warnings', () => {
      const conflicts = new Map([
        ['emp-1', ['Existing visit']],
        ['emp-2', ['Another visit']],
      ]);
      const names = new Map([
        ['emp-1', 'Alice'],
        ['emp-2', 'Bob'],
        ['emp-3', 'Carol'],
      ]);

      const result = filterEmployeeIdsWithoutRotaConflict(
        ['emp-1', 'emp-2', 'emp-3'],
        conflicts,
        names,
      );

      expect(result.employeeIds).toEqual(['emp-3']);
      expect(result.warnings).toEqual([
        `Alice: ${CARER_ROTA_CONFLICT_MESSAGE} (Existing visit)`,
        `Bob: ${CARER_ROTA_CONFLICT_MESSAGE} (Another visit)`,
      ]);
    });
  });
});
