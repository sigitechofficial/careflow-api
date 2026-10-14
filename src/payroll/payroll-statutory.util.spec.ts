import {
  calculatePeriodStatutory,
  govUkEnglandRateSnapshot2026_27,
  parseUkTaxCode,
  periodsInTaxYear,
  rawTaxYearPeriodNumber,
  taxYearPeriodNumber,
  unsupportedTaxCodeReason,
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
    // Gate C1, HMRC Pay Adjustment Tables A: code 1257 free pay = (12570 + 9) / 12 = £1,048.25 a month.
    // Gross 3000 → taxable 1951.75, rounded down to £1,951 → tax 20% = 390.20
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
    expect(result.taxablePay).toBe(1951);
    expect(result.incomeTax).toBe(390.2);
    expect(result.employeeNi).toBe(156.16);
    expect(result.employerNi).toBe(387.45);
    expect(result.netPay).toBe(2453.64);
    expect(result.calculationBasis).toBe('WEEK1_MONTH1_NON_CUMULATIVE');
  });

  it('uses cumulative PAYE when YTD is provided (month 2)', () => {
    // Month 1 already posted: gross 3000, tax 390.20
    // Month 2 gross 3000 → YTD gross 6000
    // Free to date = 1048.25 × 2 = 2096.50 (Tables A)
    // Taxable YTD = 6000 - 2096.50 = 3903.50 → £3,903 → tax due YTD = 780.60
    // This period tax = 780.60 - 390.20 = 390.40
    const result = calculatePeriodStatutory({
      periodGross: 3000,
      taxCode: '1257L',
      niCategory: 'A',
      frequency: 'MONTHLY',
      rates,
      periodNumber: 2,
      ytdGrossBefore: 3000,
      ytdTaxBefore: 390.2,
    });
    expect(result.calculationBasis).toBe('CUMULATIVE');
    expect(result.incomeTax).toBe(390.4);
    expect(result.taxablePay).toBe(1952);
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

  /**
   * Gate C1. Expected figures are HMRC's own, from "Taxable Pay Tables Manual Method" (use from
   * 6 April 2025; the 2026-27 bands are the same, GOV.UK "Rates and thresholds for employers
   * 2026 to 2027"): worked examples 1 and 3, the Tables C "tax due to date" columns and the
   * Tables A rule for codes. Nothing below is computed by the code under test.
   */
  describe('PAYE as HMRC tables work it (Gate C1)', () => {
    const cumulative = (over: Partial<Parameters<typeof calculatePeriodStatutory>[0]>) =>
      calculatePeriodStatutory({ periodGross: 0, taxCode: '1257L', niCategory: 'A', frequency: 'MONTHLY', rates, ...over });

    it('HMRC example 1: code 431L month 4, pay to date £3,400, Tables A £1,439.68, taxable £1,960, tax £392.00', () => {
      const r = cumulative({ taxCode: '431L', periodNumber: 4, ytdGrossBefore: 2475, periodGross: 925 });
      expect(r.explanation).toContain('free pay to date £1439.68');
      expect(r.incomeTax).toBe(392); // tax due to date; nothing deducted before
    });

    it('HMRC example 3: code 431L week 11, pay to date £2,030, Tables A £913.66, taxable £1,116, tax £223.20', () => {
      const r = cumulative({ taxCode: '431L', frequency: 'WEEKLY', periodNumber: 11, ytdGrossBefore: 1827, periodGross: 203 });
      expect(r.explanation).toContain('free pay to date £913.66');
      expect(r.incomeTax).toBe(223.2);
    });

    it('HMRC Tables C, tax due to date at the band limits: month 1 £3,142 is £628.46, week 1 £2,407 is £817.82', () => {
      // 1257L free pay: £1,048.25 a month; £241.91 a week (12,579 / 52 = 241.9038, rounded up).
      expect(cumulative({ periodNumber: 1, periodGross: 4190.25 }).incomeTax).toBe(628.46);
      expect(cumulative({ frequency: 'WEEKLY', periodNumber: 1, periodGross: 2648.91 }).incomeTax).toBe(817.82);
    });

    it('HMRC Tables C examples, month 4: taxable £20,300 is £5,606.66; taxable £49,214 is £17,547.30', () => {
      // 1257L free pay to date at month 4: 4 × £1,048.25 = £4,193.00.
      expect(cumulative({ periodNumber: 4, periodGross: 24493 }).incomeTax).toBe(5606.66);
      expect(cumulative({ periodNumber: 4, periodGross: 53407 }).incomeTax).toBe(17547.3);
    });

    it('cumulative refund: less pay refunds tax already deducted, and net pay rises by it', () => {
      // Month 1: £3,000, £390.20 deducted. Month 2: £500, so to date £3,500 − £2,096.50 = £1,403.50,
      // taxable £1,403, tax due to date £280.60: a refund of £109.60. £500 is below the NI threshold.
      const r = cumulative({ periodNumber: 2, ytdGrossBefore: 3000, ytdTaxBefore: 390.2, periodGross: 500 });
      expect(r.calculationBasis).toBe('CUMULATIVE');
      expect(r.incomeTax).toBe(-109.6);
      expect(r.employeeNi).toBe(0);
      expect(r.netPay).toBe(609.6);
      expect(r.explanation).toContain('refund £109.60');
      // No pay in month 3: to date £3,500 − £3,144.75 = £355.25, taxable £355, due £71.00: refund £209.60.
      expect(cumulative({ periodNumber: 3, ytdGrossBefore: 3500, ytdTaxBefore: 280.6, periodGross: 0 }).incomeTax).toBe(-209.6);
    });

    it('a tax code change applies to pay to date (cumulative)', () => {
      // Month 1 on 1257L: £3,000, £390.20 deducted. Code 2000L for month 2: free pay a month
      // (20,000 + 9) / 12 = £1,667.42 (rounded up), to date £3,334.84; pay to date £6,000,
      // taxable £2,665, tax due £533.00: £142.80 this month.
      expect(cumulative({ taxCode: '2000L', periodNumber: 2, ytdGrossBefore: 3000, ytdTaxBefore: 390.2, periodGross: 3000 }).incomeTax).toBe(142.8);
      // A higher code from month 2 with little pay: to date £3,500 − £3,334.84 = £165.16 → £165, due £33.00: refund £357.20.
      expect(cumulative({ taxCode: '2000L', periodNumber: 2, ytdGrossBefore: 3000, ytdTaxBefore: 390.2, periodGross: 500 }).incomeTax).toBe(-357.2);
    });

    it('Week 1 / Month 1: this period alone, and no refund however much was deducted before', () => {
      const m1 = (periodGross: number) =>
        cumulative({ week1Month1: true, periodNumber: 6, ytdGrossBefore: 10000, ytdTaxBefore: 5000, periodGross });
      // £2,000 − £1,048.25 = £951.75, taxable £951, tax £190.20.
      expect(m1(2000)).toMatchObject({ calculationBasis: 'WEEK1_MONTH1_NON_CUMULATIVE', incomeTax: 190.2, taxablePay: 951 });
      expect(m1(500).incomeTax).toBe(0);
      expect(m1(0).incomeTax).toBe(0);
    });

    it('codes this version does not calculate are named, not guessed', () => {
      for (const code of ['1257L', 'C1257L', 'BR', 'NT', '0T', 'D0', 'D1', ' 1257L ']) expect(unsupportedTaxCodeReason(code)).toBeNull();
      expect(unsupportedTaxCodeReason(null)).toBe('no tax code recorded');
      expect(unsupportedTaxCodeReason('  ')).toBe('no tax code recorded');
      expect(unsupportedTaxCodeReason('S1257L')).toMatch(/^Scottish tax code S1257L/);
      expect(unsupportedTaxCodeReason('K475')).toMatch(/^K code K475/);
      expect(unsupportedTaxCodeReason('12A57')).toMatch(/not recognised/);
    });

    it('week 53 is seen as week 53 (taxed on a Week 1 basis), not folded into week 52', () => {
      const start = new Date(Date.UTC(2026, 3, 6));
      expect(rawTaxYearPeriodNumber(start, new Date(Date.UTC(2027, 3, 5)), 'WEEKLY')).toBe(53);
      expect(taxYearPeriodNumber(start, new Date(Date.UTC(2027, 3, 5)), 'WEEKLY')).toBe(52);
      expect(rawTaxYearPeriodNumber(start, new Date(Date.UTC(2027, 2, 29)), 'WEEKLY')).toBe(52);
    });
  });
});
