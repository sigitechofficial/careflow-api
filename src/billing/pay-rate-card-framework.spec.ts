import {
  calculateBandedPay,
  splitIntoTimeSegments,
  applyEnhancement,
  type TimeBandRule,
} from './pay-time-band.util';
import { calculateUkMileage, classifyGapBetweenVisits } from './pay-mileage.util';
import {
  calculateSleepInPay,
  calculateWakingNightPay,
  calculateCallOutPay,
  calculateOnCallStandby,
  calculateLiveInDayPay,
} from './pay-overnight.util';
import {
  calculateOvertimePay,
  weeklyOvertimeMinutes,
  calculateNonVisitActivityPay,
  resolveCancellationOutcome,
  calculateCancellationPay,
  calculateDoubleUpSupplement,
} from './pay-policy.util';
import {
  calculateRolledUpHolidayPay,
  validateMinimumWage,
  resolveNmwCategory,
  estimateEmployerCost,
  estimateSspWeekly2026,
  deductionWouldBreachNmw,
  nmwHourlyRate,
} from './pay-compliance.util';
import { calculatePayableAmount } from './visit-reconciliation.util';

describe('pay-time-band.util', () => {
  const baseRules: TimeBandRule[] = [
    { label: 'Daytime', dayType: 'WEEKDAY', startTime: '06:00', endTime: '18:00', rateType: 'HOURLY', amount: 13.5, priority: 0, sortOrder: 0 },
    { label: 'Evening', dayType: 'WEEKDAY', startTime: '18:00', endTime: '22:00', rateType: 'HOURLY', amount: 14.5, priority: 1, sortOrder: 1 },
    { label: 'Night', dayType: 'WEEKDAY', startTime: '22:00', endTime: '06:00', rateType: 'HOURLY', amount: 15.5, priority: 2, sortOrder: 2 },
  ];

  it('Example 1: shift within one time band (Mon 09:00–12:00)', () => {
    const start = new Date('2026-07-13T09:00:00.000Z'); // Monday
    const end = new Date('2026-07-13T12:00:00.000Z');
    const result = calculateBandedPay({ start, end, rules: baseRules });
    expect(result?.totalAmount).toBe(40.5);
    expect(result?.segments).toHaveLength(1);
  });

  it('Example 2: shift crosses daytime and evening (17:00–21:00)', () => {
    const start = new Date('2026-07-13T17:00:00.000Z');
    const end = new Date('2026-07-13T21:00:00.000Z');
    const result = calculateBandedPay({ start, end, rules: baseRules });
    expect(result?.segments.length).toBeGreaterThanOrEqual(2);
    expect(result?.totalAmount).toBe(57);
  });

  it('Example 3: shift crosses midnight Sunday→Monday', () => {
    const rules: TimeBandRule[] = [
      { label: 'Sunday', dayType: 'SUNDAY', rateType: 'HOURLY', amount: 16, priority: 5, sortOrder: 0 },
      { label: 'Monday night', dayType: 'WEEKDAY', startTime: '22:00', endTime: '06:00', rateType: 'HOURLY', amount: 15.5, priority: 2, sortOrder: 1 },
    ];
    const start = new Date('2026-07-12T21:00:00.000Z'); // Sunday
    const end = new Date('2026-07-13T01:00:00.000Z'); // Monday
    const result = calculateBandedPay({ start, end, rules });
    expect(result?.totalMinutes).toBe(240);
    expect(result?.totalAmount).toBe(63.5);
  });

  it('Christmas priority wins over Sunday under PRIORITY policy', () => {
    const rules: TimeBandRule[] = [
      { label: 'Sunday', dayType: 'SUNDAY', rateType: 'HOURLY', amount: 16, priority: 1, sortOrder: 0 },
      {
        label: 'Christmas',
        dayType: 'CHRISTMAS',
        rateType: 'UPLIFT',
        amount: 2,
        multiplier: 2,
        enhancementMethod: 'MULTIPLIER',
        priority: 10,
        sortOrder: 0,
      },
      { label: 'Base', dayType: 'WEEKDAY', rateType: 'HOURLY', amount: 14, priority: 0, sortOrder: 0 },
    ];
    const start = new Date('2026-12-25T10:00:00.000Z'); // Friday Christmas also treated via special day
    const end = new Date('2026-12-25T11:00:00.000Z');
    const result = calculateBandedPay({
      start,
      end,
      rules,
      stackingPolicy: 'PRIORITY',
      specialDays: [{ date: '2026-12-25', kind: 'CHRISTMAS' }],
    });
    expect(result?.segments[0].appliedHourlyRate).toBe(28);
  });

  it('applies percentage uplift enhancement', () => {
    const applied = applyEnhancement(14, {
      dayType: 'SUNDAY',
      rateType: 'UPLIFT',
      amount: 25,
      percentageUplift: 25,
      enhancementMethod: 'PERCENTAGE_UPLIFT',
    });
    expect(applied.rate).toBe(17.5);
  });

  it('applies fixed shift allowance on top of base hourly', () => {
    const rules: TimeBandRule[] = [
      {
        label: 'Base',
        dayType: 'ANY',
        rateType: 'HOURLY',
        amount: 14,
        priority: 0,
        sortOrder: 0,
      },
      {
        label: 'Weekday night',
        dayType: 'WEEKDAY',
        startTime: '22:00',
        endTime: '07:00',
        rateType: 'HOURLY',
        amount: 25,
        enhancementMethod: 'FIXED_SHIFT_ALLOWANCE',
        priority: 5,
        sortOrder: 1,
      },
    ];
    const start = new Date('2026-07-13T22:00:00.000Z');
    const end = new Date('2026-07-13T23:00:00.000Z');
    const result = calculateBandedPay({ start, end, rules });
    // 1h @ £14 + £25 allowance
    expect(result?.totalAmount).toBe(39);
    expect(result?.segments[0].shiftAllowance).toBe(25);
  });

  it('splits travel crossing evening into night', () => {
    const rules: TimeBandRule[] = [
      { label: 'Evening travel', dayType: 'WEEKDAY', startTime: '18:00', endTime: '22:00', rateType: 'HOURLY', amount: 13.5, appliesToVisit: true, priority: 1, sortOrder: 0 },
      { label: 'Night travel', dayType: 'WEEKDAY', startTime: '22:00', endTime: '06:00', rateType: 'HOURLY', amount: 15.5, appliesToVisit: true, priority: 2, sortOrder: 1 },
    ];
    const start = new Date('2026-07-13T21:50:00.000Z');
    const end = new Date('2026-07-13T22:20:00.000Z');
    const segs = splitIntoTimeSegments(start, end, rules);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    const result = calculateBandedPay({ start, end, rules });
    expect(result?.totalMinutes).toBe(30);
    expect(result!.totalAmount).toBeCloseTo(13.5 * (10 / 60) + 15.5 * (20 / 60), 2);
  });
});

describe('calculatePayableAmount with time window', () => {
  it('uses banded path when rules have start/end times', () => {
    const rules = [
      {
        label: 'Day',
        dayType: 'WEEKDAY',
        startTime: '06:00',
        endTime: '18:00',
        rateType: 'HOURLY',
        amount: 13.5,
        priority: 0,
        sortOrder: 0,
      },
      {
        label: 'Eve',
        dayType: 'WEEKDAY',
        startTime: '18:00',
        endTime: '22:00',
        rateType: 'HOURLY',
        amount: 14.5,
        priority: 1,
        sortOrder: 1,
      },
    ];
    const start = new Date('2026-07-13T17:00:00.000Z');
    const end = new Date('2026-07-13T21:00:00.000Z');
    const result = calculatePayableAmount(rules, start, 240, false, { start, end });
    expect(result?.label).toBe('BANDED_HOURLY');
    expect(result?.amount).toBe(57);
  });
});

describe('pay-mileage.util', () => {
  // The rates the application used before rates were recorded per period (now a MileageRate row).
  const rates = { rateFirst: 0.55, rateAfter: 0.25, thresholdMiles: 10_000, passengerRate: 0.05, approved: null };

  it('applies 55p then 25p after 10,000 miles', () => {
    const result = calculateUkMileage({
      miles: 100,
      vehicleType: 'CAR_VAN',
      ytdBusinessMiles: 9950,
      useUkApprovedRates: true,
      rates,
    });
    expect(result?.milesAtPrimaryRate).toBe(50);
    expect(result?.milesAtSecondaryRate).toBe(50);
    expect(result?.amount).toBeCloseTo(50 * 0.55 + 50 * 0.25, 2);
  });

  it('adds passenger supplement', () => {
    const result = calculateUkMileage({
      miles: 10,
      vehicleType: 'CAR_VAN',
      passengerMiles: 10,
      rates,
    });
    expect(result?.passengerAmount).toBe(0.5);
    expect(result?.totalAmount).toBeCloseTo(5.5 + 0.5, 2);
  });

  it('does not auto-classify every gap as unpaid', () => {
    expect(
      classifyGapBetweenVisits({ gapMinutes: 20, employerRequiredWait: true }),
    ).toBe('PAID_WAITING');
    expect(classifyGapBetweenVisits({ gapMinutes: 90, returnedHome: true })).toBe('UNPAID_PERSONAL');
    expect(classifyGapBetweenVisits({ gapMinutes: 25 })).toBe('REQUIRES_MANAGER_REVIEW');
  });
});

describe('pay-overnight.util', () => {
  it('calculates sleep-in allowance + awake time', () => {
    const result = calculateSleepInPay({
      fixedAllowance: 70,
      awakeMinutes: 60,
      awakeHourlyRate: 15.5,
      minimumCallOutMinutes: 30,
      callOutCount: 2,
    });
    expect(result.amount).toBe(70 + 15.5);
  });

  it('converts sleep-in to waking night when required', () => {
    const result = calculateSleepInPay({
      fixedAllowance: 70,
      awakeMinutes: 30,
      awakeHourlyRate: 15.5,
      convertToWakingNight: true,
      wakingNightHourlyRate: 15.5,
      scheduledShiftMinutes: 540,
    });
    expect(result.amount).toBeCloseTo(15.5 * 9, 2);
  });

  it('calculates waking night, on-call, call-out, live-in', () => {
    expect(calculateWakingNightPay(480, 15.5).amount).toBeCloseTo(124, 2);
    expect(calculateOnCallStandby({ allowance: 25, units: 1, unit: 'NIGHT' }).amount).toBe(25);
    expect(
      calculateCallOutPay({ workedMinutes: 45, hourlyRate: 15.5, minimumMinutes: 120 }).amount,
    ).toBeCloseTo(31, 2);
    expect(
      calculateLiveInDayPay({ dailyAllowance: 100, mealAllowance: 10, weeklyCap: 650, weeklyAccruedSoFar: 640 })
        .amount,
    ).toBe(10);
  });
});

describe('pay-policy.util', () => {
  it('calculates overtime without stacking by default', () => {
    const ot = calculateOvertimePay({
      baseHourlyRate: 14,
      overtimeMinutes: 60,
      method: 'TIME_AND_QUARTER',
      stackWithTimeBand: false,
      alreadyEnhancedHourlyRate: 21,
    });
    expect(ot.hourlyRate).toBe(17.5);
  });

  it('computes weekly overtime net of daily OT already paid', () => {
    expect(weeklyOvertimeMinutes(45 * 60, 37.5 * 60, 60)).toBe(7.5 * 60 - 60);
  });

  it('pays mandatory training as non-visit activity', () => {
    const pay = calculateNonVisitActivityPay(
      { code: 'MANDATORY_TRAINING', payable: true, hourlyRate: 13.5 },
      120,
    );
    expect(pay?.amount).toBe(27);
  });

  it('applies cancellation notice matrix', () => {
    const outcome = resolveCancellationOutcome('LESS_THAN_24H');
    const pay = calculateCancellationPay({
      outcome,
      scheduledVisitPay: 40,
    });
    expect(pay.amount).toBe(40);
  });

  it('pays each double-up worker independently with lead supplement', () => {
    const lead = calculateDoubleUpSupplement({
      role: 'LEAD',
      baseVisitPay: 40,
      leadSupplement: 5,
    });
    const second = calculateDoubleUpSupplement({ role: 'SECOND', baseVisitPay: 38 });
    expect(lead.amount).toBe(45);
    expect(second.amount).toBe(38);
  });
});

describe('pay-compliance.util', () => {
  it('calculates rolled-up holiday at 12.07%', () => {
    expect(calculateRolledUpHolidayPay(1000).amount).toBe(120.7);
  });

  it('validates NMW over the pay reference period including travel hours', () => {
    const category = resolveNmwCategory({ ageOnPayPeriodEnd: 25 });
    expect(nmwHourlyRate(category)).toBe(12.71);
    const result = validateMinimumWage({
      category,
      components: [
        { amount: 120, includesInNmwPay: true, countsAsNmwHours: true, hours: 10 },
        { amount: 0, includesInNmwPay: true, countsAsNmwHours: true, hours: 1 }, // unpaid travel risk
        { amount: 5.5, includesInNmwPay: false, countsAsNmwHours: false }, // mileage excluded
      ],
    });
    expect(result.compliant).toBe(false);
    expect(result.topUp).toBeGreaterThan(0);
  });

  it('warns when uniform deduction would breach NMW', () => {
    const nmw = validateMinimumWage({
      category: 'AGE_21_AND_OVER',
      components: [{ amount: 127.1, includesInNmwPay: true, countsAsNmwHours: true, hours: 10 }],
    });
    const warn = deductionWouldBreachNmw({
      nmw,
      deductionAmount: 10,
      deductionReducesNmwPay: true,
    });
    expect(warn.warn).toBe(true);
  });

  it('estimates employer cost and SSP 2026', () => {
    const cost = estimateEmployerCost({ grossPay: 500, mileageAndExpenses: 20, payFrequency: 'WEEKLY' });
    expect(cost.employerNi).toBeGreaterThan(0);
    expect(cost.totalEmploymentCost).toBeGreaterThan(500);
    expect(estimateSspWeekly2026(200).amount).toBe(123.25);
  });
});
