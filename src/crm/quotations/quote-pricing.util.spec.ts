import {
  priceQuote,
  priceOccurrence,
  resolveVat,
  validatePattern,
  type QuotePatternInput,
  type QuotePricingContext,
} from './quote-pricing.util';
import type { ChargeCardRuleLike } from '../../billing/visit-reconciliation.util';

const rule = (r: Partial<ChargeCardRuleLike>): ChargeCardRuleLike => ({
  label: null,
  chargeMethod: 'HOURLY_PRO_RATA',
  rateType: 'HOURLY',
  amount: 0,
  dayType: 'ANY',
  startTime: null,
  endTime: null,
  minimumMinutes: null,
  priority: 0,
  sortOrder: 0,
  ...r,
});

/** Weekday £30/h, Saturday/Sunday £36/h, bank holiday £60/h, sleeping night £90, waking night £25/h. */
const RULES: ChargeCardRuleLike[] = [
  rule({ label: 'Weekday', dayType: 'WEEKDAY', amount: 30 }),
  rule({ label: 'Saturday', dayType: 'SATURDAY', amount: 36, sortOrder: 1 }),
  rule({ label: 'Sunday', dayType: 'SUNDAY', amount: 36, sortOrder: 2 }),
  rule({
    label: 'Bank holiday',
    dayType: 'BANK_HOLIDAY',
    amount: 60,
    sortOrder: 3,
  }),
  rule({
    label: 'Sleep-in',
    chargeMethod: 'SLEEP_IN',
    rateType: 'SLEEP_IN',
    amount: 90,
    sortOrder: 4,
  }),
  rule({
    label: 'Waking night',
    chargeMethod: 'WAKING_NIGHT',
    rateType: 'WAKING_NIGHT',
    amount: 25,
    sortOrder: 5,
  }),
];

const ctx = (over: Partial<QuotePricingContext> = {}): QuotePricingContext => ({
  cardName: 'Private 2026',
  rules: RULES,
  defaultChargeMethod: 'HOURLY_PRO_RATA',
  multiCarerMode: 'COMBINED',
  timeZone: 'Europe/London',
  bankHolidays: new Set(['2026-12-25', '2026-12-28']),
  referenceWeekStart: '2026-11-09',
  calendarMonth: '2026-12',
  vat: resolveVat('VAT exempt'),
  ...over,
});

const pattern = (over: Partial<QuotePatternInput> = {}): QuotePatternInput => ({
  label: 'Morning call',
  startTime: '08:00',
  endTime: '09:00',
  durationMinutes: 60,
  daysOfWeek: [1, 2, 3, 4, 5],
  frequency: 'WEEKLY',
  carersPerVisit: 1,
  ...over,
});

describe('quote pricing', () => {
  it('B: prices a weekday morning visit from the client charge card', () => {
    const r = priceQuote([pattern()], [], [], 'PRIVATE', ctx(), null);
    expect(r.issues).toEqual([]);
    expect(r.patterns[0].chargePerOccurrence).toBe(30);
    expect(r.patterns[0].weeklyTotal).toBe(150);
    expect(r.weeklyTotal).toBe(150);
  });

  it('D: charges weekend days at the weekend rate', () => {
    const r = priceQuote(
      [pattern({ daysOfWeek: [0, 1, 6] })],
      [],
      [],
      'PRIVATE',
      ctx(),
      null,
    );
    expect(r.patterns[0].occurrences.map((o) => [o.weekday, o.amount])).toEqual(
      [
        ['Monday', 30],
        ['Saturday', 36],
        ['Sunday', 36],
      ],
    );
    expect(r.weeklyTotal).toBe(102);
  });

  it('E/F: double-up charges each carer and keeps coverage and carer hours apart', () => {
    const p = pattern({
      startTime: '08:00',
      endTime: '08:30',
      durationMinutes: 30,
      daysOfWeek: [1],
      carersPerVisit: 2,
    });
    const r = priceQuote([p], [], [], 'PRIVATE', ctx(), null);
    expect(r.patterns[0].chargePerOccurrence).toBe(30); // 2 × £15
    expect(r.weeklyCoverageMinutes).toBe(30);
    expect(r.weeklyCarerMinutes).toBe(60);
    const fixed = priceQuote(
      [p],
      [],
      [],
      'PRIVATE',
      ctx({ multiCarerMode: 'FIXED' }),
      null,
    );
    expect(fixed.patterns[0].chargePerOccurrence).toBe(15);
  });

  it('G: gives weekly, four-weekly, average monthly, annual and calendar-month estimates with their method', () => {
    const r = priceQuote([pattern()], [], [], 'PRIVATE', ctx(), null);
    const by = Object.fromEntries(r.estimates.map((e) => [e.key, e.amount]));
    expect(by).toEqual({
      weekly: 150,
      fourWeekly: 600,
      monthlyAverage: 650,
      annual: 7800,
    });
    expect(r.estimates.every((e) => e.method.length > 0)).toBe(true);
    // December 2026: 23 weekdays, 2 of them bank holidays (25th, 28th) at £60.
    expect(r.calendarMonth.occurrences).toBe(23);
    expect(r.calendarMonth.bankHolidayOccurrences).toBe(2);
    expect(r.calendarMonth.amount).toBe(21 * 30 + 2 * 60);
    expect(r.calendarMonth.method).toMatch(/December 2026/);
  });

  it('H: does not stack a night band on top of the weekend rate', () => {
    const banded: ChargeCardRuleLike[] = [
      ...RULES,
      rule({
        label: 'Night',
        dayType: 'ANY',
        startTime: '22:00',
        endTime: '07:00',
        amount: 40,
        priority: 5,
      }),
    ];
    const occ = priceOccurrence(
      pattern({ startTime: '22:00', endTime: '23:00', durationMinutes: 60 }),
      '2026-11-14', // Saturday
      ctx({ rules: banded }),
      false,
    );
    // One rate for the hour (never 36 + 40).
    expect(occ.amount).toBe(40);
  });

  it('C/I: prices a sleeping night and a cross-midnight waking night', () => {
    const sleep = priceQuote(
      [
        pattern({
          label: 'Sleep-in',
          startTime: '22:00',
          endTime: '07:00',
          durationMinutes: 540,
          daysOfWeek: [1],
          nightDuty: 'SLEEPING_NIGHT',
        }),
      ],
      [],
      [],
      'PRIVATE',
      ctx(),
      null,
    );
    expect(sleep.patterns[0].chargePerOccurrence).toBe(90);
    const waking = priceQuote(
      [
        pattern({
          label: 'Waking night',
          startTime: '22:00',
          endTime: '06:00',
          durationMinutes: 480,
          daysOfWeek: [1],
          nightDuty: 'WAKING_NIGHT',
        }),
      ],
      [],
      [],
      'PRIVATE',
      ctx(),
      null,
    );
    expect(waking.patterns[0].chargePerOccurrence).toBe(200);
  });

  it('I: follows the clock on the night the clocks go back (DST)', () => {
    // 25 Oct 2026: clocks go back, so 22:00–06:00 is 9 hours.
    const occ = priceOccurrence(
      pattern({
        startTime: '22:00',
        endTime: '06:00',
        durationMinutes: 480,
        nightDuty: 'WAKING_NIGHT',
      }),
      '2026-10-24',
      ctx(),
      false,
    );
    expect(occ.amount).toBe(225);
  });

  it('C: prices a one-off visit on its date (bank holiday rate) outside the weekly total', () => {
    const r = priceQuote(
      [
        pattern({
          label: 'Christmas lunch',
          frequency: 'ONE_OFF',
          daysOfWeek: [],
          oneOffDates: ['2026-12-25'],
        }),
      ],
      [],
      [],
      'PRIVATE',
      ctx(),
      null,
    );
    expect(r.weeklyTotal).toBe(0);
    expect(r.oneOffTotal).toBe(60);
  });

  it('J: reports a missing rate and counts it as unresolved', () => {
    const r = priceQuote(
      [pattern()],
      [],
      [],
      'PRIVATE',
      ctx({ rules: [RULES[1]] }),
      null,
    );
    expect(r.unresolvedCharges).toBeGreaterThan(0);
    expect(r.issues[0]).toMatch(
      /No visit rate on Private 2026 for Monday 08:00/,
    );
  });

  it('validates recurrence, duration and dates', () => {
    expect(validatePattern(pattern({ daysOfWeek: [] }))).toContain(
      'Morning call: choose at least one day',
    );
    expect(validatePattern(pattern({ durationMinutes: 45 })).join()).toMatch(
      /is 60 minutes but the duration is 45/,
    );
    expect(
      validatePattern(
        pattern({ startTime: '22:00', endTime: '07:00', durationMinutes: 540 }),
      ),
    ).toEqual([]);
    expect(
      validatePattern(
        pattern({ effectiveFrom: '2026-12-01', effectiveTo: '2026-11-01' }),
      ).join(),
    ).toMatch(/before/);
    expect(
      validatePattern(pattern({ manualChargePerVisit: 10 })).join(),
    ).toMatch(/reason/);
  });

  it('applies a manual override, extras, a % discount and the fortnightly frequency', () => {
    const r = priceQuote(
      [
        pattern({
          manualChargePerVisit: 20,
          overrideReason: 'Agreed with manager',
        }),
        pattern({
          label: 'Cleaning',
          daysOfWeek: [3],
          frequency: 'FORTNIGHTLY',
        }),
      ],
      [
        {
          kind: 'SETUP_FEE',
          description: 'Set-up',
          frequency: 'ONE_OFF',
          amount: 50,
        },
        {
          kind: 'MILEAGE',
          description: 'Mileage',
          frequency: 'WEEKLY',
          quantity: 10,
        },
        {
          kind: 'DISCOUNT',
          description: '10% off',
          frequency: 'WEEKLY',
          amount: 10,
          isPercentage: true,
        },
      ],
      [],
      'PRIVATE',
      ctx(),
      0.5,
    );
    expect(r.visitsWeekly).toBe(100 + 15);
    expect(r.extrasWeekly).toBe(5);
    expect(r.discountWeekly).toBe(12);
    expect(r.weeklyTotal).toBe(108);
    expect(r.oneOffTotal).toBe(50);
  });

  it('K/L: private and mixed funding leave the right client liability', () => {
    const p = [pattern()]; // £150 / week, 5 visits
    const priv = priceQuote(p, [], [], 'PRIVATE', ctx(), null);
    expect(priv.clientWeeklyLiability).toBe(150);
    const mixed = priceQuote(
      p,
      [],
      [
        {
          payerType: 'LOCAL_AUTHORITY',
          method: 'FIXED',
          amount: 100,
          status: 'CONFIRMED',
        },
        {
          payerType: 'NHS',
          method: 'PER_VISIT',
          amount: 4,
          status: 'PENDING_APPROVAL',
        },
      ],
      'MIXED',
      ctx(),
      null,
    );
    expect(mixed.issues).toEqual([]);
    expect(mixed.fundedWeekly).toBe(120);
    expect(mixed.pendingFundingWeekly).toBe(20);
    expect(mixed.clientWeeklyLiability).toBe(30);
    expect(mixed.clientWeeklyLiabilityIfPendingDeclined).toBe(50);
    const over = priceQuote(
      p,
      [],
      [
        {
          payerType: 'LOCAL_AUTHORITY',
          method: 'PERCENTAGE',
          amount: 120,
          status: 'CONFIRMED',
        },
      ],
      'MIXED',
      ctx(),
      null,
    );
    expect(over.unresolvedCharges).toBeGreaterThan(0);
    const wrong = priceQuote(
      p,
      [],
      [{ payerType: 'NHS', method: 'FIXED', amount: 10, status: 'CONFIRMED' }],
      'PRIVATE',
      ctx(),
      null,
    );
    expect(wrong.issues.join()).toMatch(/choose Mixed/);
  });

  it('takes VAT only from the configured classification', () => {
    expect(resolveVat(null).rate).toBeNull();
    expect(resolveVat('VAT exempt').rate).toBe(0);
    expect(resolveVat('Standard 20%').rate).toBe(20);
    expect(resolveVat('Standard').problem).toBeTruthy();
    const r = priceQuote(
      [pattern()],
      [],
      [],
      'PRIVATE',
      ctx({ vat: resolveVat('VAT 20%') }),
      null,
    );
    expect(r.vatWeekly).toBe(30);
    expect(r.weeklyTotal).toBe(180);
  });
});
