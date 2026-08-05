import { calculateBandedPay, pickBaseHourlyRate } from './pay-time-band.util';
import { calculatePayableAmount } from './visit-reconciliation.util';

describe('Saturday-only pay card must not price weekday visits', () => {
  const saturdayOnlyRules = [
    {
      dayType: 'SATURDAY',
      rateType: 'HOURLY',
      amount: 25,
      multiplier: 1,
      minimumMinutes: null,
      priority: 0,
      sortOrder: 0,
      label: 'Saturday daytime',
      startTime: '07:00',
      endTime: '19:00',
      enhancementMethod: 'ABSOLUTE_HOURLY' as const,
    },
    {
      dayType: 'SATURDAY',
      rateType: 'FIXED',
      amount: 15,
      multiplier: 1,
      minimumMinutes: 15,
      priority: 0,
      sortOrder: 1,
      label: '15 minutes visit',
      startTime: '01:00',
      endTime: '23:00',
    },
  ];

  it('pickBaseHourlyRate ignores Saturday-only bands', () => {
    expect(pickBaseHourlyRate(saturdayOnlyRules)).toBe(0);
  });

  it('does not pay Wednesday 17:00–19:00 from Saturday £25/hr', () => {
    // 2026-08-05 is a Wednesday
    const start = new Date('2026-08-05T17:00:00.000Z');
    const end = new Date('2026-08-05T19:00:00.000Z');
    const banded = calculateBandedPay({
      start,
      end,
      rules: saturdayOnlyRules,
    });
    expect(banded).toBeNull();

    const payable = calculatePayableAmount(saturdayOnlyRules, start, 120, false, {
      start,
      end,
    });
    expect(payable).toBeNull();
  });

  it('still pays Saturday 17:00–19:00 at £25/hr', () => {
    // 2026-08-08 is a Saturday
    const start = new Date('2026-08-08T17:00:00.000Z');
    const end = new Date('2026-08-08T19:00:00.000Z');
    const payable = calculatePayableAmount(saturdayOnlyRules, start, 120, false, {
      start,
      end,
    });
    expect(payable?.label).toBe('BANDED_HOURLY');
    expect(payable?.amount).toBe(50);
  });
});
