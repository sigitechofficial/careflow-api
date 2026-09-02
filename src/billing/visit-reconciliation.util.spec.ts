import {
  calculatePayableAmount,
  calculateBillableAmount,
  buildPayRateBreakdown,
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

describe('deriveReconciliationStatus — auto pay on complete', () => {
  it('auto-approves pay when only invoice / overrun exceptions exist', () => {
    const status = deriveReconciliationStatus([
      { code: FinanceExceptionCode.CHARGE_CARD_MISSING, message: 'No charge card' },
      { code: FinanceExceptionCode.OVERRUN, message: '10 min overrun' },
      { code: FinanceExceptionCode.FUNDING_SETUP_INCOMPLETE, message: 'Funding incomplete' },
    ]);
    expect(status).toBe(VisitReconciliationStatus.APPROVED_FOR_PAY);
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

describe('deriveReconciliationStatus — auto pay on complete', () => {
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
});
