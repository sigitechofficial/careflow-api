import { Prisma } from '@prisma/client';
import { TimebankBudget } from './service-user-timebank-ledger.service';
import {
  makeTimebankDayRule,
  standardWeekdayTime,
} from './timebank-day-rule.util';

/** Timebank hours only pay for weekday care at the standard rate (decision 10 Nov 2026). */
describe('timebank day rule', () => {
  const TZ = 'Europe/London';

  function db(
    holidays: Array<{ date: string; name: string; region?: string }> = [],
  ) {
    return {
      bankHoliday: {
        findMany: jest.fn(
          (args: { where: { holidayDate: { gte: Date; lte: Date } } }) =>
            Promise.resolve(
              holidays
                .map((h) => ({
                  holidayDate: new Date(`${h.date}T00:00:00.000Z`),
                  name: h.name,
                  region: h.region ?? 'UK',
                }))
                .filter(
                  (h) =>
                    h.holidayDate >= args.where.holidayDate.gte &&
                    h.holidayDate <= args.where.holidayDate.lte,
                ),
            ),
        ),
      },
    };
  }

  const hourly = (
    dayType: string,
    amount: number,
    startTime: string | null = null,
    endTime: string | null = null,
    priority = 0,
  ) => ({
    dayType,
    rateType: 'HOURLY',
    chargeMethod: 'HOURLY_PRO_RATA',
    amount: new Prisma.Decimal(amount),
    chargeableFlag: true,
    priority,
    sortOrder: 0,
    startTime,
    endTime,
    serviceType: null,
    minimumMinutes: null,
    multiplier: null,
  });

  const at = (iso: string) => new Date(iso);

  // Wed 11 Nov 2026 is a normal weekday; Sat 14 Nov a weekend; Fri 25 Dec Christmas Day.
  it('allows a normal weekday visit', async () => {
    const rule = makeTimebankDayRule({
      db: db() as never,
      timeZone: TZ,
      card: null,
    });
    expect(
      await rule(at('2026-11-11T10:00:00Z'), at('2026-11-11T12:00:00Z')),
    ).toBeNull();
  });

  it('blocks a weekend visit', async () => {
    const rule = makeTimebankDayRule({
      db: db() as never,
      timeZone: TZ,
      card: null,
    });
    expect(
      await rule(at('2026-11-14T10:00:00Z'), at('2026-11-14T12:00:00Z')),
    ).toBe('weekend (Saturday)');
  });

  it('blocks a bank holiday and an organisation special day', async () => {
    const rule = makeTimebankDayRule({
      db: db([
        { date: '2026-12-25', name: 'Christmas Day' },
        { date: '2026-11-12', name: 'Founders Day', region: 'ORGANISATION' },
      ]) as never,
      timeZone: TZ,
      card: null,
    });
    expect(
      await rule(at('2026-12-25T10:00:00Z'), at('2026-12-25T12:00:00Z')),
    ).toBe('Christmas Day (bank holiday)');
    expect(
      await rule(at('2026-11-12T10:00:00Z'), at('2026-11-12T11:00:00Z')),
    ).toBe('Founders Day (special day)');
  });

  it('blocks a visit that runs past midnight into a weekend', async () => {
    const rule = makeTimebankDayRule({
      db: db() as never,
      timeZone: TZ,
      card: null,
    });
    // Fri 13 Nov 22:00 – Sat 14 Nov 01:00.
    expect(
      await rule(at('2026-11-13T22:00:00Z'), at('2026-11-14T01:00:00Z')),
    ).toBe('weekend (Saturday)');
  });

  it('blocks a weekday time the charge card prices differently, allows the standard time', async () => {
    const card = {
      rules: [
        hourly('WEEKDAY', 20),
        // Evening rate 20:00–23:59, higher priority.
        hourly('WEEKDAY', 28, '20:00', '23:59', 10),
      ] as never,
      defaultChargeMethod: 'HOURLY_PRO_RATA',
    };
    const rule = makeTimebankDayRule({ db: db() as never, timeZone: TZ, card });
    expect(
      await rule(at('2026-11-11T10:00:00Z'), at('2026-11-11T11:00:00Z')),
    ).toBeNull();
    expect(
      await rule(at('2026-11-11T20:30:00Z'), at('2026-11-11T21:30:00Z')),
    ).toBe('a different rate on the charge card at this time');
  });

  it('the standard weekday time skips a bank holiday Monday', async () => {
    const d = db([{ date: '2026-08-31', name: 'Summer bank holiday' }]);
    const t = await standardWeekdayTime(d as never, '2026-08-31', TZ);
    // Tuesday 1 Sep 2026, 10:00 BST = 09:00Z.
    expect(t.toISOString()).toBe('2026-09-01T09:00:00.000Z');
  });

  it('the budget asks the rule only when the setting is on', async () => {
    const rule = jest.fn().mockResolvedValue('weekend (Saturday)');
    const on = new TimebankBudget(true, 600, new Map()).withDayRule(rule);
    const off = new TimebankBudget(false, 600, new Map()).withDayRule(rule);
    const start = at('2026-11-14T10:00:00Z');
    const end = at('2026-11-14T12:00:00Z');
    expect(await on.blockReason(start, end)).toBe('weekend (Saturday)');
    expect(await off.blockReason(start, end)).toBeNull();
    expect(rule).toHaveBeenCalledTimes(1);
  });
});
