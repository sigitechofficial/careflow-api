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
};

export type StatutoryCalcResult = {
  taxablePay: number;
  incomeTax: number;
  employeeNi: number;
  employerNi: number;
  netPay: number;
  taxCodeApplied: string;
  niCategoryApplied: string;
  periodFreePay: number;
  calculationBasis: 'WEEK1_MONTH1_NON_CUMULATIVE';
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
  periods: number,
  special: ReturnType<typeof parseUkTaxCode>['special'],
): number {
  if (special === 'NT' || taxable <= 0) return 0;
  if (special === 'BR') return round2(taxable * (rates.basicRatePercent / 100));
  if (special === 'D0') return round2(taxable * (rates.higherRatePercent / 100));
  if (special === 'D1') return round2(taxable * (rates.additionalRatePercent / 100));

  const basicWidth = rates.basicRateBandAnnual / periods;
  const higherWidth =
    (rates.additionalRateThresholdAnnual - rates.personalAllowanceAnnual - rates.basicRateBandAnnual) /
    periods;

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
 * Week 1 / Month 1 (non-cumulative) PAYE + Class 1 NI for one pay period.
 * Uses HMRC band widths and NI thresholds scaled to the pay frequency.
 */
export function calculatePeriodStatutory(input: StatutoryCalcInput): StatutoryCalcResult {
  const gross = Math.max(0, round2(input.periodGross));
  const parsed = parseUkTaxCode(input.taxCode);
  const niCategory = (input.niCategory ?? 'A').toUpperCase();
  const periods = periodsInTaxYear(input.frequency);
  const niTh = periodNiThresholds(input.frequency, input.rates);

  let periodFreePay = 0;
  if (parsed.special === 'NT') {
    periodFreePay = gross; // no tax
  } else if (parsed.annualFreePay != null) {
    periodFreePay = round2(parsed.annualFreePay / periods);
  }

  const taxablePay =
    parsed.special === 'NT' ? 0 : round2(Math.max(0, gross - periodFreePay));
  const incomeTax = taxOnTaxable(taxablePay, input.rates, periods, parsed.special);
  const employeeNi = employeeNiOnGross(gross, niTh, input.rates, niCategory);
  const employerNi = employerNiOnGross(gross, niTh, input.rates, niCategory);
  const netPay = round2(gross - incomeTax - employeeNi);

  const explanation = [
    `Basis: Week 1 / Month 1 (non-cumulative), ${input.frequency}, ${periods} periods/year.`,
    `Tax code ${parsed.code}; period free pay £${periodFreePay.toFixed(2)}.`,
    `Period gross £${gross.toFixed(2)}; taxable £${taxablePay.toFixed(2)}; tax £${incomeTax.toFixed(2)}.`,
    `NI category ${niCategory}; PT £${niTh.pt.toFixed(2)} UEL £${niTh.uel.toFixed(2)}; employee NI £${employeeNi.toFixed(2)}; employer NI £${employerNi.toFixed(2)}.`,
    'Not cumulative YTD PAYE. Scotland / student loans / pensions not included.',
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
