/**
 * R-27: a day that is normally a bank holiday, with no entry in the calendar, is not priced as an
 * ordinary day. The "normal pattern" is checked here against the dates GOV.UK publishes.
 */
import { parseGovUkBankHolidays } from './bank-holidays.service';
import {
  type CalendarEntry,
  cardHasHolidayRates,
  expectedBankHolidays,
  localDaysTouched,
  unresolvedHolidayDays,
  validateHolidayCalendar,
} from './holiday-calendar.util';
import { GOV_UK_BANK_HOLIDAYS } from './testing/gov-uk-bank-holidays.fixture';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const published = parseGovUkBankHolidays(GOV_UK_BANK_HOLIDAYS, '2019-01-01');
const publishedDates = (region: string, year: number) =>
  published.filter((h) => h.region === region && h.holidayDate.startsWith(String(year))).map((h) => h.holidayDate).sort();
const entriesOf = (region: string, year?: number): CalendarEntry[] =>
  published
    .filter((h) => h.region === region && (!year || h.holidayDate.startsWith(String(year))))
    .map((h) => ({ holidayDate: d(h.holidayDate), name: h.name, region: h.region }));
const expectedDates = (region: 'UK' | 'SCOTLAND' | 'NORTHERN_IRELAND', year: number) =>
  expectedBankHolidays(region, year).map((h) => h.observed).sort();
const london = (instant: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(instant);

describe('the usual pattern agrees with the published calendar', () => {
  it('England & Wales, ordinary years: exactly the published dates', () => {
    for (const year of [2019, 2021, 2024, 2025, 2026, 2027, 2028]) {
      expect(expectedDates('UK', year)).toEqual(publishedDates('UK', year));
    }
  });

  it('England & Wales, years with moved or one-off holidays: the differences are those holidays and nothing else', () => {
    const difference = (year: number) => {
      const usual = expectedDates('UK', year);
      const actual = publishedDates('UK', year);
      return { notPublished: usual.filter((x) => !actual.includes(x)), extra: actual.filter((x) => !usual.includes(x)) };
    };
    expect(difference(2020)).toEqual({ notPublished: ['2020-05-04'], extra: ['2020-05-08'] }); // early May moved for VE day
    expect(difference(2022)).toEqual({ notPublished: ['2022-05-30'], extra: ['2022-06-02', '2022-06-03', '2022-09-19'] }); // jubilee, state funeral
    expect(difference(2023)).toEqual({ notPublished: [], extra: ['2023-05-08'] }); // coronation
  });

  it('Scotland 2025 to 2028: the published dates, apart from the one-off holiday of 2026', () => {
    for (const year of [2025, 2027, 2028]) expect(expectedDates('SCOTLAND', year)).toEqual(publishedDates('SCOTLAND', year));
    expect(publishedDates('SCOTLAND', 2026).filter((x) => !expectedDates('SCOTLAND', 2026).includes(x))).toEqual(['2026-06-15']);
    expect(expectedDates('SCOTLAND', 2026).filter((x) => !publishedDates('SCOTLAND', 2026).includes(x))).toEqual([]);
  });

  it('Northern Ireland 2025 to 2028: exactly the published dates', () => {
    for (const year of [2025, 2026, 2027, 2028]) expect(expectedDates('NORTHERN_IRELAND', year)).toEqual(publishedDates('NORTHERN_IRELAND', year));
  });

  it('substitute days: the published substitutes are where the pattern puts them', () => {
    const observed = (region: 'UK' | 'SCOTLAND' | 'NORTHERN_IRELAND', year: number, key: string) =>
      expectedBankHolidays(region, year).find((h) => h.key === key);
    expect(observed('UK', 2027, 'christmas-day')).toMatchObject({ actual: '2027-12-25', observed: '2027-12-27' });
    expect(observed('UK', 2027, 'boxing-day')).toMatchObject({ actual: '2027-12-26', observed: '2027-12-28' });
    expect(observed('UK', 2022, 'christmas-day')).toMatchObject({ actual: '2022-12-25', observed: '2022-12-27' }); // Sunday; Boxing Day keeps Monday
    expect(observed('UK', 2022, 'boxing-day')).toMatchObject({ observed: '2022-12-26' });
    expect(observed('UK', 2028, 'new-year-s-day')).toMatchObject({ actual: '2028-01-01', observed: '2028-01-03' });
    expect(observed('SCOTLAND', 2028, '2nd-january')).toMatchObject({ actual: '2028-01-02', observed: '2028-01-04' });
    expect(observed('SCOTLAND', 2025, 'st-andrew-s-day')).toMatchObject({ actual: '2025-11-30', observed: '2025-12-01' });
    expect(observed('NORTHERN_IRELAND', 2026, 'battle-of-the-boyne')).toMatchObject({ actual: '2026-07-12', observed: '2026-07-13' });
  });

  it('the published years are complete by the completeness check, with their substitute days recognised', () => {
    const rows = (region: string) =>
      published.filter((h) => h.region === region).map((h) => ({
        holidayDate: d(h.holidayDate),
        name: h.name,
        region: h.region,
        isSubstitute: h.isSubstitute,
        substituteForDate: h.substituteForDate ? d(h.substituteForDate) : null,
      }));
    for (const year of [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028]) {
      expect(validateHolidayCalendar(rows('UK'), 'UK', year)).toMatchObject({ complete: true, issues: [] });
    }
    for (const year of [2025, 2026, 2027, 2028]) {
      expect(validateHolidayCalendar(rows('SCOTLAND'), 'SCOTLAND', year)).toMatchObject({ complete: true });
      expect(validateHolidayCalendar(rows('NORTHERN_IRELAND'), 'NORTHERN_IRELAND', year)).toMatchObject({ complete: true });
    }
    expect(published.filter((h) => h.isSubstitute && !h.substituteForDate)).toEqual([]);
  });
});

describe('R-27: days the calendar says nothing about', () => {
  it('a complete published year has no unresolved day, including the years with moved holidays', () => {
    for (const year of [2020, 2022, 2023, 2026, 2027]) {
      const everyDay = Array.from({ length: 366 }, (_, i) => new Date(Date.UTC(year, 0, 1 + i)).toISOString().slice(0, 10)).filter((k) => k.startsWith(String(year)));
      expect(unresolvedHolidayDays(entriesOf('UK', year), 'UK', 'BOTH', everyDay)).toEqual([]);
    }
  });

  it('a year with no entries: every day that is normally a bank holiday is unresolved, and no other day', () => {
    const days = ['2027-03-26', '2027-03-29', '2027-05-03', '2027-05-04', '2027-12-27', '2027-12-25', '2027-01-01', '2027-06-15'];
    expect(unresolvedHolidayDays([], 'UK', 'BOTH', days).map((u) => [u.day, u.name])).toEqual([
      ['2027-03-26', 'Good Friday'],
      ['2027-03-29', 'Easter Monday'],
      ['2027-05-03', 'Early May bank holiday'],
      ['2027-12-27', 'Christmas Day'], // the substitute Monday is a holiday only if the calendar says so
    ]);
    // 1 January 2027 (a Friday) and 25 December are special by date under BOTH: nothing to resolve there.
  });

  it('one missing entry in an otherwise complete year', () => {
    const noSummer = entriesOf('UK', 2027).filter((e) => !/Summer/.test(e.name));
    expect(unresolvedHolidayDays(noSummer, 'UK', 'BOTH', ['2027-08-30', '2027-08-31', '2027-05-03'])).toEqual([{ day: '2027-08-30', name: 'Summer bank holiday', year: 2027 }]);
  });

  it('an entry switched off, or a holiday moved to another day, is a decision: nothing is unresolved', () => {
    const switchedOff = [...entriesOf('UK', 2027).filter((e) => !/Summer/.test(e.name)), { holidayDate: d('2027-08-30'), name: 'Not observed this year', region: 'UK' }];
    expect(unresolvedHolidayDays(switchedOff, 'UK', 'BOTH', ['2027-08-30'])).toEqual([]);
    // 2020: the early May holiday was moved to Friday 8 May. Monday 4 May is an ordinary day.
    expect(unresolvedHolidayDays(entriesOf('UK', 2020), 'UK', 'BOTH', ['2020-05-04', '2020-05-08'])).toEqual([]);
  });

  it('each nation has its own holidays', () => {
    expect(unresolvedHolidayDays([], 'SCOTLAND', 'BOTH', ['2027-01-04', '2027-11-30', '2027-03-29', '2027-08-02', '2027-08-30']).map((u) => u.day)).toEqual(['2027-01-04', '2027-08-02', '2027-11-30']);
    expect(unresolvedHolidayDays([], 'NORTHERN_IRELAND', 'BOTH', ['2027-03-17', '2027-07-12', '2027-03-29', '2027-01-04']).map((u) => u.day)).toEqual(['2027-03-17', '2027-03-29', '2027-07-12']);
    // A Scottish gap does not hold an England & Wales card.
    expect(unresolvedHolidayDays(entriesOf('UK', 2027), 'UK', 'BOTH', ['2027-01-04', '2027-11-30'])).toEqual([]);
  });

  it("which day is unresolved follows the organisation's basis for weekend holidays", () => {
    // Scotland 2027: 2 January is a Saturday, observed on Monday 4 January. No entries at all.
    const days = ['2027-01-02', '2027-01-04'];
    expect(unresolvedHolidayDays([], 'SCOTLAND', 'BOTH', days).map((u) => u.day)).toEqual(['2027-01-04']);
    expect(unresolvedHolidayDays([], 'SCOTLAND', 'STATUTORY_DAY', days).map((u) => u.day)).toEqual(['2027-01-04']);
    expect(unresolvedHolidayDays([], 'SCOTLAND', 'ACTUAL_DAY', days).map((u) => u.day)).toEqual(['2027-01-02']);
    // Christmas Day 2027 (a Saturday): special by date unless the basis is the statutory day.
    const christmas = ['2027-12-25', '2027-12-27'];
    expect(unresolvedHolidayDays([], 'UK', 'ACTUAL_DAY', christmas)).toEqual([]);
    expect(unresolvedHolidayDays([], 'UK', 'STATUTORY_DAY', christmas).map((u) => u.day)).toEqual(['2027-12-27']);
    // Christmas Day 2026 (a Friday): by date under BOTH; under the statutory basis only the calendar makes it a holiday.
    expect(unresolvedHolidayDays([], 'UK', 'BOTH', ['2026-12-25'])).toEqual([]);
    expect(unresolvedHolidayDays([], 'UK', 'STATUTORY_DAY', ['2026-12-25']).map((u) => u.day)).toEqual(['2026-12-25']);
  });

  it('only a card that pays differently on a holiday depends on the calendar', () => {
    expect(cardHasHolidayRates([{ dayType: 'WEEKDAY' }, { dayType: 'SATURDAY' }, { dayType: 'ANY' }])).toBe(false);
    expect(cardHasHolidayRates([{ dayType: 'WEEKDAY' }, { dayType: 'BANK_HOLIDAY' }])).toBe(true);
    expect(cardHasHolidayRates([{ dayType: 'CHRISTMAS' }])).toBe(true);
    expect(cardHasHolidayRates([{ dayType: 'SPECIAL' }])).toBe(false); // organisation days come from the calendar's own entries
  });
});

describe('R-27: the days a period of work touches (midnight)', () => {
  const touched = (start: string, end: string) => localDaysTouched(new Date(start), new Date(end), london);

  it('a visit inside one day, and one that ends exactly at midnight, touch that day only', () => {
    expect(touched('2027-05-02T09:00:00Z', '2027-05-02T10:00:00Z')).toEqual(['2027-05-02']);
    expect(touched('2027-05-02T21:00:00Z', '2027-05-02T23:00:00Z')).toEqual(['2027-05-02']); // 22:00 to midnight BST
  });

  it('a visit one minute past midnight touches the next day', () => {
    expect(touched('2027-05-02T21:00:00Z', '2027-05-02T23:01:00Z')).toEqual(['2027-05-02', '2027-05-03']);
  });

  it('local midnight, not UTC midnight, decides (summer time)', () => {
    // 00:15 BST on Monday 3 May 2027 is 23:15 UTC on Sunday.
    expect(touched('2027-05-02T23:15:00Z', '2027-05-02T23:45:00Z')).toEqual(['2027-05-03']);
  });

  it('a long shift touches every day it covers', () => {
    expect(touched('2027-12-24T20:00:00Z', '2027-12-27T08:00:00Z')).toEqual(['2027-12-24', '2027-12-25', '2027-12-26', '2027-12-27']);
  });
});
