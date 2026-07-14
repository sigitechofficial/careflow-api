/**
 * Holiday pay, NMW validation, employer-cost estimates, allowances, and statutory hooks.
 */

export type HolidayPayMethod =
  | 'ACCRUAL_WHEN_TAKEN'
  | 'ROLLED_UP_12_07'
  | 'REFERENCE_52_WEEK'
  | 'CONTRACTUAL_ABOVE_STATUTORY';

export const IRREGULAR_HOURS_HOLIDAY_ACCRUAL_RATE = 0.1207;

export function calculateRolledUpHolidayPay(qualifyingRemuneration: number): {
  amount: number;
  explanation: string;
} {
  const amount = Math.round(qualifyingRemuneration * IRREGULAR_HOURS_HOLIDAY_ACCRUAL_RATE * 100) / 100;
  return {
    amount,
    explanation: `Rolled-up holiday 12.07% of £${qualifyingRemuneration.toFixed(2)} = £${amount.toFixed(2)}`,
  };
}

export function accrueHolidayHours(hoursWorked: number): number {
  return Math.round(hoursWorked * IRREGULAR_HOURS_HOLIDAY_ACCRUAL_RATE * 100) / 100;
}

export function ageInFullYears(dateOfBirth: Date, onDate: Date): number {
  let age = onDate.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const m = onDate.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (m < 0 || (m === 0 && onDate.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return Math.max(0, age);
}

/** NMW / NLW rates from 1 April 2026. */
export const UK_NMW_RATES_FROM_2026_04_01 = {
  AGE_21_AND_OVER: 12.71,
  AGE_18_TO_20: 10.85,
  UNDER_18: 8.0,
  APPRENTICE: 8.0,
} as const;

export type NmwWorkerCategory = 'AGE_21_AND_OVER' | 'AGE_18_TO_20' | 'UNDER_18' | 'APPRENTICE';

export function resolveNmwCategory(input: {
  ageOnPayPeriodEnd: number;
  isApprentice?: boolean;
  apprenticeEligible?: boolean;
}): NmwWorkerCategory {
  if (input.isApprentice && input.apprenticeEligible !== false) {
    // Apprentice rate only when eligible (typically first year / under 19 rules simplified here)
    if (input.ageOnPayPeriodEnd < 19 || input.apprenticeEligible) return 'APPRENTICE';
  }
  if (input.ageOnPayPeriodEnd >= 21) return 'AGE_21_AND_OVER';
  if (input.ageOnPayPeriodEnd >= 18) return 'AGE_18_TO_20';
  return 'UNDER_18';
}

export function nmwHourlyRate(
  category: NmwWorkerCategory,
  asOf: Date = new Date('2026-04-01T00:00:00.000Z'),
): number {
  // Single band table for post-1-Apr-2026; pre-change callers can pass an earlier config later
  if (asOf < new Date('2026-04-01T00:00:00.000Z')) {
    // 2025–26 NLW placeholder
    if (category === 'AGE_21_AND_OVER') return 12.21;
    if (category === 'AGE_18_TO_20') return 10.0;
    return 7.55;
  }
  return UK_NMW_RATES_FROM_2026_04_01[category];
}

export type NmwPayComponent = {
  amount: number;
  includesInNmwPay: boolean;
  countsAsNmwHours?: boolean;
  hours?: number;
};

export type NmwValidationResult = {
  eligiblePay: number;
  nmwHours: number;
  effectiveHourly: number;
  requiredHourly: number;
  compliant: boolean;
  shortfall: number;
  topUp: number;
  category: NmwWorkerCategory;
  explanation: string;
};

/**
 * NMW check over the whole pay reference period — not per visit.
 * Mileage/expense reimbursements must set includesInNmwPay=false.
 */
export function validateMinimumWage(input: {
  category: NmwWorkerCategory;
  components: NmwPayComponent[];
  asOf?: Date;
}): NmwValidationResult {
  const requiredHourly = nmwHourlyRate(input.category, input.asOf);
  const eligiblePay = input.components
    .filter((c) => c.includesInNmwPay)
    .reduce((s, c) => s + c.amount, 0);
  const nmwHours = input.components
    .filter((c) => c.countsAsNmwHours)
    .reduce((s, c) => s + (c.hours ?? 0), 0);

  const effectiveHourly = nmwHours > 0 ? eligiblePay / nmwHours : 0;
  const compliant = nmwHours <= 0 || effectiveHourly + 1e-9 >= requiredHourly;
  const shortfall =
    nmwHours > 0 && !compliant
      ? Math.round((requiredHourly * nmwHours - eligiblePay) * 100) / 100
      : 0;

  return {
    eligiblePay: Math.round(eligiblePay * 100) / 100,
    nmwHours: Math.round(nmwHours * 1000) / 1000,
    effectiveHourly: Math.round(effectiveHourly * 10000) / 10000,
    requiredHourly,
    compliant,
    shortfall,
    topUp: shortfall,
    category: input.category,
    explanation: compliant
      ? `NMW OK: £${effectiveHourly.toFixed(4)}/hr ≥ £${requiredHourly.toFixed(2)} (${input.category})`
      : `NMW shortfall £${shortfall.toFixed(2)}: £${effectiveHourly.toFixed(4)}/hr < £${requiredHourly.toFixed(2)} (${input.category})`,
  };
}

export type AllowanceFlags = {
  taxable: boolean;
  pensionable: boolean;
  includedInHolidayAverage: boolean;
  includedInNmwPay: boolean;
};

export type AllowanceFrequency =
  | 'HOURLY'
  | 'PER_VISIT'
  | 'PER_SHIFT'
  | 'PER_DAY'
  | 'PER_WEEK'
  | 'PER_PAY_PERIOD'
  | 'ONE_OFF';

export function calculateAllowanceAmount(input: {
  amount: number;
  frequency: AllowanceFrequency;
  units: number;
}): number {
  return Math.round(input.amount * input.units * 100) / 100;
}

export function deductionWouldBreachNmw(input: {
  nmw: NmwValidationResult;
  deductionAmount: number;
  deductionReducesNmwPay: boolean;
}): { warn: boolean; message: string } {
  if (!input.deductionReducesNmwPay || input.nmw.nmwHours <= 0) {
    return { warn: false, message: '' };
  }
  const payAfter = input.nmw.eligiblePay - input.deductionAmount;
  const hourlyAfter = payAfter / input.nmw.nmwHours;
  if (hourlyAfter + 1e-9 < input.nmw.requiredHourly) {
    return {
      warn: true,
      message: `Deduction £${input.deductionAmount.toFixed(2)} would reduce NMW hourly to £${hourlyAfter.toFixed(4)} below £${input.nmw.requiredHourly.toFixed(2)}`,
    };
  }
  return { warn: false, message: '' };
}

/** Employer NI 2026–27 estimate: 15% above secondary threshold (£96/week). */
export const EMPLOYER_NI_RATE_2026_27 = 0.15;
export const EMPLOYER_NI_SECONDARY_THRESHOLD_WEEKLY = 96;
export const EMPLOYER_NI_SECONDARY_THRESHOLD_MONTHLY = 417;
export const EMPLOYER_PENSION_MIN_RATE = 0.03;

export function estimateEmployerCost(input: {
  grossPay: number;
  mileageAndExpenses?: number;
  holidayCost?: number;
  trainingCost?: number;
  otherOverhead?: number;
  payFrequency?: 'WEEKLY' | 'MONTHLY';
  applyEmployerNi?: boolean;
  applyEmployerPension?: boolean;
  pensionablePay?: number;
}): {
  employerNi: number;
  employerPension: number;
  totalEmploymentCost: number;
  explanation: string;
} {
  const threshold =
    input.payFrequency === 'MONTHLY'
      ? EMPLOYER_NI_SECONDARY_THRESHOLD_MONTHLY
      : EMPLOYER_NI_SECONDARY_THRESHOLD_WEEKLY;

  const employerNi =
    input.applyEmployerNi === false
      ? 0
      : Math.round(Math.max(0, input.grossPay - threshold) * EMPLOYER_NI_RATE_2026_27 * 100) / 100;

  const pensionBase = input.pensionablePay ?? input.grossPay;
  const employerPension =
    input.applyEmployerPension === false
      ? 0
      : Math.round(pensionBase * EMPLOYER_PENSION_MIN_RATE * 100) / 100;

  const total =
    Math.round(
      (input.grossPay +
        employerNi +
        employerPension +
        (input.holidayCost ?? 0) +
        (input.trainingCost ?? 0) +
        (input.mileageAndExpenses ?? 0) +
        (input.otherOverhead ?? 0)) *
        100,
    ) / 100;

  return {
    employerNi,
    employerPension,
    totalEmploymentCost: total,
    explanation: `Employer cost £${total.toFixed(2)} (NI £${employerNi.toFixed(2)} + pension £${employerPension.toFixed(2)} + gross/expenses)`,
  };
}

/** Statutory pay types — configuration hooks only; amounts from payroll engine. */
export const STATUTORY_PAY_TYPES = [
  'SSP',
  'SMP',
  'SPP',
  'SAP',
  'SHPP',
  'SPBP',
  'SNCP',
  'JURY_SERVICE',
  'COMPASSIONATE',
  'UNPAID_LEAVE',
  'CONTRACTUAL_SICK',
] as const;

export type StatutoryPayType = (typeof STATUTORY_PAY_TYPES)[number];

/** SSP from 6 April 2026: lower of 80% AWE or £123.25/week; no waiting days. */
export function estimateSspWeekly2026(averageWeeklyEarnings: number): {
  amount: number;
  explanation: string;
} {
  const cap = 123.25;
  const eighty = averageWeeklyEarnings * 0.8;
  const amount = Math.round(Math.min(eighty, cap) * 100) / 100;
  return {
    amount,
    explanation: `SSP estimate min(80% of £${averageWeeklyEarnings.toFixed(2)}, £${cap.toFixed(2)}) = £${amount.toFixed(2)}`,
  };
}

export type PayComponentRecord = {
  workerId: string;
  shiftOrVisitId?: string | null;
  payPeriodId?: string | null;
  componentType: string;
  sourceDurationMinutes?: number | null;
  approvedDurationMinutes?: number | null;
  appliedRate?: number | null;
  multiplier?: number | null;
  amount: number;
  taxable: boolean;
  pensionable: boolean;
  nmwInclusion: boolean;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO';
  calculationExplanation: string;
  rateCardId?: string | null;
  rateCardVersion?: number | null;
};

export function buildPayComponent(
  partial: Omit<PayComponentRecord, 'approvalStatus' | 'taxable' | 'pensionable' | 'nmwInclusion'> &
    Partial<Pick<PayComponentRecord, 'approvalStatus' | 'taxable' | 'pensionable' | 'nmwInclusion'>>,
): PayComponentRecord {
  return {
    taxable: partial.taxable ?? true,
    pensionable: partial.pensionable ?? true,
    nmwInclusion: partial.nmwInclusion ?? true,
    approvalStatus: partial.approvalStatus ?? 'AUTO',
    ...partial,
  };
}
