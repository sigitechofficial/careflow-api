import {
  addDays,
  auditTiming,
  complianceLevel,
  daysBetween,
  dueDatesBetween,
  monthsFrom,
  nextDueDate,
  nthDueDate,
} from './quality-audit-schedule.util';

describe('audit schedule dates', () => {
  it('adds days and counts the days between two dates', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-11-23', '2026-11-26')).toBe(3);
    expect(daysBetween('2026-11-26', '2026-11-23')).toBe(-3);
  });

  it('steps through weeks, months, quarters, half years and years', () => {
    expect(nthDueDate('2026-11-02', 'WEEKLY', 2)).toBe('2026-11-16');
    expect(nthDueDate('2026-11-15', 'MONTHLY', 3)).toBe('2027-02-15');
    expect(nthDueDate('2026-11-15', 'QUARTERLY', 1)).toBe('2027-02-15');
    expect(nthDueDate('2026-11-15', 'BIANNUAL', 1)).toBe('2027-05-15');
    expect(nthDueDate('2026-11-15', 'ANNUAL', 2)).toBe('2028-11-15');
  });

  it('keeps the day of the month, or uses the last day of a shorter month', () => {
    expect(nthDueDate('2027-01-31', 'MONTHLY', 1)).toBe('2027-02-28');
    expect(nthDueDate('2027-01-31', 'MONTHLY', 2)).toBe('2027-03-31');
  });

  it('finds the next due date after a given day', () => {
    expect(nextDueDate('2026-01-10', 'MONTHLY', null)).toBe('2026-01-10');
    expect(nextDueDate('2026-01-10', 'MONTHLY', '2025-12-01')).toBe(
      '2026-01-10',
    );
    expect(nextDueDate('2026-01-10', 'MONTHLY', '2026-01-10')).toBe(
      '2026-02-10',
    );
    expect(nextDueDate('2026-01-10', 'MONTHLY', '2026-11-23')).toBe(
      '2026-12-10',
    );
    expect(nextDueDate('2026-01-05', 'WEEKLY', '2026-11-23')).toBe(
      '2026-11-30',
    );
  });

  it('lists the due dates in a range', () => {
    expect(
      dueDatesBetween('2026-01-10', 'QUARTERLY', '2026-06-01', '2027-01-31'),
    ).toEqual(['2026-07-10', '2026-10-10', '2027-01-10']);
  });

  it('lists months from a starting month', () => {
    expect(monthsFrom('2026-11', 4)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });
});

describe('auditTiming', () => {
  // Due 20 Nov, may be done 2 days early (from 18 Nov), missed after 2 days late (after 22 Nov).
  const at = (today: string) => auditTiming('2026-11-20', 2, 2, today);

  it('is upcoming before the early window, due up to the due date, overdue in the late days, then missed', () => {
    expect(at('2026-11-17').state).toBe('UPCOMING');
    expect(at('2026-11-18').state).toBe('DUE');
    expect(at('2026-11-20').state).toBe('DUE');
    expect(at('2026-11-21').state).toBe('OVERDUE');
    expect(at('2026-11-22').state).toBe('OVERDUE');
    expect(at('2026-11-23').state).toBe('MISSED');
  });

  it('gives the window and the days left', () => {
    expect(at('2026-11-17')).toMatchObject({
      opensOn: '2026-11-18',
      closesOn: '2026-11-22',
      daysToDue: 3,
      daysToClose: 5,
    });
  });
});

describe('complianceLevel', () => {
  it('is compliant from 90%, partially compliant from 75%, otherwise not compliant', () => {
    expect(complianceLevel(100)).toBe('COMPLIANT');
    expect(complianceLevel(90)).toBe('COMPLIANT');
    expect(complianceLevel(89.9)).toBe('PARTIALLY_COMPLIANT');
    expect(complianceLevel(75)).toBe('PARTIALLY_COMPLIANT');
    expect(complianceLevel(74.9)).toBe('NOT_COMPLIANT');
    expect(complianceLevel(null)).toBeNull();
  });
});
