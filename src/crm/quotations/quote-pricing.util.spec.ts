import {
  describeQuoteRates,
  normaliseQuoteRates,
  priceQuote,
  priceOccurrence,
  validatePattern,
  type QuotePatternInput,
  type QuotePricingContext,
} from './quote-pricing.util';

/** £30 per carer per hour, typed on the quote. */
const ctx = (over: Partial<QuotePricingContext> = {}): QuotePricingContext => ({
  hourlyRate: 30,
  timeZone: 'Europe/London',
  bankHolidays: new Set(['2026-12-25', '2026-12-28']),
  referenceWeekStart: '2026-11-09',
  calendarMonth: '2026-12',
  vat: { rate: null, label: 'VAT not added' },
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

describe('quote pricing (manual hourly rate)', () => {
  it('B: prices a visit as hourly rate × length', () => {
    const r = priceQuote([pattern()], [], [], 'PRIVATE', ctx(), null);
    expect(r.issues).toEqual([]);
    expect(r.patterns[0].chargePerOccurrence).toBe(30);
    expect(r.patterns[0].rateReference).toBe('£30.00/hour × 60 min');
    expect(r.patterns[0].weeklyTotal).toBe(150);
    expect(r.weeklyTotal).toBe(150);
  });

  it('D: uses the same rate every day (no charge card day rates)', () => {
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
        ['Saturday', 30],
        ['Sunday', 30],
      ],
    );
    expect(r.weeklyTotal).toBe(90);
  });

  it('E/F: double-up charges each carer and keeps coverage and carer hours apart', () => {
    const r = priceQuote(
      [
        pattern({
          startTime: '08:00',
          endTime: '08:30',
          durationMinutes: 30,
          daysOfWeek: [1],
          carersPerVisit: 2,
        }),
      ],
      [],
      [],
      'PRIVATE',
      ctx(),
      null,
    );
    expect(r.patterns[0].chargePerOccurrence).toBe(30); // 2 × £15
    expect(r.patterns[0].rateReference).toBe('£30.00/hour × 30 min × 2 carers');
    expect(r.weeklyCoverageMinutes).toBe(30);
    expect(r.weeklyCarerMinutes).toBe(60);
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
    // December 2026: 23 weekdays; bank holidays are counted but priced at the same rate.
    expect(r.calendarMonth.occurrences).toBe(23);
    expect(r.calendarMonth.bankHolidayOccurrences).toBe(2);
    expect(r.calendarMonth.amount).toBe(23 * 30);
    expect(r.calendarMonth.method).toMatch(/December 2026/);
  });

  it('C/I: prices a night by the hour, or at its own price', () => {
    const night = pattern({
      label: 'Sleep-in',
      startTime: '22:00',
      endTime: '07:00',
      durationMinutes: 540,
      daysOfWeek: [1],
      nightDuty: 'SLEEPING_NIGHT',
    });
    const hourly = priceQuote([night], [], [], 'PRIVATE', ctx(), null);
    expect(hourly.patterns[0].chargePerOccurrence).toBe(270);
    const own = priceQuote(
      [{ ...night, manualChargePerVisit: 90 }],
      [],
      [],
      'PRIVATE',
      ctx(),
      null,
    );
    expect(own.patterns[0].chargePerOccurrence).toBe(90);
    expect(own.patterns[0].rateReference).toBe('Own price');
  });

  it('I: follows the clock on the night the clocks go back (DST)', () => {
    // 25 Oct 2026: clocks go back, so 22:00–06:00 is 9 hours.
    const occ = priceOccurrence(
      pattern({ startTime: '22:00', endTime: '06:00', durationMinutes: 480 }),
      '2026-10-24',
      ctx(),
      false,
    );
    expect(occ.amount).toBe(270);
  });

  it('C: prices a one-off visit on its date outside the weekly total', () => {
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
    expect(r.oneOffTotal).toBe(30);
  });

  it('J: asks for the hourly rate once, and counts the visits as unresolved', () => {
    const r = priceQuote(
      [pattern()],
      [],
      [],
      'PRIVATE',
      ctx({ hourlyRate: null }),
      null,
    );
    expect(r.unresolvedCharges).toBeGreaterThan(0);
    expect(r.issues).toEqual(['Set the hourly rate for this quote']);
    // A visit with its own price still works without the hourly rate.
    const own = priceQuote(
      [pattern({ manualChargePerVisit: 20 })],
      [],
      [],
      'PRIVATE',
      ctx({ hourlyRate: null }),
      null,
    );
    expect(own.issues).toEqual([]);
    expect(own.weeklyTotal).toBe(100);
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
    // An own price needs no reason, but cannot be negative.
    expect(validatePattern(pattern({ manualChargePerVisit: 10 }))).toEqual([]);
    expect(
      validatePattern(pattern({ manualChargePerVisit: -1 })).join(),
    ).toMatch(/0 or more/);
  });

  it('applies an own price, extras, a % discount and the fortnightly frequency', () => {
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
          amount: 0.5,
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
      null,
    );
    expect(r.visitsWeekly).toBe(100 + 15);
    expect(r.extrasWeekly).toBe(5);
    expect(r.discountWeekly).toBe(12);
    expect(r.weeklyTotal).toBe(108);
    expect(r.oneOffTotal).toBe(50);
  });

  it('asks for a mileage rate when none is entered', () => {
    const r = priceQuote(
      [pattern()],
      [
        {
          kind: 'MILEAGE',
          description: 'Mileage',
          frequency: 'WEEKLY',
          quantity: 10,
        },
      ],
      [],
      'PRIVATE',
      ctx(),
      null,
    );
    expect(r.issues).toEqual(['Mileage: enter the rate per mile']);
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

  it('adds VAT when a rate is given', () => {
    const r = priceQuote(
      [pattern()],
      [],
      [],
      'PRIVATE',
      ctx({ vat: { rate: 20, label: 'VAT 20%' } }),
      null,
    );
    expect(r.vatWeekly).toBe(30);
    expect(r.weeklyTotal).toBe(180);
  });
});

describe('quote rates (short visits, weekends, bank holidays, nights)', () => {
  const rates = normaliseQuoteRates({
    shortVisits: [
      { upToMinutes: 30, pricePerVisit: 14 },
      { upToMinutes: 15, pricePerVisit: 9.5 },
    ],
    weekend: { mode: 'PERCENT', value: 20 },
    bankHoliday: { mode: 'PERCENT', value: 50 },
    sleepingNightPrice: 110,
    wakingNightHourly: 22,
  });
  const c = ctx({ rates });
  // 2026-11-10 is a Tuesday, 2026-11-14 a Saturday, 2026-12-25 a (Friday) bank holiday.
  const tue = '2026-11-10';
  const sat = '2026-11-14';
  const xmas = '2026-12-25';

  it('prices a visit by the shortest short-visit band it fits, else by the hour', () => {
    expect(
      priceOccurrence(
        pattern({ endTime: '08:15', durationMinutes: 15 }),
        tue,
        c,
        false,
      ),
    ).toMatchObject({
      amount: 9.5,
      rateReference: 'Short visit (up to 15 min) £9.50',
    });
    expect(
      priceOccurrence(
        pattern({ endTime: '08:30', durationMinutes: 30 }),
        tue,
        c,
        false,
      ).amount,
    ).toBe(14);
    expect(
      priceOccurrence(
        pattern({ endTime: '08:45', durationMinutes: 45 }),
        tue,
        c,
        false,
      ),
    ).toMatchObject({
      amount: 22.5,
      rateReference: '£30.00/hour × 45 min',
    });
  });

  it('adds the weekend %, or the bank holiday % instead of it, to any visit', () => {
    expect(priceOccurrence(pattern(), sat, c, false)).toMatchObject({
      amount: 36,
      rateReference: '£30.00/hour × 60 min + 20% weekend',
    });
    expect(
      priceOccurrence(
        pattern({ endTime: '08:15', durationMinutes: 15 }),
        sat,
        c,
        false,
      ).amount,
    ).toBe(11.4);
    expect(priceOccurrence(pattern(), xmas, c, true)).toMatchObject({
      amount: 45,
      rateReference: '£30.00/hour × 60 min + 50% bank holiday',
    });
  });

  it('gives no single per-visit price when the days differ, and no average', () => {
    const r = priceQuote(
      [pattern({ daysOfWeek: [1, 6] })],
      [],
      [],
      'PRIVATE',
      c,
      null,
    );
    expect(r.patterns[0].chargePerOccurrence).toBeNull();
    expect(r.patterns[0].weeklyTotal).toBe(66);
  });

  it('uses an hourly day rate in place of the standard rate', () => {
    const hourly = ctx({
      rates: normaliseQuoteRates({ weekend: { mode: 'HOURLY', value: 34 } }),
    });
    expect(
      priceOccurrence(pattern({ carersPerVisit: 2 }), sat, hourly, false),
    ).toMatchObject({
      amount: 68,
      rateReference: '£34.00/hour (weekend) × 60 min × 2 carers',
    });
    expect(priceOccurrence(pattern(), tue, hourly, false).amount).toBe(30);
  });

  it('prices sleeping nights per night and waking nights per hour', () => {
    const night = {
      startTime: '22:00',
      endTime: '07:00',
      durationMinutes: 540,
    };
    expect(
      priceOccurrence(
        pattern({ ...night, nightDuty: 'SLEEPING_NIGHT' }),
        tue,
        c,
        false,
      ),
    ).toMatchObject({
      amount: 110,
      rateReference: 'Sleeping night £110.00',
    });
    expect(
      priceOccurrence(
        pattern({ ...night, nightDuty: 'WAKING_NIGHT' }),
        tue,
        c,
        false,
      ),
    ).toMatchObject({
      amount: 198,
      rateReference: 'Waking night £22.00/hour × 540 min',
    });
    // Without a night rate a night is priced by the hour.
    expect(
      priceOccurrence(
        pattern({ ...night, nightDuty: 'SLEEPING_NIGHT' }),
        tue,
        ctx(),
        false,
      ).amount,
    ).toBe(270);
  });

  it('needs no hourly rate when every visit is priced by another rate', () => {
    const r = priceQuote(
      [
        pattern({
          startTime: '22:00',
          endTime: '07:00',
          durationMinutes: 540,
          nightDuty: 'SLEEPING_NIGHT',
          daysOfWeek: [1],
        }),
      ],
      [],
      [],
      'PRIVATE',
      ctx({ hourlyRate: null, rates }),
      null,
    );
    expect(r.issues).toEqual([]);
    expect(r.visitsWeekly).toBe(110);
  });

  it('ignores rates still at 0 so nothing is priced at £0', () => {
    expect(
      normaliseQuoteRates({
        shortVisits: [{ upToMinutes: 15, pricePerVisit: 0 }],
        weekend: { mode: 'HOURLY', value: 0 },
        sleepingNightPrice: 0,
      }),
    ).toBeNull();
  });

  it('keeps only usable rates and describes them for the client', () => {
    expect(
      normaliseQuoteRates({
        shortVisits: [{ upToMinutes: 0, pricePerVisit: 5 }],
        weekend: { mode: 'X', value: 5 },
      }),
    ).toBeNull();
    expect(describeQuoteRates(30, rates)).toEqual([
      { label: 'Standard visits', value: '£30.00 per carer per hour' },
      {
        label: 'Short visits (up to 15 min)',
        value: '£9.50 per visit per carer',
      },
      {
        label: 'Short visits (up to 30 min)',
        value: '£14.00 per visit per carer',
      },
      {
        label: 'Weekends (Saturday and Sunday)',
        value: '+20% on the visit price',
      },
      { label: 'Bank holidays', value: '+50% on the visit price' },
      { label: 'Sleeping night', value: '£110.00 per night per carer' },
      { label: 'Waking night', value: '£22.00 per carer per hour' },
    ]);
  });
});

describe('total amount quotes (typed weekly total)', () => {
  const slots = [
    pattern({
      label: 'Morning visit',
      endTime: '08:30',
      durationMinutes: 30,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    }),
    pattern({
      label: 'Evening visit',
      startTime: '18:00',
      endTime: '18:30',
      durationMinutes: 30,
      daysOfWeek: [1, 2, 3, 4, 5],
    }),
  ];

  it('prices the visits at the typed weekly total, not from rates', () => {
    const r = priceQuote(
      slots,
      [],
      [],
      'PRIVATE',
      ctx({ hourlyRate: null, manualWeeklyTotal: 300 }),
      null,
    );
    expect(r.manual).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.visitsWeekly).toBe(300);
    expect(r.weeklyTotal).toBe(300);
    expect(r.weeklyVisitCount).toBe(12);
    expect(r.weeklyCoverageMinutes).toBe(0);
    expect(r.patterns.map((p) => p.weeklyTotal)).toEqual([0, 0]);
    expect(r.estimates.find((e) => e.key === 'weekly')?.method).toBe(
      'The agreed weekly price',
    );
    // December 2026 has 31 days: 300 × 31 ÷ 7.
    expect(r.calendarMonth).toMatchObject({ amount: 1328.57, complete: true });
  });

  it('asks for the total until it is typed, and funding works on it as usual', () => {
    expect(
      priceQuote(
        slots,
        [],
        [],
        'PRIVATE',
        ctx({ manualWeeklyTotal: null }),
        null,
      ).issues,
    ).toEqual(['Enter the weekly total for this quote']);
    const funded = priceQuote(
      slots,
      [],
      [
        {
          payerType: 'LOCAL_AUTHORITY',
          method: 'PERCENTAGE',
          amount: 50,
          status: 'CONFIRMED',
        },
      ],
      'MIXED',
      ctx({ manualWeeklyTotal: 300 }),
      null,
    );
    expect(funded.clientWeeklyLiability).toBe(150);
  });
});
