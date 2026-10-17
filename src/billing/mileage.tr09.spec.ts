/**
 * TR-09 / TR-13: mileage rates per period, year-to-date thresholds and tax treatment.
 *
 * Every rate in this file is a SYNTHETIC TEST VALUE. None is a statement of what the organisation
 * pays or of what HMRC approves.
 */
import {
  calculateUkMileage,
  type MileageRateRow,
  type MileageRates,
  milesOfMileageLine,
  pickMileageRates,
  ukTaxYearStartKey,
} from './pay-mileage.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const row = (over: Partial<MileageRateRow>): MileageRateRow => ({
  effectiveFrom: d('2000-04-06'),
  vehicleType: 'CAR_VAN',
  rateFirst: 0.55,
  rateAfter: 0.25,
  thresholdMiles: 10_000,
  passengerRate: 0.05,
  approvedRateFirst: null,
  approvedRateAfter: null,
  approvedThresholdMiles: null,
  approvedPassengerRate: null,
  approvedVerifiedAt: null,
  ...over,
});
/** Synthetic: the organisation pays 55p then 25p; the approved amount is 45p then 25p. */
const rates = (over: Partial<MileageRates> = {}): MileageRates => ({
  rateFirst: 0.55,
  rateAfter: 0.25,
  thresholdMiles: 10_000,
  passengerRate: 0.05,
  approved: { rateFirst: 0.45, rateAfter: 0.25, thresholdMiles: 10_000, passengerRate: 0.05 },
  ...over,
});

describe('TR-09: the rates in force on the day of the journey', () => {
  const rows = [
    row({}),
    row({ effectiveFrom: d('2027-04-06'), rateFirst: 0.6, rateAfter: 0.3 }),
    row({ vehicleType: 'BICYCLE', rateFirst: 0.2, rateAfter: 0.2, thresholdMiles: null }),
  ];

  it('each period has its own rates', () => {
    expect(pickMileageRates(rows, 'CAR_VAN', '2027-04-05')).toMatchObject({ rateFirst: 0.55, rateAfter: 0.25 });
    expect(pickMileageRates(rows, 'CAR_VAN', '2027-04-06')).toMatchObject({ rateFirst: 0.6, rateAfter: 0.3 });
    expect(pickMileageRates(rows, 'BICYCLE', '2030-01-01')).toMatchObject({ rateFirst: 0.2, thresholdMiles: null });
  });

  it('no rate recorded for the day or the vehicle is said, not guessed', () => {
    expect(pickMileageRates(rows, 'CAR_VAN', '1999-12-31')).toBeNull();
    expect(pickMileageRates(rows, 'MOTORCYCLE', '2027-01-01')).toBeNull();
    expect(pickMileageRates([], 'CAR_VAN', '2027-01-01')).toBeNull();
  });

  it('approved amounts count only once a person has verified them', () => {
    const entered = row({ approvedRateFirst: 0.45, approvedRateAfter: 0.25, approvedThresholdMiles: 10_000 });
    expect(pickMileageRates([entered], 'CAR_VAN', '2027-01-01')?.approved).toBeNull();
    const verified = { ...entered, approvedVerifiedAt: d('2027-01-02') };
    expect(pickMileageRates([verified], 'CAR_VAN', '2027-01-01')?.approved).toEqual({ rateFirst: 0.45, rateAfter: 0.25, thresholdMiles: 10_000, passengerRate: 0 });
  });
});

describe('TR-09: the tax year and the miles counted in it', () => {
  it('the tax year starts on 6 April', () => {
    expect(ukTaxYearStartKey('2026-04-05')).toBe('2025-04-06');
    expect(ukTaxYearStartKey('2026-04-06')).toBe('2026-04-06');
    expect(ukTaxYearStartKey('2026-04-01')).toBe('2025-04-06'); // was counted in the new year
    expect(ukTaxYearStartKey('2027-01-10')).toBe('2026-04-06');
    expect(ukTaxYearStartKey('2026-12-31')).toBe('2026-04-06');
  });

  it('miles come from the line; older lines carry them in their description', () => {
    expect(milesOfMileageLine({ quantity: 12.5, description: 'Mileage — VIS-1 (99.00 mi)' })).toBe(12.5);
    expect(milesOfMileageLine({ quantity: null, description: 'Mileage — VIS-GEN-20261103-0001 (6.20 mi)' })).toBe(6.2);
    expect(milesOfMileageLine({ description: 'Mileage — VIS-1 (40.00 mi): 40.00 mi × £0.55' })).toBe(40);
    expect(milesOfMileageLine({ description: 'Mileage' })).toBe(0);
  });
});

describe('TR-09: reimbursement across the threshold', () => {
  const noApproved = rates({ approved: null });
  const claim = (miles: number, ytdBusinessMiles: number, over: Record<string, unknown> = {}) =>
    calculateUkMileage({ miles, vehicleType: 'CAR_VAN', ytdBusinessMiles, rates: noApproved, ...over });

  it('below, across and above the threshold', () => {
    expect(claim(20, 0)).toMatchObject({ amount: 11, milesAtPrimaryRate: 20, milesAtSecondaryRate: 0, unitRate: 0.55 });
    expect(claim(20, 9_990)).toMatchObject({ amount: 8, milesAtPrimaryRate: 10, milesAtSecondaryRate: 10 }); // 10 × 55p + 10 × 25p
    expect(claim(20, 10_000)).toMatchObject({ amount: 5, milesAtPrimaryRate: 0, milesAtSecondaryRate: 20, unitRate: 0.25 });
    expect(claim(20, 12_345)).toMatchObject({ amount: 5 });
    expect(claim(20, 9_990)?.explanation).toBe('10.00 mi × £0.55 + 10.00 mi × £0.25');
  });

  it("a pay card's own rate replaces the first rate; a flat card rate has no threshold", () => {
    expect(claim(10, 0, { cardRatePerMile: 0.4 })).toMatchObject({ amount: 4, unitRate: 0.4 });
    expect(claim(20, 9_990, { cardRatePerMile: 0.4 })).toMatchObject({ amount: 6.5 }); // 10 × 40p + 10 × 25p
    expect(claim(20, 9_990, { cardRatePerMile: 0.4, useUkApprovedRates: false })).toMatchObject({ amount: 8, milesAtSecondaryRate: 0 });
  });

  it('motorcycles and bicycles use their own recorded rate', () => {
    const bike = rates({ rateFirst: 0.2, rateAfter: 0.2, thresholdMiles: null, approved: null });
    expect(calculateUkMileage({ miles: 30, vehicleType: 'BICYCLE', ytdBusinessMiles: 50_000, cardRatePerMile: 0.9, rates: bike })).toMatchObject({ amount: 6 });
  });

  it('passenger miles are paid at the passenger rate, never for more miles than the journey', () => {
    expect(claim(10, 0, { passengerMiles: 25 })).toMatchObject({ amount: 5.5, passengerAmount: 0.5, totalAmount: 6 });
  });

  it('nothing to price with: no result, so the caller can say so', () => {
    expect(calculateUkMileage({ miles: 10, vehicleType: 'CAR_VAN', rates: null })).toBeNull();
    expect(calculateUkMileage({ miles: 10, vehicleType: 'CAR_VAN', rates: null, cardRatePerMile: 0.4 })).toMatchObject({ amount: 4 });
    expect(calculateUkMileage({ miles: 10, vehicleType: 'PUBLIC_TRANSPORT', rates: noApproved })).toBeNull();
    expect(calculateUkMileage({ miles: 0, vehicleType: 'CAR_VAN', rates: noApproved })).toBeNull();
  });
});

describe('TR-13: how much of a reimbursement is within the approved amount', () => {
  const claim = (miles: number, ytdBusinessMiles: number, r: MileageRates, over: Record<string, unknown> = {}) =>
    calculateUkMileage({ miles, vehicleType: 'CAR_VAN', ytdBusinessMiles, rates: r, ...over });

  it('paid above the approved amount: paid in full, and the part above is taxable', () => {
    expect(claim(10, 0, rates())).toMatchObject({ amount: 5.5, taxFreeAmount: 4.5, taxableAmount: 1, taxTreatment: 'PART_TAXABLE' });
  });

  it('paid at or below the approved amount: all of it is tax-free', () => {
    expect(claim(10, 0, rates({ rateFirst: 0.45 }))).toMatchObject({ amount: 4.5, taxFreeAmount: 4.5, taxableAmount: 0, taxTreatment: 'TAX_FREE' });
    expect(claim(10, 0, rates({ rateFirst: 0.3 }))).toMatchObject({ amount: 3, taxFreeAmount: 3, taxableAmount: 0, taxTreatment: 'TAX_FREE' });
  });

  it('approved amounts not verified: the treatment is not asserted either way', () => {
    expect(claim(10, 0, rates({ approved: null }))).toMatchObject({ amount: 5.5, taxFreeAmount: null, taxableAmount: null, taxTreatment: 'NOT_VERIFIED' });
  });

  it('the comparison follows the same miles across both thresholds', () => {
    // 10 miles below the threshold and 10 above: paid 10 × 55p + 10 × 25p = £8.00;
    // approved 10 × 45p + 10 × 25p = £7.00.
    expect(claim(20, 9_990, rates())).toMatchObject({ amount: 8, taxFreeAmount: 7, taxableAmount: 1 });
    // The organisation's threshold is higher than the approved one: more of the payment is above it.
    const generous = rates({ thresholdMiles: 20_000 });
    expect(claim(20, 9_990, generous)).toMatchObject({ amount: 11, taxFreeAmount: 7, taxableAmount: 4 });
  });

  it('the passenger payment is compared with its own approved amount', () => {
    const r = rates({ passengerRate: 0.08 });
    expect(claim(10, 0, r, { passengerMiles: 10 })).toMatchObject({ passengerAmount: 0.8, passengerTaxFreeAmount: 0.5, passengerTaxableAmount: 0.3, taxTreatment: 'PART_TAXABLE' });
  });
});
