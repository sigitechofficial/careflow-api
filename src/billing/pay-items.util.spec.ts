import { Prisma } from '@prisma/client';
import {
  PAY_ITEM_CONFIG,
  cardBaseHourlyRate,
  cardRuleOfType,
  overtimePremiumPerHour,
  payItemAmount,
  rolledUpHolidayPay,
  weekKeyInTimeZone,
  weeklyOvertime,
} from './pay-items.util';
import { classifyPayRule } from './wage-types.util';

const LONDON = 'Europe/London';

describe('pay item amounts (decimal, half-up to pence)', () => {
  it('multiplies quantity by rate without float drift', () => {
    expect(payItemAmount('7.5', '13.333').toFixed(2)).toBe('100.00');
    expect(payItemAmount('0.1', '0.2').toFixed(2)).toBe('0.02');
    expect(payItemAmount(3, '12.345').toFixed(2)).toBe('37.04');
  });
});

describe('pay item rules', () => {
  it('only manual adjustments may be negative; bonus and adjustment need a second approver', () => {
    expect(PAY_ITEM_CONFIG.MANUAL_ADJUSTMENT.allowNegative).toBe(true);
    expect(PAY_ITEM_CONFIG.BONUS.allowNegative).toBe(false);
    expect(PAY_ITEM_CONFIG.BONUS.requiresSecondApprover).toBe(true);
    expect(PAY_ITEM_CONFIG.MANUAL_ADJUSTMENT.requiresSecondApprover).toBe(true);
    expect(PAY_ITEM_CONFIG.ON_CALL.requiresSecondApprover).toBe(false);
  });

  it('holiday and sick pay do not count as pay for the minimum wage check; training hours count as work', () => {
    expect(PAY_ITEM_CONFIG.HOLIDAY_PAY.includesInNmwPay).toBe(false);
    expect(PAY_ITEM_CONFIG.SICK_PAY.includesInNmwPay).toBe(false);
    expect(PAY_ITEM_CONFIG.TRAINING.countsAsNmwHours).toBe(true);
  });
});

describe('weekly overtime', () => {
  it('uses Monday–Sunday weeks in the organisation timezone', () => {
    // Sunday 11 Oct 2026 23:30 BST = 22:30Z → week of Mon 5 Oct.
    expect(weekKeyInTimeZone(new Date('2026-10-11T22:30:00.000Z'), LONDON)).toBe('2026-10-05');
    // Monday 12 Oct 00:30 BST = Sunday 23:30Z → week of Mon 12 Oct.
    expect(weekKeyInTimeZone(new Date('2026-10-11T23:30:00.000Z'), LONDON)).toBe('2026-10-12');
  });

  it('pays only minutes above the threshold, per week', () => {
    const shifts = [
      // Week of 5 Oct: 5 × 9h = 45h
      ...[5, 6, 7, 8, 9].map((d) => ({ start: new Date(`2026-10-0${d}T08:00:00.000Z`), minutes: 540 })),
      // Week of 12 Oct: 30h
      { start: new Date('2026-10-12T08:00:00.000Z'), minutes: 1800 },
    ];
    expect(weeklyOvertime(shifts, 40 * 60, LONDON)).toEqual([
      { weekKey: '2026-10-05', workedMinutes: 2700, overtimeMinutes: 300 },
      { weekKey: '2026-10-12', workedMinutes: 1800, overtimeMinutes: 0 },
    ]);
  });

  it('pays only the premium on top of base pay (no double counting)', () => {
    expect(overtimePremiumPerHour({ amount: '1.5', enhancementMethod: 'MULTIPLIER' }, 12).toFixed(2)).toBe('6.00');
    expect(overtimePremiumPerHour({ amount: 3, enhancementMethod: 'ADDITIONAL_PER_HOUR' }, 12).toFixed(2)).toBe('3.00');
    expect(overtimePremiumPerHour({ amount: 18, enhancementMethod: 'ABSOLUTE_HOURLY' }, 12).toFixed(2)).toBe('6.00');
    expect(overtimePremiumPerHour({ amount: 10, enhancementMethod: 'ABSOLUTE_HOURLY' }, 12).toFixed(2)).toBe('0.00');
  });
});

describe('rolled-up holiday pay', () => {
  it('is 12.07% of worked pay', () => {
    expect(rolledUpHolidayPay('1000').toFixed(2)).toBe('120.70');
    expect(rolledUpHolidayPay(new Prisma.Decimal('333.33')).toFixed(2)).toBe('40.23');
  });
});

describe('card rates for non-visit pay', () => {
  const rules = [
    { rateType: 'HOURLY', dayType: 'WEEKDAY', startTime: '07:00', endTime: '19:00', amount: 12, sortOrder: 0 },
    { rateType: 'TRAINING', dayType: 'ANY', amount: 11.5, sortOrder: 1 },
    { rateType: 'OVERTIME', dayType: 'ANY', amount: 1.5, enhancementMethod: 'MULTIPLIER', minimumMinutes: 2400, sortOrder: 2 },
  ];

  it('finds the rate rule and the base hourly rate', () => {
    expect(cardRuleOfType(rules, 'TRAINING')?.amount).toBe(11.5);
    expect(cardRuleOfType(rules, 'ON_CALL')).toBeNull();
    expect(cardBaseHourlyRate(rules)).toBe(12);
  });

  it('classifies the new rate types as wage types', () => {
    expect(classifyPayRule({ rateType: 'OVERTIME' })).toBe('OVERTIME');
    expect(classifyPayRule({ rateType: 'ON_CALL' })).toBe('ON_CALL');
    expect(classifyPayRule({ rateType: 'TRAINING' })).toBe('TRAINING');
    expect(classifyPayRule({ rateType: 'LIVE_IN_WEEKLY' })).toBe('LIVE_IN');
  });
});
