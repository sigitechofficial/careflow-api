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
