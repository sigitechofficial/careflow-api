import {
  calculatePeriodStatutory,
  govUkEnglandRateSnapshot2026_27,
  parseUkTaxCode,
  periodsInTaxYear,
  taxYearPeriodNumber,
} from './payroll-statutory.util';

describe('payroll-statutory.util', () => {
  const rates = govUkEnglandRateSnapshot2026_27();

  it('parses 1257L tax code to £12,570 allowance', () => {
    expect(parseUkTaxCode('1257L')).toEqual({
      code: '1257L',
      annualFreePay: 12570,
      special: 'NORMAL',
    });
  });

  it('parses Scottish and Welsh prefixed codes', () => {
    expect(parseUkTaxCode('S1257L').annualFreePay).toBe(12570);
    expect(parseUkTaxCode('C1257L').annualFreePay).toBe(12570);
    expect(parseUkTaxCode('SBR').special).toBe('BR');
  });

  it('uses 12 monthly periods', () => {
    expect(periodsInTaxYear('MONTHLY')).toBe(12);
  });

  it('maps calendar months to tax-year period numbers', () => {
    const taxYearStart = new Date(Date.UTC(2026, 3, 6));
    expect(taxYearPeriodNumber(taxYearStart, new Date(Date.UTC(2026, 3, 1)), 'MONTHLY')).toBe(1);
    expect(taxYearPeriodNumber(taxYearStart, new Date(Date.UTC(2026, 4, 1)), 'MONTHLY')).toBe(2);
    expect(taxYearPeriodNumber(taxYearStart, new Date(Date.UTC(2027, 2, 1)), 'MONTHLY')).toBe(12);
  });

  it('calculates W1/M1 tax and category A NI on monthly gross', () => {
    // Monthly free pay = 12570/12 = 1047.5
    // Gross 3000 → taxable 1952.5 → tax 20% = 390.50
    // NI: above PT 1048 → (3000-1048)*8% = 156.16
    // Employer: (3000-417)*15% = 387.45
    const result = calculatePeriodStatutory({
      periodGross: 3000,
      taxCode: '1257L',
      niCategory: 'A',
      frequency: 'MONTHLY',
      rates,
      week1Month1: true,
    });
    expect(result.taxablePay).toBe(1952.5);
    expect(result.incomeTax).toBe(390.5);
    expect(result.employeeNi).toBe(156.16);
    expect(result.employerNi).toBe(387.45);
    expect(result.netPay).toBe(2453.34);
    expect(result.calculationBasis).toBe('WEEK1_MONTH1_NON_CUMULATIVE');
  });

  it('uses cumulative PAYE when YTD is provided (month 2)', () => {
    // Month 1 already posted: gross 3000, tax 390.50
    // Month 2 gross 3000 → YTD gross 6000
    // Free to date = 12570/12*2 = 2095
    // Taxable YTD = 6000-2095 = 3905 → tax due YTD = 781
    // This period tax = 781 - 390.50 = 390.50
    const result = calculatePeriodStatutory({
      periodGross: 3000,
      taxCode: '1257L',
      niCategory: 'A',
      frequency: 'MONTHLY',
      rates,
      periodNumber: 2,
      ytdGrossBefore: 3000,
      ytdTaxBefore: 390.5,
    });
    expect(result.calculationBasis).toBe('CUMULATIVE');
    expect(result.incomeTax).toBe(390.5);
    expect(result.taxablePay).toBe(1952.5);
  });

  it('charges no tax under NT code', () => {
    const result = calculatePeriodStatutory({
      periodGross: 2000,
      taxCode: 'NT',
      niCategory: 'A',
      frequency: 'MONTHLY',
      rates,
    });
    expect(result.incomeTax).toBe(0);
    expect(result.employeeNi).toBeGreaterThan(0);
  });
});
