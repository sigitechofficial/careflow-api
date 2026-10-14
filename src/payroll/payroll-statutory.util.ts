import { round2 } from './payroll-gross.util';

export type PayFrequencyCode = 'WEEKLY' | 'FORTNIGHTLY' | 'FOUR_WEEKLY' | 'MONTHLY';

export type StatutoryRateSnapshot = {
  personalAllowanceAnnual: number;
  basicRateBandAnnual: number;
  higherRateThresholdAnnual: number;
  additionalRateThresholdAnnual: number;
  basicRatePercent: number;
  higherRatePercent: number;
  additionalRatePercent: number;
  niLelWeekly: number;
  niPtWeekly: number;
  niStWeekly: number;
  niUelWeekly: number;
  niLelMonthly: number;
  niPtMonthly: number;
  niStMonthly: number;
  niUelMonthly: number;
  niEmployeeRateMainPercent: number;
  niEmployeeRateUpperPercent: number;
  niEmployerRatePercent: number;
};

export type StatutoryCalcInput = {
  periodGross: number;
  taxCode: string | null | undefined;
  niCategory: string | null | undefined;
  frequency: PayFrequencyCode;
  rates: StatutoryRateSnapshot;
  /** Force Week 1 / Month 1 non-cumulative (profile taxCodeWeek1Month1). */
  week1Month1?: boolean;
  /** 1-based period index within the tax year (required for cumulative). */
  periodNumber?: number;
  /** Gross already posted to YTD before this period (closed runs). */
  ytdGrossBefore?: number;
  /** Income tax already posted to YTD before this period. */
  ytdTaxBefore?: number;
  /** Scottish bands of the run's tax year (scottishIncomeTaxBands); used only for an S code. */
  scottishBands?: IncomeTaxBand[] | null;
  /** Welsh bands of the run's tax year (welshIncomeTaxBands); used only for a CK code. */
  welshBands?: IncomeTaxBand[] | null;
};

/** One band of annual taxable pay: taxed at ratePercent up to upToAnnual (null: no upper limit). */
export type IncomeTaxBand = { upToAnnual: number | null; ratePercent: number };

/**
 * Scottish income tax bands of taxable pay, for the tax year starting 6 April 2026 only (GOV.UK
 * "Rates and thresholds for employers 2026 to 2027"; HMRC Taxable Pay Tables 2026-27, Scottish
 * Tables C). Another year's Scottish bands are not assumed: null means none are recorded.
 */
export function scottishIncomeTaxBands(taxYearStart: Date): IncomeTaxBand[] | null {
  if (taxYearStart.toISOString().slice(0, 10) !== '2026-04-06') return null;
  return [
    { upToAnnual: 3967, ratePercent: 19 },
    { upToAnnual: 16956, ratePercent: 20 },
    { upToAnnual: 31092, ratePercent: 21 },
    { upToAnnual: 62430, ratePercent: 42 },
    { upToAnnual: 125140, ratePercent: 45 },
    { upToAnnual: null, ratePercent: 48 },
  ];
}

/**
 * GOV.UK "What your tax code means": SBR, SD0, SD1, SD2 and SD3 tax all pay from the job at the
 * Scottish basic, intermediate, higher, advanced and top rate. The rate is the tax year's own
 * (the matching band of scottishIncomeTaxBands: 20%, 21%, 42%, 45%, 48% for 2026-27).
 */
const SCOTTISH_FLAT_RATE_BAND: Record<string, number> = { SBR: 1, SD0: 2, SD1: 3, SD2: 4, SD3: 5 };

export function scottishFlatRatePercent(taxCode: string, bands: IncomeTaxBand[] | null | undefined): number | null {
  const index = SCOTTISH_FLAT_RATE_BAND[taxCode];
  if (index == null || !bands || !bands[index]) return null;
  return bands[index].ratePercent;
}

/**
 * Welsh income tax bands of taxable pay, for the tax year starting 6 April 2026 only (GOV.UK
 * "Rates and thresholds for employers 2026 to 2027", Wales: 20% up to £37,700, 40% to £125,140,
 * 45% above — the same as England and Northern Ireland that year). They are recorded per year,
 * not assumed to follow England: null means none are recorded for that year.
 */
export function welshIncomeTaxBands(taxYearStart: Date): IncomeTaxBand[] | null {
  if (taxYearStart.toISOString().slice(0, 10) !== '2026-04-06') return null;
  return [
    { upToAnnual: 37700, ratePercent: 20 },
    { upToAnnual: 125140, ratePercent: 40 },
    { upToAnnual: null, ratePercent: 45 },
  ];
}

export type StatutoryCalculationBasis =
  | 'WEEK1_MONTH1_NON_CUMULATIVE'
  | 'CUMULATIVE';

export type StatutoryCalcResult = {
  taxablePay: number;
  incomeTax: number;
  employeeNi: number;
  employerNi: number;
  netPay: number;
  taxCodeApplied: string;
  niCategoryApplied: string;
  periodFreePay: number;
  calculationBasis: StatutoryCalculationBasis;
  /** Tax due this period before the 50% regulatory limit (negative: a refund). */
  taxDueThisPeriod: number;
  /** Tax the regulatory limit kept from being deducted this period (0 when it did not apply). */
  taxNotDeductedOverLimit: number;
  explanation: string;
};

export function periodsInTaxYear(frequency: PayFrequencyCode): number {
  switch (frequency) {
    case 'WEEKLY':
      return 52;
    case 'FORTNIGHTLY':
      return 26;
    case 'FOUR_WEEKLY':
      return 13;
    case 'MONTHLY':
    default:
      return 12;
  }
}

/** 1-based pay period index inside a UK tax year (clamped to frequency periods). */
export function taxYearPeriodNumber(
  taxYearStart: Date,
  periodStart: Date,
  frequency: PayFrequencyCode,
): number {
  return Math.min(periodsInTaxYear(frequency), Math.max(1, rawTaxYearPeriodNumber(taxYearStart, periodStart, frequency)));
}

/**
 * The pay period index inside a UK tax year, not clamped: 53 for a weekly week 53, 27 for a
 * fortnightly week 54, 14 for a four-weekly week 56. HMRC: those periods are taxed on a
 * Week 1 basis.
 */
export function rawTaxYearPeriodNumber(taxYearStart: Date, periodStart: Date, frequency: PayFrequencyCode): number {
  const start = new Date(
    Date.UTC(taxYearStart.getUTCFullYear(), taxYearStart.getUTCMonth(), taxYearStart.getUTCDate()),
  );
  const period = new Date(
    Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate()),
  );

  if (frequency === 'MONTHLY') {
    return (period.getUTCFullYear() - start.getUTCFullYear()) * 12 + (period.getUTCMonth() - start.getUTCMonth()) + 1;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor((period.getTime() - start.getTime()) / dayMs);
  if (frequency === 'WEEKLY') return Math.floor(days / 7) + 1;
  if (frequency === 'FORTNIGHTLY') return Math.floor(days / 14) + 1;
  return Math.floor(days / 28) + 1;
}

/**
 * Whether this version can calculate PAYE for a tax code: England and Northern Ireland codes,
 * K codes, (Gate C3) standard Scottish allowance codes such as S1257L, (Gate C4) Scottish SK and
 * Welsh CK codes and (Gate C5) Scottish SBR / SD0-SD3 and Welsh C allowance codes such as C1257L,
 * when the tax year's Scottish or Welsh bands are known. Missing codes, other Scottish codes and
 * codes it does not recognise are refused rather than guessed; a Scottish code, a CK code or a C
 * allowance code is never taxed on England bands.
 */
export function unsupportedTaxCodeReason(
  taxCode: string | null | undefined,
  scottishBandsAvailable = false,
  welshBandsAvailable = false,
): string | null {
  const raw = (taxCode ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return 'no tax code recorded';
  if (raw.startsWith('SK')) {
    if (!/^SK[1-9]\d*$/.test(raw)) return `Scottish K code ${raw} is not recognised`;
    if (!scottishBandsAvailable) return `Scottish K code ${raw} (no Scottish rates recorded for this tax year)`;
    return null;
  }
  if (/^S(BR|D\d+)$/.test(raw)) {
    if (!/^S(BR|D[0-3])$/.test(raw)) return `Scottish flat-rate code ${raw} is not recognised`;
    if (!scottishBandsAvailable) return `Scottish flat-rate code ${raw} (no Scottish rates recorded for this tax year)`;
    return null;
  }
  if (raw.startsWith('S')) {
    if (!/^S[1-9]\d*[LMNT]$/.test(raw)) return `Scottish tax code ${raw} is not supported by this version`;
    if (!scottishBandsAvailable) return `Scottish tax code ${raw} (no Scottish rates recorded for this tax year)`;
    return null;
  }
  if (raw.startsWith('CK')) {
    if (!/^CK[1-9]\d*$/.test(raw)) return `Welsh K code ${raw} is not recognised`;
    if (!welshBandsAvailable) return `Welsh K code ${raw} (no Welsh rates recorded for this tax year)`;
    return null;
  }
  if (/^C\d/.test(raw) && !welshBandsAvailable) {
    return `Welsh tax code ${raw} (no Welsh rates recorded for this tax year)`;
  }
  const parsed = parseUkTaxCode(raw);
  if (raw.startsWith('K') && !/^K[1-9]\d*$/.test(raw)) return `tax code ${raw} is not recognised`;
  if (parsed.special === 'UNKNOWN') return `tax code ${raw} is not recognised`;
  return null;
}

/** HMRC: tax is never more than its exact amount; tables and software round tax down to the penny. */
function floorPenny(amount: number): number {
  return Math.floor(amount * 100 + 1e-7) / 100;
}

/** HMRC: taxable pay to date is rounded down to the nearest pound. */
function floorPound(amount: number): number {
  return Math.floor(amount + 1e-7);
}

const ceilPenny = (amount: number) => Math.ceil(amount * 100 - 1e-7) / 100;

/**
 * HMRC Pay Adjustment Tables A, per period (to date it is this times the period number).
 * Codes 1 to 500: (code x 10 + 9) / periods, rounded up to the penny (Month 1: 154 → £129.09,
 * 257 → £214.92, 431 → £359.92, 500 → £417.42). A code over 500 is split into units of 500: the
 * remainder from that table plus each unit at 5,000 / periods rounded up (£416.67 a month,
 * £96.16 a week); a code that divides exactly takes one unit of 500 from the table (1257:
 * £214.92 + 2 x £416.67 = £1,048.26 a month). A K code's "additional pay" is worked out the same
 * way and added to pay instead of taken off it.
 */
export function payAdjustmentPerPeriod(parsed: ReturnType<typeof parseUkTaxCode>, periods: number): number {
  if (parsed.annualFreePay == null || parsed.special !== 'NORMAL') return 0;
  const codeNumber = Math.abs(parsed.annualFreePay) / 10;
  if (codeNumber === 0) return 0;
  let units = Math.floor(codeNumber / 500);
  let remainder = codeNumber - units * 500;
  if (remainder === 0) {
    remainder = 500;
    units -= 1;
  }
  const perPeriod = round2(ceilPenny((remainder * 10 + 9) / periods) + units * ceilPenny(5000 / periods));
  return parsed.annualFreePay < 0 ? -perPeriod : perPeriod;
}

/**
 * HMRC: "Tax deducted on any one day cannot exceed 50% of the gross pay for that period" — for
 * every tax code since 6 April 2015 (PAYE11050, PAYE11095). A refund is not limited. Tax the
 * limit holds back stays due: on a cumulative code the next pay day collects it where it can.
 */
function applyRegulatoryLimit(taxDue: number, periodGross: number) {
  if (taxDue <= 0) return { deducted: taxDue, notDeducted: 0 };
  const limit = Math.floor(Math.max(0, periodGross) * 50 + 1e-7) / 100;
  const deducted = Math.min(taxDue, limit);
  return { deducted, notDeducted: round2(taxDue - deducted) };
}

/** Parse common UK tax codes. Digits × 10 = annual personal allowance (e.g. 1257L → 12570). */
export function parseUkTaxCode(taxCode: string | null | undefined): {
  code: string;
  annualFreePay: number | null;
  special: 'NORMAL' | 'BR' | '0T' | 'NT' | 'D0' | 'D1' | 'UNKNOWN';
} {
  const raw = (taxCode ?? '1257L').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return { code: '1257L', annualFreePay: 12570, special: 'NORMAL' };

  // Strip nation prefix: S = Scotland, C = Wales (Phase 3 still applies ENG band %).
  const core = raw.replace(/^[SC]/, '');

  if (core === 'BR') return { code: raw, annualFreePay: 0, special: 'BR' };
  if (core === '0T') return { code: raw, annualFreePay: 0, special: '0T' };
  if (core === 'NT') return { code: raw, annualFreePay: null, special: 'NT' };
  if (core === 'D0' || core === 'D1' || core === 'D2') {
    return {
      code: raw,
      annualFreePay: 0,
      special: core === 'D0' ? 'D0' : 'D1',
    };
  }

  // K codes: negative allowance (digits after K × 10).
  const kMatch = core.match(/^K(\d+)$/);
  if (kMatch) {
    return { code: raw, annualFreePay: -Number(kMatch[1]) * 10, special: 'NORMAL' };
  }

  const match = core.match(/^(\d+)([A-Z]*)$/);
  if (!match) return { code: raw, annualFreePay: 12570, special: 'UNKNOWN' };
  const digits = Number(match[1]);
  return { code: raw, annualFreePay: digits * 10, special: 'NORMAL' };
}

function periodNiThresholds(frequency: PayFrequencyCode, rates: StatutoryRateSnapshot) {
  if (frequency === 'MONTHLY') {
    return {
      lel: rates.niLelMonthly,
      pt: rates.niPtMonthly,
      st: rates.niStMonthly,
      uel: rates.niUelMonthly,
    };
  }
  const weeks =
    frequency === 'WEEKLY' ? 1 : frequency === 'FORTNIGHTLY' ? 2 : 4;
  return {
    lel: round2(rates.niLelWeekly * weeks),
    pt: round2(rates.niPtWeekly * weeks),
    st: round2(rates.niStWeekly * weeks),
    uel: round2(rates.niUelWeekly * weeks),
  };
}

function taxOnTaxable(
  taxable: number,
  rates: StatutoryRateSnapshot,
  bandScalePeriods: number,
  special: ReturnType<typeof parseUkTaxCode>['special'],
  bands?: IncomeTaxBand[] | null,
  flatRatePercent?: number | null,
): number {
  if (special === 'NT' || taxable <= 0) return 0;
  if (flatRatePercent != null) return floorPenny(taxable * (flatRatePercent / 100));
  if (bands) {
    // Scottish or Welsh: the same method on that nation's bands, in proportion to the periods to
    // date and not rounded (HMRC Scottish Tables C, month 4: £4,133 taxable → £813.37).
    const scale = Math.max(1, bandScalePeriods);
    let lower = 0;
    let tax = 0;
    for (const band of bands) {
      const upper = band.upToAnnual == null ? Infinity : band.upToAnnual / scale;
      if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * (band.ratePercent / 100);
      lower = upper;
    }
    return floorPenny(tax);
  }
  if (special === 'BR') return floorPenny(taxable * (rates.basicRatePercent / 100));
  if (special === 'D0') return floorPenny(taxable * (rates.higherRatePercent / 100));
  if (special === 'D1') return floorPenny(taxable * (rates.additionalRatePercent / 100));

  // Bands to date are the annual bands in proportion to the periods to date, not rounded (HMRC
  // Tables C: £628.46 tax due on £3,142 at month 1). The bands are of taxable pay: basic up to
  // £37,700, higher up to £125,140, additional above.
  const scale = Math.max(1, bandScalePeriods);
  const basicWidth = rates.basicRateBandAnnual / scale;
  const higherWidth = (rates.additionalRateThresholdAnnual - rates.basicRateBandAnnual) / scale;

  let remaining = taxable;
  let tax = 0;

  const basicSlice = Math.min(remaining, basicWidth);
  tax += basicSlice * (rates.basicRatePercent / 100);
  remaining -= basicSlice;

  if (remaining > 0) {
    const higherSlice = Math.min(remaining, Math.max(0, higherWidth));
    tax += higherSlice * (rates.higherRatePercent / 100);
    remaining -= higherSlice;
  }
  if (remaining > 0) {
    tax += remaining * (rates.additionalRatePercent / 100);
  }
  return floorPenny(tax);
}

function employeeNiOnGross(
  gross: number,
  thresholds: { pt: number; uel: number },
  rates: StatutoryRateSnapshot,
  category: string,
): number {
  if (category === 'C' || category === 'S' || category === 'K' || category === 'X') return 0;
  const mainRate =
    category === 'B' || category === 'E' || category === 'I'
      ? 1.85
      : category === 'J' || category === 'L' || category === 'Z' || category === 'D'
        ? rates.niEmployeeRateUpperPercent
        : rates.niEmployeeRateMainPercent;
  const upperRate = rates.niEmployeeRateUpperPercent;

  if (gross <= thresholds.pt) return 0;
  const mainBand = Math.min(gross, thresholds.uel) - thresholds.pt;
  const upperBand = Math.max(0, gross - thresholds.uel);
  return round2(mainBand * (mainRate / 100) + upperBand * (upperRate / 100));
}

function employerNiOnGross(
  gross: number,
  thresholds: { st: number; uel: number },
  rates: StatutoryRateSnapshot,
  category: string,
): number {
  if (category === 'X') return 0;
  // Under-21 / apprentice under 25 / veteran: 0% up to UEL, then employer rate above UEL.
  if (category === 'H' || category === 'M' || category === 'V') {
    if (gross <= thresholds.uel) return 0;
    return round2((gross - thresholds.uel) * (rates.niEmployerRatePercent / 100));
  }
  // Category A (and similar): employer rate on earnings above secondary threshold.
  if (gross <= thresholds.st) return 0;
  return round2((gross - thresholds.st) * (rates.niEmployerRatePercent / 100));
}

/**
 * PAYE Income Tax + Class 1 NI for one pay period.
 * Default: cumulative (uses YTD gross/tax when provided).
 * Week 1 / Month 1: non-cumulative when week1Month1=true or special BR/D0/D1-style period codes.
 */
export function calculatePeriodStatutory(input: StatutoryCalcInput): StatutoryCalcResult {
  const gross = Math.max(0, round2(input.periodGross));
  const parsed = parseUkTaxCode(input.taxCode);
  const niCategory = (input.niCategory ?? 'A').toUpperCase();
  const periods = periodsInTaxYear(input.frequency);
  const niTh = periodNiThresholds(input.frequency, input.rates);
  const periodNumber = Math.min(
    periods,
    Math.max(1, input.periodNumber ?? 1),
  );
  const ytdGrossBefore = Math.max(0, round2(input.ytdGrossBefore ?? 0));
  const ytdTaxBefore = round2(input.ytdTaxBefore ?? 0);
  const scottish = parsed.code.startsWith('S');
  // Welsh K codes (Gate C4) and Welsh allowance codes such as C1257L (Gate C5) use the Welsh bands.
  const welsh = parsed.code.startsWith('C') && (parsed.special === 'NORMAL' || parsed.special === '0T');
  if (scottish || welsh) {
    const reason = unsupportedTaxCodeReason(parsed.code, Boolean(input.scottishBands), Boolean(input.welshBands));
    if (reason) throw new Error(`PAYE not calculated: ${reason}`);
  }
  const bands = scottish ? input.scottishBands : welsh ? input.welshBands : null;
  // Scottish SBR / SD0-SD3: one rate on all pay, no allowance, on the recorded basis
  // (cumulative unless Week 1 / Month 1 is recorded).
  const flatRate = scottish ? scottishFlatRatePercent(parsed.code, input.scottishBands) : null;
  const notIncluded =
    flatRate != null
      ? `Scottish flat rate ${flatRate}% on all pay (no allowance). Student loans / pensions not included.`
      : scottish
        ? 'Scottish income tax bands applied. Student loans / pensions not included.'
        : welsh
          ? 'Welsh income tax bands applied. Student loans / pensions not included.'
          : 'Student loans / pensions / Scotland bands not included.';

  const forceNonCumulative =
    Boolean(input.week1Month1) ||
    (flatRate == null &&
      (parsed.special === 'BR' || parsed.special === 'D0' || parsed.special === 'D1' || parsed.special === '0T'));

  const employeeNi = employeeNiOnGross(gross, niTh, input.rates, niCategory);
  const employerNi = employerNiOnGross(gross, niTh, input.rates, niCategory);

  if (forceNonCumulative || parsed.special === 'NT') {
    // Week 1 / Month 1: the period 1 figures on this period's pay alone; earlier pay and tax are
    // not looked at, so there is never a refund (HMRC PAYE11090).
    let periodFreePay = 0;
    if (parsed.special === 'NT') {
      periodFreePay = gross;
    } else {
      periodFreePay = payAdjustmentPerPeriod(parsed, periods);
    }

    const taxablePay =
      parsed.special === 'NT' ? 0 : floorPound(Math.max(0, gross - periodFreePay));
    const taxDue = taxOnTaxable(taxablePay, input.rates, periods, parsed.special, bands, flatRate);
    const limited = applyRegulatoryLimit(taxDue, gross);
    const incomeTax = limited.deducted;
    const netPay = round2(gross - incomeTax - employeeNi);
    const basisLabel = input.week1Month1
      ? 'Week 1 / Month 1 (non-cumulative)'
      : `Non-cumulative (${parsed.special})`;

    const explanation = [
      `Basis: ${basisLabel}, ${input.frequency}, period ${periodNumber}/${periods}.`,
      `Tax code ${parsed.code}; period free pay £${periodFreePay.toFixed(2)}.`,
      `Period gross £${gross.toFixed(2)}; taxable £${taxablePay.toFixed(2)}; tax £${incomeTax.toFixed(2)}.`,
      ...(limited.notDeducted > 0
        ? [`Regulatory limit: tax due £${taxDue.toFixed(2)} is more than 50% of pay; £${limited.notDeducted.toFixed(2)} not deducted (not collected later on this basis).`]
        : []),
      `NI category ${niCategory}; PT £${niTh.pt.toFixed(2)} UEL £${niTh.uel.toFixed(2)}; employee NI £${employeeNi.toFixed(2)}; employer NI £${employerNi.toFixed(2)}.`,
      notIncluded,
    ].join(' ');

    return {
      taxablePay,
      incomeTax,
      employeeNi,
      employerNi,
      netPay,
      taxCodeApplied: parsed.code,
      niCategoryApplied: niCategory,
      periodFreePay,
      calculationBasis: 'WEEK1_MONTH1_NON_CUMULATIVE',
      taxDueThisPeriod: taxDue,
      taxNotDeductedOverLimit: limited.notDeducted,
      explanation,
    };
  }

  // Cumulative PAYE (standard letter codes), as HMRC's tables work it: free pay to date from Pay
  // Adjustment Tables A, taxable pay to date rounded down to the pound, tax due to date on the
  // bands to date, less the tax already deducted. When less is due than was deducted, the
  // difference is refunded through pay (PAYE11090: the employer "deducts more or less tax, or
  // makes a refund, as the rate of pay rises or falls").
  const adjustment = payAdjustmentPerPeriod(parsed, periods);
  const freePayToDate = round2(adjustment * periodNumber);
  const freePayPrevious = round2(adjustment * (periodNumber - 1));
  const grossYtd = round2(ytdGrossBefore + gross);
  const taxableYtd = floorPound(Math.max(0, grossYtd - freePayToDate));
  const taxablePrevious = floorPound(Math.max(0, ytdGrossBefore - freePayPrevious));
  const taxablePay = round2(taxableYtd - taxablePrevious);

  // Band widths to date: annual band × periodNumber / periods  ⇒ divide annual by (periods/periodNumber)
  const bandScale = periods / periodNumber;
  const taxDueYtd = taxOnTaxable(taxableYtd, input.rates, bandScale, parsed.special, bands, flatRate);
  const taxDueThisPeriod = round2(taxDueYtd - ytdTaxBefore);
  const limited = applyRegulatoryLimit(taxDueThisPeriod, gross);
  const incomeTax = limited.deducted;
  const periodFreePay = round2(freePayToDate - freePayPrevious);
  const netPay = round2(gross - incomeTax - employeeNi);

  const explanation = [
    `Basis: Cumulative PAYE, ${input.frequency}, period ${periodNumber}/${periods}.`,
    freePayToDate < 0
      ? `Tax code ${parsed.code}; additional pay to date £${(-freePayToDate).toFixed(2)} (this period £${(-periodFreePay).toFixed(2)}).`
      : `Tax code ${parsed.code}; free pay to date £${freePayToDate.toFixed(2)} (this period £${periodFreePay.toFixed(2)}).`,
    `YTD gross before £${ytdGrossBefore.toFixed(2)} + period £${gross.toFixed(2)} = £${grossYtd.toFixed(2)}.`,
    `Taxable YTD £${taxableYtd.toFixed(2)}; tax due YTD £${taxDueYtd.toFixed(2)}; tax paid YTD £${ytdTaxBefore.toFixed(2)}; this period ${incomeTax < 0 ? `refund £${(-incomeTax).toFixed(2)}` : `tax £${incomeTax.toFixed(2)}`}.`,
    ...(limited.notDeducted > 0
      ? [`Regulatory limit: tax due this period £${taxDueThisPeriod.toFixed(2)} is more than 50% of pay; £${limited.notDeducted.toFixed(2)} not deducted, still due and collected on a later pay day where the limit allows.`]
      : []),
    `NI category ${niCategory}; employee NI £${employeeNi.toFixed(2)}; employer NI £${employerNi.toFixed(2)} (period basis).`,
    notIncluded,
  ].join(' ');

  return {
    taxablePay,
    incomeTax,
    employeeNi,
    employerNi,
    netPay,
    taxCodeApplied: parsed.code,
    niCategoryApplied: niCategory,
    periodFreePay,
    calculationBasis: 'CUMULATIVE',
    taxDueThisPeriod,
    taxNotDeductedOverLimit: limited.notDeducted,
    explanation,
  };
}

/** GOV.UK England/NI/Wales + Class 1 figures for 2026–27 (also used for 2025–26 frozen bands). */
export function govUkEnglandRateSnapshot2026_27(): StatutoryRateSnapshot {
  return {
    personalAllowanceAnnual: 12570,
    basicRateBandAnnual: 37700,
    higherRateThresholdAnnual: 50270,
    additionalRateThresholdAnnual: 125140,
    basicRatePercent: 20,
    higherRatePercent: 40,
    additionalRatePercent: 45,
    niLelWeekly: 129,
    niPtWeekly: 242,
    niStWeekly: 96,
    niUelWeekly: 967,
    niLelMonthly: 559,
    niPtMonthly: 1048,
    niStMonthly: 417,
    niUelMonthly: 4189,
    niEmployeeRateMainPercent: 8,
    niEmployeeRateUpperPercent: 2,
    niEmployerRatePercent: 15,
  };
}
