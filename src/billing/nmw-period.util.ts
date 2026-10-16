/**
 * Minimum wage over the pay reference period (Q37–Q39).
 *
 * The check belongs to the period by which the worker is paid — a week for a weekly-paid worker,
 * a month for a monthly-paid one, never more than a month — and not to the dates a visit pay run
 * happens to cover. Hours count in the period they were worked. Age, and the rate in force, are
 * taken at the start of the period: a birthday or a new rate applies from the first period that
 * starts on or after it.
 */
import { NmwWorkerCategory, ageInFullYears } from './pay-compliance.util';

export const NMW_PERIOD_SOURCE = 'NMW_PERIOD';

export type PayReferencePeriod = {
  /** YYYY-MM-DD */
  start: string;
  end: string;
  /**
   * PAYROLL_SCHEDULE: a period of the worker's UK payroll schedule.
   * PAY_RUN_PERIOD: no schedule period covers the day; the run's own dates (a month or less).
   * CALENDAR_MONTH: neither can be used, because it would be longer than a month.
   */
  source: 'PAYROLL_SCHEDULE' | 'PAY_RUN_PERIOD' | 'CALENDAR_MONTH';
  /** Why the period is not the worker's own payroll period, for a person to put right. */
  issue: 'NO_PAYROLL_SCHEDULE' | 'PERIOD_OVER_ONE_MONTH' | null;
};

export const NMW_ISSUE_MESSAGES: Record<string, string> = {
  NO_PAYROLL_SCHEDULE:
    'No UK payroll schedule period covers this work, so the pay reference period is not known. The check was made over a period of a month or less so that nothing is averaged over longer; give the worker a payroll schedule.',
  PERIOD_OVER_ONE_MONTH:
    'The period this worker is paid by is longer than a month, which cannot be a pay reference period. The check was made by calendar month instead; correct the payroll schedule.',
  SALARIED_NOT_ASSESSED_HERE:
    'Salaried hours work: not assessed from visit lines. The salary is checked against its basic hours in the UK payroll run.',
  BASIC_HOURS_NOT_RECORDED:
    'The pay agreement records no contracted weekly hours, so the basic hours the salary pays for are not known and the minimum wage cannot be checked.',
  EXCESS_HOURS_NOT_VERIFIED:
    'More hours were worked in the period than the basic hours of the salary. If the basic hours for the year have been exceeded, the extra hours must be paid at least the minimum wage: this has to be checked against the year so far.',
  POLICY_REVIEW_REQUIRED:
    'No approved method is in force for turning contracted weekly hours into the basic hours of a year, so this salary cannot be checked against the minimum wage. Nothing is assumed and nothing is topped up: have the employer\u2019s annualisation method entered and approved, then calculate gross again.',
  SHORTFALL:
    'A shortfall against the minimum wage has been confirmed. It cannot be cleared by a review: pay the top-up or correct the pay, then calculate gross again.',
};

/** What a review of an assessment found (Sprint B4A). */
export const NMW_REVIEW_OUTCOMES = ['EVIDENCE_SUPPORTS_COMPLIANCE', 'SHORTFALL_CONFIRMED'] as const;
export type NmwReviewOutcome = (typeof NMW_REVIEW_OUTCOMES)[number];

/**
 * Whether an assessment stops its UK payroll run being closed. An issue stops it until a review
 * finds, on stated facts, that the evidence supports compliance. A confirmed shortfall always
 * stops it: only more pay (a top-up or a correction) and a new calculation can clear it.
 */
export function nmwBlocksClose(a: { issue: string | null; reviewOutcome: string | null }): boolean {
  return !!a.issue && NMW_BLOCKING_ISSUES.includes(a.issue) && a.reviewOutcome !== 'EVIDENCE_SUPPORTS_COMPLIANCE';
}

/** Whether a review may be recorded: there is an open question, and it is not a confirmed shortfall. */
export function nmwCanBeReviewed(a: { issue: string | null; reviewOutcome: string | null }): boolean {
  return !!a.issue && a.issue !== 'SHORTFALL' && NMW_BLOCKING_ISSUES.includes(a.issue) && !a.reviewOutcome;
}

/** Issues that stop a UK payroll run being closed until someone with that power has reviewed them. */
export const NMW_BLOCKING_ISSUES: readonly string[] = [
  'SHORTFALL',
  'BASIC_HOURS_NOT_RECORDED',
  'EXCESS_HOURS_NOT_VERIFIED',
  'PERIOD_OVER_ONE_MONTH',
  'POLICY_REVIEW_REQUIRED',
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A pay reference period is a month, or the shorter period the worker is paid by: never longer.
 * True when the days from `start` to `end` inclusive are no more than one calendar month.
 */
export function isWithinOneMonth(start: string, end: string): boolean {
  const next = new Date(`${start}T00:00:00.000Z`);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastOfNext = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastOfNext));
  // `next` is the same day of the following month: the period must end before it.
  return end < iso(next);
}

export function calendarMonthOf(dayKey: string): { start: string; end: string } {
  const [year, month] = dayKey.split('-').map(Number);
  return { start: `${dayKey.slice(0, 7)}-01`, end: iso(new Date(Date.UTC(year, month, 0))) };
}

/**
 * The pay reference period a day of work falls in: the worker's payroll schedule period. Where
 * there is none, or it is longer than a month, a period of a month or less is still used — the
 * run's own dates if they are short enough, otherwise the calendar month — and the reason is
 * returned so that it is shown, never silently accepted.
 */
export function payReferencePeriodFor(
  dayKey: string,
  schedulePeriods: Array<{ periodStart: Date; periodEnd: Date }>,
  run: { periodStart: Date; periodEnd: Date },
): PayReferencePeriod {
  const period = schedulePeriods.find((p) => iso(p.periodStart) <= dayKey && dayKey <= iso(p.periodEnd));
  if (period) {
    const start = iso(period.periodStart);
    const end = iso(period.periodEnd);
    if (isWithinOneMonth(start, end)) return { start, end, source: 'PAYROLL_SCHEDULE', issue: null };
    return { ...calendarMonthOf(dayKey), source: 'CALENDAR_MONTH', issue: 'PERIOD_OVER_ONE_MONTH' };
  }
  const runStart = iso(run.periodStart);
  const runEnd = iso(run.periodEnd);
  if (isWithinOneMonth(runStart, runEnd)) {
    return { start: runStart, end: runEnd, source: 'PAY_RUN_PERIOD', issue: 'NO_PAYROLL_SCHEDULE' };
  }
  return { ...calendarMonthOf(dayKey), source: 'CALENDAR_MONTH', issue: 'NO_PAYROLL_SCHEDULE' };
}

export type NmwCategoryDecision = {
  category: NmwWorkerCategory;
  ageAtPeriodStart: number | null;
  note: string | null;
};

/**
 * The minimum wage band of a worker for one pay reference period.
 *
 * The apprentice rate applies to an apprentice who is under 19, or who is 19 or over and in the
 * first year of the apprenticeship. Being on an apprentice contract is not enough: without the
 * date the apprenticeship began, a worker of 19 or over is given the rate for their age, which
 * can never be the lower one.
 */
export function nmwCategoryForPeriod(input: {
  dateOfBirth: Date | null;
  periodStart: Date;
  apprenticeContract: boolean;
  apprenticeshipStartDate: Date | null;
}): NmwCategoryDecision {
  const age = input.dateOfBirth ? ageInFullYears(input.dateOfBirth, input.periodStart) : null;
  const byAge: NmwWorkerCategory =
    age == null || age >= 21 ? 'AGE_21_AND_OVER' : age >= 18 ? 'AGE_18_TO_20' : 'UNDER_18';
  const ageNote = age == null ? 'Date of birth not recorded: the highest rate is used.' : null;

  if (input.apprenticeContract) {
    if (age != null && age < 19) return { category: 'APPRENTICE', ageAtPeriodStart: age, note: 'Apprentice under 19.' };
    if (input.apprenticeshipStartDate) {
      const firstYearEnds = new Date(input.apprenticeshipStartDate);
      firstYearEnds.setUTCFullYear(firstYearEnds.getUTCFullYear() + 1);
      if (input.periodStart.getTime() < firstYearEnds.getTime()) {
        return { category: 'APPRENTICE', ageAtPeriodStart: age, note: 'Apprentice in the first year of the apprenticeship.' };
      }
      return {
        category: byAge,
        ageAtPeriodStart: age,
        note: 'Apprentice of 19 or over past the first year of the apprenticeship: the rate for their age applies.',
      };
    }
    return {
      category: byAge,
      ageAtPeriodStart: age,
      note:
        'Apprentice contract, but the date the apprenticeship began is not recorded: the rate for their age is used.' +
        (ageNote ? ` ${ageNote}` : ''),
    };
  }
  return { category: byAge, ageAtPeriodStart: age, note: ageNote };
}

/**
 * How a pay line counts towards minimum wage.
 *  - pay: the amount is pay for the purposes of the check;
 *  - hours: its minutes are working time.
 * Reimbursements, holiday and sick pay, pay for guaranteed hours not worked, pay for a visit that
 * did not take place, the premium part of overtime and the top-up itself are not pay for work
 * done, so none of them can hide a shortfall.
 */
export function nmwTreatment(lineType: string): { pay: boolean; hours: boolean } {
  switch (lineType) {
    case 'VISIT_PAY':
    case 'TRAVEL_TIME':
    case 'WAITING_TIME':
    case 'NON_VISIT_ACTIVITY':
      return { pay: true, hours: true };
    case 'MILEAGE':
    case 'PASSENGER_MILEAGE':
    case 'EXPENSE':
    case 'HOLIDAY_PAY':
    case 'SICK_PAY':
    case 'GUARANTEED_HOURS':
    case 'CANCELLATION':
    case 'OVERTIME':
    case 'NMW_TOP_UP':
      return { pay: false, hours: false };
    default:
      return { pay: true, hours: false };
  }
}

export type PeriodAssessment = {
  periodPay: number;
  periodMinutes: number;
  /** Top-up the whole period needs so far. */
  topUpDue: number;
  /** What this run adds (or, when negative, takes back from an earlier top-up). */
  topUpInRun: number;
  /** True when the pay of the period, before any top-up, already meets the rate. */
  compliant: boolean;
  effectiveHourly: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The position of a pay reference period: this run's pay and hours together with those of the
 * locked runs that already paid part of it. The top-up is the shortfall of the whole period less
 * what was already topped up, so a period divided between runs is topped up once.
 */
export function assessPayReferencePeriod(input: {
  requiredHourly: number;
  thisPay: number;
  thisMinutes: number;
  otherPay: number;
  otherMinutes: number;
  topUpAlreadyPaid: number;
}): PeriodAssessment {
  const periodPay = round2(input.thisPay + input.otherPay);
  const periodMinutes = input.thisMinutes + input.otherMinutes;
  const hours = periodMinutes / 60;
  const shortfall = hours > 0 ? round2(input.requiredHourly * hours - periodPay) : 0;
  const topUpDue = Math.max(0, shortfall);
  return {
    periodPay,
    periodMinutes,
    topUpDue,
    topUpInRun: round2(topUpDue - input.topUpAlreadyPaid),
    compliant: topUpDue === 0,
    effectiveHourly: hours > 0 ? Math.round((periodPay / hours) * 10000) / 10000 : 0,
  };
}

/**
 * Basic hours of a pay period for salaried hours work: the basic hours of a year divided by the
 * number of pay periods in the year, as HMRC's guidance sets out. The basic hours of a year are
 * the contracted weekly hours times `weeksPerYear`, the multiplier of the employer's approved
 * method: it is always given by the caller and never assumed here. A part of a period (a starter,
 * a leaver, a change of agreement) carries its share by days. Null when any part has no
 * contracted hours recorded: the basic hours are then not known.
 */
export function basicHoursOfPeriod(
  parts: Array<{ contractedWeeklyHours: number | null; days: number }>,
  periodDays: number,
  periodsPerYear: number,
  weeksPerYear: number,
): number | null {
  if (!parts.length || parts.some((p) => !(p.contractedWeeklyHours && p.contractedWeeklyHours > 0))) return null;
  const hours = parts.reduce(
    (sum, p) => sum + (((p.contractedWeeklyHours as number) * weeksPerYear) / periodsPerYear) * (p.days / periodDays),
    0,
  );
  return Math.round(hours * 100) / 100;
}

const NOT_MONTHLY = ['WEEKLY', 'FORTNIGHTLY', 'FOUR_WEEKLY'];
const utcDay = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day));
const DAY = 86_400_000;

/**
 * The calculation year of salaried hours work that a day falls in (HMRC, "Working hours for which
 * the minimum wage must be paid"). `anchor` is the day the salaried contract started.
 *  - Paid monthly, started on the 1st: the year runs from that date and each anniversary.
 *  - Paid monthly, started on another day: the first year runs from the start to the end of the
 *    same month a year later; after that, years run from the 1st of the next month.
 *  - Paid weekly, fortnightly or four-weekly: the year runs from the start and each anniversary.
 * Null for a day before the contract started.
 */
export function salariedCalculationYear(anchor: Date, frequency: string, onDay: Date): { start: Date; end: Date } | null {
  const a = utcDay(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const t = utcDay(onDay.getUTCFullYear(), onDay.getUTCMonth(), onDay.getUTCDate()).getTime();
  if (t < a.getTime()) return null;
  let first = a;
  if (!NOT_MONTHLY.includes(frequency) && a.getUTCDate() !== 1) {
    // Day 0 of the month after next year's month = the last day of that month.
    const firstEnd = utcDay(a.getUTCFullYear() + 1, a.getUTCMonth() + 1, 0);
    if (t <= firstEnd.getTime()) return { start: a, end: firstEnd };
    first = new Date(firstEnd.getTime() + DAY);
  }
  const yearFrom = (k: number) => utcDay(first.getUTCFullYear() + k, first.getUTCMonth(), first.getUTCDate());
  let k = Math.max(0, new Date(t).getUTCFullYear() - first.getUTCFullYear() - 1);
  while (yearFrom(k + 1).getTime() <= t) k += 1;
  return { start: yearFrom(k), end: new Date(yearFrom(k + 1).getTime() - DAY) };
}

/**
 * Basic hours of a calculation year: for each stretch under one agreement, days / 365 of that
 * agreement's hours for a year (contracted weekly hours x `weeksPerYear`). This is HMRC's method
 * for a contract whose hours change during the year. Null when any stretch has no contracted
 * hours recorded.
 */
export function annualBasicHours(
  stretches: Array<{ days: number; contractedWeeklyHours: number | null }>,
  weeksPerYear: number,
): number | null {
  if (!stretches.length || stretches.some((p) => !(p.contractedWeeklyHours && p.contractedWeeklyHours > 0))) return null;
  const hours = stretches.reduce((sum, p) => sum + (p.days / 365) * (p.contractedWeeklyHours as number) * weeksPerYear, 0);
  return Math.round(hours * 100) / 100;
}

/** The pay periods of the worker's frequency from `start` until `end` is covered (the last one may run past it). */
export function payPeriodWindows(start: Date, end: Date, frequency: string): Array<{ start: Date; end: Date }> {
  const windows: Array<{ start: Date; end: Date }> = [];
  const step = frequency === 'WEEKLY' ? 7 : frequency === 'FORTNIGHTLY' ? 14 : frequency === 'FOUR_WEEKLY' ? 28 : 0;
  let from = utcDay(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  for (let i = 1; from.getTime() <= end.getTime() && i < 400; i += 1) {
    const next = step
      ? new Date(start.getTime() + i * step * DAY)
      : utcDay(start.getUTCFullYear(), start.getUTCMonth() + i, start.getUTCDate());
    windows.push({ start: from, end: new Date(next.getTime() - DAY) });
    from = next;
  }
  return windows;
}

/** Where a salaried worker stands in the calculation year when a period is assessed. */
export type SalariedYearPosition = {
  /**
   * Basic hours the hours worked are compared with: those of the calculation year or, for a worker
   * who leaves during it, those of the pay periods employed.
   */
  thresholdHours: number;
  /** Hours worked in the calculation year before this period. */
  hoursBefore: number;
  /** Hours worked in this period that count towards the year. */
  hoursInPeriod: number;
  /** Hours beyond the basic hours that assessments of earlier periods have already counted. */
  excessCountedBefore: number;
  /**
   * Basic hours of this period by days (days / 365 of the year's hours): HMRC uses them in the
   * period in which the basic hours are first exceeded. Null for a leaver's last period, where the
   * period's ordinary basic hours are used.
   */
  exceedingPeriodBasicHours: number | null;
};

export type SalariedAssessment = {
  /** Hours the pay of the period is measured against: basic hours and separately paid hours. */
  hours: number | null;
  effectiveHourly: number | null;
  /** Pay needed to bring the period up to the rate on those hours. */
  topUp: number;
  /** True, false, or null when it cannot be said. */
  compliant: boolean | null;
  issue: string | null;
  /** Pay that may still be missing after the top-up (hours beyond the basic hours). */
  shortfall: number;
  /** Hours beyond the basic hours of the year that this assessment counted (0 without a year). */
  excessHours: number;
  note: string;
};

/**
 * Minimum wage for salaried hours work in one pay reference period.
 *
 * Pay is measured against the basic hours of the period plus any hours paid on top. A shortfall
 * on those hours is certain, and is topped up. Hours worked beyond them are a different matter:
 * they only count once the basic hours for the year are exceeded, which one period cannot show.
 * If counting them would put the worker below the rate, that is reported for a person to check
 * against the year; the worker is not declared compliant.
 *
 * With `year` (Sprint B4B) that question is decided instead of reported. While the hours worked
 * in the calculation year stay within its basic hours, extra hours in one period change nothing.
 * From the period in which the basic hours are exceeded, the excess hours are added to the hours
 * the pay must cover, in that period and every later one, and a shortfall is topped up. Excess
 * hours that an earlier period's assessment did not count (they reached payroll late) are counted
 * here, once.
 */
export function assessSalariedHours(input: {
  requiredHourly: number;
  basicHours: number | null;
  pay: number;
  additionalPaidMinutes: number;
  workedMinutes: number;
  year?: SalariedYearPosition | null;
}): SalariedAssessment {
  if (input.basicHours == null) {
    return {
      hours: null,
      effectiveHourly: null,
      topUp: 0,
      compliant: null,
      issue: 'BASIC_HOURS_NOT_RECORDED',
      shortfall: 0,
      excessHours: 0,
      note: NMW_ISSUE_MESSAGES.BASIC_HOURS_NOT_RECORDED,
    };
  }
  if (input.year) {
    const y = input.year;
    const paidOnTop = input.additionalPaidMinutes / 60;
    const yearSoFar = y.hoursBefore + y.hoursInPeriod;
    const excess = Math.max(0, round2(Math.max(0, yearSoFar - y.thresholdHours) - y.excessCountedBefore));
    const position = `${yearSoFar.toFixed(2)}h worked in the calculation year (${y.hoursInPeriod.toFixed(2)}h in this period) against ${y.thresholdHours}h basic`;
    if (excess > 0) {
      // First exceeded here: HMRC takes the period's basic hours by days. Later periods, and a
      // leaver's last period, use the ordinary basic hours of the period.
      const first = y.excessCountedBefore <= 0 && y.exceedingPeriodBasicHours != null;
      const basic = first ? (y.exceedingPeriodBasicHours as number) : input.basicHours;
      const hours = round2(basic + Math.max(excess, paidOnTop));
      const topUp = Math.max(0, round2(input.requiredHourly * hours - input.pay));
      return {
        hours,
        effectiveHourly: hours > 0 ? Math.round((input.pay / hours) * 10000) / 10000 : null,
        topUp,
        compliant: topUp === 0,
        issue: null,
        shortfall: 0,
        excessHours: excess,
        note:
          `${position}: the basic hours are exceeded. The pay must cover ${hours}h (${basic}h basic${first ? ' by days' : ''} + ${Math.max(excess, paidOnTop).toFixed(2)}h beyond the basic hours) ` +
          `at £${input.requiredHourly.toFixed(2)} = £${round2(input.requiredHourly * hours).toFixed(2)}; £${input.pay.toFixed(2)} is paid` +
          (topUp > 0 ? `: topped up by £${topUp.toFixed(2)}.` : '.'),
      };
    }
    const hours = round2(input.basicHours + paidOnTop);
    const effectiveHourly = hours > 0 ? Math.round((input.pay / hours) * 10000) / 10000 : null;
    const topUp = hours > 0 ? Math.max(0, round2(input.requiredHourly * hours - input.pay)) : 0;
    const figures = `£${input.pay.toFixed(2)} for ${hours}h (${input.basicHours}h basic${input.additionalPaidMinutes ? ` + ${paidOnTop.toFixed(2)}h paid on top` : ''}) = £${(effectiveHourly ?? 0).toFixed(4)}/hr against £${input.requiredHourly.toFixed(2)}`;
    return {
      hours,
      effectiveHourly,
      topUp,
      compliant: topUp === 0,
      issue: null,
      shortfall: 0,
      excessHours: 0,
      note: `${figures}${topUp > 0 ? `: topped up by £${topUp.toFixed(2)}` : ''}. ${position}: within the basic hours.`,
    };
  }
  const hours = Math.round((input.basicHours + input.additionalPaidMinutes / 60) * 100) / 100;
  const effectiveHourly = hours > 0 ? Math.round((input.pay / hours) * 10000) / 10000 : null;
  const topUp = hours > 0 ? Math.max(0, round2(input.requiredHourly * hours - input.pay)) : 0;
  const workedHours = input.workedMinutes / 60;
  const figures = `£${input.pay.toFixed(2)} for ${hours}h (${input.basicHours}h basic${input.additionalPaidMinutes ? ` + ${(input.additionalPaidMinutes / 60).toFixed(2)}h paid on top` : ''}) = £${(effectiveHourly ?? 0).toFixed(4)}/hr against £${input.requiredHourly.toFixed(2)}`;
  const excessShortfall =
    workedHours > hours ? Math.max(0, round2(input.requiredHourly * workedHours - input.pay - topUp)) : 0;
  if (excessShortfall > 0) {
    return {
      hours,
      effectiveHourly,
      topUp,
      compliant: null,
      issue: 'EXCESS_HOURS_NOT_VERIFIED',
      shortfall: excessShortfall,
      excessHours: 0,
      note: `${figures}. ${workedHours.toFixed(2)}h were worked. ${NMW_ISSUE_MESSAGES.EXCESS_HOURS_NOT_VERIFIED} Up to £${excessShortfall.toFixed(2)} more may be due.`,
    };
  }
  return {
    hours,
    effectiveHourly,
    topUp,
    compliant: topUp === 0,
    issue: null,
    shortfall: 0,
    excessHours: 0,
    note: topUp > 0 ? `${figures}: topped up by £${topUp.toFixed(2)}.` : `${figures}.`,
  };
}
