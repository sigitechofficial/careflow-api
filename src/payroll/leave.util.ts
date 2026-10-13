/**
 * Holiday entitlement and holiday pay (Q35).
 *
 * Two things here are law, and are stated as such: statutory leave is 5.6 weeks a year, and a
 * worker with irregular hours or who works part of the year accrues it at 12.07% of the hours
 * worked in each pay period (leave years starting on or after 1 April 2024). Everything else —
 * the leave year, the hours of a normal week, extra contractual leave, carry-over, how a day of
 * holiday is paid — is the employee's terms, recorded and approved, and never assumed.
 *
 * Statutory and contractual leave are kept apart throughout: different rules apply to each.
 */

export const WORKER_CATEGORIES = ['REGULAR_HOURS', 'IRREGULAR_HOURS', 'PART_YEAR'] as const;
export type WorkerCategory = (typeof WORKER_CATEGORIES)[number];

export const HOLIDAY_PAY_METHODS = ['NORMAL_REMUNERATION_52_WEEKS', 'ROLLED_UP_12_07'] as const;
export type HolidayPayMethod = (typeof HOLIDAY_PAY_METHODS)[number];

export const LEAVE_ENTRY_TYPES = ['TAKEN', 'ADJUSTMENT', 'CARRY_OVER', 'LEAVER_PAYMENT'] as const;
export const LEAVE_ENTITLEMENT_TYPES = ['STATUTORY', 'CONTRACTUAL'] as const;

/** Working Time Regulations 1998: 5.6 weeks of leave in a leave year. */
export const STATUTORY_LEAVE_WEEKS = 5.6;
/** Irregular-hours and part-year workers: leave accrues at 12.07% of hours worked in a pay period. */
export const IRREGULAR_ACCRUAL_RATE = 0.1207;
/** Normal remuneration is averaged over the last 52 paid weeks, looking back at most 104 weeks. */
export const REFERENCE_WEEKS = 52;
export const REFERENCE_LOOKBACK_WEEKS = 104;

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export type LeaveTerms = {
  workerCategory: string;
  leaveYearStartMonth: number;
  leaveYearStartDay: number;
  weeklyHours: number | null;
  contractualExtraHours: number | null;
  payMethod: string;
  carryOverMaxHours: number | null;
};

/** Rolled-up holiday pay is lawful only for irregular-hours and part-year workers. */
export const rolledUpAllowedFor = (workerCategory: string) =>
  workerCategory === 'IRREGULAR_HOURS' || workerCategory === 'PART_YEAR';

/** The leave year a day falls in. */
export function leaveYearFor(day: Date, startMonth: number, startDay: number): { start: Date; end: Date } {
  const year = day.getUTCFullYear();
  let start = new Date(Date.UTC(year, startMonth - 1, startDay));
  if (utcDay(day) < start.getTime()) start = new Date(Date.UTC(year - 1, startMonth - 1, startDay));
  const next = new Date(Date.UTC(start.getUTCFullYear() + 1, startMonth - 1, startDay));
  return { start, end: new Date(next.getTime() - DAY_MS) };
}

/** The share of a leave year a person is employed for (a starter or a leaver has part of a year). */
export function employedShareOfYear(
  leaveYear: { start: Date; end: Date },
  employment: { startDate?: Date | null; endDate?: Date | null },
  upTo?: Date,
): number {
  const yearDays = (utcDay(leaveYear.end) - utcDay(leaveYear.start)) / DAY_MS + 1;
  const from = Math.max(utcDay(leaveYear.start), employment.startDate ? utcDay(employment.startDate) : -Infinity);
  const to = Math.min(
    utcDay(leaveYear.end),
    employment.endDate ? utcDay(employment.endDate) : Infinity,
    upTo ? utcDay(upTo) : Infinity,
  );
  if (to < from) return 0;
  return ((to - from) / DAY_MS + 1) / yearDays;
}

/**
 * Leave accrued by an irregular-hours or part-year worker: 12.07% of the hours worked in each pay
 * period, each period's result rounded to the nearest hour (half an hour or more rounds up).
 * The yearly maximum of 28 days is not applied here: it needs the length of the worker's day,
 * which the terms do not hold.
 */
export function accruedIrregularLeaveHours(hoursByPayPeriod: number[]): number {
  return hoursByPayPeriod.reduce((sum, hours) => sum + Math.floor(Math.max(0, hours) * IRREGULAR_ACCRUAL_RATE + 0.5), 0);
}

export type Entitlement = { statutoryHours: number; contractualHours: number; basis: string };

/**
 * What the terms give for the leave year, up to a day when one is given (what has been earned so
 * far), otherwise for the whole year.
 */
export function entitlementHours(input: {
  terms: LeaveTerms;
  leaveYear: { start: Date; end: Date };
  employment: { startDate?: Date | null; endDate?: Date | null };
  /** Hours worked in each pay period of the leave year so far (irregular hours and part year). */
  hoursByPayPeriod: number[];
  upTo?: Date;
}): Entitlement {
  const share = employedShareOfYear(input.leaveYear, input.employment, input.upTo);
  const contractualHours = round2((input.terms.contractualExtraHours ?? 0) * share);
  if (input.terms.workerCategory === 'REGULAR_HOURS') {
    const weekly = input.terms.weeklyHours ?? 0;
    return {
      statutoryHours: round2(weekly * STATUTORY_LEAVE_WEEKS * share),
      contractualHours,
      basis: `5.6 weeks of ${weekly} hours, for ${(share * 100).toFixed(1)}% of the leave year`,
    };
  }
  return {
    statutoryHours: accruedIrregularLeaveHours(input.hoursByPayPeriod),
    contractualHours,
    basis: `12.07% of the hours worked in each of ${input.hoursByPayPeriod.length} pay period(s)`,
  };
}

export type LeaveMovement = { entryType: string; entitlementType: string; hours: number };

/** Balance of one kind of leave: entitlement plus what was carried in or adjusted, less what was used. */
export function leaveBalance(entitlement: number, movements: LeaveMovement[], entitlementType: string) {
  const of = (type: string) =>
    round2(
      movements
        .filter((m) => m.entitlementType === entitlementType && m.entryType === type)
        .reduce((sum, m) => sum + m.hours, 0),
    );
  const taken = of('TAKEN');
  const adjustments = of('ADJUSTMENT');
  const carriedOver = of('CARRY_OVER');
  const paidOnLeaving = of('LEAVER_PAYMENT');
  return {
    entitlement: round2(entitlement),
    taken,
    adjustments,
    carriedOver,
    paidOnLeaving,
    balance: round2(entitlement + adjustments + carriedOver - taken - paidOnLeaving),
  };
}

/** Untaken leave that the terms allow into the next leave year. */
export function carryOverAllowed(balanceAtYearEnd: number, carryOverMaxHours: number | null): number {
  return round2(Math.max(0, Math.min(balanceAtYearEnd, carryOverMaxHours ?? 0)));
}

export type WeekOfPay = { weekKey: string; pay: number; hours: number };

/**
 * Normal remuneration: the average over the last 52 weeks in which the worker was paid, before
 * the week of the leave, looking back no further than 104 weeks. Weeks with no pay are left out
 * and earlier weeks are used instead; with fewer than 52 paid weeks, the weeks there are.
 */
export function normalRemuneration(weeks: WeekOfPay[], leaveWeekKey: string) {
  const earliest = new Date(`${leaveWeekKey}T00:00:00.000Z`);
  earliest.setUTCDate(earliest.getUTCDate() - REFERENCE_LOOKBACK_WEEKS * 7);
  const earliestKey = earliest.toISOString().slice(0, 10);
  const used = weeks
    .filter((w) => w.weekKey < leaveWeekKey && w.weekKey >= earliestKey && w.pay > 0)
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey))
    .slice(0, REFERENCE_WEEKS);
  const pay = used.reduce((sum, w) => sum + w.pay, 0);
  const hours = used.reduce((sum, w) => sum + w.hours, 0);
  return {
    weeksUsed: used.length,
    averageWeeklyPay: used.length ? round2(pay / used.length) : null,
    averageHourlyPay: hours > 0 ? Math.round((pay / hours) * 10000) / 10000 : null,
    complete: used.length === REFERENCE_WEEKS,
  };
}
