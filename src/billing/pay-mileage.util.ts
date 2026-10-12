/**
 * UK mileage and travel/waiting gap helpers. Mileage rates are read from `billing.MileageRate`
 * for the day of the journey (TR-09); none is fixed here.
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

/**
 * TR-09: mileage rates in force for a day and vehicle type. Read from `billing.MileageRate`; none
 * of these figures is fixed in the code. `approved` is HMRC's tax-free amount for the same
 * period and is null until a person has verified it.
 */
export type MileageRates = {
  rateFirst: number;
  rateAfter: number;
  /** Business miles in the tax year after which `rateAfter` applies; null = no threshold. */
  thresholdMiles: number | null;
  passengerRate: number;
  approved: {
    rateFirst: number;
    rateAfter: number;
    thresholdMiles: number | null;
    passengerRate: number;
  } | null;
};

export type MileageRateRow = {
  effectiveFrom: Date;
  vehicleType: string;
  rateFirst: unknown;
  rateAfter: unknown;
  thresholdMiles: number | null;
  passengerRate: unknown;
  approvedRateFirst: unknown;
  approvedRateAfter: unknown;
  approvedThresholdMiles: number | null;
  approvedPassengerRate: unknown;
  approvedVerifiedAt: Date | null;
};

/** The rates in force on a local day (YYYY-MM-DD) for a vehicle type, or null when none is recorded. */
export function pickMileageRates(
  rows: MileageRateRow[],
  vehicleType: MileageVehicleType,
  dayKey: string,
): MileageRates | null {
  const row = rows
    .filter((r) => r.vehicleType === vehicleType && r.effectiveFrom.toISOString().slice(0, 10) <= dayKey)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
  if (!row) return null;
  // Approved amounts count only once a person has verified them.
  const verified = !!row.approvedVerifiedAt && row.approvedRateFirst != null;
  return {
    rateFirst: Number(row.rateFirst),
    rateAfter: Number(row.rateAfter),
    thresholdMiles: row.thresholdMiles,
    passengerRate: Number(row.passengerRate),
    approved: verified
      ? {
          rateFirst: Number(row.approvedRateFirst),
          rateAfter: Number(row.approvedRateAfter ?? row.approvedRateFirst),
          thresholdMiles: row.approvedThresholdMiles,
          passengerRate: Number(row.approvedPassengerRate ?? 0),
        }
      : null,
  };
}

/** First day (YYYY-MM-DD) of the UK tax year a local day falls in: 6 April. */
export function ukTaxYearStartKey(dayKey: string): string {
  const year = Number(dayKey.slice(0, 4));
  return dayKey >= `${year}-04-06` ? `${year}-04-06` : `${year - 1}-04-06`;
}

/**
 * Miles of a mileage line. Lines written before miles were stored have them in the description
 * ("Mileage — VIS-… (12.50 mi)"); locked lines are history and are read, never rewritten.
 */
export function milesOfMileageLine(line: { quantity?: unknown; description?: string | null }): number {
  if (line.quantity != null) return Number(line.quantity);
  const match = /\(([0-9]+(?:\.[0-9]+)?) mi\)/.exec(line.description ?? '');
  return match ? Number(match[1]) : 0;
}

export type MileageTaxTreatment = 'TAX_FREE' | 'PART_TAXABLE' | 'NOT_VERIFIED';

export type MileageCalcInput = {
  miles: number;
  vehicleType: MileageVehicleType;
  /** Business miles already reimbursed in the tax year before this claim. */
  ytdBusinessMiles?: number;
  passengerMiles?: number;
  /** The pay card's own rate per mile, where it has one. */
  cardRatePerMile?: number | null;
  /** False: the card's rate is a flat rate with no threshold. */
  useUkApprovedRates?: boolean;
  /** Rates in force on the day of the journey; null when none is recorded. */
  rates: MileageRates | null;
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
  /** TR-13: the part within HMRC's approved amount and the part above it. Null when not verified. */
  taxTreatment: MileageTaxTreatment;
  taxFreeAmount: number | null;
  taxableAmount: number | null;
  passengerTaxFreeAmount: number | null;
  passengerTaxableAmount: number | null;
};

const pence = (n: number) => Math.round(n * 100) / 100;

function splitAtThreshold(miles: number, ytd: number, threshold: number | null) {
  const remaining = threshold == null ? Number.POSITIVE_INFINITY : Math.max(0, threshold - ytd);
  const first = Math.min(miles, remaining);
  return { first, after: Math.max(0, miles - first) };
}

/**
 * What the organisation reimburses for a journey, and how much of it is within HMRC's approved
 * amount. The two are worked out separately: a rate above the approved amount is paid in full and
 * the part above is taxable; it is never assumed that the whole payment is tax-free.
 */
export function calculateUkMileage(input: MileageCalcInput): MileageCalcResult | null {
  const miles = input.miles;
  if (miles <= 0) return null;
  if (input.vehicleType === 'PUBLIC_TRANSPORT') return null; // receipt-based, not per-mile

  const ytd = input.ytdBusinessMiles ?? 0;
  const useUk = input.useUkApprovedRates !== false;
  const rates = input.rates;
  let primaryRate: number;
  let secondaryRate: number;
  let threshold: number | null;

  if (!useUk && input.cardRatePerMile != null) {
    primaryRate = Number(input.cardRatePerMile);
    secondaryRate = primaryRate;
    threshold = null;
  } else if (!rates) {
    // No rate recorded for the day: only a card's own rate can price the journey, flat.
    if (input.cardRatePerMile == null) return null;
    primaryRate = Number(input.cardRatePerMile);
    secondaryRate = primaryRate;
    threshold = null;
  } else if (input.vehicleType === 'MOTORCYCLE' || input.vehicleType === 'BICYCLE') {
    primaryRate = rates.rateFirst;
    secondaryRate = rates.rateAfter;
    threshold = rates.thresholdMiles;
  } else {
    primaryRate = input.cardRatePerMile ?? rates.rateFirst;
    secondaryRate = rates.rateAfter;
    threshold = rates.thresholdMiles;
  }

  const paid = splitAtThreshold(miles, ytd, threshold);
  const amount = pence(paid.first * primaryRate + paid.after * secondaryRate);
  const unitRate = paid.after > 0 && paid.first === 0 ? secondaryRate : primaryRate;

  const passengerMiles = Math.min(input.passengerMiles ?? 0, miles);
  const passengerAmount = pence(passengerMiles * (rates?.passengerRate ?? 0));

  let taxTreatment: MileageTaxTreatment = 'NOT_VERIFIED';
  let taxFreeAmount: number | null = null;
  let taxableAmount: number | null = null;
  let passengerTaxFreeAmount: number | null = null;
  let passengerTaxableAmount: number | null = null;
  if (rates?.approved) {
    const within = splitAtThreshold(miles, ytd, rates.approved.thresholdMiles);
    const approvedAmount = pence(
      within.first * rates.approved.rateFirst + within.after * rates.approved.rateAfter,
    );
    taxFreeAmount = Math.min(amount, approvedAmount);
    taxableAmount = pence(amount - taxFreeAmount);
    passengerTaxFreeAmount = Math.min(
      passengerAmount,
      pence(passengerMiles * rates.approved.passengerRate),
    );
    passengerTaxableAmount = pence(passengerAmount - passengerTaxFreeAmount);
    taxTreatment = taxableAmount > 0 || passengerTaxableAmount > 0 ? 'PART_TAXABLE' : 'TAX_FREE';
  }

  return {
    amount,
    unitRate,
    passengerAmount,
    totalAmount: pence(amount + passengerAmount),
    milesAtPrimaryRate: paid.first,
    milesAtSecondaryRate: paid.after,
    explanation:
      paid.after > 0
        ? `${paid.first.toFixed(2)} mi × £${primaryRate.toFixed(2)} + ${paid.after.toFixed(2)} mi × £${secondaryRate.toFixed(2)}` +
          (passengerAmount > 0 ? ` + passenger £${passengerAmount.toFixed(2)}` : '')
        : `${miles.toFixed(2)} mi × £${primaryRate.toFixed(2)}` +
          (passengerAmount > 0 ? ` + passenger £${passengerAmount.toFixed(2)}` : ''),
    countsTowardNmw: false,
    taxTreatment,
    taxFreeAmount,
    taxableAmount,
    passengerTaxFreeAmount,
    passengerTaxableAmount,
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
