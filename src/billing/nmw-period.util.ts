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
  /** PAYROLL_SCHEDULE: a period of the worker's UK payroll schedule. PAY_RUN_PERIOD: none covers the day. */
  source: 'PAYROLL_SCHEDULE' | 'PAY_RUN_PERIOD';
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The pay reference period a day of work falls in. */
export function payReferencePeriodFor(
  dayKey: string,
  schedulePeriods: Array<{ periodStart: Date; periodEnd: Date }>,
  run: { periodStart: Date; periodEnd: Date },
): PayReferencePeriod {
  const period = schedulePeriods.find((p) => iso(p.periodStart) <= dayKey && dayKey <= iso(p.periodEnd));
  if (period) return { start: iso(period.periodStart), end: iso(period.periodEnd), source: 'PAYROLL_SCHEDULE' };
  return { start: iso(run.periodStart), end: iso(run.periodEnd), source: 'PAY_RUN_PERIOD' };
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
 * Salaried hours work: the salary of a pay period against the basic hours it pays for. Used to
 * show whether a salary alone meets the rate; it does not decide a top-up.
 */
export function salariedHoursCheck(input: {
  periodSalary: number;
  contractedWeeklyHours: number | null;
  periodsPerYear: number;
  requiredHourly: number;
}): { basicHours: number | null; effectiveHourly: number | null; compliant: boolean | null } {
  if (!(input.contractedWeeklyHours && input.contractedWeeklyHours > 0)) {
    return { basicHours: null, effectiveHourly: null, compliant: null };
  }
  const basicHours = (input.contractedWeeklyHours * 52) / input.periodsPerYear;
  const effectiveHourly = Math.round((input.periodSalary / basicHours) * 10000) / 10000;
  return {
    basicHours: Math.round(basicHours * 100) / 100,
    effectiveHourly,
    compliant: effectiveHourly + 1e-9 >= input.requiredHourly,
  };
}
