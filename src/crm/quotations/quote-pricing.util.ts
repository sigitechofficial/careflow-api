import {
  addDaysToOperationalIso,
  combineOperationalDateAndHm,
  DEFAULT_OPERATIONAL_TIMEZONE,
} from '../../common/utils/operational-day.util';
import {
  clockSpanMinutes,
  wallClockVisitEnd,
} from '../../service-user-visit-plans/visit-plan-slot-window.util';
import {
  calculateBillableAmount,
  type ChargeCardRuleLike,
} from '../../billing/visit-reconciliation.util';

/**
 * Enquiry quotation pricing. Every visit is priced with the existing CLIENT charge engine
 * (`calculateBillableAmount`): day types, bank holidays, time bands (PRIORITY stacking, so an
 * uplift is applied once), fixed short-visit slots, hourly pro-rata, sleep-in and waking nights.
 *
 * Order (deterministic): visits → extras (set-up fee, mileage, other) → discounts → VAT → totals.
 * Weekly estimates use a typical week (no bank holidays); the calendar-month estimate prices the
 * real dates of one month, bank holidays included.
 */

export const WEEKS_PER_YEAR = 52;
export const AVERAGE_MONTH_FACTOR = WEEKS_PER_YEAR / 12;

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type QuotePatternFrequency =
  | 'WEEKLY'
  | 'FORTNIGHTLY'
  | 'FOUR_WEEKLY'
  | 'ONE_OFF';
export type QuoteNightDuty = 'NONE' | 'SLEEPING_NIGHT' | 'WAKING_NIGHT';

export type QuotePatternInput = {
  label: string;
  startTime: string;
  endTime?: string | null;
  /** Latest start of a time window; null = fixed start time. */
  windowEndTime?: string | null;
  durationMinutes: number;
  /** 0=Sun … 6=Sat. */
  daysOfWeek: number[];
  frequency: QuotePatternFrequency;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  oneOffDates?: string[];
  carersPerVisit: number;
  nightDuty?: QuoteNightDuty;
  manualChargePerVisit?: number | null;
  overrideReason?: string | null;
};

export type QuoteExtraInput = {
  kind: 'SETUP_FEE' | 'MILEAGE' | 'DISCOUNT' | 'OTHER';
  description: string;
  frequency: 'ONE_OFF' | 'WEEKLY' | 'MONTHLY';
  amount?: number | null;
  quantity?: number | null;
  isPercentage?: boolean;
};

export type QuoteFundingInput = {
  payerType: 'PRIVATE_CLIENT' | 'LOCAL_AUTHORITY' | 'NHS' | 'OTHER';
  payerName?: string | null;
  method: 'FIXED' | 'PERCENTAGE' | 'PER_VISIT';
  amount: number;
  status: 'CONFIRMED' | 'PENDING_APPROVAL';
};

export type QuoteVat = {
  /** Percentage (0 = exempt / zero rated); null = no classification configured. */
  rate: number | null;
  label: string;
  /** Set when the card names a VAT treatment that cannot be read (blocks issuing). */
  problem?: string | null;
};

export type QuotePricingContext = {
  cardName: string | null;
  rules: ChargeCardRuleLike[];
  defaultChargeMethod: string;
  /** COMBINED: each carer is charged (default). FIXED: the visit is charged once. */
  multiCarerMode: 'COMBINED' | 'FIXED';
  timeZone?: string;
  bankHolidays: Set<string>;
  /** Monday (YYYY-MM-DD) of the week used for weekly prices. */
  referenceWeekStart: string;
  /** Month priced for the calendar-month estimate (YYYY-MM). */
  calendarMonth: string;
  vat: QuoteVat;
};

/* ─── validation ──────────────────────────────────────────────────────── */

const hmMinutes = (hm: string) =>
  Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Problems with one pattern (empty = valid). Shown on save; issuing is blocked while any remain. */
export function validatePattern(p: QuotePatternInput): string[] {
  const errors: string[] = [];
  const name = p.label?.trim() || 'Visit';
  if (!p.label?.trim()) errors.push('Each visit pattern needs a label');
  if (!HM_RE.test(p.startTime ?? ''))
    errors.push(`${name}: start time must be HH:mm`);
  if (p.endTime && !HM_RE.test(p.endTime))
    errors.push(`${name}: end time must be HH:mm`);
  if (p.windowEndTime && !HM_RE.test(p.windowEndTime))
    errors.push(`${name}: window end must be HH:mm`);
  if (
    !Number.isInteger(p.durationMinutes) ||
    p.durationMinutes < 1 ||
    p.durationMinutes > 1440
  ) {
    errors.push(`${name}: duration must be between 1 minute and 24 hours`);
  }
  if (
    !p.windowEndTime &&
    p.endTime &&
    HM_RE.test(p.startTime) &&
    HM_RE.test(p.endTime) &&
    clockSpanMinutes(p.startTime, p.endTime) !== p.durationMinutes
  ) {
    errors.push(
      `${name}: ${p.startTime}–${p.endTime} is ${clockSpanMinutes(p.startTime, p.endTime)} minutes but the duration is ${p.durationMinutes}`,
    );
  }
  if (
    p.windowEndTime &&
    HM_RE.test(p.startTime) &&
    HM_RE.test(p.windowEndTime)
  ) {
    if (hmMinutes(p.windowEndTime) <= hmMinutes(p.startTime)) {
      errors.push(
        `${name}: the time window must end after it starts (same day)`,
      );
    }
  }
  if (
    !Number.isInteger(p.carersPerVisit) ||
    p.carersPerVisit < 1 ||
    p.carersPerVisit > 4
  ) {
    errors.push(`${name}: carers per visit must be 1 to 4`);
  }
  if (p.frequency === 'ONE_OFF') {
    const dates = p.oneOffDates ?? [];
    if (!dates.length)
      errors.push(`${name}: add the date of the one-off visit`);
    if (dates.some((d) => !ISO_DAY_RE.test(d)))
      errors.push(`${name}: one-off dates must be YYYY-MM-DD`);
  } else {
    const days = p.daysOfWeek ?? [];
    if (!days.length) errors.push(`${name}: choose at least one day`);
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
      errors.push(`${name}: days must be 0 (Sun) to 6 (Sat)`);
    if (new Set(days).size !== days.length)
      errors.push(`${name}: a day is listed twice`);
  }
  for (const d of [p.effectiveFrom, p.effectiveTo]) {
    if (d && !ISO_DAY_RE.test(d))
      errors.push(`${name}: effective dates must be YYYY-MM-DD`);
  }
  if (p.effectiveFrom && p.effectiveTo && p.effectiveTo < p.effectiveFrom) {
    errors.push(`${name}: effective to is before effective from`);
  }
  if (
    p.nightDuty &&
    p.nightDuty !== 'NONE' &&
    p.frequency === 'ONE_OFF' &&
    !(p.oneOffDates ?? []).length
  ) {
    errors.push(`${name}: a night needs a date`);
  }
  if (p.manualChargePerVisit != null) {
    if (!(p.manualChargePerVisit >= 0))
      errors.push(`${name}: manual charge must be 0 or more`);
    if (!p.overrideReason?.trim())
      errors.push(`${name}: give a reason for the manual charge`);
  }
  return errors;
}

export function validateFunding(
  fundings: QuoteFundingInput[],
  category: string,
): string[] {
  const errors: string[] = [];
  for (const f of fundings) {
    if (!(f.amount >= 0)) errors.push('Funding amounts must be 0 or more');
    if (f.method === 'PERCENTAGE' && f.amount > 100)
      errors.push('A funding percentage cannot be over 100%');
  }
  const pct = fundings
    .filter((f) => f.method === 'PERCENTAGE')
    .reduce((s, f) => s + f.amount, 0);
  if (pct > 100.0001)
    errors.push(`Funding percentages add up to ${round2(pct)}% (over 100%)`);
  const thirdParty = fundings.filter((f) => f.payerType !== 'PRIVATE_CLIENT');
  if (category === 'PRIVATE' && thirdParty.length) {
    errors.push(
      'A private quote cannot have local authority / NHS / other funding — choose Mixed',
    );
  }
  if (category === 'MIXED' && !thirdParty.length) {
    errors.push(
      'A mixed quote needs at least one local authority, NHS or other funder',
    );
  }
  return errors;
}

/* ─── occurrences ─────────────────────────────────────────────────────── */

const dayOfWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Monday on or after `iso`. */
export function mondayOnOrAfter(iso: string): string {
  const dow = dayOfWeek(iso);
  return addDaysToOperationalIso(iso, (8 - dow) % 7);
}

function weeksBetween(fromIso: string, toIso: string): number {
  const ms =
    Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.floor(Math.round(ms / 86400000) / 7);
}

const EVERY_N_WEEKS: Record<QuotePatternFrequency, number> = {
  WEEKLY: 1,
  FORTNIGHTLY: 2,
  FOUR_WEEKLY: 4,
  ONE_OFF: 0,
};

/** Whether a recurring pattern runs on `iso` (frequency counted from the pattern start or `anchor`). */
export function patternRunsOn(
  p: QuotePatternInput,
  iso: string,
  anchor: string,
): boolean {
  if (p.frequency === 'ONE_OFF') return (p.oneOffDates ?? []).includes(iso);
  if (p.effectiveFrom && iso < p.effectiveFrom) return false;
  if (p.effectiveTo && iso > p.effectiveTo) return false;
  if (!p.daysOfWeek.includes(dayOfWeek(iso))) return false;
  const every = EVERY_N_WEEKS[p.frequency];
  if (every <= 1) return true;
  const start = mondayOnOrAfter(
    addDaysToOperationalIso(p.effectiveFrom ?? anchor, -6),
  );
  return ((weeksBetween(start, iso) % every) + every) % every === 0;
}

/* ─── one visit ───────────────────────────────────────────────────────── */

export type OccurrencePrice = {
  date: string;
  weekday: string;
  amount: number | null;
  perCarerAmount: number | null;
  rateReference: string;
  isBankHoliday: boolean;
  issue: string | null;
};

/** Price one visit on `dayIso` for every carer (per `multiCarerMode`). */
export function priceOccurrence(
  p: QuotePatternInput,
  dayIso: string,
  ctx: QuotePricingContext,
  isBankHoliday: boolean,
): OccurrencePrice {
  const timeZone = ctx.timeZone ?? DEFAULT_OPERATIONAL_TIMEZONE;
  const weekday = WEEKDAY_NAMES[dayOfWeek(dayIso)];
  const base = { date: dayIso, weekday, isBankHoliday };
  if (p.manualChargePerVisit != null) {
    return {
      ...base,
      amount: round2(p.manualChargePerVisit),
      perCarerAmount: null,
      rateReference: `Manual charge (${p.overrideReason?.trim() || 'no reason'})`,
      issue: null,
    };
  }
  if (!ctx.rules.length) {
    return {
      ...base,
      amount: null,
      perCarerAmount: null,
      rateReference: 'No charge card',
      issue: 'No client charge card applies to this quote',
    };
  }
  const start = combineOperationalDateAndHm(dayIso, p.startTime, timeZone);
  // A fixed visit ends on the clock (cross-midnight and clock-change nights); a window visit lasts its duration.
  const end =
    p.endTime && !p.windowEndTime
      ? wallClockVisitEnd(dayIso, p.startTime, p.endTime, timeZone)
      : new Date(start.getTime() + p.durationMinutes * 60_000);
  const minutes = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 60_000),
  );
  const nightDuty = p.nightDuty && p.nightDuty !== 'NONE' ? p.nightDuty : null;
  const calc = calculateBillableAmount(
    ctx.rules,
    start,
    minutes,
    ctx.defaultChargeMethod,
    isBankHoliday,
    {
      start,
      end,
      isBankHolidayFn: (d) => ctx.bankHolidays.has(isoInZone(d, timeZone)),
      timeZone,
    },
    nightDuty,
    minutes,
  );
  const when = `${weekday}${isBankHoliday ? ' (bank holiday)' : ''} ${p.startTime}, ${minutes} min`;
  if (!calc) {
    const what =
      nightDuty === 'SLEEPING_NIGHT'
        ? 'sleeping night'
        : nightDuty === 'WAKING_NIGHT'
          ? 'waking night'
          : 'visit';
    return {
      ...base,
      amount: null,
      perCarerAmount: null,
      rateReference: ctx.cardName ?? 'Charge card',
      issue: `No ${what} rate on ${ctx.cardName ?? 'the charge card'} for ${when}`,
    };
  }
  const carers =
    ctx.multiCarerMode === 'FIXED' ? 1 : Math.max(1, p.carersPerVisit);
  const segments = calc.segments?.length
    ? calc.segments
        .map(
          (s) =>
            `${s.hoursLabel ?? ''} @ £${s.rate.toFixed(2)}/h${s.ruleLabel ? ` (${s.ruleLabel})` : ''}`,
        )
        .join(' + ')
    : calc.label;
  return {
    ...base,
    amount: round2(calc.amount * carers),
    perCarerAmount: round2(calc.amount),
    rateReference: `${ctx.cardName ?? 'Charge card'}: ${segments}${carers > 1 ? ` × ${carers} carers` : ''}`,
    issue: null,
  };
}

function isoInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/* ─── a whole quote ───────────────────────────────────────────────────── */

export type PatternPricing = {
  index: number;
  label: string;
  frequency: QuotePatternFrequency;
  carersPerVisit: number;
  durationMinutes: number;
  weeklyOccurrences: number;
  /** Visit time covered per week (each visit once). */
  weeklyCoverageMinutes: number;
  /** Carer time per week (visit time × carers). */
  weeklyCarerMinutes: number;
  chargePerOccurrence: number | null;
  rateReference: string | null;
  weeklyTotal: number;
  oneOffTotal: number;
  occurrences: OccurrencePrice[];
  issues: string[];
};

export type ExtraPricing = QuoteExtraInput & {
  total: number;
  weeklyEquivalent: number;
  issue: string | null;
};

export type FundingPricing = QuoteFundingInput & { weeklyAmount: number };

export type QuotePricingResult = {
  patterns: PatternPricing[];
  extras: ExtraPricing[];
  fundings: FundingPricing[];
  visitsWeekly: number;
  extrasWeekly: number;
  discountWeekly: number;
  netWeekly: number;
  vatWeekly: number;
  vatLabel: string;
  weeklyTotal: number;
  oneOffNet: number;
  oneOffVat: number;
  oneOffTotal: number;
  weeklyVisitCount: number;
  weeklyCoverageMinutes: number;
  weeklyCarerMinutes: number;
  estimates: Array<{
    key: string;
    label: string;
    amount: number;
    method: string;
  }>;
  calendarMonth: {
    month: string;
    amount: number;
    occurrences: number;
    bankHolidayOccurrences: number;
    method: string;
    complete: boolean;
  };
  clientWeeklyLiability: number;
  clientWeeklyLiabilityIfPendingDeclined: number;
  fundedWeekly: number;
  pendingFundingWeekly: number;
  issues: string[];
  unresolvedCharges: number;
};

/**
 * Price a quote. Weekly prices use `referenceWeekStart` (Mon–Sun) with normal day rates —
 * bank holidays are counted only in the calendar-month estimate.
 */
export function priceQuote(
  patternsIn: QuotePatternInput[],
  extrasIn: QuoteExtraInput[],
  fundingsIn: QuoteFundingInput[],
  fundingCategory: string,
  ctx: QuotePricingContext,
  mileageRate: number | null,
): QuotePricingResult {
  const issues: string[] = [];
  let unresolved = 0;
  const weekStart = ctx.referenceWeekStart;
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    addDaysToOperationalIso(weekStart, i),
  );

  const patterns: PatternPricing[] = patternsIn.map((p, index) => {
    const pIssues = validatePattern(p);
    let weeklyTotal = 0;
    let oneOffTotal = 0;
    let weeklyOccurrences = 0;
    const occurrences: OccurrencePrice[] = [];
    if (!pIssues.length) {
      if (p.frequency === 'ONE_OFF') {
        for (const d of [...(p.oneOffDates ?? [])].sort()) {
          const occ = priceOccurrence(p, d, ctx, ctx.bankHolidays.has(d));
          occurrences.push(occ);
          if (occ.amount == null) {
            pIssues.push(occ.issue!);
            unresolved++;
          } else oneOffTotal += occ.amount;
        }
      } else {
        const every = EVERY_N_WEEKS[p.frequency];
        // One typical week: each chosen day once, at normal (non bank holiday) rates.
        for (const d of weekDays) {
          if (!p.daysOfWeek.includes(dayOfWeek(d))) continue;
          const occ = priceOccurrence(p, d, ctx, false);
          occurrences.push(occ);
          if (occ.amount == null) {
            pIssues.push(occ.issue!);
            unresolved++;
          } else weeklyTotal += occ.amount / every;
        }
        weeklyOccurrences = p.daysOfWeek.length / every;
      }
    }
    const priced = occurrences.filter((o) => o.amount != null);
    const amounts = [...new Set(priced.map((o) => o.amount))];
    return {
      index,
      label: p.label,
      frequency: p.frequency,
      carersPerVisit: p.carersPerVisit,
      durationMinutes: p.durationMinutes,
      weeklyOccurrences: Math.round(weeklyOccurrences * 1000) / 1000,
      weeklyCoverageMinutes: Math.round(p.durationMinutes * weeklyOccurrences),
      weeklyCarerMinutes: Math.round(
        p.durationMinutes * weeklyOccurrences * p.carersPerVisit,
      ),
      chargePerOccurrence:
        amounts.length === 1
          ? amounts[0]
          : priced.length
            ? round2(priced.reduce((s, o) => s + o.amount!, 0) / priced.length)
            : null,
      rateReference:
        [...new Set(priced.map((o) => o.rateReference))].join('; ') || null,
      weeklyTotal: round2(weeklyTotal),
      oneOffTotal: round2(oneOffTotal),
      occurrences,
      issues: pIssues,
    };
  });
  for (const p of patterns) issues.push(...p.issues);

  const visitsWeekly = round2(patterns.reduce((s, p) => s + p.weeklyTotal, 0));
  const visitsOneOff = round2(patterns.reduce((s, p) => s + p.oneOffTotal, 0));

  // Extras before discounts; discounts apply to visits + extras of the same frequency.
  const toWeekly = (amount: number, f: QuoteExtraInput['frequency']) =>
    f === 'WEEKLY'
      ? amount
      : f === 'MONTHLY'
        ? amount / AVERAGE_MONTH_FACTOR
        : 0;
  const extras: ExtraPricing[] = extrasIn.map((e) => {
    if (e.kind === 'DISCOUNT')
      return { ...e, total: 0, weeklyEquivalent: 0, issue: null };
    let total = 0;
    let issue: string | null = null;
    if (e.kind === 'MILEAGE') {
      const rate = e.amount ?? mileageRate;
      if (rate == null)
        issue = `${e.description || 'Mileage'}: no mileage rate on the charge card — enter a rate`;
      else total = round2((e.quantity ?? 0) * rate);
    } else {
      if (e.amount == null)
        issue = `${e.description || 'Charge'}: enter an amount`;
      else total = round2(e.amount);
    }
    if (issue) {
      issues.push(issue);
      unresolved++;
    }
    return {
      ...e,
      total,
      weeklyEquivalent: round2(toWeekly(total, e.frequency)),
      issue,
    };
  });
  const extrasWeekly = round2(
    extras.reduce((s, e) => s + e.weeklyEquivalent, 0),
  );
  const extrasOneOff = round2(
    extras
      .filter((e) => e.frequency === 'ONE_OFF')
      .reduce((s, e) => s + e.total, 0),
  );

  let discountWeekly = 0;
  let discountOneOff = 0;
  for (const e of extras) {
    if (e.kind !== 'DISCOUNT') continue;
    const value = e.amount ?? 0;
    if (!(value >= 0) || (e.isPercentage && value > 100)) {
      e.issue = `${e.description || 'Discount'}: enter 0–100% or a £ amount`;
      issues.push(e.issue);
      unresolved++;
      continue;
    }
    const baseWeekly = visitsWeekly + extrasWeekly;
    const baseOneOff = visitsOneOff + extrasOneOff;
    if (e.frequency === 'ONE_OFF') {
      const d = e.isPercentage
        ? round2((baseOneOff * value) / 100)
        : round2(value);
      e.total = -d;
      discountOneOff += d;
    } else {
      const weekly = e.isPercentage
        ? round2((baseWeekly * value) / 100)
        : round2(toWeekly(value, e.frequency));
      e.total = e.isPercentage ? -weekly : -round2(value);
      e.weeklyEquivalent = -weekly;
      discountWeekly += weekly;
    }
  }
  discountWeekly = round2(discountWeekly);
  discountOneOff = round2(discountOneOff);

  const netWeekly = round2(
    Math.max(0, visitsWeekly + extrasWeekly - discountWeekly),
  );
  const oneOffNet = round2(
    Math.max(0, visitsOneOff + extrasOneOff - discountOneOff),
  );
  if (ctx.vat.problem) {
    issues.push(ctx.vat.problem);
    unresolved++;
  }
  const vatRate = ctx.vat.rate ?? 0;
  const vatWeekly = round2((netWeekly * vatRate) / 100);
  const oneOffVat = round2((oneOffNet * vatRate) / 100);
  const weeklyTotal = round2(netWeekly + vatWeekly);
  const oneOffTotal = round2(oneOffNet + oneOffVat);

  // Calendar month: real dates, bank holidays priced as bank holidays.
  const [y, m] = ctx.calendarMonth.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let monthVisits = 0;
  let monthOccurrences = 0;
  let monthBankHoliday = 0;
  let monthComplete = true;
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${ctx.calendarMonth}-${String(day).padStart(2, '0')}`;
    patternsIn.forEach((p, i) => {
      if (patterns[i].issues.length && p.frequency !== 'ONE_OFF') {
        monthComplete = false;
        return;
      }
      if (!patternRunsOn(p, iso, weekStart)) return;
      const bh = ctx.bankHolidays.has(iso);
      const occ = priceOccurrence(p, iso, ctx, bh);
      monthOccurrences++;
      if (bh) monthBankHoliday++;
      if (occ.amount == null) monthComplete = false;
      else monthVisits += occ.amount;
    });
  }
  const monthExtras = extras
    .filter((e) => e.kind !== 'DISCOUNT')
    .reduce(
      (s, e) =>
        s +
        (e.frequency === 'WEEKLY'
          ? (e.total * daysInMonth) / 7
          : e.frequency === 'MONTHLY'
            ? e.total
            : 0),
      0,
    );
  const monthDiscount = extras
    .filter(
      (e) => e.kind === 'DISCOUNT' && !e.issue && e.frequency !== 'ONE_OFF',
    )
    .reduce((s, e) => {
      if (e.isPercentage)
        return s + ((monthVisits + monthExtras) * (e.amount ?? 0)) / 100;
      return (
        s +
        (e.frequency === 'WEEKLY'
          ? ((e.amount ?? 0) * daysInMonth) / 7
          : (e.amount ?? 0))
      );
    }, 0);
  const monthNet = Math.max(0, monthVisits + monthExtras - monthDiscount);
  const monthAmount = round2(monthNet + (monthNet * vatRate) / 100);
  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  // Funding: who pays what each week; the client pays the rest.
  const weeklyVisitCount = patterns.reduce(
    (s, p) => s + p.weeklyOccurrences,
    0,
  );
  const fundings: FundingPricing[] = fundingsIn.map((f) => {
    const weekly =
      f.method === 'PERCENTAGE'
        ? (weeklyTotal * f.amount) / 100
        : f.method === 'PER_VISIT'
          ? f.amount * weeklyVisitCount
          : f.amount;
    return { ...f, weeklyAmount: round2(weekly) };
  });
  const fundingIssues = validateFunding(fundingsIn, fundingCategory);
  const thirdParty = fundings.filter((f) => f.payerType !== 'PRIVATE_CLIENT');
  const fundedWeekly = round2(
    thirdParty.reduce((s, f) => s + f.weeklyAmount, 0),
  );
  const pendingFundingWeekly = round2(
    thirdParty
      .filter((f) => f.status === 'PENDING_APPROVAL')
      .reduce((s, f) => s + f.weeklyAmount, 0),
  );
  if (fundedWeekly > weeklyTotal + 0.005) {
    fundingIssues.push(
      `Funding (£${fundedWeekly.toFixed(2)}/week) is more than the weekly total (£${weeklyTotal.toFixed(2)})`,
    );
  }
  issues.push(...fundingIssues);
  unresolved += fundingIssues.length;

  return {
    patterns,
    extras,
    fundings,
    visitsWeekly,
    extrasWeekly,
    discountWeekly,
    netWeekly,
    vatWeekly,
    vatLabel: ctx.vat.label,
    weeklyTotal,
    oneOffNet,
    oneOffVat,
    oneOffTotal,
    weeklyVisitCount: Math.round(weeklyVisitCount * 1000) / 1000,
    weeklyCoverageMinutes: patterns.reduce(
      (s, p) => s + p.weeklyCoverageMinutes,
      0,
    ),
    weeklyCarerMinutes: patterns.reduce((s, p) => s + p.weeklyCarerMinutes, 0),
    estimates: [
      {
        key: 'weekly',
        label: 'Weekly',
        amount: weeklyTotal,
        method:
          'One typical week (Mon–Sun) at normal day rates; bank holidays not included',
      },
      {
        key: 'fourWeekly',
        label: 'Four-weekly',
        amount: round2(weeklyTotal * 4),
        method: 'Weekly × 4',
      },
      {
        key: 'monthlyAverage',
        label: 'Average monthly',
        amount: round2((weeklyTotal * WEEKS_PER_YEAR) / 12),
        method: 'Weekly × 52 ÷ 12',
      },
      {
        key: 'annual',
        label: 'Annual',
        amount: round2(weeklyTotal * WEEKS_PER_YEAR),
        method: 'Weekly × 52 (bank holiday rates not included)',
      },
    ],
    calendarMonth: {
      month: ctx.calendarMonth,
      amount: monthAmount,
      occurrences: monthOccurrences,
      bankHolidayOccurrences: monthBankHoliday,
      complete: monthComplete,
      method: `Actual dates in ${monthLabel}: ${monthOccurrences} visit${monthOccurrences === 1 ? '' : 's'}${monthBankHoliday ? `, ${monthBankHoliday} on bank holidays at bank holiday rates` : ''}; weekly extras pro rata; one-off charges excluded`,
    },
    clientWeeklyLiability: round2(Math.max(0, weeklyTotal - fundedWeekly)),
    clientWeeklyLiabilityIfPendingDeclined: round2(
      Math.max(0, weeklyTotal - (fundedWeekly - pendingFundingWeekly)),
    ),
    fundedWeekly,
    pendingFundingWeekly,
    issues,
    unresolvedCharges: unresolved,
  };
}

/**
 * VAT only from the charge card's configured tax treatment. Nothing configured = no VAT line
 * (labelled as such); a treatment that names VAT without a readable rate blocks issuing.
 */
export function resolveVat(taxTreatment: string | null | undefined): QuoteVat {
  const t = taxTreatment?.trim();
  if (!t)
    return {
      rate: null,
      label: 'No VAT classification on the charge card — VAT not added',
    };
  if (/exempt|zero|outside|not applicable|^n\/?a$|^none$/i.test(t))
    return { rate: 0, label: `VAT: ${t}` };
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(t);
  if (pct)
    return { rate: Number(pct[1]), label: `VAT ${Number(pct[1])}% (${t})` };
  return {
    rate: null,
    label: `VAT: ${t}`,
    problem: `The charge card's tax treatment "${t}" has no VAT rate — set it to e.g. "VAT exempt" or "VAT 20%"`,
  };
}
