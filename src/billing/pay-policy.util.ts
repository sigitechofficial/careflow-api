/**
 * Overtime, non-visit activities, cancellation, and double-up pay helpers.
 */

export type OvertimeMethod =
  | 'BASE'
  | 'TIME_AND_QUARTER'
  | 'TIME_AND_HALF'
  | 'DOUBLE'
  | 'FIXED_ADDITIONAL';

export type OvertimeCalcInput = {
  baseHourlyRate: number;
  overtimeMinutes: number;
  method: OvertimeMethod;
  fixedAdditionalPerHour?: number;
  /** When false (default), do not multiply an already-enhanced Sunday/BH rate again. */
  stackWithTimeBand?: boolean;
  /** Pre-enhanced band rate if stacking is allowed. */
  alreadyEnhancedHourlyRate?: number;
};

export function overtimeMultiplier(method: OvertimeMethod): number {
  switch (method) {
    case 'TIME_AND_QUARTER':
      return 1.25;
    case 'TIME_AND_HALF':
      return 1.5;
    case 'DOUBLE':
      return 2;
    case 'BASE':
    case 'FIXED_ADDITIONAL':
    default:
      return 1;
  }
}

export function calculateOvertimePay(input: OvertimeCalcInput): {
  amount: number;
  hourlyRate: number;
  explanation: string;
} {
  const startRate =
    input.stackWithTimeBand && input.alreadyEnhancedHourlyRate != null
      ? input.alreadyEnhancedHourlyRate
      : input.baseHourlyRate;

  let hourlyRate: number;
  if (input.method === 'FIXED_ADDITIONAL') {
    hourlyRate = startRate + (input.fixedAdditionalPerHour ?? 0);
  } else {
    hourlyRate = startRate * overtimeMultiplier(input.method);
  }

  const amount = Math.round(hourlyRate * (input.overtimeMinutes / 60) * 100) / 100;
  return {
    amount,
    hourlyRate,
    explanation: `Overtime ${input.overtimeMinutes}m × £${hourlyRate.toFixed(2)}/hr (${input.method}) = £${amount.toFixed(2)}`,
  };
}

/** Minutes over weekly contracted hours that qualify as overtime (no daily+weekly double count). */
export function weeklyOvertimeMinutes(
  totalWorkedMinutes: number,
  contractedWeeklyMinutes: number,
  alreadyPaidDailyOvertimeMinutes = 0,
): number {
  const over = Math.max(0, totalWorkedMinutes - contractedWeeklyMinutes);
  return Math.max(0, over - alreadyPaidDailyOvertimeMinutes);
}

export const NON_VISIT_ACTIVITY_CODES = [
  'MANDATORY_INDUCTION',
  'MANDATORY_TRAINING',
  'E_LEARNING',
  'SHADOW_SHIFT',
  'SUPERVISION',
  'APPRAISAL',
  'TEAM_MEETING',
  'HANDOVER',
  'CARE_PLAN_REVIEW',
  'MEDICATION_AUDIT',
  'OFFICE_ADMIN',
  'INCIDENT_REPORTING',
  'CARE_NOTES',
  'MANDATORY_PHONE_CALL',
  'COLLECT_PPE',
  'COLLECT_KEYS',
  'RETURN_KEYS',
  'DBS_APPOINTMENT',
  'OH_APPOINTMENT',
  'COURT_SAFEGUARDING',
  'HOSPITAL_ESCORT',
  'ACCOMPANYING_SERVICE_USER',
  'BRANCH_DUTY',
  'ROTA_COORDINATION',
] as const;

export type NonVisitActivityCode = (typeof NON_VISIT_ACTIVITY_CODES)[number];

export type NonVisitActivityConfig = {
  code: NonVisitActivityCode | string;
  payable: boolean;
  hourlyRate?: number | null;
  fixedAmount?: number | null;
  minimumMinutes?: number | null;
  travelPayable?: boolean;
  mileagePayable?: boolean;
  requiresApproval?: boolean;
};

export function calculateNonVisitActivityPay(
  config: NonVisitActivityConfig,
  minutes: number,
): { amount: number; explanation: string } | null {
  if (!config.payable) return null;
  const payableMins = Math.max(minutes, config.minimumMinutes ?? 0);
  if (config.fixedAmount != null) {
    return {
      amount: Number(config.fixedAmount),
      explanation: `${config.code} fixed £${Number(config.fixedAmount).toFixed(2)}`,
    };
  }
  if (config.hourlyRate == null || payableMins <= 0) return null;
  const amount = Math.round(Number(config.hourlyRate) * (payableMins / 60) * 100) / 100;
  return {
    amount,
    explanation: `${config.code} ${payableMins}m × £${Number(config.hourlyRate).toFixed(2)}/hr = £${amount.toFixed(2)}`,
  };
}

export type CancellationNoticeBand =
  | 'MORE_THAN_48H'
  | 'BETWEEN_24_AND_48H'
  | 'LESS_THAN_24H'
  | 'AFTER_TRAVEL_STARTED'
  | 'AFTER_ARRIVAL'
  | 'SU_NOT_HOME'
  | 'HOSPITAL_ADMISSION'
  | 'CLIENT_DEATH'
  | 'PACKAGE_SUSPENSION';

export type CancellationWorkerOutcome =
  | 'NO_PAY'
  | 'PARTIAL_VISIT_PAY'
  | 'FULL_SCHEDULED_PAY'
  | 'MINIMUM_CANCELLATION_PAYMENT'
  | 'TRAVEL_TIME_ONLY'
  | 'TRAVEL_AND_MILEAGE'
  | 'GUARANTEED_HOURS_PROTECTION'
  | 'ALTERNATIVE_WORK_OFFERED';

export const DEFAULT_CANCELLATION_POLICY: Record<CancellationNoticeBand, CancellationWorkerOutcome> = {
  MORE_THAN_48H: 'NO_PAY',
  BETWEEN_24_AND_48H: 'PARTIAL_VISIT_PAY',
  LESS_THAN_24H: 'FULL_SCHEDULED_PAY',
  AFTER_TRAVEL_STARTED: 'TRAVEL_AND_MILEAGE',
  AFTER_ARRIVAL: 'FULL_SCHEDULED_PAY',
  SU_NOT_HOME: 'FULL_SCHEDULED_PAY',
  HOSPITAL_ADMISSION: 'PARTIAL_VISIT_PAY',
  CLIENT_DEATH: 'FULL_SCHEDULED_PAY',
  PACKAGE_SUSPENSION: 'NO_PAY',
};

export function resolveCancellationOutcome(
  band: CancellationNoticeBand,
  policy: Partial<Record<CancellationNoticeBand, CancellationWorkerOutcome>> = {},
): CancellationWorkerOutcome {
  return policy[band] ?? DEFAULT_CANCELLATION_POLICY[band];
}

export function calculateCancellationPay(input: {
  outcome: CancellationWorkerOutcome;
  scheduledVisitPay: number;
  partialFraction?: number;
  minimumCancellationAmount?: number;
  travelTimePay?: number;
  mileageAmount?: number;
}): { amount: number; explanation: string } {
  switch (input.outcome) {
    case 'NO_PAY':
    case 'ALTERNATIVE_WORK_OFFERED':
      return { amount: 0, explanation: `Cancellation: ${input.outcome}` };
    case 'PARTIAL_VISIT_PAY': {
      const frac = input.partialFraction ?? 0.5;
      const amount = Math.round(input.scheduledVisitPay * frac * 100) / 100;
      return { amount, explanation: `Cancellation partial (${frac * 100}%) £${amount.toFixed(2)}` };
    }
    case 'FULL_SCHEDULED_PAY':
    case 'GUARANTEED_HOURS_PROTECTION':
      return {
        amount: input.scheduledVisitPay,
        explanation: `Cancellation ${input.outcome} £${input.scheduledVisitPay.toFixed(2)}`,
      };
    case 'MINIMUM_CANCELLATION_PAYMENT': {
      const amount = input.minimumCancellationAmount ?? 0;
      return { amount, explanation: `Minimum cancellation £${amount.toFixed(2)}` };
    }
    case 'TRAVEL_TIME_ONLY':
      return {
        amount: input.travelTimePay ?? 0,
        explanation: `Cancellation travel only £${(input.travelTimePay ?? 0).toFixed(2)}`,
      };
    case 'TRAVEL_AND_MILEAGE': {
      const amount = Math.round(((input.travelTimePay ?? 0) + (input.mileageAmount ?? 0)) * 100) / 100;
      return { amount, explanation: `Cancellation travel+mileage £${amount.toFixed(2)}` };
    }
    default:
      return { amount: 0, explanation: 'Cancellation: unknown outcome' };
  }
}

export type DoubleUpRole = 'LEAD' | 'SECOND' | 'DRIVER' | 'NURSE' | 'SHADOW' | 'OBSERVER';

export function calculateDoubleUpSupplement(input: {
  role: DoubleUpRole;
  baseVisitPay: number;
  leadSupplement?: number;
  driverSupplement?: number;
  secondCarerRateOverride?: number | null;
  nurseSupplement?: number;
  shadowPayable?: boolean;
  observerPayable?: boolean;
}): { amount: number; explanation: string } {
  switch (input.role) {
    case 'OBSERVER':
      if (!input.observerPayable) {
        return { amount: 0, explanation: 'Unpaid observer' };
      }
      return { amount: input.baseVisitPay, explanation: 'Observer paid at base (policy)' };
    case 'SHADOW':
      if (!input.shadowPayable) {
        return { amount: 0, explanation: 'Unpaid shadow' };
      }
      return { amount: input.baseVisitPay, explanation: 'Shadow paid at base' };
    case 'LEAD': {
      const amount = input.baseVisitPay + (input.leadSupplement ?? 0);
      return { amount, explanation: `Lead carer £${amount.toFixed(2)}` };
    }
    case 'DRIVER': {
      const amount = input.baseVisitPay + (input.driverSupplement ?? 0);
      return { amount, explanation: `Driver £${amount.toFixed(2)}` };
    }
    case 'NURSE': {
      const amount = input.baseVisitPay + (input.nurseSupplement ?? 0);
      return { amount, explanation: `Nurse £${amount.toFixed(2)}` };
    }
    case 'SECOND':
    default: {
      if (input.secondCarerRateOverride != null) {
        return {
          amount: input.secondCarerRateOverride,
          explanation: `Second carer override £${input.secondCarerRateOverride.toFixed(2)}`,
        };
      }
      return { amount: input.baseVisitPay, explanation: `Second carer £${input.baseVisitPay.toFixed(2)}` };
    }
  }
}
