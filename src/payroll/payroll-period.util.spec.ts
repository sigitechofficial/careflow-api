import { generatePayrollPeriods, listUkTaxYearsAroundDate, ukTaxYearBoundsForDate } from './payroll-period.util';

describe('payroll-period.util', () => {
  it('derives UK tax year bounds around 6 April', () => {
    expect(ukTaxYearBoundsForDate('2026-04-05')).toEqual({
      code: '2025-26',
      label: 'Tax year 2025-26',
      startDate: '2025-04-06',
      endDate: '2026-04-05',
    });
    expect(ukTaxYearBoundsForDate('2026-04-06').code).toBe('2026-27');
  });

  it('lists UK tax years around a date', () => {
    const years = listUkTaxYearsAroundDate('2026-07-22', { yearsBefore: 1, yearsAfter: 1 });
    expect(years.map((y) => y.code)).toEqual(['2025-26', '2026-27', '2027-28']);
    expect(years.find((y) => y.code === '2026-27')?.isCurrent).toBe(true);
  });

  it('generates full calendar-month periods within a tax year', () => {
    const periods = generatePayrollPeriods({
      frequency: 'MONTHLY',
      anchorDay: 28,
      taxYearStart: '2025-04-06',
      taxYearEnd: '2026-04-05',
    });
    expect(periods.length).toBe(12);
    expect(periods[0].periodStart).toBe('2025-04-01');
    expect(periods[0].periodEnd).toBe('2025-04-30');
    expect(periods[0].paymentDate).toBe('2025-04-30');
    expect(periods[0].label).toBe('Apr 2025');
    expect(periods[1].periodStart).toBe('2025-05-01');
    expect(periods[1].periodEnd).toBe('2025-05-31');
    expect(periods[periods.length - 1].periodStart).toBe('2026-03-01');
    expect(periods[periods.length - 1].periodEnd).toBe('2026-03-31');
    expect(periods[periods.length - 1].paymentDate).toBe('2026-03-31');
  });

  it('sets monthly payment date to the last day of each month', () => {
    const periods = generatePayrollPeriods({
      frequency: 'MONTHLY',
      anchorDay: 1,
      taxYearStart: '2025-04-06',
      taxYearEnd: '2026-04-05',
    });
    expect(periods.length).toBe(12);
    for (const period of periods) {
      expect(period.paymentDate).toBe(period.periodEnd);
    }
    expect(periods[0].paymentDate).toBe('2025-04-30');
    expect(periods[1].paymentDate).toBe('2025-05-31');
    expect(periods[10].paymentDate).toBe('2026-02-28'); // Feb 2026
  });

  it('generates weekly periods covering the tax year', () => {
    const periods = generatePayrollPeriods({
      frequency: 'WEEKLY',
      anchorDay: 5,
      taxYearStart: '2025-04-06',
      taxYearEnd: '2025-05-03',
    });
    expect(periods.length).toBe(4);
    expect(periods[0].label).toContain('P1');
    expect(periods[0].paymentDate).toBe(periods[0].periodEnd);
  });
});
