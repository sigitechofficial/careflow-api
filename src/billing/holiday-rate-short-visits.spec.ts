/**
 * Carer pay on a bank holiday: the card's holiday rate applies to short visits too, instead of an
 * "any day" fixed visit amount. A fixed amount set for the holiday itself still wins.
 */
import { calculatePayableAmount } from './visit-reconciliation.util';

const TZ = 'Europe/London';
// Friday 23 Oct 2026, 11:00–12:00 London (BST) — the day used for the test bank holiday.
const start = new Date('2026-10-23T10:00:00.000Z');
const end = new Date('2026-10-23T11:00:00.000Z');
const rule = (r: Record<string, unknown>) => ({ priority: 0, sortOrder: 0, appliesToVisit: true, ...r });

// The shape of pay card "zz": hourly day rates, a bank holiday rate and "any day" fixed visits.
const card = [
  rule({ dayType: 'WEEKDAY', rateType: 'HOURLY', amount: 14, startTime: '07:00', endTime: '19:00' }),
  rule({ dayType: 'BANK_HOLIDAY', rateType: 'HOURLY', amount: 21, startTime: '00:00', endTime: '23:59' }),
  rule({ dayType: 'ANY', rateType: 'FIXED', amount: 14.5, minimumMinutes: 60, startTime: '00:00', endTime: '23:59' }),
  rule({ dayType: 'ANY', rateType: 'FIXED', amount: 8.5, minimumMinutes: 30, startTime: '00:00', endTime: '23:59' }),
];

const pay = (
  rules: unknown[],
  minutes: number,
  bankHoliday: boolean,
  dayTypePriority?: Record<string, number>,
) => {
  const to = new Date(start.getTime() + minutes * 60_000);
  return calculatePayableAmount(
    rules as never,
    start,
    minutes,
    bankHoliday,
    {
      start,
      end: to,
      timeZone: TZ,
      isBankHolidayFn: () => bankHoliday,
      ...(dayTypePriority ? { calendar: { dayTypePriority } } : {}),
    },
    null,
    minutes,
  )?.amount;
};

// The built-in order with "Any day" moved to the top.
const anyDayFirst = {
  ANY: 200, CHRISTMAS: 100, BOXING_DAY: 90, NEW_YEAR: 80, EASTER: 70, SPECIAL: 60,
  BANK_HOLIDAY: 50, SUNDAY: 40, SATURDAY: 30, WEEKDAY: 20,
};

describe('bank holiday rate on short visits', () => {
  it('a 60-minute visit on a bank holiday is paid the holiday rate, not the fixed amount', () => {
    expect(pay(card, 60, true)).toBe(21);
  });

  it('a 30-minute visit on a bank holiday is paid half an hour at the holiday rate', () => {
    expect(pay(card, 30, true)).toBe(10.5);
  });

  it('on an ordinary day the fixed visit amount still applies', () => {
    expect(pay(card, 60, false)).toBe(14.5);
    expect(pay(card, 30, false)).toBe(8.5);
  });

  it('a fixed amount set for the bank holiday itself wins on that day', () => {
    const withHolidayFixed = [
      ...card,
      rule({ dayType: 'BANK_HOLIDAY', rateType: 'FIXED', amount: 25, minimumMinutes: 60, startTime: '00:00', endTime: '23:59' }),
    ];
    expect(pay(withHolidayFixed, 60, true)).toBe(25);
  });

  it('the organisation day priority: "Any day" ranked above bank holiday keeps the fixed amount', () => {
    expect(pay(card, 60, true, anyDayFirst)).toBe(14.5);
    // The default order (bank holiday above any day) pays the holiday rate.
    expect(pay(card, 60, true)).toBe(21);
  });

  it('the organisation day priority decides between overlapping hourly rates', () => {
    // A weekday rate and a bank holiday rate both cover 11:00–12:00 on the holiday.
    const weekdayFirst = { ...anyDayFirst, ANY: 10, WEEKDAY: 300 };
    expect(pay(card, 120, true)).toBe(42);
    expect(pay(card, 120, true, weekdayFirst)).toBe(28);
  });

  it('the higher priority wins between two fixed amounts for the same visit length', () => {
    const twoFixed = [
      ...card,
      rule({ dayType: 'ANY', rateType: 'FIXED', amount: 16, minimumMinutes: 60, startTime: '00:00', endTime: '23:59', priority: 5 }),
    ];
    expect(pay(twoFixed, 60, false)).toBe(16);
  });

  it('a card without a holiday rate keeps the fixed amount on a bank holiday', () => {
    const noHolidayRate = card.filter((r) => r.dayType !== 'BANK_HOLIDAY');
    expect(pay(noHolidayRate, 60, true)).toBe(14.5);
  });
});
