import { PrismaService } from '../prisma/prisma.service';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import { ORGANISATION_SPECIAL_DAY_REGION } from '../billing/holiday-calendar.util';
import { lateCancellationAmount } from '../billing/invoice-late-cancellation.util';

/**
 * Timebank hours are charged at the standard weekday rate, so they only pay for care at that rate
 * (decision 10 Nov 2026, docs/SU_TIMEBANK_USE_PLAN.md §9): Monday–Friday, not a bank holiday or an
 * organisation special day (Finance › Billing management › Bank holidays), and at a time the
 * service user's charge card prices like the standard weekday time. Night visits are checked
 * where they are made (they never use the bank).
 */

type Db = Pick<PrismaService, 'bankHoliday'>;

export type TimebankChargeCard = {
  rules: Parameters<typeof lateCancellationAmount>[0]['rules'];
  defaultChargeMethod: string | null;
} | null;

/** Why a visit cannot use the timebank, in words; null when it can. */
export type TimebankDayRule = (
  start: Date,
  end: Date,
) => Promise<string | null>;

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function weekdayOf(dayKey: string): number {
  return new Date(`${dayKey}T12:00:00.000Z`).getUTCDay();
}

function mondayOf(dayKey: string): string {
  const dow = weekdayOf(dayKey);
  return addDaysToOperationalIso(dayKey, dow === 0 ? -6 : 1 - dow);
}

async function holidaysBetween(
  db: Db,
  fromDay: string,
  toDay: string,
): Promise<Map<string, string>> {
  const rows = await db.bankHoliday.findMany({
    where: {
      isActive: true,
      region: { in: ['UK', ORGANISATION_SPECIAL_DAY_REGION] },
      holidayDate: {
        gte: new Date(`${fromDay}T00:00:00.000Z`),
        lte: new Date(`${toDay}T00:00:00.000Z`),
      },
    },
    select: { holidayDate: true, name: true, region: true },
  });
  return new Map(
    rows.map((r) => [
      r.holidayDate.toISOString().slice(0, 10),
      r.region === ORGANISATION_SPECIAL_DAY_REGION
        ? `${r.name} (special day)`
        : `${r.name} (bank holiday)`,
    ]),
  );
}

/**
 * The time whose rate is the standard weekday rate for a week: 10:00 on the first day Monday to
 * Friday that is not a bank holiday (Friday 10:00 if all five are). Used to charge timebank hours
 * on the invoice and to tell whether a visit is at the standard rate.
 */
export async function standardWeekdayTime(
  db: Db,
  weekStart: string,
  timeZone: string,
): Promise<Date> {
  const at = (day: number) =>
    new Date(
      operationalDayBounds(
        addDaysToOperationalIso(weekStart, day),
        timeZone,
      ).start.getTime() +
        10 * 3_600_000,
    );
  const holidays = await holidaysBetween(
    db,
    weekStart,
    addDaysToOperationalIso(weekStart, 4),
  );
  for (let day = 0; day < 5; day++) {
    if (!holidays.has(addDaysToOperationalIso(weekStart, day))) return at(day);
  }
  return at(4);
}

/** The rule for one service user (their charge card loaded once). */
export function makeTimebankDayRule(deps: {
  db: Db;
  timeZone: string;
  card: TimebankChargeCard;
}): TimebankDayRule {
  const { db, timeZone, card } = deps;
  return async (start, end) => {
    const lastInstant = new Date(Math.max(start.getTime(), end.getTime() - 1));
    const firstDay = dayKeyInTimeZone(start, timeZone);
    const lastDay = dayKeyInTimeZone(lastInstant, timeZone);
    const holidays = await holidaysBetween(db, firstDay, lastDay);
    // Every day the visit touches (a visit past midnight counts both days).
    for (
      let day = firstDay;
      day <= lastDay;
      day = addDaysToOperationalIso(day, 1)
    ) {
      const dow = weekdayOf(day);
      if (dow === 0 || dow === 6) return `weekend (${WEEKDAY_NAMES[dow]})`;
      const holiday = holidays.get(day);
      if (holiday) return holiday;
    }
    // A weekday time the charge card prices differently (e.g. an evening rate).
    if (!card?.rules?.length) return null;
    const minutes = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 60_000),
    );
    const price = (at: Date) =>
      lateCancellationAmount({
        rules: card.rules,
        defaultChargeMethod: card.defaultChargeMethod ?? 'HOURLY_PRO_RATA',
        start: at,
        minutes,
        carers: 1,
        percent: 100,
        isBankHolidayFn: () => false,
        timeZone,
      });
    const standard = await standardWeekdayTime(
      db,
      mondayOf(firstDay),
      timeZone,
    );
    const visitAmount = price(start);
    const standardAmount = price(standard);
    if (
      visitAmount != null &&
      standardAmount != null &&
      Math.abs(visitAmount - standardAmount) > 0.005
    ) {
      return 'a different rate on the charge card at this time';
    }
    return null;
  };
}
