import { fineSummary, staffActionProblems } from './incident-staff-action.util';

describe('staffActionProblems', () => {
  const month = '2026-10';

  it('only checks fines', () => {
    expect(staffActionProblems({ actionType: 'WRITTEN_WARNING' }, month)).toEqual([]);
  });

  it('a fine needs an amount, a month and the contract confirmation', () => {
    expect(staffActionProblems({ actionType: 'FINE' }, month)).toEqual([
      'a fine amount above £0',
      'the salary month the fine comes out of',
      'confirmation that the contract or written consent allows the deduction',
    ]);
  });

  it('refuses a past salary month, allows this month and later', () => {
    const base = { actionType: 'FINE', fineAmount: 25, deductionAllowedConfirmed: true };
    expect(staffActionProblems({ ...base, fineSalaryMonth: '2026-09' }, month)).toEqual([
      'a salary month that is not already past',
    ]);
    expect(staffActionProblems({ ...base, fineSalaryMonth: '2026-10' }, month)).toEqual([]);
    expect(staffActionProblems({ ...base, fineSalaryMonth: '2027-01' }, month)).toEqual([]);
  });
});

describe('fineSummary', () => {
  it('names the amount and month', () => {
    expect(fineSummary(25, '2026-10')).toBe('£25.00 from October 2026 salary');
  });
});
