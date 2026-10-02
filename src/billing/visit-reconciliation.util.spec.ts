import {
  calculatePayableAmount,
  calculateBillableAmount,
  buildPayRateBreakdown,
  alignRateBreakdownVisitSliceLabels,
  deriveReconciliationStatus,
  formatVisitRef,
  hasPayBlockingExceptions,
  isCanonicalVisitRef,
  normalizeVisitRefBranchCode,
  visitRefDayKey,
} from './visit-reconciliation.util';
import { FinanceExceptionCode, VisitReconciliationStatus } from '@prisma/client';

const weekday = new Date('2026-07-13T10:00:00.000Z'); // Monday

function fixedRule(minutes: number, amount: number, priority = 0, sortOrder = 0) {
  return {
    dayType: 'WEEKDAY',
    rateType: 'FIXED',
    amount,
    multiplier: 1,
    minimumMinutes: minutes,
    priority,
    sortOrder,
    label: `${minutes}m`,
  };
}

describe('pickBestRule exact fixed slot then hourly', () => {
  it('uses exact fixed slot when present', () => {
    const result = calculatePayableAmount(
      [fixedRule(30, 6), fixedRule(45, 10), fixedRule(60, 12)],
      weekday,
      60,
    );
    expect(result).toEqual({ amount: 12, label: 'FIXED' });
  });

  it('uses hourly pro-rata when no exact fixed slot (10 min with 15/30/45 fixed)', () => {
    const result = calculatePayableAmount(
      [
        fixedRule(15, 4),
        fixedRule(30, 6),
        fixedRule(45, 10),
        {
          dayType: 'WEEKDAY',
          rateType: 'HOURLY',
          amount: 12,
          multiplier: 1,
          minimumMinutes: null,
          priority: 0,
          sortOrder: 0,
          label: 'Hourly',
        },
      ],
      weekday,
      10,
    );
    // 10/60 × £12 = £2
    expect(result).toEqual({ amount: 2, label: 'HOURLY' });
  });

  it('uses hourly pro-rata for 45 min when only 15 and 30 fixed slots exist', () => {
    const result = calculatePayableAmount(
      [
        fixedRule(15, 4),
        fixedRule(30, 6),
        {
          dayType: 'WEEKDAY',
          rateType: 'HOURLY',
          amount: 20,
          multiplier: 1,
          minimumMinutes: null,
          priority: 0,
          sortOrder: 0,
          label: 'Hourly',
        },
      ],
      weekday,
      45,
    );
    // 45/60 × £20 = £15
    expect(result).toEqual({ amount: 15, label: 'HOURLY' });
  });

  it('uses hourly for short actual when planned duration is over 60 minutes', () => {
    const result = calculatePayableAmount(
      [
        fixedRule(30, 8),
        fixedRule(45, 12),
        fixedRule(60, 15),
        {
          dayType: 'WEEKDAY',
          rateType: 'HOURLY',
          amount: 24,
          multiplier: 1,
          minimumMinutes: null,
          priority: 0,
          sortOrder: 0,
          label: 'Hourly',
        },
      ],
      weekday,
      30, // actual / payable minutes
      false,
      undefined,
      null,
      180, // planned 3 hours → force hourly
    );
    // 30/60 × £24 = £12 (not the £8 fixed 30m slot)
    expect(result).toEqual({ amount: 12, label: 'HOURLY' });
  });

  it('still uses fixed 30m slot when planned is also ≤ 60 minutes', () => {
    const result = calculatePayableAmount(
      [
        fixedRule(30, 8),
        {
          dayType: 'WEEKDAY',
          rateType: 'HOURLY',
          amount: 24,
          multiplier: 1,
          minimumMinutes: null,
          priority: 0,
          sortOrder: 0,
          label: 'Hourly',
        },
      ],
      weekday,
      30,
      false,
      undefined,
      null,
      30,
    );
    expect(result).toEqual({ amount: 8, label: 'FIXED' });
  });

  it('prefers fixed slot whose From/Until covers the visit clock', () => {
    const daytime = {
      ...fixedRule(30, 12),
      startTime: '07:00',
      endTime: '19:00',
      label: '30m daytime',
    };
    const evening = {
      ...fixedRule(30, 18),
      startTime: '19:00',
      endTime: '22:00',
      label: '30m evening',
    };
    const eveningVisit = new Date('2026-07-13T20:00:00.000Z');
    const result = calculatePayableAmount([daytime, evening], eveningVisit, 30);
    expect(result).toEqual({ amount: 18, label: 'FIXED' });
  });

  it('falls back to hourly when no fixed slots exist', () => {
    const result = calculatePayableAmount(
      [{
        dayType: 'WEEKDAY',
        rateType: 'HOURLY',
        amount: 12,
        multiplier: 1,
        minimumMinutes: null,
        priority: 0,
        sortOrder: 0,
        label: 'Hourly',
      }],
      weekday,
      10,
    );
    expect(result).toEqual({ amount: 2, label: 'HOURLY' });
  });

  it('labels exact slot in pay breakdown', () => {
    const breakdown = buildPayRateBreakdown(
      [fixedRule(15, 4), fixedRule(30, 6)],
      weekday,
      15,
    );
    expect(breakdown?.formula).toContain('for 15-minute visit');
    expect(breakdown?.amount).toBe('£4.00');
  });
});

describe('calculatePayableAmount fixed slots vs day/time hourly', () => {
  const rules = [
    {
      dayType: 'ANY',
      rateType: 'HOURLY' as const,
      amount: 14,
      minimumMinutes: null,
      priority: 0,
      sortOrder: 0,
      label: 'Base',
    },
    {
      dayType: 'ANY' as const,
      rateType: 'FIXED' as const,
      amount: 20,
      minimumMinutes: 30,
      priority: 0,
      sortOrder: 1,
      label: '30 minutes visit',
    },
    {
      dayType: 'WEEKDAY' as const,
      startTime: '07:00',
      endTime: '19:00',
      rateType: 'HOURLY' as const,
      amount: 30,
      enhancementMethod: 'ABSOLUTE_HOURLY' as const,
      priority: 10,
      sortOrder: 2,
      label: 'Weekday daytime',
    },
  ];

  it('uses exact 30-min fixed slot even when weekday daytime hourly exists', () => {
    const start = new Date('2026-07-13T10:00:00.000Z');
    const end = new Date('2026-07-13T10:30:00.000Z');
    const result = calculatePayableAmount(rules, start, 30, false, { start, end });
    expect(result?.label).toBe('FIXED');
    expect(result?.amount).toBe(20);
  });

  it('uses day/time hourly banding for 45 min when only a 30-min fixed slot exists', () => {
    const start = new Date('2026-07-13T10:00:00.000Z');
    const end = new Date('2026-07-13T10:45:00.000Z');
    const result = calculatePayableAmount(rules, start, 45, false, { start, end });
    expect(result?.label).toBe('BANDED_HOURLY');
    expect(result?.amount).toBe(22.5); // 0.75h × £30
  });

  it('uses day/time hourly banding for visits over 1 hour', () => {
    const start = new Date('2026-07-13T10:00:00.000Z');
    const end = new Date('2026-07-13T12:00:00.000Z');
    const result = calculatePayableAmount(rules, start, 120, false, { start, end });
    expect(result?.label).toBe('BANDED_HOURLY');
    expect(result?.amount).toBe(60); // 2h × £30
  });
});

describe('deriveReconciliationStatus — default approved for both', () => {
  it('stays pending when any exceptions exist', () => {
    const status = deriveReconciliationStatus([
      { code: FinanceExceptionCode.CHARGE_CARD_MISSING, message: 'No charge card' },
      { code: FinanceExceptionCode.OVERRUN, message: '10 min overrun' },
      { code: FinanceExceptionCode.FUNDING_SETUP_INCOMPLETE, message: 'Funding incomplete' },
    ]);
    expect(status).toBe(VisitReconciliationStatus.PENDING_REVIEW);
  });

  it('stays pending when pay card is missing', () => {
    const exceptions = [
      { code: FinanceExceptionCode.PAY_CARD_MISSING, message: 'No pay card' },
    ];
    expect(hasPayBlockingExceptions(exceptions)).toBe(true);
    expect(deriveReconciliationStatus(exceptions)).toBe(
      VisitReconciliationStatus.PENDING_REVIEW,
    );
  });

  it('defaults to approved for both when there are no exceptions', () => {
    expect(deriveReconciliationStatus([])).toBe(
      VisitReconciliationStatus.APPROVED_FOR_BOTH,
    );
    expect(
      deriveReconciliationStatus([], VisitReconciliationStatus.PENDING_REVIEW),
    ).toBe(VisitReconciliationStatus.APPROVED_FOR_BOTH);
  });

  it('preserves human approval when only soft exceptions remain', () => {
    expect(
      deriveReconciliationStatus([], VisitReconciliationStatus.APPROVED_FOR_PAY),
    ).toBe(VisitReconciliationStatus.APPROVED_FOR_PAY);
    expect(
      deriveReconciliationStatus([], VisitReconciliationStatus.APPROVED_FOR_BOTH),
    ).toBe(VisitReconciliationStatus.APPROVED_FOR_BOTH);
    expect(
      deriveReconciliationStatus([], VisitReconciliationStatus.APPROVED_FOR_INVOICE),
    ).toBe(VisitReconciliationStatus.APPROVED_FOR_INVOICE);
    expect(
      deriveReconciliationStatus(
        [{ code: FinanceExceptionCode.OVERRUN, message: 'over' }],
        VisitReconciliationStatus.APPROVED_FOR_BOTH,
      ),
    ).toBe(VisitReconciliationStatus.APPROVED_FOR_BOTH);
    expect(
      deriveReconciliationStatus(
        [{ code: FinanceExceptionCode.UNDERRUN, message: 'short' }],
        VisitReconciliationStatus.APPROVED_FOR_BOTH,
      ),
    ).toBe(VisitReconciliationStatus.APPROVED_FOR_BOTH);
  });

  it('resets human approval when a blocking exception appears', () => {
    expect(
      deriveReconciliationStatus(
        [{ code: FinanceExceptionCode.CHARGE_CARD_MISSING, message: 'No charge card' }],
        VisitReconciliationStatus.APPROVED_FOR_BOTH,
      ),
    ).toBe(VisitReconciliationStatus.PENDING_REVIEW);
  });
});

describe('calculateBillableAmount night duty', () => {
  const dayHourly = {
    chargeMethod: 'HOURLY_PRO_RATA',
    dayType: 'WEEKDAY',
    rateType: 'HOURLY',
    amount: 18,
    minimumMinutes: null,
    priority: 0,
    sortOrder: 0,
    label: 'Weekday daytime',
  };
  const sleepIn = {
    chargeMethod: 'SLEEP_IN',
    dayType: 'ANY',
    rateType: 'FIXED',
    amount: 75,
    minimumMinutes: null,
    priority: 0,
    sortOrder: 1,
    label: 'Sleeping night',
  };
  const waking = {
    chargeMethod: 'WAKING_NIGHT',
    dayType: 'ANY',
    rateType: 'HOURLY',
    amount: 16,
    minimumMinutes: null,
    priority: 0,
    sortOrder: 2,
    label: 'Waking night',
  };

  it('charges a flat sleeping night even when hourly day rules exist', () => {
    const result = calculateBillableAmount(
      [dayHourly, sleepIn, waking],
      weekday,
      540,
      'HOURLY_PRO_RATA',
      false,
      undefined,
      'SLEEPING_NIGHT',
    );
    expect(result).toEqual({ amount: 75, label: 'SLEEP_IN' });
  });

  it('charges waking night hourly from duration', () => {
    const result = calculateBillableAmount(
      [dayHourly, sleepIn, waking],
      weekday,
      540,
      'HOURLY_PRO_RATA',
      false,
      undefined,
      'WAKING_NIGHT',
    );
    expect(result).toEqual({ amount: 144, label: 'WAKING_NIGHT' });
  });

  it('ignores overnight rules on a normal day visit', () => {
    const result = calculateBillableAmount(
      [dayHourly, sleepIn, waking],
      weekday,
      120,
      'HOURLY_PRO_RATA',
    );
    expect(result).toEqual({ amount: 36, label: 'HOURLY_PRO_RATA' });
  });

  it('prefers a weekday sleeping night rate over an ANY-day fallback', () => {
    const weekdaySleep = {
      ...sleepIn,
      dayType: 'WEEKDAY',
      amount: 90,
      priority: 10,
      label: 'Sleeping night — Weekday',
    };
    const result = calculateBillableAmount(
      [dayHourly, sleepIn, weekdaySleep, waking],
      weekday,
      540,
      'HOURLY_PRO_RATA',
      false,
      undefined,
      'SLEEPING_NIGHT',
    );
    expect(result).toEqual({ amount: 90, label: 'SLEEP_IN' });
  });
});

describe('formatVisitRef', () => {
  it('builds VIS-[BRANCH]-[YYYYMMDD]-[NNNN] with 3-char branch', () => {
    expect(formatVisitRef('L01', '20260901', 123)).toBe('VIS-L01-20260901-0123');
    expect(formatVisitRef('croydon_1', '2026-09-01', 1)).toBe('VIS-C01-20260901-0001');
  });

  it('normalizes branch codes to exactly 3 characters', () => {
    expect(normalizeVisitRefBranchCode('L01')).toBe('L01');
    expect(normalizeVisitRefBranchCode('L-01')).toBe('L01');
    expect(normalizeVisitRefBranchCode('MERTON')).toBe('MER');
    expect(normalizeVisitRefBranchCode('')).toBe('GEN');
    expect(isCanonicalVisitRef('VIS-L01-20260901-0123')).toBe(true);
    expect(isCanonicalVisitRef('VIS-CROYDON1-20260901-0001')).toBe(false);
    expect(isCanonicalVisitRef('V-2026-09-ABCD')).toBe(false);
    expect(visitRefDayKey('2026-09-01')).toBe('20260901');
  });
});

describe('deriveReconciliationStatus — pay blocking helpers', () => {
  it('treats pay-card RATE_MISSING as pay blocking, not charge-card', () => {
    expect(
      hasPayBlockingExceptions([
        { code: FinanceExceptionCode.RATE_MISSING, message: 'Pay card has no rate rules configured' },
      ]),
    ).toBe(true);
    expect(
      hasPayBlockingExceptions([
        { code: FinanceExceptionCode.RATE_MISSING, message: 'Charge card has no charge rules configured' },
      ]),
    ).toBe(false);
  });
});

describe('calculatePayableAmount operational timezone (BST)', () => {
  it('matches Weekday daytime 07:00–19:00 for a London 07:00–10:00 visit stored as UTC', () => {
    // 2026-09-02 07:00–10:00 Europe/London = 06:00–09:00Z
    const start = new Date('2026-09-02T06:00:00.000Z');
    const end = new Date('2026-09-02T09:00:00.000Z');
    const rules = [
      {
        label: 'Weekday daytime',
        dayType: 'WEEKDAY',
        rateType: 'HOURLY',
        amount: 25,
        priority: 0,
        sortOrder: 0,
        startTime: '07:00',
        endTime: '19:00',
        appliesToVisit: true,
      },
    ];
    const withoutTz = calculatePayableAmount(rules, start, 180, false, { start, end });
    expect(withoutTz).toBeNull();

    const withLondon = calculatePayableAmount(rules, start, 180, false, {
      start,
      end,
      timeZone: 'Europe/London',
    });
    expect(withLondon?.amount).toBe(75);
    expect(withLondon?.label).toBe('BANDED_HOURLY');
  });

  it('labels pay breakdown segments in Europe/London, not UTC', () => {
    // 2026-09-07 11:00–14:00 Europe/London = 10:00–13:00Z
    const start = new Date('2026-09-07T10:00:00.000Z');
    const end = new Date('2026-09-07T13:00:00.000Z');
    const rules = [
      {
        label: 'Weekday daytime',
        dayType: 'WEEKDAY',
        rateType: 'HOURLY',
        amount: 49,
        priority: 0,
        sortOrder: 0,
        startTime: '07:00',
        endTime: '19:00',
        appliesToVisit: true,
      },
    ];
    const breakdown = buildPayRateBreakdown(rules, start, 180, undefined, false, {
      start,
      end,
      timeZone: 'Europe/London',
    });
    expect(breakdown?.segments?.[0]?.startLabel).toBe('11:00');
    expect(breakdown?.segments?.[0]?.endLabel).toBe('14:00');
    expect(breakdown?.appliedRules?.[0]?.timeWindow).toBe('11:00–14:00');
  });
});

describe('alignRateBreakdownVisitSliceLabels', () => {
  it('rewrites UTC visit-slice labels to the org timezone window', () => {
    const start = new Date('2026-09-07T10:00:00.000Z');
    const end = new Date('2026-09-07T13:00:00.000Z');
    const aligned = alignRateBreakdownVisitSliceLabels(
      {
        minutes: 180,
        hoursLabel: '3 hrs',
        rateType: 'BANDED_HOURLY',
        unitRate: '£49.00/hr',
        amount: '£147.00',
        formula: '3 hrs across 1 time band = £147.00',
        cardName: 'test',
        cardCode: 'T',
        cardSource: null,
        ruleLabel: 'Time-band split',
        segments: [
          {
            startLabel: '10:00',
            endLabel: '13:00',
            hoursLabel: '3 hrs',
            minutes: 180,
            unitRate: '£49.00/hr',
            ruleLabel: 'Weekday daytime',
            lineFormula: '3 hrs × £49.00/hr = £147.00',
            amount: '£147.00',
          },
        ],
        appliedRules: [
          {
            label: 'Weekday daytime',
            rateType: 'BANDED_HOURLY',
            rateTypeLabel: 'Time-banded hourly',
            dayType: null,
            dayTypeLabel: null,
            timeWindow: '10:00–13:00',
            unitRate: '£49.00/hr',
            amount: '£147.00',
            detail: 'Weekday daytime · 10:00–13:00 · £49.00/hr',
          },
        ],
      },
      start,
      end,
      'Europe/London',
    );
    expect(aligned?.segments?.[0]?.startLabel).toBe('11:00');
    expect(aligned?.segments?.[0]?.endLabel).toBe('14:00');
    expect(aligned?.appliedRules?.[0]?.timeWindow).toBe('11:00–14:00');
    expect(aligned?.appliedRules?.[0]?.detail).toContain('11:00–14:00');
  });
});

describe('calculatePayableAmount night duty', () => {
  const weekdayNight = new Date('2026-07-13T10:00:00.000Z'); // Monday
  const dayHourly = {
    label: 'Weekday daytime',
    dayType: 'WEEKDAY',
    rateType: 'HOURLY',
    amount: 12,
    minimumMinutes: null,
    priority: 0,
    sortOrder: 0,
    startTime: '07:00',
    endTime: '19:00',
  };
  const sleepIn = {
    label: 'Sleeping night',
    dayType: 'ANY',
    rateType: 'SLEEP_IN',
    amount: 80,
    minimumMinutes: null,
    priority: 0,
    sortOrder: 1,
  };
  const waking = {
    label: 'Waking night',
    dayType: 'ANY',
    rateType: 'WAKING_NIGHT',
    amount: 18,
    minimumMinutes: null,
    priority: 0,
    sortOrder: 2,
  };

  it('pays a flat sleeping night even when hourly day rules exist', () => {
    const result = calculatePayableAmount(
      [dayHourly, sleepIn, waking],
      weekdayNight,
      540,
      false,
      undefined,
      'SLEEPING_NIGHT',
    );
    expect(result).toEqual({ amount: 80, label: 'SLEEP_IN' });
  });

  it('pays waking night hourly from duration', () => {
    const result = calculatePayableAmount(
      [dayHourly, sleepIn, waking],
      weekdayNight,
      540,
      false,
      undefined,
      'WAKING_NIGHT',
    );
    expect(result).toEqual({ amount: 162, label: 'WAKING_NIGHT' });
  });
});

describe('absent co-carer (multi-carer pay)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const util = require('./visit-reconciliation.util') as typeof import('./visit-reconciliation.util');
  it('flags a carer who never clocked in while a co-carer did', () => {
    expect(
      util.isAbsentCoCarer({
        requiredCarers: 2,
        activeCarerCount: 2,
        myActualStartDateTime: null,
        anyCoCarerClockedIn: true,
      }),
    ).toBe(true);
  });
  it('keeps single-carer, clocked-in, and nobody-clocked-in visits unchanged', () => {
    expect(
      util.isAbsentCoCarer({ requiredCarers: 1, activeCarerCount: 1, myActualStartDateTime: null, anyCoCarerClockedIn: false }),
    ).toBe(false);
    expect(
      util.isAbsentCoCarer({ requiredCarers: 2, activeCarerCount: 2, myActualStartDateTime: new Date(), anyCoCarerClockedIn: true }),
    ).toBe(false);
    expect(
      util.isAbsentCoCarer({ requiredCarers: 2, activeCarerCount: 2, myActualStartDateTime: null, anyCoCarerClockedIn: false }),
    ).toBe(false);
  });
  it('absent co-carer MISSING_CHECK_IN blocks pay; generic missing check-in does not', () => {
    expect(
      util.isPayBlockingException({
        code: 'MISSING_CHECK_IN' as never,
        message: util.ABSENT_CO_CARER_EXCEPTION_MESSAGE,
      }),
    ).toBe(true);
    expect(
      util.isPayBlockingException({
        code: 'MISSING_CHECK_IN' as never,
        message: 'No check-in time recorded for this visit',
      }),
    ).toBe(false);
  });
});

describe('day-type rules use the organisation timezone (not the UTC date)', () => {
  // Sat 2026-07-18 00:30 BST = Fri 2026-07-17 23:30Z
  const satEarlyLondon = new Date('2026-07-17T23:30:00.000Z');
  const weekdaySleep = {
    label: 'Weekday sleep-in',
    dayType: 'WEEKDAY',
    rateType: 'SLEEP_IN',
    amount: 80,
    minimumMinutes: null,
    priority: 0,
    sortOrder: 0,
  };
  const saturdaySleep = { ...weekdaySleep, label: 'Saturday sleep-in', dayType: 'SATURDAY', amount: 95 };

  it('Europe/London BST: 00:30 Saturday visit gets the Saturday rate', () => {
    const result = calculatePayableAmount(
      [weekdaySleep, saturdaySleep],
      satEarlyLondon,
      540,
      false,
      { start: satEarlyLondon, end: new Date('2026-07-18T08:30:00.000Z'), timeZone: 'Europe/London' },
      'SLEEPING_NIGHT',
    );
    expect(result).toEqual({ amount: 95, label: 'SLEEP_IN' });
  });

  it('legacy UTC evaluation (no timezone) would have used Friday', () => {
    const result = calculatePayableAmount(
      [weekdaySleep, saturdaySleep],
      satEarlyLondon,
      540,
      false,
      undefined,
      'SLEEPING_NIGHT',
    );
    expect(result).toEqual({ amount: 80, label: 'SLEEP_IN' });
  });

  it('Christmas Day: 00:15 GMT on 25 Dec (= 00:15Z) vs Karachi (05:15 PKT, also 25th) vs 24 Dec 23:30 London', () => {
    const christmas = { ...weekdaySleep, label: 'Christmas', dayType: 'CHRISTMAS', amount: 200 };
    const lateXmasEveLondon = new Date('2026-12-24T23:30:00.000Z'); // 23:30 GMT on the 24th
    const xmasEarlyKarachi = new Date('2026-12-24T19:30:00.000Z'); // 00:30 PKT on the 25th
    expect(
      calculatePayableAmount([weekdaySleep, christmas], lateXmasEveLondon, 60, false, {
        start: lateXmasEveLondon,
        end: lateXmasEveLondon,
        timeZone: 'Europe/London',
      }, 'SLEEPING_NIGHT'),
    ).toEqual({ amount: 80, label: 'SLEEP_IN' });
    expect(
      calculatePayableAmount([weekdaySleep, christmas], xmasEarlyKarachi, 60, false, {
        start: xmasEarlyKarachi,
        end: xmasEarlyKarachi,
        timeZone: 'Asia/Karachi',
      }, 'SLEEPING_NIGHT'),
    ).toEqual({ amount: 200, label: 'SLEEP_IN' });
  });

  it('mileage supplement day type follows the org timezone', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { calculateMileageAmount } = require('./visit-reconciliation.util') as typeof import('./visit-reconciliation.util');
    const weekdayMileage = { ...weekdaySleep, rateType: 'MILEAGE', amount: 0.45 };
    const saturdayMileage = { ...weekdaySleep, rateType: 'MILEAGE', dayType: 'SATURDAY', amount: 0.6 };
    expect(
      calculateMileageAmount([weekdayMileage, saturdayMileage], satEarlyLondon, 10, false, 'Europe/London')
        ?.unitRate,
    ).toBe(0.6);
    expect(
      calculateMileageAmount([weekdayMileage, saturdayMileage], satEarlyLondon, 10, false, 'UTC')?.unitRate,
    ).toBe(0.45);
  });
});
