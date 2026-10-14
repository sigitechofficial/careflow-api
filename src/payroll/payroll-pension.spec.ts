import {
  calculatePeriodStatutory,
  govUkEnglandRateSnapshot2026_27,
  pensionContributions,
  pensionQualifyingLimits,
  studentLoanThresholds,
} from './payroll-statutory.util';

/**
 * Gate C16. Workplace pension, defined contribution on qualifying earnings, relief at source. The
 * Pensions Regulator 2026-27 monthly qualifying earnings: £520 to £4,189. Rates here are the
 * statutory minimum (5% employee gross, of which 4% from pay and 1% basic-rate relief; 3% employer)
 * and are synthetic: they are not any employer's actual scheme.
 */
describe('workplace pension, relief at source (Gate C16)', () => {
  const limits = pensionQualifyingLimits(new Date(Date.UTC(2026, 3, 6)), 'MONTHLY')!;
  const setup = (pensionablePay: number, earlier: Parameters<typeof pensionContributions>[0]['earlier'] = null) => ({
    pensionablePay,
    ...limits,
    employeeRatePercent: 5,
    employerRatePercent: 3,
    earlier,
  });

  it('£3,000 a month: qualifying earnings £2,480; £124.00 gross, £99.20 from pay, £24.80 relief, £74.40 employer', () => {
    expect(limits).toEqual({ lower: 520, upper: 4189 });
    expect(pensionContributions(setup(3000))).toEqual({
      pensionablePay: 3000,
      qualifyingEarnings: 2480,
      employeeGross: 124,
      employeeNet: 99.2,
      taxRelief: 24.8,
      employer: 74.4,
    });
    expect(pensionContributions(setup(500))).toMatchObject({ qualifyingEarnings: 0, employeeGross: 0, employer: 0 }); // below £520
    expect(pensionContributions(setup(5000))).toMatchObject({ qualifyingEarnings: 3669, employeeGross: 183.45, employeeNet: 146.76, taxRelief: 36.69, employer: 110.07 }); // capped at £4,189
    // £1,000 more in the same month: on £4,000 (£3,480) less what £3,000 contributed.
    expect(pensionContributions(setup(1000, { pensionablePay: 3000, employeeGross: 124, employeeNet: 99.2, employer: 74.4 }))).toMatchObject({
      qualifyingEarnings: 1000,
      employeeGross: 50,
      employeeNet: 40,
      employer: 30,
    });
    expect(pensionQualifyingLimits(new Date(Date.UTC(2026, 3, 6)), 'WEEKLY')).toBeNull();
    expect(pensionQualifyingLimits(new Date(Date.UTC(2025, 3, 6)), 'MONTHLY')).toBeNull();
  });

  it('the employee deduction comes off net pay only: PAYE, NI and the student loan are unchanged', () => {
    const th = studentLoanThresholds(new Date(Date.UTC(2026, 3, 6)), 'MONTHLY')!;
    const base = {
      periodGross: 3000,
      taxCode: '1257L',
      niCategory: 'A',
      frequency: 'MONTHLY' as const,
      rates: govUkEnglandRateSnapshot2026_27(),
      periodNumber: 1,
      studentLoans: { plan: '2' as const, planThreshold: th.plans['2'], postgraduate: false, postgraduateThreshold: null, weeks: null, earlierStudentLoan: 0, earlierPostgraduateLoan: 0 },
    };
    const without = calculatePeriodStatutory(base);
    const withPension = calculatePeriodStatutory({ ...base, pension: setup(3000) });
    for (const key of ['taxablePay', 'incomeTax', 'employeeNi', 'employerNi', 'studentLoanDeduction'] as const) {
      expect(withPension[key]).toBe(without[key]);
    }
    expect([withPension.taxablePay, withPension.incomeTax, withPension.employeeNi, withPension.employerNi, withPension.studentLoanDeduction]).toEqual([1951, 390.2, 156.16, 387.45, 49]);
    expect(withPension.netPay).toBe(2305.44); // 3,000 − 390.20 − 156.16 − 49 − 99.20; the £74.40 employer contribution is not deducted
    expect(withPension.pension).toMatchObject({ applied: true, employeeNet: 99.2, employer: 74.4 });
    expect(withPension.explanation).toContain('£99.20 from pay, £24.80 tax relief claimed by the provider; employer £74.40 (not deducted from pay)');
    expect(without.pension).toMatchObject({ applied: false, employeeNet: 0 });
  });
});
