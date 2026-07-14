/**
 * UK mileage and travel/waiting gap helpers (2026–27 tax year defaults).
 */

export type MileageVehicleType = 'CAR_VAN' | 'MOTORCYCLE' | 'BICYCLE' | 'COMPANY_VEHICLE' | 'PUBLIC_TRANSPORT';

export type GapClassification =
  | 'PAID_WAITING'
  | 'PAID_TRAVEL'
  | 'UNPAID_REST_BREAK'
  | 'UNPAID_PERSONAL'
  | 'REQUIRES_MANAGER_REVIEW';

export type TravelSubtype =
  | 'SERVICE_USER_TO_SERVICE_USER'
  | 'BRANCH_TO_SERVICE_USER'
  | 'MANDATORY_TRAINING'
  | 'TRANSPORTING_WORKER'
  | 'ACCOMPANYING_SERVICE_USER'
  | 'SPLIT_SHIFT'
  | 'PUBLIC_TRANSPORT'
  | 'WALKING_CYCLING'
  | 'MANUAL_ADJUSTMENT'
  | 'EXCLUDED_COMMUTE';

export type CommuteMileagePolicy = 'EXCLUDE' | 'INCLUDE_AS_BUSINESS' | 'ORG_POLICY';

/** HMRC approved mileage amounts from 6 April 2026 (car/van 55p first 10k). */
export const UK_MILEAGE_RATES_2026_27 = {
  CAR_VAN_FIRST_10000: 0.55,
  CAR_VAN_OVER_10000: 0.25,
  MOTORCYCLE: 0.24,
  BICYCLE: 0.2,
  PASSENGER_SUPPLEMENT: 0.05,
  ANNUAL_THRESHOLD_MILES: 10_000,
} as const;

export type MileageCalcInput = {
  miles: number;
  vehicleType: MileageVehicleType;
  /** Business miles already claimed in the tax year before this claim. */
  ytdBusinessMiles?: number;
  passengerMiles?: number;
  /** Override rates from pay card (flat rate) — still applies threshold split for CAR_VAN when using UK defaults. */
  cardRatePerMile?: number | null;
  useUkApprovedRates?: boolean;
};

export type MileageCalcResult = {
  amount: number;
  unitRate: number;
  passengerAmount: number;
  totalAmount: number;
  milesAtPrimaryRate: number;
  milesAtSecondaryRate: number;
  explanation: string;
  countsTowardNmw: false;
};

export function calculateUkMileage(input: MileageCalcInput): MileageCalcResult | null {
  const miles = input.miles;
  if (miles <= 0) return null;

  const ytd = input.ytdBusinessMiles ?? 0;
  const useUk = input.useUkApprovedRates !== false;
  let primaryRate: number;
  let secondaryRate: number;
  let threshold: number = UK_MILEAGE_RATES_2026_27.ANNUAL_THRESHOLD_MILES;

  if (!useUk && input.cardRatePerMile != null) {
    primaryRate = Number(input.cardRatePerMile);
    secondaryRate = primaryRate;
    threshold = Number.POSITIVE_INFINITY;
  } else {
    switch (input.vehicleType) {
      case 'MOTORCYCLE':
        primaryRate = UK_MILEAGE_RATES_2026_27.MOTORCYCLE;
        secondaryRate = UK_MILEAGE_RATES_2026_27.MOTORCYCLE;
        break;
      case 'BICYCLE':
        primaryRate = UK_MILEAGE_RATES_2026_27.BICYCLE;
        secondaryRate = UK_MILEAGE_RATES_2026_27.BICYCLE;
        break;
      case 'PUBLIC_TRANSPORT':
        return null; // receipt-based, not per-mile AMAPs
      case 'COMPANY_VEHICLE':
      case 'CAR_VAN':
      default:
        primaryRate = input.cardRatePerMile ?? UK_MILEAGE_RATES_2026_27.CAR_VAN_FIRST_10000;
        secondaryRate = UK_MILEAGE_RATES_2026_27.CAR_VAN_OVER_10000;
        break;
    }
  }

  const remainingAtPrimary = Math.max(0, threshold - ytd);
  const milesAtPrimaryRate = Math.min(miles, remainingAtPrimary);
  const milesAtSecondaryRate = Math.max(0, miles - milesAtPrimaryRate);
  const amount =
    Math.round((milesAtPrimaryRate * primaryRate + milesAtSecondaryRate * secondaryRate) * 100) / 100;
  const unitRate = milesAtSecondaryRate > 0 && milesAtPrimaryRate === 0 ? secondaryRate : primaryRate;

  const passengerMiles = Math.min(input.passengerMiles ?? 0, miles);
  const passengerAmount =
    Math.round(passengerMiles * UK_MILEAGE_RATES_2026_27.PASSENGER_SUPPLEMENT * 100) / 100;

  return {
    amount,
    unitRate,
    passengerAmount,
    totalAmount: Math.round((amount + passengerAmount) * 100) / 100,
    milesAtPrimaryRate,
    milesAtSecondaryRate,
    explanation:
      milesAtSecondaryRate > 0
        ? `${milesAtPrimaryRate.toFixed(2)} mi × £${primaryRate.toFixed(2)} + ${milesAtSecondaryRate.toFixed(2)} mi × £${secondaryRate.toFixed(2)}` +
          (passengerAmount > 0 ? ` + passenger £${passengerAmount.toFixed(2)}` : '')
        : `${miles.toFixed(2)} mi × £${primaryRate.toFixed(2)}` +
          (passengerAmount > 0 ? ` + passenger £${passengerAmount.toFixed(2)}` : ''),
    countsTowardNmw: false,
  };
}

export type GapClassifyInput = {
  gapMinutes: number;
  /** Worker returned home between assignments. */
  returnedHome?: boolean;
  /** Travel was recorded for this gap. */
  hasApprovedTravel?: boolean;
  /** Short gap where worker cannot reasonably use time personally. */
  cannotUsePersonally?: boolean;
  /** Explicitly marked genuine rest. */
  genuineRestBreak?: boolean;
  /** Service-user or clinical delay. */
  employerRequiredWait?: boolean;
  /** Threshold (minutes) below which short gaps default to paid waiting when cannot use personally. */
  shortGapMinutes?: number;
  /** Threshold above which gaps default to unpaid rest if returned home. */
  longBreakMinutes?: number;
};

/**
 * Classify rota gaps — never auto-treat every gap as unpaid break.
 */
export function classifyGapBetweenVisits(input: GapClassifyInput): GapClassification {
  const short = input.shortGapMinutes ?? 15;
  const long = input.longBreakMinutes ?? 60;

  if (input.genuineRestBreak) return 'UNPAID_REST_BREAK';
  if (input.hasApprovedTravel) return 'PAID_TRAVEL';
  if (input.employerRequiredWait) return 'PAID_WAITING';
  if (input.returnedHome && input.gapMinutes >= long) return 'UNPAID_PERSONAL';
  if (input.cannotUsePersonally && input.gapMinutes <= short) return 'PAID_WAITING';
  if (input.returnedHome) return 'UNPAID_PERSONAL';
  if (input.gapMinutes > long) return 'REQUIRES_MANAGER_REVIEW';
  if (input.gapMinutes <= short) return 'REQUIRES_MANAGER_REVIEW';
  return 'REQUIRES_MANAGER_REVIEW';
}

export function isTravelPayableSubtype(subtype: TravelSubtype): boolean {
  return subtype !== 'EXCLUDED_COMMUTE';
}

export function applyCommuteMileagePolicy(
  miles: number,
  leg: 'HOME_TO_FIRST' | 'LAST_TO_HOME' | 'BETWEEN_ASSIGNMENTS',
  policy: CommuteMileagePolicy,
): number {
  if (leg === 'BETWEEN_ASSIGNMENTS') return miles;
  if (policy === 'EXCLUDE') return 0;
  if (policy === 'INCLUDE_AS_BUSINESS') return miles;
  // ORG_POLICY — treat as excluded by default until org overrides
  return 0;
}

export function calculateTravelTimePay(
  travelMinutes: number,
  travelHourlyRate: number,
): { amount: number; explanation: string } | null {
  if (travelMinutes <= 0 || travelHourlyRate < 0) return null;
  const amount = Math.round(travelHourlyRate * (travelMinutes / 60) * 100) / 100;
  return {
    amount,
    explanation: `${travelMinutes} min ÷ 60 × £${travelHourlyRate.toFixed(2)}/hr = £${amount.toFixed(2)}`,
  };
}
