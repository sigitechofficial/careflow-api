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
};

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
  const max = periodsInTaxYear(frequency);
  const start = new Date(
    Date.UTC(taxYearStart.getUTCFullYear(), taxYearStart.getUTCMonth(), taxYearStart.getUTCDate()),
  );
  const period = new Date(
    Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate()),
  );

  if (frequency === 'MONTHLY') {
    const n =
      (period.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (period.getUTCMonth() - start.getUTCMonth()) +
      1;
    return Math.min(max, Math.max(1, n));
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor((period.getTime() - start.getTime()) / dayMs);
  if (frequency === 'WEEKLY') return Math.min(max, Math.max(1, Math.floor(days / 7) + 1));
  if (frequency === 'FORTNIGHTLY') return Math.min(max, Math.max(1, Math.floor(days / 14) + 1));
  return Math.min(max, Math.max(1, Math.floor(days / 28) + 1));
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
): number {
  if (special === 'NT' || taxable <= 0) return 0;
  if (special === 'BR') return round2(taxable * (rates.basicRatePercent / 100));
  if (special === 'D0') return round2(taxable * (rates.higherRatePercent / 100));
  if (special === 'D1') return round2(taxable * (rates.additionalRatePercent / 100));

  const scale = Math.max(1, bandScalePeriods);
  const basicWidth = rates.basicRateBandAnnual / scale;
  const higherWidth =
    (rates.additionalRateThresholdAnnual - rates.personalAllowanceAnnual - rates.basicRateBandAnnual) /
    scale;

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
  return round2(tax);
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
  const ytdTaxBefore = Math.max(0, round2(input.ytdTaxBefore ?? 0));

  const forceNonCumulative =
    Boolean(input.week1Month1) ||
    parsed.special === 'BR' ||
    parsed.special === 'D0' ||
    parsed.special === 'D1' ||
    parsed.special === '0T';

  const employeeNi = employeeNiOnGross(gross, niTh, input.rates, niCategory);
  const employerNi = employerNiOnGross(gross, niTh, input.rates, niCategory);

  if (forceNonCumulative || parsed.special === 'NT') {
    let periodFreePay = 0;
    if (parsed.special === 'NT') {
      periodFreePay = gross;
    } else if (parsed.annualFreePay != null) {
      periodFreePay = round2(parsed.annualFreePay / periods);
    }

    const taxablePay =
      parsed.special === 'NT' ? 0 : round2(Math.max(0, gross - periodFreePay));
    const incomeTax = taxOnTaxable(taxablePay, input.rates, periods, parsed.special);
    const netPay = round2(gross - incomeTax - employeeNi);
    const basisLabel = input.week1Month1
      ? 'Week 1 / Month 1 (non-cumulative)'
      : `Non-cumulative (${parsed.special})`;

    const explanation = [
      `Basis: ${basisLabel}, ${input.frequency}, period ${periodNumber}/${periods}.`,
      `Tax code ${parsed.code}; period free pay £${periodFreePay.toFixed(2)}.`,
      `Period gross £${gross.toFixed(2)}; taxable £${taxablePay.toFixed(2)}; tax £${incomeTax.toFixed(2)}.`,
      `NI category ${niCategory}; PT £${niTh.pt.toFixed(2)} UEL £${niTh.uel.toFixed(2)}; employee NI £${employeeNi.toFixed(2)}; employer NI £${employerNi.toFixed(2)}.`,
      'Student loans / pensions / Scotland bands not included.',
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
      explanation,
    };
  }

  // Cumulative PAYE (standard letter codes).
  const annualFree = parsed.annualFreePay ?? 0;
  const freePayToDate = round2((annualFree / periods) * periodNumber);
  const freePayPrevious =
    periodNumber <= 1 ? 0 : round2((annualFree / periods) * (periodNumber - 1));
  const grossYtd = round2(ytdGrossBefore + gross);
  const taxableYtd = round2(Math.max(0, grossYtd - freePayToDate));
  const taxablePrevious = round2(Math.max(0, ytdGrossBefore - freePayPrevious));
  const taxablePay = round2(Math.max(0, taxableYtd - taxablePrevious));

  // Band widths to date: annual band × periodNumber / periods  ⇒ divide annual by (periods/periodNumber)
  const bandScale = periods / periodNumber;
  const taxDueYtd = taxOnTaxable(taxableYtd, input.rates, bandScale, parsed.special);
  const incomeTax = round2(Math.max(0, taxDueYtd - ytdTaxBefore));
  const periodFreePay = round2(freePayToDate - freePayPrevious);
  const netPay = round2(gross - incomeTax - employeeNi);

  const explanation = [
    `Basis: Cumulative PAYE, ${input.frequency}, period ${periodNumber}/${periods}.`,
    `Tax code ${parsed.code}; free pay to date £${freePayToDate.toFixed(2)} (this period £${periodFreePay.toFixed(2)}).`,
    `YTD gross before £${ytdGrossBefore.toFixed(2)} + period £${gross.toFixed(2)} = £${grossYtd.toFixed(2)}.`,
    `Taxable YTD £${taxableYtd.toFixed(2)}; tax due YTD £${taxDueYtd.toFixed(2)}; tax paid YTD £${ytdTaxBefore.toFixed(2)}; this period tax £${incomeTax.toFixed(2)}.`,
    `NI category ${niCategory}; employee NI £${employeeNi.toFixed(2)}; employer NI £${employerNi.toFixed(2)} (period basis).`,
    'Student loans / pensions / Scotland bands not included.',
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
