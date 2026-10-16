/**
 * Salary agreements (WM-02 / WM-03 / WM-09).
 *
 * Nothing here decides an employer's policy. An agreement states, for one employee and from one
 * date, how much the salary is, how a part period is paid and what work the salary already pays
 * for. These functions only apply what the agreement states.
 */

export const SALARY_ENTRY_PERIODS = ['ANNUAL', 'MONTHLY', 'WEEKLY'] as const;
export type SalaryEntryPeriod = (typeof SALARY_ENTRY_PERIODS)[number];

export const SALARY_PRORATION_METHODS = [
  'CALENDAR_DAYS_365_25',
  'EQUAL_PERIODS_CALENDAR_DAYS',
  'EQUAL_PERIODS_WORKING_DAYS',
] as const;
export type SalaryProrationMethod = (typeof SALARY_PRORATION_METHODS)[number];
/** What an agreement with no method recorded does: the behaviour before methods existed. */
export const LEGACY_PRORATION_METHOD: SalaryProrationMethod = 'CALENDAR_DAYS_365_25';

export const SALARY_COVERAGES = ['ALL_VISIT_WORK', 'CONTRACTED_HOURS', 'NO_VISIT_WORK'] as const;
export type SalaryCoverage = (typeof SALARY_COVERAGES)[number];

export const GUARANTEE_TOP_UPS = ['PAY_SHORTFALL'] as const;
export const GUARANTEE_QUALIFYING_TIMES = ['VISITS', 'VISITS_AND_TRAVEL'] as const;
export const GUARANTEE_LEAVE_TREATMENTS = ['COUNT_PAID_LEAVE_HOURS', 'REDUCE_FOR_ABSENCE_DAYS'] as const;

export const UNPAID_COVERED_BY_SALARY = 'COVERED_BY_SALARY';
export const UNPAID_COVERAGE_NOT_DECIDED = 'SALARY_COVERAGE_NOT_DECIDED';

/** Pay for time worked: what a salary can already be paying for. */
export const SALARY_TIME_LINE_TYPES: ReadonlySet<string> = new Set([
  'VISIT_PAY',
  'TRAVEL_TIME',
  'WAITING_TIME',
  'NON_VISIT_ACTIVITY',
  'LIVE_IN',
]);
/** Amounts the visit pay run works out from that pay. They follow it. */
export const SALARY_DERIVED_LINE_TYPES: ReadonlySet<string> = new Set([
  'NMW_TOP_UP',
  'OVERTIME',
  'HOLIDAY_PAY',
]);

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The yearly figure of a salary entered per year, per month or per week (52 weeks, 12 months). */
export function annualSalaryFromEntry(period: SalaryEntryPeriod, amount: number): number {
  const factor = period === 'MONTHLY' ? 12 : period === 'WEEKLY' ? 52 : 1;
  return round2(amount * factor);
}

export function periodsPerYear(frequency: string): number {
  switch (frequency) {
    case 'WEEKLY':
      return 52;
    case 'FORTNIGHTLY':
      return 26;
    case 'FOUR_WEEKLY':
      return 13;
    default:
      return 12;
  }
}

export type AgreementTerms = {
  id: string;
  basis: string;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  annualSalary: number | null;
  contractedHours: number | null;
  salaryProrationMethod: string | null;
  salaryCoverage: string | null;
  guaranteedWeeklyHours?: number | null;
  guaranteeTopUp?: string | null;
  guaranteeQualifyingTime?: string | null;
  guaranteeLeaveTreatment?: string | null;
  /** When it was approved, or created when it needed no approval. Decides between equal dates. */
  decidedAt: Date;
  /** For an agreement ended without an end date: the day it was ended. */
  endedAt?: Date | null;
};

type DecimalLike = { toString(): string } | number | null | undefined;
const num = (v: DecimalLike) => (v == null ? null : Number(v));

/** A stored pay agreement as these rules read it. */
export function agreementTermsOf(row: {
  id: string;
  basis: string;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  annualSalary: DecimalLike;
  contractedHours: DecimalLike;
  salaryProrationMethod: string | null;
  salaryCoverage: string | null;
  guaranteedWeeklyHours?: DecimalLike;
  guaranteeTopUp?: string | null;
  guaranteeQualifyingTime?: string | null;
  guaranteeLeaveTreatment?: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AgreementTerms {
  return {
    id: row.id,
    basis: row.basis,
    status: row.status,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    annualSalary: num(row.annualSalary),
    contractedHours: num(row.contractedHours),
    salaryProrationMethod: row.salaryProrationMethod,
    salaryCoverage: row.salaryCoverage,
    guaranteedWeeklyHours: num(row.guaranteedWeeklyHours),
    guaranteeTopUp: row.guaranteeTopUp ?? null,
    guaranteeQualifyingTime: row.guaranteeQualifyingTime ?? null,
    guaranteeLeaveTreatment: row.guaranteeLeaveTreatment ?? null,
    decidedAt: row.approvedAt ?? row.createdAt,
    endedAt: row.status === 'TERMINATED' ? row.updatedAt : null,
  };
}

export const carriesSalary = (a: Pick<AgreementTerms, 'basis' | 'annualSalary'> | null | undefined) =>
  !!a && (a.basis === 'SALARIED' || a.basis === 'HYBRID') && (a.annualSalary ?? 0) > 0;

/**
 * The agreement in force on a day: the one with the latest start on or before that day (of two
 * starting together, the one decided last). It applies until its own end date; an ended agreement
 * does not bring an older one back.
 */
export function governingAgreement(agreements: AgreementTerms[], day: Date): AgreementTerms | null {
  const t = dayOf(day).getTime();
  let chosen: AgreementTerms | null = null;
  for (const a of agreements) {
    if (a.status === 'DRAFT') continue;
    const from = dayOf(a.effectiveFrom).getTime();
    if (from > t) continue;
    if (!chosen) {
      chosen = a;
      continue;
    }
    const chosenFrom = dayOf(chosen.effectiveFrom).getTime();
    const later =
      from > chosenFrom ||
      (from === chosenFrom &&
        (a.decidedAt.getTime() > chosen.decidedAt.getTime() ||
          (a.decidedAt.getTime() === chosen.decidedAt.getTime() && a.id > chosen.id)));
    if (later) chosen = a;
  }
  if (!chosen) return null;
  const end = chosen.effectiveTo ?? (chosen.status === 'TERMINATED' ? (chosen.endedAt ?? null) : null);
  if (end && t > dayOf(end).getTime()) return null;
  return chosen;
}

export type EmploymentDates = { startDate?: Date | null; endDate?: Date | null };

const employedOn = (employment: EmploymentDates | undefined, t: number) =>
  !(employment?.startDate && t < dayOf(employment.startDate).getTime()) &&
  !(employment?.endDate && t > dayOf(employment.endDate).getTime());

const isWorkingDay = (t: number) => {
  const dow = new Date(t).getUTCDay();
  return dow !== 0 && dow !== 6;
};

export type AgreementSegment = {
  agreement: AgreementTerms;
  from: Date;
  to: Date;
  days: number;
  workingDays: number;
};

/** The stretches of a period, each under one agreement, on the days the person was employed. */
export function agreementSegments(
  agreements: AgreementTerms[],
  periodStart: Date,
  periodEnd: Date,
  employment?: EmploymentDates,
): AgreementSegment[] {
  const segments: AgreementSegment[] = [];
  let current: AgreementSegment | null = null;
  for (let t = dayOf(periodStart).getTime(); t <= dayOf(periodEnd).getTime(); t += DAY_MS) {
    const agreement = employedOn(employment, t) ? governingAgreement(agreements, new Date(t)) : null;
    if (!agreement) {
      current = null;
      continue;
    }
    if (!current || current.agreement.id !== agreement.id) {
      current = { agreement, from: new Date(t), to: new Date(t), days: 0, workingDays: 0 };
      segments.push(current);
    }
    current.to = new Date(t);
    current.days += 1;
    if (isWorkingDay(t)) current.workingDays += 1;
  }
  return segments;
}

export type SalaryPart = {
  agreementId: string;
  from: Date;
  to: Date;
  /** Days of the period this part covers, and the contracted weekly hours of its agreement. */
  days: number;
  contractedHours: number | null;
  amount: number;
  description: string;
};

const METHOD_WORDS: Record<SalaryProrationMethod, string> = {
  CALENDAR_DAYS_365_25: 'calendar days of a 365.25 day year',
  EQUAL_PERIODS_CALENDAR_DAYS: 'equal pay periods, part period by calendar days',
  EQUAL_PERIODS_WORKING_DAYS: 'equal pay periods, part period by Monday to Friday days',
};

/**
 * Salary of one pay period: one part for each stretch under a salaried agreement. A whole period
 * under one agreement with an "equal pay periods" method is exactly the yearly salary divided by
 * the number of periods in a year.
 */
export function salaryForPeriod(input: {
  agreements: AgreementTerms[];
  periodStart: Date;
  periodEnd: Date;
  frequency: string;
  employment?: EmploymentDates;
}): SalaryPart[] {
  const periodDays = Math.round((dayOf(input.periodEnd).getTime() - dayOf(input.periodStart).getTime()) / DAY_MS) + 1;
  let periodWorkingDays = 0;
  for (let t = dayOf(input.periodStart).getTime(); t <= dayOf(input.periodEnd).getTime(); t += DAY_MS) {
    if (isWorkingDay(t)) periodWorkingDays += 1;
  }
  const parts: SalaryPart[] = [];
  for (const seg of agreementSegments(input.agreements, input.periodStart, input.periodEnd, input.employment)) {
    if (!carriesSalary(seg.agreement)) continue;
    const annual = seg.agreement.annualSalary as number;
    const method = (SALARY_PRORATION_METHODS as readonly string[]).includes(seg.agreement.salaryProrationMethod ?? '')
      ? (seg.agreement.salaryProrationMethod as SalaryProrationMethod)
      : LEGACY_PRORATION_METHOD;
    const whole = seg.days === periodDays;
    let amount: number;
    let share: string;
    if (method === 'CALENDAR_DAYS_365_25') {
      amount = (annual * seg.days) / 365.25;
      share = `${seg.days} days`;
    } else {
      const perPeriod = annual / periodsPerYear(input.frequency);
      if (whole) {
        amount = perPeriod;
        share = 'whole period';
      } else if (method === 'EQUAL_PERIODS_WORKING_DAYS' && periodWorkingDays > 0) {
        amount = (perPeriod * seg.workingDays) / periodWorkingDays;
        share = `${seg.workingDays} of ${periodWorkingDays} working days`;
      } else {
        amount = (perPeriod * seg.days) / periodDays;
        share = `${seg.days} of ${periodDays} days`;
      }
    }
    amount = round2(amount);
    if (amount <= 0) continue;
    parts.push({
      agreementId: seg.agreement.id,
      from: seg.from,
      to: seg.to,
      days: seg.days,
      contractedHours: seg.agreement.contractedHours,
      amount,
      description: `Salary ${isoDay(seg.from)} – ${isoDay(seg.to)}: £${annual.toFixed(2)} a year, ${share} (${METHOD_WORDS[method]})`,
    });
  }
  return parts;
}

/** Monday of the week a moment falls in (UTC day, as UK payroll periods are compared). */
export function weekStartKey(instant: Date): string {
  const d = dayOf(instant);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return isoDay(d);
}

export type VisitCoverage = { coveredMinutes: number; minutes: number; notDecided: boolean };

/**
 * How much of each visit a salary already pays for. Visits are taken in the order they were
 * worked, so the answer for a visit does not depend on which pay run it is in: a week split
 * between two runs gives each visit the same result in both.
 *
 * - ALL_VISIT_WORK: every minute is covered.
 * - CONTRACTED_HOURS: the first contracted hours of each Monday–Sunday week are covered, the rest
 *   are additional hours.
 * - NO_VISIT_WORK, or no salary on that day: nothing is covered.
 * - salary with no coverage recorded: not decided.
 */
export function salaryCoverageByVisit(
  /** `day` is the civil date the visit belongs to, when that differs from the UTC date of `start`. */
  visits: Array<{ id: string; start: Date; minutes: number; day?: Date }>,
  agreements: AgreementTerms[],
): Map<string, VisitCoverage> {
  const result = new Map<string, VisitCoverage>();
  const usedByWeek = new Map<string, number>();
  const ordered = [...visits].sort((a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id));
  for (const visit of ordered) {
    const minutes = Math.max(0, visit.minutes);
    const on = visit.day ?? visit.start;
    const agreement = governingAgreement(agreements, on);
    if (!carriesSalary(agreement)) {
      result.set(visit.id, { coveredMinutes: 0, minutes, notDecided: false });
      continue;
    }
    const coverage = agreement!.salaryCoverage;
    if (coverage === 'ALL_VISIT_WORK') {
      result.set(visit.id, { coveredMinutes: minutes, minutes, notDecided: false });
    } else if (coverage === 'NO_VISIT_WORK') {
      result.set(visit.id, { coveredMinutes: 0, minutes, notDecided: false });
    } else if (coverage === 'CONTRACTED_HOURS') {
      const week = weekStartKey(on);
      const used = usedByWeek.get(week) ?? 0;
      const allowance = Math.max(0, Math.round((agreement!.contractedHours ?? 0) * 60) - used);
      const covered = Math.min(minutes, allowance);
      usedByWeek.set(week, used + covered);
      result.set(visit.id, { coveredMinutes: covered, minutes, notDecided: false });
    } else {
      result.set(visit.id, { coveredMinutes: 0, minutes, notDecided: true });
    }
  }
  return result;
}

export type LineCoverage = { paid: number; unpaid: number; reason: string | null };

/**
 * What a visit-pay-run line of a salaried employee pays in UK payroll.
 * `visit` is the coverage of the visit the line belongs to (null for a line with no visit).
 */
export function applySalaryCoverage(input: {
  lineType: string;
  amount: number;
  agreement: AgreementTerms | null;
  visit: VisitCoverage | null;
}): LineCoverage {
  const { lineType, amount, agreement, visit } = input;
  const untouched: LineCoverage = { paid: amount, unpaid: 0, reason: null };
  if (!carriesSalary(agreement)) return untouched;
  const isTime = SALARY_TIME_LINE_TYPES.has(lineType);
  const isDerived = SALARY_DERIVED_LINE_TYPES.has(lineType);
  if (!isTime && !isDerived) return untouched;
  const coverage = agreement!.salaryCoverage;
  if (coverage === 'NO_VISIT_WORK') return untouched;
  if (coverage === 'ALL_VISIT_WORK') return { paid: 0, unpaid: amount, reason: UNPAID_COVERED_BY_SALARY };
  if (coverage === 'CONTRACTED_HOURS') {
    // Only visit time is counted against the contracted hours. Anything else worked out
    // automatically is not paid on top of a salary; a person adds it as an approved pay item.
    if (!isTime || !visit) return { paid: 0, unpaid: amount, reason: UNPAID_COVERED_BY_SALARY };
    if (visit.coveredMinutes <= 0 || visit.minutes <= 0) return untouched;
    const unpaid = round2((amount * Math.min(visit.coveredMinutes, visit.minutes)) / visit.minutes);
    return { paid: round2(amount - unpaid), unpaid, reason: UNPAID_COVERED_BY_SALARY };
  }
  return { paid: 0, unpaid: amount, reason: UNPAID_COVERAGE_NOT_DECIDED };
}

/**
 * Guaranteed hours (WM-07 / EL-01). A top-up exists only under an agreement that states a
 * guarantee and that the shortfall is paid. A salary already pays for the hours, so a salaried
 * agreement never adds a top-up.
 */
export const paysGuarantee = (a: AgreementTerms | null | undefined) =>
  !!a && a.guaranteeTopUp === 'PAY_SHORTFALL' && (a.guaranteedWeeklyHours ?? 0) > 0 && !carriesSalary(a);

export type GuaranteeWeek = {
  /** Minutes guaranteed for the week, after part weeks and absence days are taken off. */
  guaranteedMinutes: number;
  /** The agreement in force on the last guaranteed day of the week. */
  agreement: AgreementTerms | null;
  daysInForce: number;
  daysReducedForAbsence: number;
  /** The days (YYYY-MM-DD) the guarantee was in force: only work on these days counts towards it. */
  dayKeysInForce: string[];
};

/**
 * The guarantee of one Monday–Sunday week. Each day carries one seventh of the weekly guarantee
 * of the agreement in force that day, so a guarantee that starts, ends or changes part way
 * through a week counts only for its own days. A day of recorded absence carries nothing when
 * the agreement says the guarantee is reduced for absence.
 */
export function guaranteeForWeek(
  agreements: AgreementTerms[],
  weekKey: string,
  employment?: EmploymentDates,
  absentDayKeys: ReadonlySet<string> = new Set(),
): GuaranteeWeek {
  const monday = new Date(`${weekKey}T00:00:00.000Z`).getTime();
  let minutes = 0;
  let agreement: AgreementTerms | null = null;
  let daysInForce = 0;
  let daysReducedForAbsence = 0;
  const dayKeysInForce: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const t = monday + i * DAY_MS;
    const governing = employedOn(employment, t) ? governingAgreement(agreements, new Date(t)) : null;
    if (!paysGuarantee(governing)) continue;
    agreement = governing;
    daysInForce += 1;
    dayKeysInForce.push(isoDay(new Date(t)));
    if (governing!.guaranteeLeaveTreatment === 'REDUCE_FOR_ABSENCE_DAYS' && absentDayKeys.has(isoDay(new Date(t)))) {
      daysReducedForAbsence += 1;
      continue;
    }
    minutes += ((governing!.guaranteedWeeklyHours as number) * 60) / 7;
  }
  return { guaranteedMinutes: Math.round(minutes), agreement, daysInForce, daysReducedForAbsence, dayKeysInForce };
}
