import {
  calculatePayableAmount,
  buildPayRateBreakdown,
} from './visit-reconciliation.util';

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

describe('calculatePayableAmount prefer banded over short fixed', () => {
  it('uses banding when base hourly + evening premium exist even for 30-min visits', () => {
    const start = new Date('2026-07-13T19:00:00.000Z');
    const end = new Date('2026-07-13T19:30:00.000Z');
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
        dayType: 'WEEKDAY' as const,
        rateType: 'FIXED' as const,
        amount: 7,
        minimumMinutes: 30,
        priority: 0,
        sortOrder: 1,
        label: '30m fixed',
      },
      {
        dayType: 'WEEKDAY' as const,
        startTime: '19:00',
        endTime: '22:00',
        rateType: 'HOURLY' as const,
        amount: 16,
        enhancementMethod: 'ABSOLUTE_HOURLY' as const,
        priority: 5,
        sortOrder: 2,
        label: 'Evening',
      },
    ];
    const result = calculatePayableAmount(rules, start, 30, false, { start, end });
    expect(result?.label).toBe('BANDED_HOURLY');
    expect(result?.amount).toBe(8); // 0.5h × £16
  });
});
