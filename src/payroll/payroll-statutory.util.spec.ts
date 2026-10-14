import {
  calculatePeriodStatutory,
  govUkEnglandRateSnapshot2026_27,
  parseUkTaxCode,
  periodsInTaxYear,
  rawTaxYearPeriodNumber,
  scottishFlatRatePercent,
  scottishIncomeTaxBands,
  taxYearPeriodNumber,
  unsupportedNiCategoryReason,
  unsupportedTaxCodeReason,
  welshIncomeTaxBands,
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
      for (const code of ['1257L', 'C1257L', 'BR', 'NT', '0T', 'D0', 'D1', ' 1257L ']) expect(unsupportedTaxCodeReason(code, true, true)).toBeNull();
      expect(unsupportedTaxCodeReason(null)).toBe('no tax code recorded');
      expect(unsupportedTaxCodeReason('  ')).toBe('no tax code recorded');
      expect(unsupportedTaxCodeReason('S1257L')).toMatch(/^Scottish tax code S1257L \(no Scottish rates recorded/);
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

  /**
   * Gate C3. Expected values as HMRC prints them in the Taxable Pay Tables Manual Method for
   * 2026-27 (Scottish pages 12 to 25): example 7 (S431L, week 18), examples 8 and 9 (month 4,
   * Tables C1 and C5) and the Scottish Tables C limits at month 1 and month 2.
   */
  describe('Scottish PAYE 2026-27, standard S codes (Gate C3)', () => {
    const scottishBands = scottishIncomeTaxBands(new Date(Date.UTC(2026, 3, 6)));
    const run = (over: Partial<Parameters<typeof calculatePeriodStatutory>[0]>) =>
      calculatePeriodStatutory({ periodGross: 0, taxCode: 'S1257L', niCategory: 'A', frequency: 'MONTHLY', rates, scottishBands, ...over });

    it('cumulative S codes as HMRC examples 7 and 8: S431L week 18 tax due £22.04; month 4 taxable £4,133 is £813.37', () => {
      // Example 7: pay to date £1,612.00 less Tables A £1,495.08 = £116.92 → £116; 19% = £22.04.
      const ex7 = run({ taxCode: 'S431L', frequency: 'WEEKLY', periodNumber: 18, ytdGrossBefore: 1527, periodGross: 85 });
      expect(ex7).toMatchObject({ calculationBasis: 'CUMULATIVE', incomeTax: 22.04, taxCodeApplied: 'S431L', taxNotDeductedOverLimit: 0 });
      expect(ex7.explanation).toContain('free pay to date £1495.08');
      expect(ex7.explanation).toContain('Taxable YTD £116.00; tax due YTD £22.04');
      expect(ex7.explanation).toContain('Scottish income tax bands applied');
      // Example 8: S1257L month 4, free pay to date 4 × £1,048.26; taxable £4,133 → £251.37 + £562.00.
      const ex8 = run({ periodNumber: 4, ytdGrossBefore: 6000, ytdTaxBefore: 400, periodGross: 2326.04 });
      expect(ex8.explanation).toContain('Taxable YTD £4133.00; tax due YTD £813.37');
      expect(ex8.incomeTax).toBe(413.37);
      // The same pay on 1257L (England bands) is taxed differently.
      expect(run({ taxCode: '1257L', periodNumber: 4, ytdGrossBefore: 6000, ytdTaxBefore: 400, periodGross: 2326.04 }).incomeTax).toBe(426.6);
    });

    it('band limits and higher pay: Tables C at month 1 and example 9 (month 4, top rate) as printed; only 2026-27 bands are used', () => {
      // Month 1 (taxable to date = gross less £1,048.26): HMRC columns 3, 6, 9, 12 and 14.
      const month1 = (taxable: number) => run({ periodNumber: 1, periodGross: taxable + 1048.26 }).taxDueThisPeriod;
      expect([331, 1413, 2591, 5203, 10429].map(month1)).toEqual([62.89, 279.29, 526.67, 1623.72, 3975.44]);
      // Example 9: month 4, taxable £49,214: £15,900.83 to £41,714 plus 48% of £7,500 = £19,500.83.
      const ex9 = run({ periodNumber: 4, ytdGrossBefore: 40000, ytdTaxBefore: 15000, periodGross: 13407.04 });
      expect(ex9.explanation).toContain('Taxable YTD £49214.00; tax due YTD £19500.83');
      expect(ex9.incomeTax).toBe(4500.83);
      // No Scottish bands are assumed for another year, and an S code never falls back to England bands.
      expect(scottishIncomeTaxBands(new Date(Date.UTC(2025, 3, 6)))).toBeNull();
      expect(() => run({ scottishBands: null, periodNumber: 1, periodGross: 3000 })).toThrow(/no Scottish rates recorded/);
      // Supported: standard allowance codes (and, from Gate C5, SBR / SD0-SD3). Refused: anything else.
      for (const code of ['S1257L', 'S431L', 'S1383M', 'S1131N', 'S1257T']) expect(unsupportedTaxCodeReason(code, true)).toBeNull();
      expect(unsupportedTaxCodeReason('SK0', true)).toMatch(/^Scottish K code SK0 is not recognised/); // SK475 supported from Gate C4
      for (const code of ['SBR', 'SD0', 'SD1', 'SD2', 'SD3']) expect(unsupportedTaxCodeReason(code, true)).toBeNull();
      for (const code of ['S', 'S0T', 'SNT', 'S12A57', 'S1257', 'S1257LX']) expect(unsupportedTaxCodeReason(code, true)).toMatch(/not supported by this version/);
      expect(() => run({ taxCode: 'SD4', periodNumber: 1, periodGross: 3000 })).toThrow(/Scottish flat-rate code SD4 is not recognised/);
    });

    it('Week 1 / Month 1 on Scottish bands (no refund); the 50% limit holds back Scottish tax over half of pay', () => {
      // Month 1 alone: £2,000 − £1,048.26 → £951; £62.81 at 19% + £124.08 at 20% → £186.89. Earlier tax is not looked at.
      expect(run({ week1Month1: true, periodNumber: 6, ytdGrossBefore: 6000, ytdTaxBefore: 1000, periodGross: 2000 })).toMatchObject({
        calculationBasis: 'WEEK1_MONTH1_NON_CUMULATIVE',
        taxablePay: 951,
        incomeTax: 186.89,
      });
      expect(run({ week1Month1: true, periodNumber: 2, ytdGrossBefore: 6000, ytdTaxBefore: 1000, periodGross: 500 }).incomeTax).toBe(0);
      // Cumulative refund is kept: the same fall in pay refunds tax already deducted.
      expect(run({ periodNumber: 2, ytdGrossBefore: 6000, ytdTaxBefore: 1000, periodGross: 500 }).incomeTax).toBeLessThan(0);
      // Month 2, nothing deducted on £6,000, £1,000 now: taxable £4,903 → £558.58 to £2,826 (HMRC col 6)
      // + 21% of £2,077 = £994.75 due; limit £500.00, £494.75 held back.
      const limited = run({ periodNumber: 2, ytdGrossBefore: 6000, ytdTaxBefore: 0, periodGross: 1000 });
      expect(limited).toMatchObject({ taxDueThisPeriod: 994.75, incomeTax: 500, taxNotDeductedOverLimit: 494.75 });
      expect(limited.explanation).toContain('Regulatory limit');
    });
  });

  /**
   * Gate C4. Additional pay from HMRC Pay Adjustment Tables A as printed (Month 1: 475 £396.59;
   * 1500 = £417.42 + 2 × £416.67 = £1,250.76); Scottish tax from the 2026-27 Scottish Tables C
   * (month 1 column 6 £279.29 at £1,413; month 2 column 6 £558.58 at £2,826) plus Tables D2 at
   * 21%; Welsh 2026-27 bands from GOV.UK (20% to £37,700, 40% to £125,140, 45% above).
   */
  describe('Scottish SK and Welsh CK codes (Gate C4)', () => {
    const start2026 = new Date(Date.UTC(2026, 3, 6));
    const scottishBands = scottishIncomeTaxBands(start2026);
    const welshBands = welshIncomeTaxBands(start2026);
    const run = (over: Partial<Parameters<typeof calculatePeriodStatutory>[0]>) =>
      calculatePeriodStatutory({ periodGross: 0, taxCode: 'SK475', niCategory: 'A', frequency: 'MONTHLY', rates, scottishBands, welshBands, ...over });

    it('SK475 cumulative: Tables A additional pay on the Scottish bands (month 1 £485.72, month 2 £485.93)', () => {
      // Month 1: £2,000 + £396.59 → £2,396; £279.29 to £1,413 + 21% of £983 (£206.43) = £485.72.
      const m1 = run({ periodNumber: 1, periodGross: 2000 });
      expect(m1).toMatchObject({ calculationBasis: 'CUMULATIVE', taxablePay: 2396, incomeTax: 485.72, taxCodeApplied: 'SK475' });
      expect(m1.explanation).toContain('additional pay to date £396.59');
      expect(m1.explanation).toContain('Scottish income tax bands applied');
      // Month 2: £4,000 + £793.18 → £4,793; £558.58 to £2,826 + 21% of £1,967 (£413.07) = £971.65, less £485.72.
      const m2 = run({ periodNumber: 2, ytdGrossBefore: 2000, ytdTaxBefore: 485.72, periodGross: 2000 });
      expect(m2.explanation).toContain('Taxable YTD £4793.00; tax due YTD £971.65');
      expect(m2.incomeTax).toBe(485.93);
      // A refund is kept: more deducted before than is due to date comes back in full.
      expect(run({ periodNumber: 2, ytdGrossBefore: 2000, ytdTaxBefore: 700, periodGross: 0 }).incomeTax).toBe(-148.02);
    });

    it('CK475 cumulative: the same additional pay on the 2026-27 Welsh bands (month 1 £479.20, month 2 £479.40)', () => {
      const m1 = run({ taxCode: 'CK475', periodNumber: 1, periodGross: 2000 });
      expect(m1).toMatchObject({ taxablePay: 2396, incomeTax: 479.2, taxCodeApplied: 'CK475' });
      expect(m1.explanation).toContain('Welsh income tax bands applied');
      const m2 = run({ taxCode: 'CK475', periodNumber: 2, ytdGrossBefore: 2000, ytdTaxBefore: 479.2, periodGross: 2000 });
      expect(m2.explanation).toContain('Taxable YTD £4793.00; tax due YTD £958.60');
      expect(m2.incomeTax).toBe(479.4);
      // Higher pay crosses the Welsh 40% band: taxable £4,142 at month 1 = £628.46 to £3,142 (Tables C) + 40% of £1,000.
      expect(run({ taxCode: 'CK475', periodNumber: 1, periodGross: 3745.41 }).taxDueThisPeriod).toBe(1028.46);
    });

    it('Week 1 / Month 1 and the 50% limit: SK1500 and CK1500 on £400 are held to £200.00, nothing carried', () => {
      // SK1500: £400 + £1,250.76 → £1,650; £279.29 + 21% of £237 (£49.77) = £329.06 due.
      const sk = run({ taxCode: 'SK1500', week1Month1: true, periodNumber: 6, ytdGrossBefore: 2000, ytdTaxBefore: 1000, periodGross: 400 });
      expect(sk).toMatchObject({ calculationBasis: 'WEEK1_MONTH1_NON_CUMULATIVE', taxDueThisPeriod: 329.06, incomeTax: 200, taxNotDeductedOverLimit: 129.06, netPay: 200 });
      expect(sk.explanation).toContain('not collected later on this basis');
      // CK1500: £1,650 at 20% = £330.00 due.
      const ck = run({ taxCode: 'CK1500', week1Month1: true, periodNumber: 6, periodGross: 400 });
      expect(ck).toMatchObject({ taxDueThisPeriod: 330, incomeTax: 200, taxNotDeductedOverLimit: 130 });
      // Cumulative: the limit holds back what is over half of pay; it stays due.
      expect(run({ taxCode: 'SK1500', periodNumber: 1, periodGross: 400 })).toMatchObject({ incomeTax: 200, taxNotDeductedOverLimit: 129.06 });
    });

    it('malformed SK / CK codes and tax years without verified bands are refused, never taxed on England bands', () => {
      for (const code of ['SK475', 'SK1500', 'CK475', 'CK1500']) expect(unsupportedTaxCodeReason(code, true, true)).toBeNull();
      for (const code of ['SK', 'SK0', 'SK012', 'SK475L', 'SKX']) expect(unsupportedTaxCodeReason(code, true, true)).toMatch(/^Scottish K code .* is not recognised/);
      for (const code of ['CK', 'CK0', 'CK012', 'CK475L', 'CKX']) expect(unsupportedTaxCodeReason(code, true, true)).toMatch(/^Welsh K code .* is not recognised/);
      expect(unsupportedTaxCodeReason('SK475', false, true)).toMatch(/no Scottish rates recorded for this tax year/);
      expect(unsupportedTaxCodeReason('CK475', true, false)).toMatch(/no Welsh rates recorded for this tax year/);
      expect(welshIncomeTaxBands(new Date(Date.UTC(2025, 3, 6)))).toBeNull();
      expect(welshIncomeTaxBands(new Date(Date.UTC(2027, 3, 6)))).toBeNull();
      expect(() => run({ taxCode: 'CK475', welshBands: null, periodNumber: 1, periodGross: 2000 })).toThrow(/no Welsh rates recorded/);
      expect(() => run({ scottishBands: null, periodNumber: 1, periodGross: 2000 })).toThrow(/no Scottish rates recorded/);
      expect(() => run({ taxCode: 'SK0', periodNumber: 1, periodGross: 2000 })).toThrow(/not recognised/);
    });
  });

  /**
   * Gate C5. GOV.UK "What your tax code means": SBR, SD0, SD1, SD2 and SD3 tax all pay at the
   * Scottish basic, intermediate, higher, advanced and top rate (2026-27: 20%, 21%, 42%, 45%,
   * 48%, GOV.UK "Rates and thresholds for employers 2026 to 2027"); C codes use the rates in
   * Wales. Welsh figures: Pay Adjustment Tables A (1257: £1,048.26 a month) and Tables C (month 1:
   * £628.46 at £3,142).
   */
  describe('Scottish flat-rate codes and Welsh C allowance codes (Gate C5)', () => {
    const start2026 = new Date(Date.UTC(2026, 3, 6));
    const scottishBands = scottishIncomeTaxBands(start2026);
    const welshBands = welshIncomeTaxBands(start2026);
    const run = (over: Partial<Parameters<typeof calculatePeriodStatutory>[0]>) =>
      calculatePeriodStatutory({ periodGross: 0, taxCode: 'SD1', niCategory: 'A', frequency: 'MONTHLY', rates, scottishBands, welshBands, ...over });

    it('SBR, SD0, SD1, SD2 and SD3 map to 20%, 21%, 42%, 45% and 48% of all pay, with no allowance', () => {
      expect(['SBR', 'SD0', 'SD1', 'SD2', 'SD3'].map((code) => scottishFlatRatePercent(code, scottishBands))).toEqual([20, 21, 42, 45, 48]);
      const onPay = (taxCode: string) => run({ taxCode, week1Month1: true, periodNumber: 1, periodGross: 1000 });
      expect(['SBR', 'SD0', 'SD1', 'SD2', 'SD3'].map((code) => onPay(code).incomeTax)).toEqual([200, 210, 420, 450, 480]);
      expect(onPay('SD1')).toMatchObject({ periodFreePay: 0, taxablePay: 1000, taxCodeApplied: 'SD1' });
      expect(onPay('SD1').explanation).toContain('Scottish flat rate 42% on all pay (no allowance)');
      // Not England's rates: D0 is 40% there.
      expect(onPay('D0').incomeTax).toBe(400);
      // Existing rounding: taxable pay down to the pound, tax down to the penny (£1,234 × 21% = £259.14).
      expect(run({ taxCode: 'SD0', week1Month1: true, periodGross: 1234.56 })).toMatchObject({ taxablePay: 1234, incomeTax: 259.14 });
    });

    it('flat rate on the recorded basis: cumulative refunds and the 50% limit; malformed codes and years without Scottish rates refused', () => {
      // Cumulative (no Week 1 / Month 1 recorded): month 2, £5,000 to date × 48% = £2,400 due; limit £500.
      expect(run({ taxCode: 'SD3', periodNumber: 2, ytdGrossBefore: 4000, ytdTaxBefore: 0, periodGross: 1000 })).toMatchObject({
        calculationBasis: 'CUMULATIVE',
        taxDueThisPeriod: 2400,
        incomeTax: 500,
        taxNotDeductedOverLimit: 1900,
      });
      // Over-deducted before: £4,000 × 42% = £1,680 due, £2,000 deducted: £320 refunded in full.
      expect(run({ periodNumber: 2, ytdGrossBefore: 4000, ytdTaxBefore: 2000, periodGross: 0 }).incomeTax).toBe(-320);
      // Week 1 / Month 1 recorded: this period alone, earlier tax not looked at.
      expect(run({ taxCode: 'SD3', week1Month1: true, periodNumber: 2, ytdGrossBefore: 4000, ytdTaxBefore: 2000, periodGross: 1000 })).toMatchObject({
        calculationBasis: 'WEEK1_MONTH1_NON_CUMULATIVE',
        incomeTax: 480,
      });
      expect(unsupportedTaxCodeReason('SD4', true)).toMatch(/^Scottish flat-rate code SD4 is not recognised/);
      expect(unsupportedTaxCodeReason('SBR', false)).toMatch(/^Scottish flat-rate code SBR \(no Scottish rates recorded/);
      expect(() => run({ taxCode: 'SBR', scottishBands: null, periodGross: 1000 })).toThrow(/no Scottish rates recorded/);
    });

    it('C1257L uses the Welsh bands of the tax year (not England\'s), keeps cumulative refunds, and is refused without Welsh rates', () => {
      // 2026-27: £3,000 − £1,048.26 → £1,951 at 20% = £390.20; taxable £4,142 = £628.46 + 40% of £1,000.
      const m1 = run({ taxCode: 'C1257L', periodNumber: 1, periodGross: 3000 });
      expect(m1).toMatchObject({ taxablePay: 1951, incomeTax: 390.2, taxCodeApplied: 'C1257L' });
      expect(m1.explanation).toContain('Welsh income tax bands applied');
      expect(run({ taxCode: 'C1257L', periodNumber: 1, periodGross: 5190.26 }).taxDueThisPeriod).toBe(1028.46);
      // Routing: a (synthetic) Welsh rate different from England's changes C1257L only.
      const otherWelsh = [{ upToAnnual: 37700, ratePercent: 21 }, { upToAnnual: 125140, ratePercent: 40 }, { upToAnnual: null, ratePercent: 45 }];
      expect(run({ taxCode: 'C1257L', welshBands: otherWelsh, periodNumber: 1, periodGross: 3000 }).incomeTax).toBe(409.71);
      expect(run({ taxCode: '1257L', welshBands: otherWelsh, periodNumber: 1, periodGross: 3000 }).incomeTax).toBe(390.2);
      // Cumulative refund and Week 1 / Month 1 as before.
      expect(run({ taxCode: 'C1257L', periodNumber: 2, ytdGrossBefore: 3000, ytdTaxBefore: 390.2, periodGross: 500 }).incomeTax).toBe(-109.6);
      expect(run({ taxCode: 'C1257L', week1Month1: true, periodNumber: 2, ytdGrossBefore: 3000, ytdTaxBefore: 390.2, periodGross: 500 }).incomeTax).toBe(0);
      // No verified Welsh bands for the year: refused, never England's.
      expect(unsupportedTaxCodeReason('C1257L', true, false)).toMatch(/^Welsh tax code C1257L \(no Welsh rates recorded/);
      expect(() => run({ taxCode: 'C1257L', welshBands: null, periodNumber: 1, periodGross: 3000 })).toThrow(/no Welsh rates recorded/);
    });
  });

  /**
   * Gate C6. GOV.UK "Rates and thresholds for employers 2026 to 2027": LEL £129 / £559, PT £242 /
   * £1,048, ST £96 / £417, UEL and the upper secondary thresholds (AUST, UST, VUST) £967 / £4,189
   * (weekly / monthly); employee 8% PT to UEL and 2% above; employer 15%. Rounding (CWG2,
   * NIM11002): each contribution separately to the nearest penny, £0.005 or less disregarded.
   */
  describe('Class 1 NI, categories A, C, H, M and V (Gate C6)', () => {
    const run = (over: Partial<Parameters<typeof calculatePeriodStatutory>[0]>) =>
      calculatePeriodStatutory({ periodGross: 0, taxCode: '1257L', niCategory: 'A', frequency: 'MONTHLY', rates, periodNumber: 1, ...over });
    const ni = (over: Partial<Parameters<typeof calculatePeriodStatutory>[0]>) => {
      const r = run(over);
      return [r.employeeNi, r.employerNi];
    };

    it('category A: £3,000 a month is £156.16 employee and £387.45 employer NI; employer NI does not reduce net pay', () => {
      const a = run({ periodGross: 3000 });
      // (3,000 − 1,048) × 8% = £156.16; (3,000 − 417) × 15% = £387.45; net £3,000 − £390.20 tax − £156.16.
      expect(a).toMatchObject({ employeeNi: 156.16, employerNi: 387.45, netPay: 2453.64, niCategoryApplied: 'A' });
      expect(a.explanation).toContain('NI-able earnings £3000.00');
      expect(a.explanation).toContain('bands: at LEL £559.00, LEL–PT £489.00, PT–UEL £1952.00');
      expect(ni({ periodGross: 5000 })).toEqual([267.5, 687.45]); // £251.28 + 2% of £811; (5,000 − 417) × 15%
      expect(ni({ frequency: 'WEEKLY', periodGross: 500 })).toEqual([20.64, 60.6]); // weekly thresholds
      expect(ni({ periodGross: 1000 })).toEqual([0, 87.45]); // below the PT: no employee NI
      expect(ni({ periodGross: 1000.1 })).toEqual([0, 87.46]); // £87.465: the half penny is disregarded
      // A second payment in the same earnings period: NI on the £3,000 total less the £2,000 payment's NI.
      const more = run({ periodGross: 1000, niEarlierInPeriod: { niableEarnings: 2000, employeeNi: 76.16, employerNi: 237.45 } });
      expect([more.employeeNi, more.employerNi]).toEqual([80, 150]);
      expect(more.explanation).toContain('including £2000.00 paid earlier in this earnings period');
    });

    it('category C: no employee NI, standard employer NI', () => {
      expect(run({ niCategory: 'C', periodGross: 3000 })).toMatchObject({ employeeNi: 0, employerNi: 387.45, netPay: 2609.8 });
      expect(ni({ niCategory: 'C', periodGross: 5000 })).toEqual([0, 687.45]);
    });

    it('categories H, M and V: no employer NI up to the upper secondary threshold, 15% above it; anything else is refused, never taken as A', () => {
      for (const niCategory of ['H', 'M', 'V']) {
        expect(ni({ niCategory, periodGross: 3000 })).toEqual([156.16, 0]);
        expect(ni({ niCategory, periodGross: 4189 })).toEqual([251.28, 0]);
        expect(ni({ niCategory, periodGross: 5000 })).toEqual([267.5, 121.65]); // (5,000 − 4,189) × 15%
        expect(ni({ niCategory, frequency: 'WEEKLY', periodGross: 1000 })).toEqual([58.66, 4.95]); // above £967
      }
      for (const category of ['A', 'C', 'H', 'M', 'V', ' m ']) expect(unsupportedNiCategoryReason(category)).toBeNull();
      for (const category of ['B', 'F', 'I', 'J', 'L', 'S', 'Z', 'X', 'Q']) expect(unsupportedNiCategoryReason(category)).toMatch(/not calculated by this version/);
      expect(unsupportedNiCategoryReason(null)).toBe('no NI category recorded');
      expect(() => run({ niCategory: 'J', periodGross: 3000 })).toThrow(/NI not calculated: NI category J/);
      expect(() => run({ niCategory: undefined, periodGross: 3000 })).toThrow(/no NI category recorded/);
    });
  });
});
