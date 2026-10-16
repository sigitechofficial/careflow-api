/**
 * PC-21 regression on the charge side: charge rules use the same time-band matcher as pay rules,
 * so an all-day charge band written as 00:00–23:59 must also cover the last minute of the day.
 */
import { calculateBillableAmount, calculatePayableAmount } from './visit-reconciliation.util';

const TZ = 'Europe/London';
const chargeRule = (dayType: string, amount: number, startTime?: string, endTime?: string) =>
  ({
    dayType,
    rateType: 'HOURLY',
    chargeMethod: 'HOURLY_PRO_RATA',
    amount,
    startTime: startTime ?? null,
    endTime: endTime ?? null,
    chargeableFlag: true,
  }) as never;
const payRule = (dayType: string, amount: number, startTime?: string, endTime?: string) =>
  ({ dayType, rateType: 'HOURLY', amount, startTime: startTime ?? null, endTime: endTime ?? null }) as never;

describe('charge cards and the all-day band', () => {
  const rules = [
    chargeRule('WEEKDAY', 20),
    chargeRule('SATURDAY', 22, '00:00', '23:59'),
    chargeRule('SUNDAY', 24, '00:00', '23:59'),
    chargeRule('BANK_HOLIDAY', 30, '00:00', '23:59'),
  ];
  const charge = (start: string, end: string, isBankHolidayFn?: (d: Date) => boolean) => {
    const s = new Date(start);
    const e = new Date(end);
    return calculateBillableAmount(
      rules,
      s,
      Math.round((e.getTime() - s.getTime()) / 60_000),
      'HOURLY_PRO_RATA',
      false,
      { start: s, end: e, timeZone: TZ, isBankHolidayFn },
    );
  };

  it('Sunday 22:00 to Monday 00:30 is charged, each part at its own rate', () => {
    // Sun 15 Nov 2026 (GMT): 2h × £24 + 0.5h × £20
    expect(charge('2026-11-15T22:00:00Z', '2026-11-16T00:30:00Z')?.amount).toBe(58);
  });

  it('the last minute of Sunday is charged at the Sunday rate', () => {
    expect(charge('2026-11-15T23:30:00Z', '2026-11-16T00:00:00Z')?.amount).toBe(12); // 30 min × £24
    expect(charge('2026-11-15T23:59:00Z', '2026-11-16T00:00:00Z')?.amount).toBe(0.4);
  });

  it('a bank holiday charge runs to midnight; the next day is charged at its own rate', () => {
    // Good Friday 3 Apr 2026 22:00 (BST) to Saturday 01:00: 2h × £30 + 1h × £22
    const isGoodFriday = (d: Date) =>
      d.toISOString() >= '2026-04-02T23:00:00.000Z' && d.toISOString() < '2026-04-03T23:00:00.000Z';
    expect(charge('2026-04-03T21:00:00Z', '2026-04-04T00:00:00Z', isGoodFriday)?.amount).toBe(82);
  });

  it('clock changes: charged for elapsed time on a Sunday all-day band', () => {
    expect(charge('2026-10-24T23:00:00Z', '2026-10-26T00:00:00Z')?.amount).toBe(600); // 25h × £24
    expect(charge('2027-03-28T00:00:00Z', '2027-03-28T23:00:00Z')?.amount).toBe(552); // 23h × £24
  });
});

describe('visit pay through calculatePayableAmount on an all-day band', () => {
  const rules = [payRule('WEEKDAY', 14), payRule('SUNDAY', 18, '00:00', '23:59')];
  const pay = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const minutes = Math.round((e.getTime() - s.getTime()) / 60_000);
    return calculatePayableAmount(rules, s, minutes, false, { start: s, end: e, timeZone: TZ }, null, minutes);
  };

  it('a visit ending at Sunday midnight is paid at the Sunday rate to the last minute', () => {
    expect(pay('2026-11-15T23:29:00Z', '2026-11-16T00:00:00Z')?.amount).toBe(9.3); // 31 min × £18
  });

  it('a short visit across Sunday midnight is split between the two days', () => {
    expect(pay('2026-11-15T23:40:00Z', '2026-11-16T00:10:00Z')?.amount).toBe(8.33); // 20 × 18/60 + 10 × 14/60
  });
});
