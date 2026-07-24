import {
  calculatePayableAmount,
  buildPayRateBreakdown,
  deriveReconciliationStatus,
  hasPayBlockingExceptions,
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

describe('pickBestRule nearest fixed slot', () => {
  it('uses exact fixed slot when present', () => {
    const result = calculatePayableAmount(
      [fixedRule(30, 6), fixedRule(45, 10), fixedRule(60, 12)],
      weekday,
      60,
    );
    expect(result).toEqual({ amount: 12, label: 'FIXED' });
  });

  it('uses nearest fixed slot when no exact match (10 min → 15)', () => {
    const result = calculatePayableAmount(
      [fixedRule(15, 4), fixedRule(30, 6), fixedRule(45, 10)],
      weekday,
      10,
    );
    expect(result).toEqual({ amount: 4, label: 'FIXED' });
  });

  it('uses nearest fixed slot for 60 min when only 30 and 45 exist', () => {
    const result = calculatePayableAmount(
      [fixedRule(30, 6), fixedRule(45, 10)],
      weekday,
      60,
    );
    expect(result).toEqual({ amount: 10, label: 'FIXED' });
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

  it('breaks equal distance toward the higher slot', () => {
    const result = calculatePayableAmount(
      [fixedRule(30, 6), fixedRule(45, 10)],
      weekday,
      37.5,
    );
    // 37.5 is equidistant; prefer 45
    expect(result).toEqual({ amount: 10, label: 'FIXED' });
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

  it('labels nearby slot in pay breakdown', () => {
    const breakdown = buildPayRateBreakdown(
      [fixedRule(15, 4), fixedRule(30, 6)],
      weekday,
      10,
    );
    expect(breakdown?.formula).toContain('nearest 15-minute slot');
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
