/**
 * PC-22 / PC-23 / PC-24: the one place carer pay reads the holiday calendar from.
 *
 * Visit pricing, the pay card preview and the calendar status all go through these functions, so
 * they agree on which days are holidays for a nation, on the organisation's special days and on
 * the organisation's policy for holidays that fall on a weekend. They take a root client or a
 * transaction client.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BANK_HOLIDAY_REGION_LABELS, BANK_HOLIDAY_REGIONS, isBankHolidayRegion } from './bank-holiday-regions.util';
import {
  buildPayCalendar,
  cardHasHolidayRates,
  describeUnresolvedHolidays,
  localDaysTouched,
  unresolvedHolidayDays,
  DEFAULT_HOLIDAY_PREMIUM_BASIS,
  type HolidayPremiumBasis,
  isHolidayPremiumBasis,
  ORGANISATION_SPECIAL_DAY_REGION,
  type PayCalendar,
  validateHolidayCalendar,
} from './holiday-calendar.util';

type Db = PrismaService | Prisma.TransactionClient;

const ROW_SELECT = {
  holidayDate: true,
  name: true,
  region: true,
  isSubstitute: true,
  substituteForDate: true,
} as const;

export async function loadHolidayPremiumBasis(db: Db): Promise<HolidayPremiumBasis> {
  const settings = await db.organisationGeneralSettings.findFirst({
    select: { holidayPremiumBasis: true },
  });
  return isHolidayPremiumBasis(settings?.holidayPremiumBasis)
    ? settings.holidayPremiumBasis
    : DEFAULT_HOLIDAY_PREMIUM_BASIS;
}

/** The calendar for carer pay in one nation over [from, to] (padded so day edges are not missed). */
export async function loadPayCalendar(
  db: Db,
  from: Date,
  to: Date,
  region: string,
): Promise<PayCalendar> {
  const padMs = 36 * 60 * 60 * 1000;
  const range = { gte: new Date(from.getTime() - padMs), lte: new Date(to.getTime() + padMs) };
  const [basis, rows] = await Promise.all([
    loadHolidayPremiumBasis(db),
    db.bankHoliday.findMany({
      where: {
        isActive: true,
        region: { in: [region, ORGANISATION_SPECIAL_DAY_REGION] },
        OR: [{ holidayDate: range }, { substituteForDate: range }],
      },
      select: ROW_SELECT,
    }),
  ]);
  return buildPayCalendar(rows, region, basis);
}

/** Whether each nation's calendar is complete for the years given, and the policy in force. */
export async function loadHolidayCalendarStatus(db: Db, years: number[]) {
  const first = Math.min(...years);
  const last = Math.max(...years);
  const [basis, rows] = await Promise.all([
    loadHolidayPremiumBasis(db),
    db.bankHoliday.findMany({
      where: {
        isActive: true,
        holidayDate: {
          gte: new Date(`${first}-01-01T00:00:00.000Z`),
          lte: new Date(`${last}-12-31T00:00:00.000Z`),
        },
      },
      select: ROW_SELECT,
    }),
  ]);
  const regions = BANK_HOLIDAY_REGIONS.map((region) => ({
    region,
    years: years.map((year) => validateHolidayCalendar(rows, region, year)),
  }));
  return {
    basis,
    regions,
    complete: regions.every((r) => r.years.every((y) => y.complete)),
    organisationSpecialDays: rows.filter((row) => row.region === ORGANISATION_SPECIAL_DAY_REGION)
      .length,
  };
}

/**
 * R-27: the reason carer pay for a period of work cannot be priced because of the calendar, or
 * null. It is a reason only when the card pays a different rate on a bank holiday, and a day of
 * the work is normally a bank holiday in the card's nation but the calendar has no entry for it.
 */
export async function calendarHoldForPay(
  db: Db,
  input: {
    region: string;
    rules: Array<{ dayType?: string | null }>;
    start: Date;
    end: Date;
    dayOf: (instant: Date) => string;
  },
): Promise<string | null> {
  if (!isBankHolidayRegion(input.region) || !cardHasHolidayRates(input.rules)) return null;
  const days = localDaysTouched(input.start, input.end, input.dayOf);
  const years = [...new Set(days.map((day) => Number(day.slice(0, 4))))];
  const [basis, entries] = await Promise.all([
    loadHolidayPremiumBasis(db),
    db.bankHoliday.findMany({
      where: {
        region: input.region,
        holidayDate: {
          gte: new Date(`${Math.min(...years)}-01-01T00:00:00.000Z`),
          lte: new Date(`${Math.max(...years)}-12-31T00:00:00.000Z`),
        },
      },
      select: { holidayDate: true, name: true, region: true },
    }),
  ]);
  const unresolved = unresolvedHolidayDays(entries, input.region, basis, days);
  return unresolved.length
    ? describeUnresolvedHolidays(unresolved, BANK_HOLIDAY_REGION_LABELS[input.region])
    : null;
}
