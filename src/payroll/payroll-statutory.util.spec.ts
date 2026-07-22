import {
  calculatePeriodStatutory,
  govUkEnglandRateSnapshot2026_27,
  parseUkTaxCode,
  periodsInTaxYear,
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
    });
    expect(result.taxablePay).toBe(1952.5);
    expect(result.incomeTax).toBe(390.5);
    expect(result.employeeNi).toBe(156.16);
    expect(result.employerNi).toBe(387.45);
    expect(result.netPay).toBe(2453.34);
    expect(result.calculationBasis).toBe('WEEK1_MONTH1_NON_CUMULATIVE');
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
