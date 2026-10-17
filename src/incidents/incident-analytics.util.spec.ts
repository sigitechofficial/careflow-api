import { analyticsCalendarParts, lastMonthKeys } from './incident-analytics.util';

const LONDON = 'Europe/London';

describe('analyticsCalendarParts (organisation time, not UTC)', () => {
  it('summer (BST): 00:30 UK on Thu 1 Oct is October, Thursday, hour 0', () => {
    // 23:30 UTC on Wed 30 Sep
    expect(analyticsCalendarParts(new Date('2026-09-30T23:30:00Z'), LONDON)).toEqual({
      hour: 0,
      weekday: 4,
      monthKey: '2026-10',
    });
  });

  it('summer (BST): 06:05 UK is a morning hour, not night', () => {
    expect(analyticsCalendarParts(new Date('2026-10-06T05:05:00Z'), LONDON).hour).toBe(6);
  });

  it('winter (GMT): UK time equals UTC', () => {
    expect(analyticsCalendarParts(new Date('2026-12-01T00:30:00Z'), LONDON)).toEqual({
      hour: 0,
      weekday: 2,
      monthKey: '2026-12',
    });
  });
});

describe('lastMonthKeys', () => {
  it('ends with the current organisation month even in the first BST hour of the month', () => {
    const keys = lastMonthKeys(12, new Date('2026-09-30T23:30:00Z'), LONDON);
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe('2025-11');
    expect(keys[11]).toBe('2026-10');
  });

  it('crosses the year boundary', () => {
    expect(lastMonthKeys(3, new Date('2027-01-15T12:00:00Z'), LONDON)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });
});
