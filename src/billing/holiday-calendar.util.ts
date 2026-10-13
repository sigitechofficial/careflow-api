/**
 * PC-22 / PC-23 / PC-24: one description of the holiday calendar for everything that prices carer
 * pay.
 *
 * The calendar says which days are bank holidays in a nation, which of them are substitute days
 * (and for which date), and which days the organisation has named as its own special days. It
 * does not say what anybody is paid: a day in the calendar earns a premium only where a pay card
 * has a rate for it. Which day counts when a holiday falls on a weekend is the organisation's
 * policy (`HolidayPremiumBasis`), not a fact about the calendar.
 */
import { BANK_HOLIDAY_REGIONS, type BankHolidayRegion } from './bank-holiday-regions.util';
import type { SpecialDayCalendar } from './pay-time-band.util';

/** The organisation's own special days are kept beside the bank holidays, under this region. */
export const ORGANISATION_SPECIAL_DAY_REGION = 'ORGANISATION';
export const CALENDAR_REGIONS = [...BANK_HOLIDAY_REGIONS, ORGANISATION_SPECIAL_DAY_REGION] as const;

/**
 * Carer pay when a holiday falls on a weekend.
 * - BOTH: the date itself (25 and 26 December, 1 January) and the substitute weekday. This is how
 *   pay was calculated before the setting existed, and it stays the default until the client
 *   decides (policy decision D-13).
 * - ACTUAL_DAY: the date the holiday falls on; the substitute weekday is an ordinary day.
 * - STATUTORY_DAY: the days in the bank holiday calendar; a holiday on a weekend is an ordinary
 *   weekend day and its substitute weekday is the holiday.
 */
export const HOLIDAY_PREMIUM_BASES = ['BOTH', 'ACTUAL_DAY', 'STATUTORY_DAY'] as const;
export type HolidayPremiumBasis = (typeof HOLIDAY_PREMIUM_BASES)[number];
export const DEFAULT_HOLIDAY_PREMIUM_BASIS: HolidayPremiumBasis = 'BOTH';

export function isHolidayPremiumBasis(value: unknown): value is HolidayPremiumBasis {
  return typeof value === 'string' && (HOLIDAY_PREMIUM_BASES as readonly string[]).includes(value);
}

export type HolidayCalendarRow = {
  holidayDate: Date;
  name: string;
  region: string;
  isSubstitute: boolean;
  substituteForDate: Date | null;
};

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

/** Holidays that fall on the same date every year, by nation. Month and day are 1-based. */
const FIXED_DATE_HOLIDAYS: Array<{
  name: string;
  month: number;
  day: number;
  match: RegExp;
  regions: readonly BankHolidayRegion[];
}> = [
  { name: "New Year's Day", month: 1, day: 1, match: /new year/, regions: BANK_HOLIDAY_REGIONS },
  { name: '2nd January', month: 1, day: 2, match: /2nd january|2 january/, regions: ['SCOTLAND'] },
  { name: "St Patrick's Day", month: 3, day: 17, match: /patrick/, regions: ['NORTHERN_IRELAND'] },
  { name: 'Battle of the Boyne', month: 7, day: 12, match: /boyne|orangemen/, regions: ['NORTHERN_IRELAND'] },
  { name: "St Andrew's Day", month: 11, day: 30, match: /andrew/, regions: ['SCOTLAND'] },
  { name: 'Christmas Day', month: 12, day: 25, match: /christmas/, regions: BANK_HOLIDAY_REGIONS },
  { name: 'Boxing Day', month: 12, day: 26, match: /boxing/, regions: BANK_HOLIDAY_REGIONS },
];

/** Bank holidays in a normal year (one-off holidays add to these). */
const USUAL_HOLIDAYS_PER_YEAR: Record<BankHolidayRegion, number> = {
  UK: 8,
  SCOTLAND: 9,
  NORTHERN_IRELAND: 10,
};

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Whether a calendar entry is a substitute day and, where its name says which holiday it is, the
 * date that holiday fell on. `notes` is the GOV.UK field ("Substitute day").
 */
export function substituteDayInfo(
  name: string,
  holidayDateKey: string,
  notes?: string | null,
): { isSubstitute: boolean; substituteForDate: string | null } {
  const text = name.toLowerCase().replace(/[’`]/g, "'");
  const fixed = FIXED_DATE_HOLIDAYS.find((holiday) => holiday.match.test(text));
  if (fixed) {
    const own = `${holidayDateKey.slice(0, 4)}-${pad(fixed.month)}-${pad(fixed.day)}`;
    if (own !== holidayDateKey) return { isSubstitute: true, substituteForDate: own };
    return { isSubstitute: false, substituteForDate: null };
  }
  const said = /substitute/i.test(name) || /substitute/i.test(notes ?? '');
  return { isSubstitute: said, substituteForDate: null };
}

export type PayCalendar = {
  /** Local days (YYYY-MM-DD) that are bank holidays for carer pay. */
  bankHolidayKeys: Set<string>;
  /** Passed to the pricing functions: the organisation's special days and the fixed-date rule. */
  calendar: SpecialDayCalendar;
};

/**
 * The calendar as carer pay sees it for one nation, under the organisation's policy.
 * `rows` are active calendar rows for that nation and for the organisation's special days.
 */
export function buildPayCalendar(
  rows: HolidayCalendarRow[],
  region: string,
  basis: HolidayPremiumBasis,
): PayCalendar {
  const bankHolidayKeys = new Set<string>();
  const specialDays: NonNullable<SpecialDayCalendar['specialDays']> = [];
  for (const row of rows) {
    if (row.region === ORGANISATION_SPECIAL_DAY_REGION) {
      specialDays.push({ date: dateKey(row.holidayDate), kind: 'SPECIAL' });
      continue;
    }
    if (row.region !== region) continue;
    if (basis === 'ACTUAL_DAY' && row.isSubstitute) {
      // The day the holiday fell on. Where that is not recorded the substitute day is kept, so a
      // holiday is never lost altogether; the calendar status reports the gap.
      bankHolidayKeys.add(dateKey(row.substituteForDate ?? row.holidayDate));
    } else {
      bankHolidayKeys.add(dateKey(row.holidayDate));
    }
  }
  return { bankHolidayKeys, calendar: { specialDays, fixedDates: basis !== 'STATUTORY_DAY' } };
}

export type HolidayCalendarYearStatus = {
  year: number;
  count: number;
  complete: boolean;
  issues: string[];
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Is a nation's calendar for a year fit to price from? A year with dates missing prices every
 * visit on those days as an ordinary day without saying so, which this check exists to catch.
 * `rows` are the active rows of that nation.
 */
export function validateHolidayCalendar(
  rows: HolidayCalendarRow[],
  region: BankHolidayRegion,
  year: number,
): HolidayCalendarYearStatus {
  const inYear = rows.filter(
    (row) => row.region === region && row.holidayDate.getUTCFullYear() === year,
  );
  if (!inYear.length) {
    return { year, count: 0, complete: false, issues: [`No dates are recorded for ${year}.`] };
  }
  const issues: string[] = [];
  const usual = USUAL_HOLIDAYS_PER_YEAR[region];
  if (inYear.length < usual) {
    issues.push(`${inYear.length} dates are recorded for ${year}; a normal year has ${usual}.`);
  }
  const dates = new Set(inYear.map((row) => dateKey(row.holidayDate)));
  const stoodFor = new Set(
    inYear.flatMap((row) => (row.substituteForDate ? [dateKey(row.substituteForDate)] : [])),
  );
  for (const holiday of FIXED_DATE_HOLIDAYS) {
    if (!holiday.regions.includes(region)) continue;
    const key = `${year}-${pad(holiday.month)}-${pad(holiday.day)}`;
    if (dates.has(key) || stoodFor.has(key)) continue;
    const weekday = new Date(`${key}T00:00:00.000Z`).getUTCDay();
    issues.push(
      weekday === 0 || weekday === 6
        ? `${holiday.name} falls on a ${WEEKDAY_NAMES[weekday]} in ${year} and no substitute day is recorded for it.`
        : `${holiday.name} (${key}) is missing.`,
    );
  }
  for (const row of inYear) {
    if (row.isSubstitute && !row.substituteForDate) {
      issues.push(
        `${dateKey(row.holidayDate)} "${row.name}" is a substitute day, but the date it stands for is not recorded.`,
      );
    }
  }
  return { year, count: inYear.length, complete: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------------------------
// R-27: days that are normally a bank holiday but that the calendar says nothing about.
// ---------------------------------------------------------------------------------------------

export type ExpectedBankHoliday = {
  key: string;
  name: string;
  /** The date the holiday itself falls on (YYYY-MM-DD). */
  actual: string;
  /** The weekday it is normally observed on: `actual`, or its substitute day. */
  observed: string;
  /** Any calendar entry whose name matches accounts for this holiday, wherever it was moved to. */
  match: RegExp;
};

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

/** Easter Sunday (Gregorian), the anonymous algorithm. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

function nthMonday(year: number, month: number, n: number): Date {
  const first = utc(year, month, 1);
  const offset = (8 - first.getUTCDay()) % 7; // days to the first Monday
  return addDays(first, offset + (n - 1) * 7);
}

function lastMonday(year: number, month: number): Date {
  const last = utc(year, month + 1, 0);
  return addDays(last, -((last.getUTCDay() + 6) % 7));
}

/**
 * The bank holidays a nation normally has in a year, by the usual pattern, with the weekday each
 * is normally observed on. This is NOT the calendar and is never used to price anything: one-off
 * holidays are not in it and holidays are sometimes moved. Its only use is to notice that the
 * calendar has no entry where one is normally expected, so that a person looks.
 */
export function expectedBankHolidays(region: BankHolidayRegion, year: number): ExpectedBankHoliday[] {
  const easter = easterSunday(year);
  const moving: Array<{ key: string; name: string; date: Date; match: RegExp }> = [
    { key: 'good-friday', name: 'Good Friday', date: addDays(easter, -2), match: /good friday/ },
    { key: 'early-may', name: 'Early May bank holiday', date: nthMonday(year, 5, 1), match: /early may/ },
    { key: 'spring', name: 'Spring bank holiday', date: lastMonday(year, 5), match: /spring/ },
    region === 'SCOTLAND'
      ? { key: 'summer', name: 'Summer bank holiday', date: nthMonday(year, 8, 1), match: /summer/ }
      : { key: 'summer', name: 'Summer bank holiday', date: lastMonday(year, 8), match: /summer/ },
  ];
  if (region !== 'SCOTLAND') {
    moving.push({ key: 'easter-monday', name: 'Easter Monday', date: addDays(easter, 1), match: /easter monday/ });
  }
  const fixed = FIXED_DATE_HOLIDAYS.filter((holiday) => holiday.regions.includes(region)).map((holiday) => ({
    key: holiday.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: holiday.name,
    date: utc(year, holiday.month, holiday.day),
    match: holiday.match,
  }));

  // Observed days: a holiday on a weekday stays; one on a weekend moves to the next weekday that
  // is not already a holiday (so Christmas Day on a Sunday is observed on Tuesday 27 December).
  const taken = new Set(moving.map((h) => iso(h.date)));
  const isWeekend = (date: Date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;
  for (const holiday of fixed) if (!isWeekend(holiday.date)) taken.add(iso(holiday.date));
  const observedOf = new Map<string, string>();
  for (const holiday of fixed) {
    if (!isWeekend(holiday.date)) {
      observedOf.set(holiday.key, iso(holiday.date));
      continue;
    }
    let day = addDays(holiday.date, 1);
    while (isWeekend(day) || taken.has(iso(day))) day = addDays(day, 1);
    taken.add(iso(day));
    observedOf.set(holiday.key, iso(day));
  }
  return [
    ...moving.map((h) => ({ key: h.key, name: h.name, actual: iso(h.date), observed: iso(h.date), match: h.match })),
    ...fixed.map((h) => ({ key: h.key, name: h.name, actual: iso(h.date), observed: observedOf.get(h.key)!, match: h.match })),
  ].sort((a, b) => a.observed.localeCompare(b.observed));
}

export type CalendarEntry = { holidayDate: Date; name: string; region: string };
export type UnresolvedHolidayDay = { day: string; name: string; year: number };

/**
 * Of the local days given, those that are normally a bank holiday in the nation while the
 * calendar has no entry for that holiday in that year: neither a row on the expected day (switched
 * on or off: off means a person decided it is not a holiday) nor a row of that name on another
 * day (the holiday was moved). Pricing such a day as an ordinary day would be a guess.
 *
 * `entries` are ALL rows of the nation for the years concerned, active or not.
 */
export function unresolvedHolidayDays(
  entries: CalendarEntry[],
  region: BankHolidayRegion,
  basis: HolidayPremiumBasis,
  dayKeys: string[],
): UnresolvedHolidayDay[] {
  const out: UnresolvedHolidayDay[] = [];
  const byYear = new Map<number, CalendarEntry[]>();
  for (const entry of entries) {
    if (entry.region !== region) continue;
    const year = entry.holidayDate.getUTCFullYear();
    byYear.set(year, [...(byYear.get(year) ?? []), entry]);
  }
  for (const year of new Set(dayKeys.map((key) => Number(key.slice(0, 4))))) {
    const rows = byYear.get(year) ?? [];
    const dates = new Set(rows.map((row) => dateKey(row.holidayDate)));
    const names = rows.map((row) => row.name.toLowerCase().replace(/[’`]/g, "'"));
    for (const holiday of expectedBankHolidays(region, year)) {
      if (dates.has(holiday.observed) || names.some((name) => holiday.match.test(name))) continue;
      // Which day the missing entry would have made a holiday depends on the organisation's basis.
      // 25 and 26 December and 1 January are special by date under BOTH and ACTUAL_DAY, whatever
      // the calendar holds, so on those dates nothing is unresolved.
      const byDate = ['christmas-day', 'boxing-day', 'new-year-s-day'].includes(holiday.key);
      const affected =
        basis === 'ACTUAL_DAY'
          ? byDate
            ? []
            : [holiday.actual]
          : basis === 'BOTH' && byDate && holiday.observed === holiday.actual
            ? []
            : [holiday.observed];
      for (const day of affected) {
        if (dayKeys.includes(day)) out.push({ day, name: holiday.name, year });
      }
    }
  }
  return out;
}

/** Whether a card pays anything different on a bank holiday; if not, the calendar cannot change its pay. */
export function cardHasHolidayRates(rules: Array<{ dayType?: string | null }>): boolean {
  return rules.some((rule) =>
    ['BANK_HOLIDAY', 'CHRISTMAS', 'BOXING_DAY', 'NEW_YEAR'].includes(String(rule.dayType)),
  );
}

export function describeUnresolvedHolidays(days: UnresolvedHolidayDay[], regionLabel: string): string {
  const list = days.map((d) => `${d.day} is normally ${d.name}`).join('; ');
  return `Carer pay is held: ${list} in ${regionLabel}, but the bank holiday calendar has no entry for it, so it is not known whether the holiday rate applies. Add the date under Billing → Bank holidays (or import from GOV.UK), or add it switched off if it is not a holiday that year; then evaluate the visit again.`;
}

/** Local days (YYYY-MM-DD) a period of work touches. A period ending exactly at midnight does not touch the next day. */
export function localDaysTouched(start: Date, end: Date, dayOf: (instant: Date) => string): string[] {
  const first = dayOf(start);
  const last = dayOf(new Date(Math.max(start.getTime(), end.getTime() - 1)));
  const days = [first];
  let cursor = new Date(`${first}T12:00:00.000Z`);
  while (days[days.length - 1] < last && days.length < 40) {
    cursor = addDays(cursor, 1);
    days.push(iso(cursor));
  }
  return days;
}
