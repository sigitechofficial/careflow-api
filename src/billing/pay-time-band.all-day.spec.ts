/**
 * Phase 1.1 (PC-21) — an all-day band written as 00:00–23:59 covers the whole day.
 * Bands are half-open [start, end); an end of 23:59 means "to the end of the day".
 */
import { calculateBandedPay, collectBandBoundaries, minuteInTimeBand, type TimeBandRule } from './pay-time-band.util';

const TZ = 'Europe/London';
const rule = (dayType: string, amount: number, startTime?: string, endTime?: string): TimeBandRule =>
  ({ dayType, rateType: 'HOURLY', amount, startTime: startTime ?? null, endTime: endTime ?? null }) as unknown as TimeBandRule;

/** Weekday rate at any time, Saturday and Sunday all day as the rules editor saves them. */
const rules = [
  rule('WEEKDAY', 16),
  rule('SATURDAY', 17, '00:00', '23:59'),
  rule('SUNDAY', 18, '00:00', '23:59'),
  rule('BANK_HOLIDAY', 21, '00:00', '23:59'),
];
const pay = (start: string, end: string, extra: Partial<Parameters<typeof calculateBandedPay>[0]> = {}) =>
  calculateBandedPay({ start: new Date(start), end: new Date(end), rules, timeZone: TZ, ...extra });

describe('minuteInTimeBand', () => {
  it('00:00–23:59 covers the last minute of the day', () => {
    expect(minuteInTimeBand(0, '00:00', '23:59')).toBe(true);
    expect(minuteInTimeBand(23 * 60 + 58, '00:00', '23:59')).toBe(true);
    expect(minuteInTimeBand(23 * 60 + 59, '00:00', '23:59')).toBe(true);
  });

  it('an evening band ending 23:59 runs to midnight; other ends stay exclusive', () => {
    expect(minuteInTimeBand(23 * 60 + 59, '19:00', '23:59')).toBe(true);
    expect(minuteInTimeBand(18 * 60 + 59, '19:00', '23:59')).toBe(false);
    expect(minuteInTimeBand(21 * 60 + 59, '19:00', '22:00')).toBe(true);
    expect(minuteInTimeBand(22 * 60, '19:00', '22:00')).toBe(false);
  });

  it('adjacent bands do not overlap: each minute belongs to one of them', () => {
    for (let minute = 0; minute < 1440; minute += 1) {
      const day = minuteInTimeBand(minute, '07:00', '19:00');
      const evening = minuteInTimeBand(minute, '19:00', '23:59');
      const night = minuteInTimeBand(minute, '00:00', '07:00');
      expect([day, evening, night].filter(Boolean)).toHaveLength(1);
    }
  });

  it('overnight bands and open bands are unchanged', () => {
    expect(minuteInTimeBand(23 * 60 + 30, '22:00', '07:00')).toBe(true);
    expect(minuteInTimeBand(6 * 60 + 59, '22:00', '07:00')).toBe(true);
    expect(minuteInTimeBand(7 * 60, '22:00', '07:00')).toBe(false);
    expect(minuteInTimeBand(12 * 60, null, null)).toBe(true);
    expect(minuteInTimeBand(12 * 60, '00:00', '00:00')).toBe(true);
  });
});

describe('all-day bands across midnight (Europe/London)', () => {
  it('Sunday 22:00 to Monday 00:30 is priced, not "rate missing"', () => {
    // Sun 18 Oct 2026 (BST): 2h Sunday £18 + 0.5h weekday £16
    const result = pay('2026-10-18T21:00:00Z', '2026-10-18T23:30:00Z');
    expect(result?.totalAmount).toBe(44);
  });

  it('23:58 to 00:02 pays two minutes on each day', () => {
    const result = pay('2026-10-18T22:58:00Z', '2026-10-18T23:02:00Z');
    expect(result?.totalAmount).toBe(1.13); // 2 × £18/60 + 2 × £16/60
  });

  it('23:59 to 00:00 pays the last minute of Sunday at the Sunday rate', () => {
    const result = pay('2026-10-18T22:59:00Z', '2026-10-18T23:00:00Z');
    expect(result?.totalAmount).toBe(0.3);
  });

  it('a full Sunday is 24 hours at the Sunday rate', () => {
    // Sun 15 Nov 2026 (GMT)
    const result = pay('2026-11-15T00:00:00Z', '2026-11-16T00:00:00Z');
    expect(result?.totalAmount).toBe(432);
  });

  it('a bank holiday visit ending the next day pays each day at its own rate', () => {
    // Good Friday 3 Apr 2026 22:00 (BST) to Saturday 01:00: 2h bank holiday £21 + 1h Saturday £17
    const result = pay('2026-04-03T21:00:00Z', '2026-04-04T00:00:00Z', {
      isBankHolidayFn: (d) => d.toISOString() < '2026-04-03T23:00:00.000Z' && d.toISOString() >= '2026-04-02T23:00:00.000Z',
    });
    expect(result?.totalAmount).toBe(59);
  });

  it('does not cut an extra slice at 23:59', () => {
    const boundaries = collectBandBoundaries(
      new Date('2026-10-18T21:00:00Z'),
      new Date('2026-10-18T23:30:00Z'),
      rules,
      TZ,
    ).map((d) => d.toISOString());
    expect(boundaries).toEqual([
      '2026-10-18T21:00:00.000Z',
      '2026-10-18T23:00:00.000Z', // local midnight
      '2026-10-18T23:30:00.000Z',
    ]);
  });
});

describe('all-day bands on clock-change days (Europe/London)', () => {
  it('clocks back (25 Oct 2026): Sunday 23:30 to Monday 00:30', () => {
    // After the change the UK is on GMT: 23:30 local = 23:30Z
    const result = pay('2026-10-25T23:30:00Z', '2026-10-26T00:30:00Z');
    expect(result?.totalAmount).toBe(17); // 0.5h × £18 + 0.5h × £16
  });

  it('clocks back: the whole Sunday is 25 hours', () => {
    const result = pay('2026-10-24T23:00:00Z', '2026-10-26T00:00:00Z');
    expect(result?.totalAmount).toBe(450); // 25h × £18
  });

  it('clocks forward (28 Mar 2027): the whole Sunday is 23 hours', () => {
    const result = pay('2027-03-28T00:00:00Z', '2027-03-28T23:00:00Z');
    expect(result?.totalAmount).toBe(414); // 23h × £18
  });

  it('clocks forward: Saturday 23:30 to Sunday 00:30', () => {
    // Sat 27 Mar 2027 is GMT: 23:30 local = 23:30Z; Sunday starts 00:00Z
    const result = pay('2027-03-27T23:30:00Z', '2027-03-28T00:30:00Z');
    expect(result?.totalAmount).toBe(17.5); // 0.5h × £17 + 0.5h × £18
  });
});
