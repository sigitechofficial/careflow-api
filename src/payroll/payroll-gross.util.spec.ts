import {
  accumulateGrossLine,
  emptyGrossBucket,
  finalizeGrossBucket,
  prorateAnnualSalary,
  salaryMonthKeysForPeriod,
} from './payroll-gross.util';

describe('payroll-gross.util', () => {
  it('prorates annual salary by period days', () => {
    const start = new Date(Date.UTC(2026, 6, 13));
    const end = new Date(Date.UTC(2026, 6, 19));
    // 7 days of £26,280 → 26280 * 7 / 365.25 ≈ 503.66
    expect(prorateAnnualSalary(26280, start, end)).toBe(503.66);
  });

  it('buckets visit, expense and deduction lines into gross', () => {
    const bucket = emptyGrossBucket();
    accumulateGrossLine(bucket, { lineType: 'VISIT_PAY', amount: 100, isExpense: false });
    accumulateGrossLine(bucket, { lineType: 'MILEAGE', amount: 12.5, isExpense: true });
    accumulateGrossLine(bucket, { lineType: 'SALARY_DEDUCTION', amount: -20, isExpense: false });
    finalizeGrossBucket(bucket);
    expect(bucket.visitPay).toBe(100);
    expect(bucket.expenseTotal).toBe(12.5);
    expect(bucket.deductionTotal).toBe(20);
    expect(bucket.totalGross).toBe(80);
  });

  it('lists salary months covering a period', () => {
    const start = new Date(Date.UTC(2026, 6, 28));
    const end = new Date(Date.UTC(2026, 7, 3));
    expect(salaryMonthKeysForPeriod(start, end)).toEqual(['2026-07', '2026-08']);
  });
});
