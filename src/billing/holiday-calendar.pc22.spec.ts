/**
 * PC-22 / PC-23 / PC-24: the holiday calendar for carer pay.
 *
 * The calendar says which days are holidays, substitute days and organisation special days. The
 * pay card says what is paid. The organisation's policy says which day counts when a holiday
 * falls on a weekend; the default is what was paid before the policy could be chosen.
 */
import { parseGovUkBankHolidays } from './bank-holidays.service';
import {
  buildPayCalendar,
  type HolidayCalendarRow,
  type HolidayPremiumBasis,
  substituteDayInfo,
  validateHolidayCalendar,
} from './holiday-calendar.util';
import { calculatePayableAmount } from './visit-reconciliation.util';

const TZ = 'Europe/London';
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const row = (date: string, name: string, region = 'UK'): HolidayCalendarRow => {
  const info = region === 'ORGANISATION' ? { isSubstitute: false, substituteForDate: null } : substituteDayInfo(name, date);
  return { holidayDate: d(date), name, region, isSubstitute: info.isSubstitute, substituteForDate: info.substituteForDate ? d(info.substituteForDate) : null };
};

// England & Wales as published by GOV.UK.
const EW_2026 = [
  row('2026-01-01', "New Year's Day"),
  row('2026-04-03', 'Good Friday'),
  row('2026-04-06', 'Easter Monday'),
  row('2026-05-04', 'Early May bank holiday'),
  row('2026-05-25', 'Spring bank holiday'),
  row('2026-08-31', 'Summer bank holiday'),
  row('2026-12-25', 'Christmas Day'),
  row('2026-12-28', 'Boxing Day'), // 26 December 2026 is a Saturday
];
const EW_2027 = [
  row('2027-01-01', "New Year's Day"),
  row('2027-03-26', 'Good Friday'),
  row('2027-03-29', 'Easter Monday'),
  row('2027-05-03', 'Early May bank holiday'),
  row('2027-05-31', 'Spring bank holiday'),
  row('2027-08-30', 'Summer bank holiday'),
  row('2027-12-27', 'Christmas Day'), // 25 December 2027 is a Saturday
  row('2027-12-28', 'Boxing Day'), // 26 December 2027 is a Sunday
];

describe('substitute days', () => {
  it('a fixed-date holiday recorded on another date is a substitute day for it', () => {
    expect(substituteDayInfo('Christmas Day', '2027-12-27')).toEqual({ isSubstitute: true, substituteForDate: '2027-12-25' });
    expect(substituteDayInfo('Boxing Day', '2027-12-28')).toEqual({ isSubstitute: true, substituteForDate: '2027-12-26' });
    expect(substituteDayInfo('New Year’s Day', '2028-01-03')).toEqual({ isSubstitute: true, substituteForDate: '2028-01-01' });
    expect(substituteDayInfo('2nd January', '2027-01-04')).toEqual({ isSubstitute: true, substituteForDate: '2027-01-02' });
    expect(substituteDayInfo('St Andrew’s Day', '2025-12-01')).toEqual({ isSubstitute: true, substituteForDate: '2025-11-30' });
    expect(substituteDayInfo('Battle of the Boyne (Orangemen’s Day)', '2026-07-13')).toEqual({ isSubstitute: true, substituteForDate: '2026-07-12' });
    expect(substituteDayInfo('St Patrick’s Day', '2029-03-19')).toEqual({ isSubstitute: true, substituteForDate: '2029-03-17' });
    expect(substituteDayInfo('Christmas Day (substitute day)', '2027-12-27')).toMatchObject({ substituteForDate: '2027-12-25' });
  });

  it('a holiday on its own date, or one that moves every year, is not a substitute day', () => {
    expect(substituteDayInfo('Christmas Day', '2026-12-25')).toEqual({ isSubstitute: false, substituteForDate: null });
    expect(substituteDayInfo('Good Friday', '2026-04-03')).toEqual({ isSubstitute: false, substituteForDate: null });
    expect(substituteDayInfo('Summer bank holiday', '2026-08-31')).toEqual({ isSubstitute: false, substituteForDate: null });
  });

  it('a day that only says it is a substitute is marked, with the date it stands for unknown', () => {
    expect(substituteDayInfo('Coronation (substitute day)', '2030-06-03')).toEqual({ isSubstitute: true, substituteForDate: null });
    expect(substituteDayInfo('Extra bank holiday', '2030-06-03', 'Substitute day')).toEqual({ isSubstitute: true, substituteForDate: null });
  });

  it('the GOV.UK dataset is read with its substitute days, for the three calendars', () => {
    const json = {
      'england-and-wales': { events: [
        { title: 'Christmas Day', date: '2027-12-27', notes: 'Substitute day', bunting: true },
        { title: 'Good Friday', date: '2027-03-26', notes: '', bunting: false },
        { title: 'Old', date: '2019-01-01', notes: '' },
      ] },
      scotland: { events: [{ title: '2nd January', date: '2027-01-04', notes: 'Substitute day' }] },
      'northern-ireland': { events: [{ title: 'St Patrick’s Day', date: '2027-03-17', notes: '' }] },
    };
    expect(parseGovUkBankHolidays(json, '2027-01-01')).toEqual([
      { region: 'UK', holidayDate: '2027-12-27', name: 'Christmas Day', isSubstitute: true, substituteForDate: '2027-12-25' },
      { region: 'UK', holidayDate: '2027-03-26', name: 'Good Friday', isSubstitute: false, substituteForDate: null },
      { region: 'SCOTLAND', holidayDate: '2027-01-04', name: '2nd January', isSubstitute: true, substituteForDate: '2027-01-02' },
      { region: 'NORTHERN_IRELAND', holidayDate: '2027-03-17', name: 'St Patrick’s Day', isSubstitute: false, substituteForDate: null },
    ]);
  });
});

describe('carer pay on a holiday that falls on a weekend', () => {
  const rules = [
    { dayType: 'WEEKDAY', rateType: 'HOURLY', amount: 14 },
    { dayType: 'SATURDAY', rateType: 'HOURLY', amount: 16, startTime: '00:00', endTime: '23:59' },
    { dayType: 'SUNDAY', rateType: 'HOURLY', amount: 18, startTime: '00:00', endTime: '23:59' },
    { dayType: 'BANK_HOLIDAY', rateType: 'HOURLY', amount: 28, startTime: '00:00', endTime: '23:59' },
  ];
  /** One hour from 10:00 on a winter day, priced on the calendar as the policy sees it. */
  const pay = (rows: HolidayCalendarRow[], basis: HolidayPremiumBasis, day: string, cardRules: object[] = rules, region = 'UK') => {
    const { bankHolidayKeys, calendar } = buildPayCalendar(rows, region, basis);
    const start = new Date(`${day}T10:00:00Z`);
    const end = new Date(start.getTime() + 60 * 60_000);
    const isBankHoliday = (at: Date) => bankHolidayKeys.has(at.toISOString().slice(0, 10));
    return calculatePayableAmount(cardRules as never, start, 60, isBankHoliday(start), { start, end, timeZone: TZ, isBankHolidayFn: isBankHoliday, calendar }, null, 60)?.amount;
  };
  // Christmas 2027: Saturday 25, Sunday 26, substitute days Monday 27 and Tuesday 28.
  const christmas2027 = (basis: HolidayPremiumBasis) => ['2027-12-25', '2027-12-26', '2027-12-27', '2027-12-28', '2027-12-29'].map((day) => pay(EW_2027, basis, day));

  it('BOTH (the default): the date and its substitute day, as before the policy could be chosen', () => {
    expect(christmas2027('BOTH')).toEqual([28, 28, 28, 28, 14]);
  });
  it('ACTUAL_DAY: the date the holiday falls on; the substitute weekday is an ordinary day', () => {
    expect(christmas2027('ACTUAL_DAY')).toEqual([28, 28, 14, 14, 14]);
  });
  it('STATUTORY_DAY: the bank holiday calendar; the weekend date is an ordinary weekend day', () => {
    expect(christmas2027('STATUTORY_DAY')).toEqual([16, 18, 28, 28, 14]);
  });

  it('a holiday on a weekday is the same under every policy', () => {
    for (const basis of ['BOTH', 'ACTUAL_DAY', 'STATUTORY_DAY'] as const) {
      expect(pay(EW_2026, basis, '2026-12-25')).toBe(28); // Friday, in the calendar
      expect(pay(EW_2026, basis, '2026-04-03')).toBe(28); // Good Friday
      expect(pay(EW_2026, basis, '2026-04-07')).toBe(14); // an ordinary Tuesday
    }
    // Boxing Day 2026 is a Saturday with a substitute on Monday 28.
    expect([pay(EW_2026, 'BOTH', '2026-12-26'), pay(EW_2026, 'BOTH', '2026-12-28')]).toEqual([28, 28]);
    expect([pay(EW_2026, 'ACTUAL_DAY', '2026-12-26'), pay(EW_2026, 'ACTUAL_DAY', '2026-12-28')]).toEqual([28, 14]);
    expect([pay(EW_2026, 'STATUTORY_DAY', '2026-12-26'), pay(EW_2026, 'STATUTORY_DAY', '2026-12-28')]).toEqual([16, 28]);
  });

  it("a card's own Christmas rate is used on Christmas Day where the policy makes that day the holiday", () => {
    const withChristmas = [...rules, { dayType: 'CHRISTMAS', rateType: 'HOURLY', amount: 35, startTime: '00:00', endTime: '23:59' }];
    expect(pay(EW_2026, 'STATUTORY_DAY', '2026-12-25', withChristmas)).toBe(35); // a Friday
    expect(pay(EW_2027, 'BOTH', '2027-12-25', withChristmas)).toBe(35);
    expect(pay(EW_2027, 'ACTUAL_DAY', '2027-12-25', withChristmas)).toBe(35);
    expect(pay(EW_2027, 'STATUTORY_DAY', '2027-12-25', withChristmas)).toBe(16); // an ordinary Saturday
    expect(pay(EW_2027, 'STATUTORY_DAY', '2027-12-27', withChristmas)).toBe(28); // the substitute: bank holiday rate
  });

  it('Scotland: 2 January on a Saturday and its substitute Monday', () => {
    const scotland = [row('2027-01-01', "New Year's Day", 'SCOTLAND'), row('2027-01-04', '2nd January', 'SCOTLAND')];
    const days = (basis: HolidayPremiumBasis) => ['2027-01-02', '2027-01-04'].map((day) => pay(scotland, basis, day, rules, 'SCOTLAND'));
    expect(days('BOTH')).toEqual([16, 28]); // as before: only the calendar date is known to be a holiday
    expect(days('ACTUAL_DAY')).toEqual([28, 14]);
    expect(days('STATUTORY_DAY')).toEqual([16, 28]);
    // The Scottish holiday is not a holiday on an England & Wales card.
    expect(pay(scotland, 'BOTH', '2027-01-04', rules, 'UK')).toBe(14);
  });

  it('a substitute day whose own date is not recorded is kept as the holiday under ACTUAL_DAY', () => {
    const unknown: HolidayCalendarRow[] = [{ holidayDate: d('2030-06-03'), name: 'Extra (substitute day)', region: 'UK', isSubstitute: true, substituteForDate: null }];
    expect(pay(unknown, 'ACTUAL_DAY', '2030-06-03')).toBe(28);
  });
});

describe('organisation special days', () => {
  const special = [...EW_2026, row('2026-12-24', 'Christmas Eve (organisation)', 'ORGANISATION')];
  const price = (cardRules: object[], day: string, region = 'UK') => {
    const { bankHolidayKeys, calendar } = buildPayCalendar(special, region, 'BOTH');
    const start = new Date(`${day}T10:00:00Z`);
    const end = new Date(start.getTime() + 60 * 60_000);
    const isBankHoliday = (at: Date) => bankHolidayKeys.has(at.toISOString().slice(0, 10));
    return calculatePayableAmount(cardRules as never, start, 60, isBankHoliday(start), { start, end, timeZone: TZ, isBankHolidayFn: isBankHoliday, calendar }, null, 60)?.amount;
  };
  const base = [
    { dayType: 'WEEKDAY', rateType: 'HOURLY', amount: 14 },
    { dayType: 'BANK_HOLIDAY', rateType: 'HOURLY', amount: 28, startTime: '00:00', endTime: '23:59' },
  ];

  it('a card with a special-day rate pays it on the organisation day, on every nation\'s card', () => {
    const withSpecial = [...base, { dayType: 'SPECIAL', rateType: 'HOURLY', amount: 21, startTime: '00:00', endTime: '23:59' }];
    expect(price(withSpecial, '2026-12-24')).toBe(21);
    expect(price(withSpecial, '2026-12-24', 'SCOTLAND')).toBe(21);
    expect(price(withSpecial, '2026-12-23')).toBe(14);
  });

  it('a card with no special-day rate pays the ordinary rate: the calendar does not create a premium', () => {
    expect(price(base, '2026-12-24')).toBe(14); // not the bank holiday rate either
  });

  it('an organisation day is not a bank holiday', () => {
    expect(buildPayCalendar(special, 'UK', 'BOTH').bankHolidayKeys.has('2026-12-24')).toBe(false);
  });
});

describe('is the calendar complete enough to price from', () => {
  it('a full year is complete', () => {
    expect(validateHolidayCalendar(EW_2026, 'UK', 2026)).toEqual({ year: 2026, count: 8, complete: true, issues: [] });
    expect(validateHolidayCalendar(EW_2027, 'UK', 2027)).toMatchObject({ complete: true });
  });

  it('a year with no dates is the first thing to know', () => {
    expect(validateHolidayCalendar(EW_2026, 'UK', 2028)).toEqual({ year: 2028, count: 0, complete: false, issues: ['No dates are recorded for 2028.'] });
    expect(validateHolidayCalendar(EW_2026, 'SCOTLAND', 2026)).toMatchObject({ complete: false, count: 0 });
  });

  it('missing dates are named', () => {
    const noChristmas = EW_2026.filter((r) => !/Christmas|Good Friday/.test(r.name));
    const status = validateHolidayCalendar(noChristmas, 'UK', 2026);
    expect(status.complete).toBe(false);
    expect(status.issues).toEqual(['6 dates are recorded for 2026; a normal year has 8.', 'Christmas Day (2026-12-25) is missing.']);
  });

  it('a holiday on a weekend with no substitute day recorded', () => {
    const noSubstitute = EW_2027.filter((r) => r.name !== 'Boxing Day');
    expect(validateHolidayCalendar(noSubstitute, 'UK', 2027).issues).toContain('Boxing Day falls on a Sunday in 2027 and no substitute day is recorded for it.');
  });

  it('a substitute day that does not say which date it stands for', () => {
    const vague = [...EW_2026, { holidayDate: d('2026-06-01'), name: 'Extra (substitute day)', region: 'UK', isSubstitute: true, substituteForDate: null }];
    expect(validateHolidayCalendar(vague, 'UK', 2026).issues).toEqual(['2026-06-01 "Extra (substitute day)" is a substitute day, but the date it stands for is not recorded.']);
  });

  it('each nation is checked for its own holidays', () => {
    const scotland = EW_2026.filter((r) => r.name !== 'Easter Monday').map((r) => ({ ...r, region: 'SCOTLAND' }));
    const issues = validateHolidayCalendar(scotland, 'SCOTLAND', 2026).issues;
    expect(issues).toContain('2nd January (2026-01-02) is missing.');
    expect(issues).toContain("St Andrew's Day (2026-11-30) is missing.");
    const ni = EW_2026.map((r) => ({ ...r, region: 'NORTHERN_IRELAND' }));
    expect(validateHolidayCalendar(ni, 'NORTHERN_IRELAND', 2026).issues).toEqual([
      '8 dates are recorded for 2026; a normal year has 10.',
      "St Patrick's Day (2026-03-17) is missing.",
      'Battle of the Boyne falls on a Sunday in 2026 and no substitute day is recorded for it.',
    ]);
  });
});
