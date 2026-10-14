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
    // HMRC Pay Adjustment Tables A, Month 1: code 257 £214.92 + 2 units of 500 at £416.67 = £1,048.26.
    // Gross 3000 → taxable 1951.74, rounded down to £1,951 → tax 20% = 390.20
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
    // Free to date = 1048.26 × 2 = 2096.52 (Tables A)
    // Taxable YTD = 6000 - 2096.52 = 3903.48 → £3,903 → tax due YTD = 780.60
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
      expect(r.taxDueThisPeriod).toBe(223.2); // tax due to date, nothing deducted before
      // Gate C2: that week's pay is £203, so no more than £101.50 is deducted (50% limit); the rest stays due.
      expect(r).toMatchObject({ incomeTax: 101.5, taxNotDeductedOverLimit: 121.7 });
    });

    it('HMRC Tables C, tax due to date at the band limits: month 1 £3,142 is £628.46, week 1 £2,407 is £817.82', () => {
      // 1257L free pay (Tables A): £1,048.26 a month; £241.92 a week (257: £49.60, plus 2 × £96.16).
      expect(cumulative({ periodNumber: 1, periodGross: 4190.26 }).incomeTax).toBe(628.46);
      expect(cumulative({ frequency: 'WEEKLY', periodNumber: 1, periodGross: 2648.92 }).incomeTax).toBe(817.82);
    });

    it('HMRC Tables C examples, month 4: taxable £20,300 is £5,606.66; taxable £49,214 is £17,547.30', () => {
      // 1257L free pay to date at month 4: 4 × £1,048.26 = £4,193.04.
      expect(cumulative({ periodNumber: 4, periodGross: 24493.04 }).incomeTax).toBe(5606.66);
      expect(cumulative({ periodNumber: 4, periodGross: 53407.04 }).incomeTax).toBe(17547.3);
    });

    it('cumulative refund: less pay refunds tax already deducted, and net pay rises by it', () => {
      // Month 1: £3,000, £390.20 deducted. Month 2: £500, so to date £3,500 − £2,096.52 = £1,403.48,
      // taxable £1,403, tax due to date £280.60: a refund of £109.60. £500 is below the NI threshold.
      const r = cumulative({ periodNumber: 2, ytdGrossBefore: 3000, ytdTaxBefore: 390.2, periodGross: 500 });
      expect(r.calculationBasis).toBe('CUMULATIVE');
      expect(r.incomeTax).toBe(-109.6);
      expect(r.employeeNi).toBe(0);
      expect(r.netPay).toBe(609.6);
      expect(r.explanation).toContain('refund £109.60');
      // No pay in month 3: to date £3,500 − £3,144.78 = £355.22, taxable £355, due £71.00: refund £209.60.
      expect(cumulative({ periodNumber: 3, ytdGrossBefore: 3500, ytdTaxBefore: 280.6, periodGross: 0 }).incomeTax).toBe(-209.6);
    });

    it('a tax code change applies to pay to date (cumulative)', () => {
      // Month 1 on 1257L: £3,000, £390.20 deducted. Code 2000L for month 2: free pay a month
      // £417.42 (500) + 3 × £416.67 = £1,667.43, to date £3,334.86; pay to date £6,000,
      // taxable £2,665, tax due £533.00: £142.80 this month.
      expect(cumulative({ taxCode: '2000L', periodNumber: 2, ytdGrossBefore: 3000, ytdTaxBefore: 390.2, periodGross: 3000 }).incomeTax).toBe(142.8);
      // A higher code from month 2 with little pay: to date £3,500 − £3,334.86 = £165.14 → £165, due £33.00: refund £357.20.
      expect(cumulative({ taxCode: '2000L', periodNumber: 2, ytdGrossBefore: 3000, ytdTaxBefore: 390.2, periodGross: 500 }).incomeTax).toBe(-357.2);
    });

    it('Week 1 / Month 1: this period alone, and no refund however much was deducted before', () => {
      const m1 = (periodGross: number) =>
        cumulative({ week1Month1: true, periodNumber: 6, ytdGrossBefore: 10000, ytdTaxBefore: 5000, periodGross });
      // £2,000 − £1,048.26 = £951.74, taxable £951, tax £190.20.
      expect(m1(2000)).toMatchObject({ calculationBasis: 'WEEK1_MONTH1_NON_CUMULATIVE', incomeTax: 190.2, taxablePay: 951 });
      expect(m1(500).incomeTax).toBe(0);
      expect(m1(0).incomeTax).toBe(0);
    });

    it('codes this version does not calculate are named, not guessed', () => {
      for (const code of ['1257L', 'C1257L', 'BR', 'NT', '0T', 'D0', 'D1', ' 1257L ']) expect(unsupportedTaxCodeReason(code)).toBeNull();
      expect(unsupportedTaxCodeReason(null)).toBe('no tax code recorded');
      expect(unsupportedTaxCodeReason('  ')).toBe('no tax code recorded');
      expect(unsupportedTaxCodeReason('S1257L')).toMatch(/^Scottish tax code S1257L/);
      expect(unsupportedTaxCodeReason('K475')).toBeNull(); // supported from Gate C2
      expect(unsupportedTaxCodeReason('12A57')).toMatch(/not recognised/);
    });

    it('week 53 is seen as week 53 (taxed on a Week 1 basis), not folded into week 52', () => {
      const start = new Date(Date.UTC(2026, 3, 6));
      expect(rawTaxYearPeriodNumber(start, new Date(Date.UTC(2027, 3, 5)), 'WEEKLY')).toBe(53);
      expect(taxYearPeriodNumber(start, new Date(Date.UTC(2027, 3, 5)), 'WEEKLY')).toBe(52);
      expect(rawTaxYearPeriodNumber(start, new Date(Date.UTC(2027, 2, 29)), 'WEEKLY')).toBe(52);
    });
  });

  /**
   * Gate C2. Figures from HMRC Pay Adjustment Tables A as printed (Month 1: code 154 £129.09,
   * 257 £214.92, 475 £396.59, 500 £417.42, a unit of 500 £416.67), Taxable Pay Tables (20% on
   * whole pounds) and the regulatory limit: "Tax deducted on any one day cannot exceed 50% of
   * the gross pay for that period", for all codes since 6 April 2015 (PAYE11050, PAYE11095).
   */
  describe('K codes and the 50% regulatory limit (Gate C2)', () => {
    const run = (over: Partial<Parameters<typeof calculatePeriodStatutory>[0]>) =>
      calculatePeriodStatutory({ periodGross: 0, taxCode: '1257L', niCategory: 'A', frequency: 'MONTHLY', rates, ...over });

    it('a K code adds Tables A "additional pay" to pay: K475 month 1 adds £396.59; K1500 adds £1,250.76', () => {
      // K475, £2,000: taxable £2,396.59 → £2,396, tax £479.20 (under 50% of pay).
      const k475 = run({ taxCode: 'K475', periodNumber: 1, periodGross: 2000 });
      expect(k475.explanation).toContain('additional pay to date £396.59');
      expect(k475).toMatchObject({ incomeTax: 479.2, taxablePay: 2396, taxNotDeductedOverLimit: 0 });
      // K1500 = one 500 from the table (£417.42) + 2 units (2 × £416.67).
      expect(run({ taxCode: 'K1500', periodNumber: 1, periodGross: 0 }).explanation).toContain('additional pay to date £1250.76');
      // 1257L for comparison: £214.92 + 2 × £416.67 = £1,048.26.
      expect(run({ periodNumber: 1, periodGross: 3000 }).explanation).toContain('free pay to date £1048.26');
      expect(unsupportedTaxCodeReason('CK475')).toMatch(/^Welsh K code/);
      expect(unsupportedTaxCodeReason('K')).toMatch(/not recognised/);
      expect(unsupportedTaxCodeReason('K0')).toMatch(/not recognised/);
    });

    it('the 50% limit stops tax above half of this period\'s pay, for a K code and for an ordinary code; a refund is not limited', () => {
      // K1500, £400: taxable £1,650.76 → £1,650, tax due £330.00; limit £200.00: £130.00 not deducted.
      const k = run({ taxCode: 'K1500', periodNumber: 1, periodGross: 400 });
      expect(k).toMatchObject({ taxDueThisPeriod: 330, incomeTax: 200, taxNotDeductedOverLimit: 130, employeeNi: 0, netPay: 200 });
      expect(k.explanation).toContain('Regulatory limit: tax due this period £330.00 is more than 50% of pay; £130.00 not deducted');
      // 1257L, month 2, nothing deducted on £6,000 before, £1,000 now: to date £7,000 − £2,096.52,
      // taxable £4,903, due £980.60; limit £500.00.
      expect(run({ periodNumber: 2, ytdGrossBefore: 6000, ytdTaxBefore: 0, periodGross: 1000 })).toMatchObject({
        taxDueThisPeriod: 980.6,
        incomeTax: 500,
        taxNotDeductedOverLimit: 480.6,
      });
      // NI is not limited, and a refund is paid in full.
      expect(run({ taxCode: 'K1500', periodNumber: 1, periodGross: 2000 }).employeeNi).toBe(76.16); // (2,000 − 1,048) × 8%
      expect(run({ periodNumber: 2, ytdGrossBefore: 3000, ytdTaxBefore: 390.2, periodGross: 500 }).incomeTax).toBe(-109.6);
    });

    it('cumulative: tax held back is collected on a later pay day as the limit allows; Week 1 / Month 1 does not carry it', () => {
      // Month 3 after the month 2 case above (£500 deducted): to date £8,000 − £3,144.78, taxable £4,855,
      // due £971.00 less £500.00 = £471.00, under the £500.00 limit: deducted in full.
      expect(run({ periodNumber: 3, ytdGrossBefore: 7000, ytdTaxBefore: 500, periodGross: 1000 })).toMatchObject({
        incomeTax: 471,
        taxNotDeductedOverLimit: 0,
      });
      // Week 1 / Month 1: the period alone; K1500 on £400 is limited the same way, and nothing is carried.
      const m1 = run({ taxCode: 'K1500', week1Month1: true, periodNumber: 6, ytdGrossBefore: 2000, ytdTaxBefore: 1000, periodGross: 400 });
      expect(m1).toMatchObject({ calculationBasis: 'WEEK1_MONTH1_NON_CUMULATIVE', incomeTax: 200, taxNotDeductedOverLimit: 130 });
      expect(m1.explanation).toContain('not collected later on this basis');
    });
  });
});
