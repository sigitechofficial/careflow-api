import {
  BillingCardStatus,
  FinanceExceptionCode,
  Prisma,
  ScheduledVisitStatus,
  VisitReconciliationStatus,
} from '@prisma/client';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  dayKeyInTimeZone,
  formatHmInTimeZone,
} from '../common/utils/operational-day.util';
import { assessFundingBillingReadiness } from './funding-contract.util';
import {
  calculateBandedPay,
  formatHhMmUtc,
  hasTimeBandedHourlyRules,
  minuteInTimeBand,
  resolveCalendarDayType as resolveBandCalendarDayType,
  resolveSpecialDay,
  shouldPreferBandedOverFixed,
  SPECIAL_DAY_PRIORITY,
  type PaySpecialDay,
  type PayStackingPolicy,
  type TimeBandRule,
} from './pay-time-band.util';

export type DetectedException = {
  code: FinanceExceptionCode;
  message: string;
};

/** Blocks invoice approval (and approve scope BOTH) unless managerOverride. */
const BLOCKING_EXCEPTION_CODES = new Set<FinanceExceptionCode>([
  FinanceExceptionCode.MISSING_CHECK_IN,
  FinanceExceptionCode.MISSING_CHECK_OUT,
  FinanceExceptionCode.PAY_CARD_MISSING,
  FinanceExceptionCode.CHARGE_CARD_MISSING,
  FinanceExceptionCode.RATE_MISSING,
  FinanceExceptionCode.FUNDING_SETUP_INCOMPLETE,
  FinanceExceptionCode.PO_EXPIRED,
  FinanceExceptionCode.PO_MISSING,
  FinanceExceptionCode.TASKS_INCOMPLETE,
]);

/** Only these prevent auto-accepting carer pay on visit complete / evaluate. */
const PAY_BLOCKING_EXCEPTION_CODES = new Set<FinanceExceptionCode>([
  FinanceExceptionCode.PAY_CARD_MISSING,
]);

export function isPayBlockingException(exception: DetectedException): boolean {
  if (PAY_BLOCKING_EXCEPTION_CODES.has(exception.code)) return true;
  // RATE_MISSING is shared for pay + charge cards; only pay-card messages block earnings.
  if (exception.code === FinanceExceptionCode.RATE_MISSING) {
    return /pay card/i.test(exception.message ?? '');
  }
  return false;
}

export function hasPayBlockingExceptions(exceptions: DetectedException[]): boolean {
  return exceptions.some(isPayBlockingException);
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

/**
 * Human visit reference: VIS-[BRANCH]-[YYYYMMDD]-[NNNN]
 * BRANCH = 3-character code from the service user’s branch (ScheduleArea.visitRefCode)
 * YYYYMMDD = original planned visit date
 * NNNN = daily sequence per branch (resets each day)
 * Immutable after creation (canonical refs never change on call-off / reschedule).
 * Legacy VIS-GEN-* / non-canonical values may be repaired once on sync.
 * Separate from Rolling Rota / Timebank IDs.
 * Example: VIS-L01-20260901-0123
 */
export function formatVisitRef(branchCode: string, dayKeyYyyymmdd: string, sequence: number): string {
  const branch = normalizeVisitRefBranchCode(branchCode);
  const day = dayKeyYyyymmdd.replace(/-/g, '').slice(0, 8);
  const seq = Math.max(1, Math.floor(sequence));
  return `VIS-${branch}-${day}-${String(seq).padStart(4, '0')}`;
}

/**
 * Exactly 3 uppercase alphanumeric characters.
 * Prefer ScheduleArea.visitRefCode; otherwise derive a stable 3-char token.
 */
export function normalizeVisitRefBranchCode(code: string | null | undefined): string {
  const cleaned = (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return 'GEN';
  if (/^[A-Z0-9]{3}$/.test(cleaned)) return cleaned;
  const withDigits = cleaned.match(/^([A-Z]+)(\d{1,2})$/);
  if (withDigits) {
    return `${withDigits[1][0]}${withDigits[2].padStart(2, '0')}`.slice(0, 3);
  }
  if (cleaned.length >= 3) return cleaned.slice(0, 3);
  return cleaned.padEnd(3, 'X').slice(0, 3);
}

export function isCanonicalVisitRef(visitRef: string | null | undefined): boolean {
  return /^VIS-[A-Z0-9]{3}-\d{8}-\d{4}$/.test((visitRef ?? '').trim());
}

/** YYYY-MM-DD → YYYYMMDD for visit ref day segment. */
export function visitRefDayKey(dayKeyIso: string): string {
  return dayKeyIso.replace(/-/g, '').slice(0, 8);
}

/** Format HH:mm–HH:mm in the organisation operational timezone. */
export function formatTimeRange(
  start: Date | null | undefined,
  end: Date | null | undefined,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  if (!start && !end) return '—';
  const fmt = (d: Date) => formatHmInTimeZone(d, timeZone);
  if (start && end) return `${fmt(start)}–${fmt(end)}`;
  if (start) return `${fmt(start)}–—`;
  return `—–${fmt(end!)}`;
}

/** Calendar day YYYY-MM-DD in the organisation operational timezone. */
export function formatDateOnly(
  date: Date,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  return dayKeyInTimeZone(date, timeZone);
}

type VisitSnapshot = {
  status: ScheduledVisitStatus;
  plannedStartDateTime: Date;
  plannedEndDateTime: Date | null;
  actualStartDateTime: Date | null;
  actualEndDateTime: Date | null;
  overrunReason?: string | null;
};

type CardSnapshot = {
  id: string;
  status: BillingCardStatus;
  rulesCount: number;
} | null;

type FundingSnapshot = {
  status: string;
  isActive: boolean;
  funderId: string | null;
  defaultChargeCardId: string | null;
  funderDefaultChargeCardId: string | null;
  purchaseOrderNumber: string | null;
  purchaseOrderExpiresAt: Date | null;
  billingContactName: string | null;
} | null;

export function detectVisitExceptions(input: {
  visit: VisitSnapshot;
  payCard: CardSnapshot;
  chargeCard: CardSnapshot;
  tasksIncomplete: boolean;
  funding: FundingSnapshot;
}): DetectedException[] {
  const exceptions: DetectedException[] = [];
  const { visit, payCard, chargeCard, tasksIncomplete, funding } = input;

  const completing =
    visit.status === ScheduledVisitStatus.COMPLETED ||
    visit.status === ScheduledVisitStatus.PARTIALLY_COMPLETED ||
    Boolean(visit.actualStartDateTime && visit.actualEndDateTime);

  if (completing && !visit.actualStartDateTime) {
    exceptions.push({
      code: FinanceExceptionCode.MISSING_CHECK_IN,
      message: 'No check-in time recorded for this visit',
    });
  }

  if (visit.status === ScheduledVisitStatus.COMPLETED && !visit.actualEndDateTime) {
    exceptions.push({
      code: FinanceExceptionCode.MISSING_CHECK_OUT,
      message: 'No check-out time recorded for this visit',
    });
  }

  if (visit.plannedEndDateTime && visit.actualStartDateTime && visit.actualEndDateTime) {
    const plannedMinutes = minutesBetween(visit.plannedStartDateTime, visit.plannedEndDateTime);
    const actualMinutes = minutesBetween(visit.actualStartDateTime, visit.actualEndDateTime);
    if (actualMinutes > plannedMinutes) {
      const overrunMinutes = actualMinutes - plannedMinutes;
      const reason = visit.overrunReason?.trim();
      exceptions.push({
        code: FinanceExceptionCode.OVERRUN,
        message: reason
          ? `${overrunMinutes} min overrun (${actualMinutes} vs ${plannedMinutes} planned). Reason: ${reason}`
          : `${overrunMinutes} min overrun (${actualMinutes} vs ${plannedMinutes} planned). No reason provided.`,
      });
    } else if (actualMinutes < plannedMinutes - 15 && actualMinutes > 0) {
      exceptions.push({
        code: FinanceExceptionCode.UNDERRUN,
        message: `Actual duration (${actualMinutes} min) is shorter than planned (${plannedMinutes} min)`,
      });
    }
  }

  if (!payCard) {
    exceptions.push({
      code: FinanceExceptionCode.PAY_CARD_MISSING,
      message: 'No pay card could be resolved for the assigned carer',
    });
  } else if (payCard.status !== BillingCardStatus.ACTIVE) {
    exceptions.push({
      code: FinanceExceptionCode.RATE_MISSING,
      message: `Pay card is ${payCard.status.toLowerCase().replace(/_/g, ' ')}`,
    });
  } else if (payCard.rulesCount === 0) {
    exceptions.push({
      code: FinanceExceptionCode.RATE_MISSING,
      message: 'Pay card has no rate rules configured',
    });
  }

  if (!chargeCard) {
    exceptions.push({
      code: FinanceExceptionCode.CHARGE_CARD_MISSING,
      message: 'No charge card could be resolved for this service user',
    });
  } else if (chargeCard.status !== BillingCardStatus.ACTIVE) {
    exceptions.push({
      code: FinanceExceptionCode.RATE_MISSING,
      message: `Charge card is ${chargeCard.status.toLowerCase().replace(/_/g, ' ')}`,
    });
  } else if (chargeCard.rulesCount === 0) {
    exceptions.push({
      code: FinanceExceptionCode.RATE_MISSING,
      message: 'Charge card has no charge rules configured',
    });
  }

  if (funding) {
    const readiness = assessFundingBillingReadiness({
      status: funding.status as Parameters<typeof assessFundingBillingReadiness>[0]['status'],
      isActive: funding.isActive,
      funderId: funding.funderId,
      defaultChargeCardId: funding.defaultChargeCardId,
      funderDefaultChargeCardId: funding.funderDefaultChargeCardId,
      purchaseOrderNumber: funding.purchaseOrderNumber,
      purchaseOrderExpiresAt: funding.purchaseOrderExpiresAt,
      billingContactName: funding.billingContactName,
    });
    for (const issue of readiness.issues) {
      if (issue.toLowerCase().includes('purchase order expired')) {
        exceptions.push({ code: FinanceExceptionCode.PO_EXPIRED, message: issue });
      } else if (issue.toLowerCase().includes('purchase order')) {
        exceptions.push({ code: FinanceExceptionCode.PO_MISSING, message: issue });
      } else {
        exceptions.push({ code: FinanceExceptionCode.FUNDING_SETUP_INCOMPLETE, message: issue });
      }
    }
  }

  if (tasksIncomplete) {
    exceptions.push({
      code: FinanceExceptionCode.TASKS_INCOMPLETE,
      message: 'One or more required visit tasks were not completed',
    });
  }

  return exceptions;
}

export function deriveReconciliationStatus(
  exceptions: DetectedException[],
  currentStatus?: VisitReconciliationStatus,
): VisitReconciliationStatus {
  if (
    currentStatus === VisitReconciliationStatus.APPROVED_FOR_PAY ||
    currentStatus === VisitReconciliationStatus.APPROVED_FOR_INVOICE ||
    currentStatus === VisitReconciliationStatus.APPROVED_FOR_BOTH ||
    currentStatus === VisitReconciliationStatus.LOCKED
  ) {
    return currentStatus;
  }

  // Carer pay is accepted as soon as the visit can be priced from the pay card.
  // Invoice / funding / overrun / GPS issues remain as exceptions for finance review,
  // but must not withhold earnings until a separate reconciliation click.
  if (hasPayBlockingExceptions(exceptions)) {
    return VisitReconciliationStatus.PENDING_REVIEW;
  }

  return VisitReconciliationStatus.APPROVED_FOR_PAY;
}

export function hasUnresolvedBlockingExceptions(exceptions: DetectedException[]): boolean {
  return exceptions.some((e) => BLOCKING_EXCEPTION_CODES.has(e.code));
}

export function listUnresolvedBlockingCodes(exceptions: DetectedException[]): FinanceExceptionCode[] {
  return [
    ...new Set(
      exceptions.filter((e) => BLOCKING_EXCEPTION_CODES.has(e.code)).map((e) => e.code),
    ),
  ];
}

export function listPayBlockingCodes(exceptions: DetectedException[]): FinanceExceptionCode[] {
  return [...new Set(exceptions.filter(isPayBlockingException).map((e) => e.code))];
}

/**
 * When actual duration is shorter than planned by at most `durationToleranceMinutes`,
 * pay and charge use the full planned window (fixed ≤60 and hourly/pro-rata >60).
 * UNDERRUN / early-leave flags stay independent of this snap.
 */
export function isDurationShortfallWithinTolerance(input: {
  plannedStartDateTime: Date;
  plannedEndDateTime: Date;
  actualStartDateTime: Date | null;
  actualEndDateTime: Date | null;
  durationToleranceMinutes: number;
}): boolean {
  const tol = Math.floor(Number(input.durationToleranceMinutes));
  if (!(tol > 0) || !input.actualStartDateTime || !input.actualEndDateTime) {
    return false;
  }
  const plannedMinutes = minutesBetween(input.plannedStartDateTime, input.plannedEndDateTime);
  const actualMinutes = minutesBetween(input.actualStartDateTime, input.actualEndDateTime);
  if (plannedMinutes <= 0 || actualMinutes <= 0) return false;
  const shortfall = plannedMinutes - actualMinutes;
  return shortfall > 0 && shortfall <= tol;
}

export function resolveDefaultApprovedWindows(input: {
  plannedStartDateTime: Date;
  plannedEndDateTime: Date | null;
  actualStartDateTime: Date | null;
  actualEndDateTime: Date | null;
  exceptions: DetectedException[];
  /** When overrun is APPROVED, pay uses actual clock times; otherwise planned (extra time unpaid until approved). */
  overrunDecision?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  /**
   * Org/slot punctuality tolerance (minutes). Early leave / short duration within this
   * still pays and charges the full planned visit length. Defaults to 0 (no snap).
   */
  durationToleranceMinutes?: number | null;
}): {
  approvedPayStart: Date;
  approvedPayEnd: Date;
  approvedBillStart: Date;
  approvedBillEnd: Date;
} {
  const {
    plannedStartDateTime,
    plannedEndDateTime,
    actualStartDateTime,
    actualEndDateTime,
    exceptions,
    overrunDecision,
    durationToleranceMinutes = 0,
  } = input;
  const plannedEnd =
    plannedEndDateTime ??
    new Date(plannedStartDateTime.getTime() + 30 * 60_000);

  const hasOverrun = exceptions.some((e) => e.code === FinanceExceptionCode.OVERRUN);
  const payActualApproved =
    overrunDecision === 'APPROVED' &&
    actualStartDateTime != null &&
    actualEndDateTime != null;

  // Overrun pending/rejected: pay planned length. Approved: pay actual clock times.
  if (hasOverrun && !payActualApproved) {
    return {
      approvedPayStart: plannedStartDateTime,
      approvedPayEnd: plannedEnd,
      ...resolveBillWindow(plannedStartDateTime, plannedEnd, actualStartDateTime, plannedEnd),
    };
  }

  if (hasOverrun && payActualApproved) {
    return {
      approvedPayStart: actualStartDateTime!,
      approvedPayEnd: actualEndDateTime!,
      ...resolveBillWindow(
        plannedStartDateTime,
        plannedEnd,
        actualStartDateTime,
        actualEndDateTime!,
      ),
    };
  }

  // Early leave / short visit within tolerance → full planned pay + charge duration.
  if (
    isDurationShortfallWithinTolerance({
      plannedStartDateTime,
      plannedEndDateTime: plannedEnd,
      actualStartDateTime,
      actualEndDateTime,
      durationToleranceMinutes: durationToleranceMinutes ?? 0,
    })
  ) {
    return {
      approvedPayStart: plannedStartDateTime,
      approvedPayEnd: plannedEnd,
      ...resolveBillWindow(plannedStartDateTime, plannedEnd, actualStartDateTime, plannedEnd),
    };
  }

  const payStart = actualStartDateTime ?? plannedStartDateTime;
  const payEnd = actualEndDateTime ?? plannedEnd;

  return {
    approvedPayStart: payStart,
    approvedPayEnd: payEnd,
    ...resolveBillWindow(
      plannedStartDateTime,
      plannedEnd,
      actualStartDateTime,
      actualEndDateTime ?? plannedEnd,
    ),
  };
}

/**
 * Client charge window: normally planned start → actual end (booked start through departure).
 * When the visit ends before planned start (fully early), that would invert — bill actual worked time instead.
 */
export function resolveBillWindow(
  plannedStartDateTime: Date,
  plannedEndDateTime: Date,
  actualStartDateTime: Date | null,
  billEndCandidate: Date,
): { approvedBillStart: Date; approvedBillEnd: Date } {
  if (billEndCandidate.getTime() > plannedStartDateTime.getTime()) {
    return {
      approvedBillStart: plannedStartDateTime,
      approvedBillEnd: billEndCandidate,
    };
  }

  const actualStart = actualStartDateTime ?? plannedStartDateTime;
  if (billEndCandidate.getTime() > actualStart.getTime()) {
    return {
      approvedBillStart: actualStart,
      approvedBillEnd: billEndCandidate,
    };
  }

  // No usable actual span — fall back to the planned slot so charge can still be calculated.
  return {
    approvedBillStart: plannedStartDateTime,
    approvedBillEnd: plannedEndDateTime,
  };
}

export function isInvertedDateWindow(start: Date | null | undefined, end: Date | null | undefined): boolean {
  if (!start || !end) return false;
  return end.getTime() <= start.getTime();
}

export type PayCardRuleLike = {
  label?: string | null;
  rateType: string;
  amount: Prisma.Decimal | number;
  dayType: string;
  startTime?: string | null;
  endTime?: string | null;
  /** Prisma Decimal or number — callers normalize via Number() */
  multiplier?: Prisma.Decimal | number | null;
  additionalAmount?: Prisma.Decimal | number | null;
  percentageUplift?: Prisma.Decimal | number | null;
  enhancementMethod?: string | null;
  minimumMinutes?: number | null;
  priority: number;
  sortOrder: number;
  appliesToVisit?: boolean | null;
  appliesToTravel?: boolean | null;
};

export type ChargeCardRuleLike = {
  label?: string | null;
  chargeMethod: string;
  rateType: string;
  amount: Prisma.Decimal | number;
  dayType: string;
  startTime?: string | null;
  endTime?: string | null;
  multiplier?: Prisma.Decimal | number | null;
  additionalAmount?: Prisma.Decimal | number | null;
  percentageUplift?: Prisma.Decimal | number | null;
  enhancementMethod?: string | null;
  minimumMinutes?: number | null;
  priority: number;
  sortOrder: number;
  appliesToVisit?: boolean | null;
  appliesToTravel?: boolean | null;
};

export function resolveCalendarDayType(visitDate: Date): 'WEEKDAY' | 'SATURDAY' | 'SUNDAY' {
  return resolveBandCalendarDayType(visitDate);
}

const SPECIAL_DAY_RULE_TYPES = new Set(
  SPECIAL_DAY_PRIORITY.filter((d): d is Exclude<PaySpecialDay, 'NONE'> => d !== 'NONE'),
);

/**
 * Special days (bank holiday, Boxing Day, org day, …) are paid like normal £/hr periods.
 * When that calendar day occurs, matching special-day rules win; if none are configured,
 * weekday / Saturday / Sunday rules still apply as fallback.
 */
function dayTypeMatches(ruleDayType: string, visitDate: Date, isBankHoliday: boolean): boolean {
  if (ruleDayType === 'ANY') return true;

  const special = resolveSpecialDay(visitDate, { isBankHoliday });
  const calendar = resolveCalendarDayType(visitDate);

  if (special !== 'NONE') {
    if (ruleDayType === special) return true;
    // Named public holidays can fall back to a generic bank-holiday rate.
    if (ruleDayType === 'BANK_HOLIDAY' && special !== 'SPECIAL') return true;
    // Other special-day-only rules do not apply on this date.
    if (SPECIAL_DAY_RULE_TYPES.has(ruleDayType as Exclude<PaySpecialDay, 'NONE'>)) return false;
    // Fall back to the underlying weekday / weekend rate when no holiday rate is set.
    return ruleDayType === calendar;
  }

  if (SPECIAL_DAY_RULE_TYPES.has(ruleDayType as Exclude<PaySpecialDay, 'NONE'>)) return false;
  return ruleDayType === calendar;
}

/** Visits up to 60 minutes use fixed duration slots; longer visits use hourly rules. */
export const MAX_FIXED_VISIT_MINUTES = 60;

const NON_VISIT_RATE_TYPES = new Set([
  'MILEAGE',
  'TRAVEL_TIME',
  'WAITING_TIME',
  'PREMIUM',
  'UPLIFT',
  'DEDUCTION',
  'PER_VISIT_FEE',
]);

type RuleWithOptionalTime = PayCardRuleLike & {
  startTime?: string | null;
  endTime?: string | null;
};

function isFixedVisitSlotRule(rule: PayCardRuleLike): boolean {
  return (
    rule.rateType === 'FIXED'
    && rule.minimumMinutes != null
    && rule.minimumMinutes > 0
    && rule.minimumMinutes <= MAX_FIXED_VISIT_MINUTES
  );
}

function isHourlyLongVisitRule(rule: RuleWithOptionalTime): boolean {
  if (NON_VISIT_RATE_TYPES.has(rule.rateType)) return false;
  // Windowed bands are applied via calculateBandedPay — exclude from single-rule picker.
  if (rule.startTime || rule.endTime) return false;
  if (rule.rateType === 'HOURLY' || rule.rateType === 'BANDED') return true;
  const chargeRule = rule as ChargeCardRuleLike;
  return chargeRule.chargeMethod === 'HOURLY_PRO_RATA';
}

function toTimeBandRules(rules: PayCardRuleLike[]): TimeBandRule[] {
  return rules.map((rule) => ({
    label: rule.label,
    dayType: rule.dayType,
    startTime: rule.startTime,
    endTime: rule.endTime,
    rateType: rule.rateType,
    amount: Number(rule.amount),
    multiplier: rule.multiplier != null ? Number(rule.multiplier) : null,
    additionalAmount: rule.additionalAmount != null ? Number(rule.additionalAmount) : null,
    percentageUplift: rule.percentageUplift != null ? Number(rule.percentageUplift) : null,
    enhancementMethod: rule.enhancementMethod as TimeBandRule['enhancementMethod'],
    minimumMinutes: rule.minimumMinutes,
    priority: rule.priority,
    sortOrder: rule.sortOrder,
    appliesToVisit: rule.appliesToVisit ?? true,
    appliesToTravel: rule.appliesToTravel ?? false,
  }));
}

function sortRuleCandidates<T extends RuleWithOptionalTime>(candidates: T[]): T | null {
  return [...candidates].sort((a, b) => {
    const aWindow = a.startTime?.trim() || a.endTime?.trim() ? 1 : 0;
    const bWindow = b.startTime?.trim() || b.endTime?.trim() ? 1 : 0;
    if (aWindow !== bWindow) return bWindow - aWindow;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.sortOrder - b.sortOrder;
  })[0] ?? null;
}

function ruleMatchesVisitClock(rule: RuleWithOptionalTime, visitDate: Date): boolean {
  const start = rule.startTime?.trim() || null;
  const end = rule.endTime?.trim() || null;
  if (!start && !end) return true;
  const minuteOfDay = visitDate.getUTCHours() * 60 + visitDate.getUTCMinutes();
  return minuteInTimeBand(minuteOfDay, start, end);
}

/** Exact fixed duration slot only — no nearest-slot fallback (use hourly pro-rata instead). */
function pickBestRule<T extends RuleWithOptionalTime>(
  rules: T[],
  visitDate: Date,
  visitMinutes: number,
  isBankHoliday = false,
): T | null {
  if (!rules.length || visitMinutes <= 0) return null;

  const dayMatches = rules.filter((rule) => dayTypeMatches(rule.dayType, visitDate, isBankHoliday));
  if (!dayMatches.length) return null;

  if (visitMinutes <= MAX_FIXED_VISIT_MINUTES) {
    const fixedSlots = dayMatches
      .filter((rule) => isFixedVisitSlotRule(rule))
      .filter((rule) => ruleMatchesVisitClock(rule, visitDate));
    const exactFixed = fixedSlots.filter((rule) => rule.minimumMinutes === visitMinutes);
    if (exactFixed.length) return sortRuleCandidates(exactFixed);

    // No exact fixed slot — fall back to hourly (banded pro-rata when a time window is provided).
    return sortRuleCandidates(dayMatches.filter((rule) => isHourlyLongVisitRule(rule)));
  }

  return sortRuleCandidates(dayMatches.filter((rule) => isHourlyLongVisitRule(rule)));
}

export type PayableAmountResult = {
  amount: number;
  label: string;
  explanation?: string;
  segments?: Array<{
    minutes: number;
    rate: number;
    amount: number;
    explanation: string;
    startLabel?: string;
    endLabel?: string;
    ruleLabel?: string | null;
    hoursLabel?: string;
    lineFormula?: string;
  }>;
};

/**
 * Calculate visit pay. When `window` is provided and the card has time-banded hourly rules,
 * the activity is split across bands; otherwise a single day-type rule is used (legacy path).
 */
export function calculatePayableAmount(
  rules: PayCardRuleLike[],
  visitDate: Date,
  minutes: number,
  isBankHoliday = false,
  window?: {
    start: Date;
    end: Date;
    stackingPolicy?: PayStackingPolicy;
    isBankHolidayFn?: (d: Date) => boolean;
  },
): PayableAmountResult | null {
  if (minutes <= 0) return null;

  const bandRules = toTimeBandRules(rules);

  // Both (fixed + hourly): visits ≤ 1 hour use an exact fixed duration slot when present.
  // Otherwise use hourly pro-rata (time-banded when a window is provided).
  if (minutes <= MAX_FIXED_VISIT_MINUTES) {
    const fixed = pickBestRule(rules, visitDate, minutes, isBankHoliday);
    if (fixed && (fixed.rateType === 'FIXED' || fixed.rateType === 'PER_VISIT_FEE')) {
      return { amount: Number(fixed.amount), label: fixed.rateType };
    }
  }

  const preferBanded = Boolean(window) && shouldPreferBandedOverFixed(bandRules);

  if (window && (preferBanded || hasTimeBandedHourlyRules(bandRules))) {
    const end =
      window.end.getTime() > window.start.getTime()
        ? window.end
        : new Date(window.start.getTime() + minutes * 60_000);
    const banded = calculateBandedPay({
      start: window.start,
      end,
      rules: bandRules,
      stackingPolicy: window.stackingPolicy ?? 'PRIORITY',
      isBankHolidayFn:
        window.isBankHolidayFn ??
        ((d) => {
          if (!isBankHoliday) return false;
          return (
            d.getUTCFullYear() === visitDate.getUTCFullYear() &&
            d.getUTCMonth() === visitDate.getUTCMonth() &&
            d.getUTCDate() === visitDate.getUTCDate()
          );
        }),
    });
    if (banded) {
      return {
        amount: banded.totalAmount,
        label: 'BANDED_HOURLY',
        explanation: banded.explanation,
        segments: banded.segments.map((s) => {
          const hoursLabel = formatMinutesAsHours(s.segment.minutes);
          const rateLabel = formatGbp(s.appliedHourlyRate);
          return {
            minutes: s.segment.minutes,
            rate: s.appliedHourlyRate,
            amount: s.amount,
            explanation: s.explanation,
            startLabel: formatHhMmUtc(s.segment.start),
            endLabel: formatHhMmUtc(s.segment.end),
            ruleLabel: s.ruleLabel,
            hoursLabel,
            lineFormula: `${hoursLabel} × ${rateLabel}/hr = ${formatGbp(s.amount)}`,
          };
        }),
      };
    }
  }

  if (minutes <= MAX_FIXED_VISIT_MINUTES) {
    const fixed = pickBestRule(rules, visitDate, minutes, isBankHoliday);
    if (fixed && (fixed.rateType === 'FIXED' || fixed.rateType === 'PER_VISIT_FEE')) {
      return { amount: Number(fixed.amount), label: fixed.rateType };
    }
  }

  const rule = pickBestRule(rules, visitDate, minutes, isBankHoliday);
  if (!rule) return null;
  const amount = Number(rule.amount);
  if (rule.rateType === 'FIXED' || rule.rateType === 'PER_VISIT_FEE') {
    return { amount, label: rule.rateType };
  }
  const hourly = amount * (minutes / 60);
  return { amount: Math.round(hourly * 100) / 100, label: 'HOURLY' };
}

function isNightDutyChargeMethod(chargeMethod?: string | null): boolean {
  return chargeMethod === 'SLEEP_IN' || chargeMethod === 'WAKING_NIGHT';
}

function pickNightDutyChargeRule(
  rules: ChargeCardRuleLike[],
  chargeMethod: 'SLEEP_IN' | 'WAKING_NIGHT',
  visitDate: Date,
  isBankHoliday: boolean,
): ChargeCardRuleLike | null {
  const matches = rules.filter(
    (rule) =>
      rule.chargeMethod === chargeMethod && dayTypeMatches(rule.dayType, visitDate, isBankHoliday),
  );
  if (!matches.length) return null;
  const dayTypeRank = (dayType: string): number => {
    switch (dayType) {
      case 'ANY':
        return 0;
      case 'WEEKDAY':
        return 10;
      case 'SATURDAY':
        return 20;
      case 'SUNDAY':
        return 30;
      case 'BANK_HOLIDAY':
        return 100;
      case 'SPECIAL':
        return 105;
      case 'EASTER':
        return 108;
      case 'CHRISTMAS':
      case 'BOXING_DAY':
      case 'NEW_YEAR':
        return 110;
      default:
        return 0;
    }
  };
  return [...matches].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa;
    const ra = dayTypeRank(a.dayType);
    const rb = dayTypeRank(b.dayType);
    if (ra !== rb) return rb - ra;
    return a.sortOrder - b.sortOrder;
  })[0] ?? null;
}

export function calculateBillableAmount(
  rules: ChargeCardRuleLike[],
  visitDate: Date,
  minutes: number,
  defaultChargeMethod: string,
  isBankHoliday = false,
  window?: {
    start: Date;
    end: Date;
    stackingPolicy?: PayStackingPolicy;
    isBankHolidayFn?: (d: Date) => boolean;
  },
  nightDuty?: string | null,
): PayableAmountResult | null {
  if (minutes <= 0) return null;

  if (nightDuty === 'SLEEPING_NIGHT') {
    const rule = pickNightDutyChargeRule(rules, 'SLEEP_IN', visitDate, isBankHoliday);
    if (!rule) return null;
    return { amount: Number(rule.amount), label: 'SLEEP_IN' };
  }
  if (nightDuty === 'WAKING_NIGHT') {
    const rule = pickNightDutyChargeRule(rules, 'WAKING_NIGHT', visitDate, isBankHoliday);
    if (!rule) return null;
    const hourly = Number(rule.amount) * (minutes / 60);
    return { amount: Math.round(hourly * 100) / 100, label: 'WAKING_NIGHT' };
  }

  const dayRules = rules.filter((rule) => !isNightDutyChargeMethod(rule.chargeMethod));

  // Reuse pay engine (fixed slots + time-banded hourly) then map labels to charge methods.
  const asPayRules: PayCardRuleLike[] = dayRules.map((rule) => ({
    label: rule.label,
    rateType: rule.rateType,
    amount: rule.amount,
    dayType: rule.dayType,
    startTime: rule.startTime,
    endTime: rule.endTime,
    multiplier: rule.multiplier,
    additionalAmount: rule.additionalAmount,
    percentageUplift: rule.percentageUplift,
    enhancementMethod: rule.enhancementMethod ?? 'ABSOLUTE_HOURLY',
    minimumMinutes: rule.minimumMinutes,
    priority: rule.priority,
    sortOrder: rule.sortOrder,
    appliesToVisit: rule.appliesToVisit ?? true,
    appliesToTravel: rule.appliesToTravel ?? false,
  }));

  const calc = calculatePayableAmount(asPayRules, visitDate, minutes, isBankHoliday, window);
  if (!calc) return null;

  if (calc.label === 'BANDED_HOURLY') {
    return { ...calc, label: 'HOURLY_PRO_RATA' };
  }
  if (calc.label === 'FIXED' || calc.label === 'PER_VISIT_FEE') {
    return { ...calc, label: 'FIXED_VISIT' };
  }
  if (calc.label === 'HOURLY') {
    return { ...calc, label: defaultChargeMethod === 'FIXED_VISIT' ? 'HOURLY_PRO_RATA' : defaultChargeMethod };
  }
  return calc;
}

export function formatMinutesAsHours(minutes: number): string {
  if (minutes <= 0) return '0 hrs';
  const hrs = minutes / 60;
  if (minutes % 60 === 0) return `${hrs.toFixed(0)} hrs`;
  return `${hrs.toFixed(2)} hrs`;
}

function pickSupplementRule<T extends PayCardRuleLike>(
  rules: T[],
  rateType: 'MILEAGE' | 'TRAVEL_TIME' | 'WAITING_TIME',
  visitDate: Date,
  isBankHoliday = false,
): T | null {
  const matches = rules.filter(
    (rule) => rule.rateType === rateType && dayTypeMatches(rule.dayType, visitDate, isBankHoliday),
  );
  if (!matches.length) return null;
  return [...matches].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.sortOrder - b.sortOrder;
  })[0] ?? null;
}

export function calculateMileageAmount(
  rules: PayCardRuleLike[],
  visitDate: Date,
  miles: number,
  isBankHoliday = false,
): { amount: number; unitRate: number; ruleLabel: string | null } | null {
  if (miles <= 0) return null;
  const rule = pickSupplementRule(rules, 'MILEAGE', visitDate, isBankHoliday);
  if (!rule) return null;
  const unitRate = Number(rule.amount);
  return {
    amount: Math.round(unitRate * miles * 100) / 100,
    unitRate,
    ruleLabel: rule.label ?? null,
  };
}

export function calculateTravelTimeAmount(
  rules: PayCardRuleLike[],
  visitDate: Date,
  travelMinutes: number,
  isBankHoliday = false,
): { amount: number; unitRate: number; ruleLabel: string | null } | null {
  if (travelMinutes <= 0) return null;
  const rule = pickSupplementRule(rules, 'TRAVEL_TIME', visitDate, isBankHoliday);
  if (!rule) return null;
  const unitRate = Number(rule.amount);
  return {
    amount: Math.round(unitRate * (travelMinutes / 60) * 100) / 100,
    unitRate,
    ruleLabel: rule.label ?? null,
  };
}

export function calculateWaitingTimeAmount(
  rules: PayCardRuleLike[],
  visitDate: Date,
  waitingMinutes: number,
  isBankHoliday = false,
): { amount: number; unitRate: number; ruleLabel: string | null } | null {
  if (waitingMinutes <= 0) return null;
  const rule = pickSupplementRule(rules, 'WAITING_TIME', visitDate, isBankHoliday);
  if (!rule) return null;
  const unitRate = Number(rule.amount);
  return {
    amount: Math.round(unitRate * (waitingMinutes / 60) * 100) / 100,
    unitRate,
    ruleLabel: rule.label ?? null,
  };
}

export type AppliedRateRule = {
  label: string;
  rateType: string;
  rateTypeLabel: string;
  dayType: string | null;
  dayTypeLabel: string | null;
  timeWindow: string | null;
  unitRate: string | null;
  amount: string | null;
  /** One-line summary for UI (e.g. "45-minute fixed · Any day · £33.20"). */
  detail: string;
};

export type RateBreakdown = {
  minutes: number;
  hoursLabel: string;
  rateType: string;
  unitRate: string | null;
  amount: string | null;
  formula: string;
  cardName: string | null;
  cardCode: string | null;
  cardSource: string | null;
  ruleLabel: string | null;
  appliedRules?: AppliedRateRule[];
  segments?: Array<{
    startLabel: string;
    endLabel: string;
    hoursLabel: string;
    minutes: number;
    unitRate: string;
    ruleLabel: string | null;
    lineFormula: string;
    amount: string;
  }>;
};

function formatGbp(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

function formatDayTypeLabel(dayType: string | null | undefined): string | null {
  if (!dayType) return null;
  const map: Record<string, string> = {
    ANY: 'Any day',
    WEEKDAY: 'Weekday',
    SATURDAY: 'Saturday',
    SUNDAY: 'Sunday',
    BANK_HOLIDAY: 'Bank holiday',
    SPECIAL: 'Organisation special day',
    CHRISTMAS: 'Christmas Day',
    BOXING_DAY: 'Boxing Day',
    NEW_YEAR: "New Year's Day",
    EASTER: 'Easter holiday',
  };
  return map[dayType] ?? dayType.replace(/_/g, ' ').toLowerCase();
}

function formatRuleTimeWindow(
  startTime?: string | null,
  endTime?: string | null,
): string | null {
  const start = startTime?.trim() || null;
  const end = endTime?.trim() || null;
  if (!start && !end) return null;
  if (start && end) {
    if (start === '00:00' && (end === '23:59' || end === '24:00')) return 'All day';
    return `${start}–${end}`;
  }
  return start ?? end;
}

function rateTypeDisplayLabel(
  rateType: string,
  minimumMinutes?: number | null,
): string {
  if (rateType === 'FIXED' || rateType === 'FIXED_VISIT' || rateType === 'PER_VISIT_FEE') {
    return minimumMinutes != null && minimumMinutes > 0
      ? `${minimumMinutes}-minute fixed visit`
      : 'Fixed visit';
  }
  if (rateType === 'HOURLY' || rateType === 'HOURLY_PRO_RATA') return 'Hourly (£/hr)';
  if (rateType === 'BANDED' || rateType === 'BANDED_HOURLY') return 'Time-banded hourly';
  if (rateType === 'SLEEP_IN') return 'Sleeping night';
  if (rateType === 'WAKING_NIGHT') return 'Waking night';
  if (rateType === 'PREMIUM') return 'Premium';
  if (rateType === 'UPLIFT') return 'Uplift';
  return rateType.replace(/_/g, ' ');
}

function buildAppliedRuleFromPick(
  rule: {
    label?: string | null;
    rateType: string;
    dayType?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    minimumMinutes?: number | null;
    amount?: unknown;
  },
  opts: {
    rateTypeOverride?: string;
    unitRate: string | null;
    amount: string | null;
  },
): AppliedRateRule {
  const rateType = opts.rateTypeOverride ?? rule.rateType;
  const rateTypeLabel = rateTypeDisplayLabel(rateType, rule.minimumMinutes);
  const dayType = rule.dayType ?? null;
  const dayTypeLabel = formatDayTypeLabel(dayType);
  const timeWindow = formatRuleTimeWindow(rule.startTime, rule.endTime);
  const label =
    rule.label?.trim() ||
    (rule.minimumMinutes != null && rule.minimumMinutes > 0
      ? `${rule.minimumMinutes} minute visit`
      : rateTypeLabel);
  const parts = [rateTypeLabel];
  if (dayTypeLabel) parts.push(dayTypeLabel);
  if (timeWindow) parts.push(timeWindow);
  if (opts.unitRate) parts.push(opts.unitRate);
  return {
    label,
    rateType,
    rateTypeLabel,
    dayType,
    dayTypeLabel,
    timeWindow,
    unitRate: opts.unitRate,
    amount: opts.amount,
    detail: parts.join(' · '),
  };
}

export function buildPayRateBreakdown(
  rules: PayCardRuleLike[],
  visitDate: Date,
  minutes: number,
  meta?: {
    cardName?: string | null;
    cardCode?: string | null;
    cardSource?: string | null;
    currency?: string;
  },
  isBankHoliday = false,
  window?: { start: Date; end: Date; stackingPolicy?: PayStackingPolicy },
): RateBreakdown | null {
  if (minutes <= 0) return null;

  const calc = calculatePayableAmount(rules, visitDate, minutes, isBankHoliday, window);
  if (!calc) return null;

  const hoursLabel = formatMinutesAsHours(minutes);

  if (calc.label === 'BANDED_HOURLY' && calc.segments?.length) {
    const rates = [...new Set(calc.segments.map((s) => s.rate))];
    const unitRate =
      rates.length === 1 ? formatGbp(rates[0]) + '/hr' : 'Varies by time band';
    const bandCount = calc.segments.length;
    const segments = calc.segments.map((s) => ({
      startLabel: s.startLabel ?? '',
      endLabel: s.endLabel ?? '',
      hoursLabel: s.hoursLabel ?? formatMinutesAsHours(s.minutes),
      minutes: s.minutes,
      unitRate: `${formatGbp(s.rate)}/hr`,
      ruleLabel: s.ruleLabel ?? null,
      lineFormula:
        s.lineFormula ??
        `${formatMinutesAsHours(s.minutes)} × ${formatGbp(s.rate)}/hr = ${formatGbp(s.amount)}`,
      amount: formatGbp(s.amount),
    }));
    return {
      minutes,
      hoursLabel,
      rateType: 'BANDED_HOURLY',
      unitRate,
      amount: formatGbp(calc.amount),
      formula: `${hoursLabel} across ${bandCount} time band${bandCount === 1 ? '' : 's'} = ${formatGbp(calc.amount)}`,
      cardName: meta?.cardName ?? null,
      cardCode: meta?.cardCode ?? null,
      cardSource: meta?.cardSource ?? null,
      ruleLabel: 'Time-band split',
      appliedRules: segments.map((s) => ({
        label: s.ruleLabel?.trim() || `${s.startLabel}–${s.endLabel}`,
        rateType: 'BANDED_HOURLY',
        rateTypeLabel: 'Time-banded hourly',
        dayType: null,
        dayTypeLabel: null,
        timeWindow: `${s.startLabel}–${s.endLabel}`,
        unitRate: s.unitRate,
        amount: s.amount,
        detail: `${s.ruleLabel?.trim() || 'Hourly band'} · ${s.startLabel}–${s.endLabel} · ${s.unitRate}`,
      })),
      segments,
    };
  }

  const rule = pickBestRule(rules, visitDate, minutes, isBankHoliday);
  if (!rule) return null;

  const unitAmount = Number(rule.amount);
  const ruleLabel = rule.label ?? null;

  if (calc.label === 'FIXED' || calc.label === 'PER_VISIT_FEE') {
    const slotMinutes = rule.minimumMinutes;
    const durationSuffix =
      slotMinutes != null && slotMinutes > 0
        ? ` for ${slotMinutes}-minute visit`
        : ' per visit';
    const unitRate = formatGbp(unitAmount);
    const amount = formatGbp(calc.amount);
    const applied = buildAppliedRuleFromPick(rule, {
      rateTypeOverride: calc.label,
      unitRate,
      amount,
    });
    return {
      minutes,
      hoursLabel,
      rateType: calc.label,
      unitRate,
      amount,
      formula: `${formatGbp(unitAmount)}${durationSuffix}`,
      cardName: meta?.cardName ?? null,
      cardCode: meta?.cardCode ?? null,
      cardSource: meta?.cardSource ?? null,
      ruleLabel: ruleLabel ?? applied.label,
      appliedRules: [applied],
    };
  }

  const unitRate = `${formatGbp(unitAmount)}/hr`;
  const amount = formatGbp(calc.amount);
  const applied = buildAppliedRuleFromPick(rule, {
    rateTypeOverride: 'HOURLY',
    unitRate,
    amount,
  });
  return {
    minutes,
    hoursLabel,
    rateType: 'HOURLY',
    unitRate,
    amount,
    formula: `${hoursLabel} × ${formatGbp(unitAmount)}/hr = ${formatGbp(calc.amount)}`,
    cardName: meta?.cardName ?? null,
    cardCode: meta?.cardCode ?? null,
    cardSource: meta?.cardSource ?? null,
    ruleLabel: ruleLabel ?? applied.label,
    appliedRules: [applied],
  };
}

export function buildChargeRateBreakdown(
  rules: ChargeCardRuleLike[],
  visitDate: Date,
  minutes: number,
  defaultChargeMethod: string,
  meta?: {
    cardName?: string | null;
    cardCode?: string | null;
    cardSource?: string | null;
  },
  isBankHoliday = false,
  window?: { start: Date; end: Date; stackingPolicy?: PayStackingPolicy },
  nightDuty?: string | null,
): RateBreakdown | null {
  if (minutes <= 0) return null;

  const calc = calculateBillableAmount(
    rules,
    visitDate,
    minutes,
    defaultChargeMethod,
    isBankHoliday,
    window,
    nightDuty,
  );
  if (!calc) return null;

  const hoursLabel = formatMinutesAsHours(minutes);

  if (calc.label === 'SLEEP_IN') {
    const rule = pickNightDutyChargeRule(rules, 'SLEEP_IN', visitDate, isBankHoliday);
    const unitAmount = Number(rule?.amount ?? calc.amount);
    const unitRate = formatGbp(unitAmount);
    const amount = formatGbp(calc.amount);
    const applied = buildAppliedRuleFromPick(
      {
        label: rule?.label ?? 'Sleeping night',
        rateType: 'SLEEP_IN',
        dayType: rule?.dayType,
        startTime: null,
        endTime: null,
        minimumMinutes: null,
        amount: unitAmount,
      },
      { unitRate, amount },
    );
    return {
      minutes,
      hoursLabel,
      rateType: 'SLEEP_IN',
      unitRate,
      amount,
      formula: `${formatGbp(unitAmount)} per sleeping night`,
      cardName: meta?.cardName ?? null,
      cardCode: meta?.cardCode ?? null,
      cardSource: meta?.cardSource ?? null,
      ruleLabel: rule?.label ?? 'Sleeping night',
      appliedRules: [applied],
    };
  }
  if (calc.label === 'WAKING_NIGHT') {
    const rule = pickNightDutyChargeRule(rules, 'WAKING_NIGHT', visitDate, isBankHoliday);
    const unitAmount = Number(rule?.amount ?? 0);
    const unitRate = `${formatGbp(unitAmount)}/hr`;
    const amount = formatGbp(calc.amount);
    const applied = buildAppliedRuleFromPick(
      {
        label: rule?.label ?? 'Waking night',
        rateType: 'WAKING_NIGHT',
        dayType: rule?.dayType,
        startTime: null,
        endTime: null,
        minimumMinutes: null,
        amount: unitAmount,
      },
      { unitRate, amount },
    );
    return {
      minutes,
      hoursLabel,
      rateType: 'WAKING_NIGHT',
      unitRate,
      amount,
      formula: `${hoursLabel} × ${formatGbp(unitAmount)}/hr = ${formatGbp(calc.amount)}`,
      cardName: meta?.cardName ?? null,
      cardCode: meta?.cardCode ?? null,
      cardSource: meta?.cardSource ?? null,
      ruleLabel: rule?.label ?? 'Waking night',
      appliedRules: [applied],
    };
  }

  if (calc.segments?.length) {
    const rates = [...new Set(calc.segments.map((s) => s.rate))];
    const unitRate =
      rates.length === 1 ? formatGbp(rates[0]) + '/hr' : 'Varies by time band';
    const bandCount = calc.segments.length;
    const segments = calc.segments.map((s) => ({
      startLabel: s.startLabel ?? '',
      endLabel: s.endLabel ?? '',
      hoursLabel: s.hoursLabel ?? formatMinutesAsHours(s.minutes),
      minutes: s.minutes,
      unitRate: `${formatGbp(s.rate)}/hr`,
      ruleLabel: s.ruleLabel ?? null,
      lineFormula:
        s.lineFormula ??
        `${formatMinutesAsHours(s.minutes)} × ${formatGbp(s.rate)}/hr = ${formatGbp(s.amount)}`,
      amount: formatGbp(s.amount),
    }));
    return {
      minutes,
      hoursLabel,
      rateType: 'BANDED_HOURLY',
      unitRate,
      amount: formatGbp(calc.amount),
      formula: `${hoursLabel} across ${bandCount} time band${bandCount === 1 ? '' : 's'} = ${formatGbp(calc.amount)}`,
      cardName: meta?.cardName ?? null,
      cardCode: meta?.cardCode ?? null,
      cardSource: meta?.cardSource ?? null,
      ruleLabel: 'Time-band split',
      appliedRules: segments.map((s) => ({
        label: s.ruleLabel?.trim() || `${s.startLabel}–${s.endLabel}`,
        rateType: 'BANDED_HOURLY',
        rateTypeLabel: 'Time-banded hourly',
        dayType: null,
        dayTypeLabel: null,
        timeWindow: `${s.startLabel}–${s.endLabel}`,
        unitRate: s.unitRate,
        amount: s.amount,
        detail: `${s.ruleLabel?.trim() || 'Hourly band'} · ${s.startLabel}–${s.endLabel} · ${s.unitRate}`,
      })),
      segments,
    };
  }

  const asPayRules: PayCardRuleLike[] = rules.map((rule) => ({
    label: rule.label,
    rateType: rule.rateType,
    amount: rule.amount,
    dayType: rule.dayType,
    startTime: rule.startTime,
    endTime: rule.endTime,
    multiplier: rule.multiplier,
    minimumMinutes: rule.minimumMinutes,
    priority: rule.priority,
    sortOrder: rule.sortOrder,
  }));
  const rule = pickBestRule(asPayRules, visitDate, minutes, isBankHoliday);
  if (!rule) return null;

  const unitAmount = Number(rule.amount);
  const ruleLabel = rule.label ?? null;

  if (calc.label === 'FIXED_VISIT' || calc.label === 'FIXED') {
    const slotMinutes = rule.minimumMinutes;
    const durationSuffix =
      slotMinutes != null && slotMinutes > 0
        ? ` for ${slotMinutes}-minute visit`
        : ' per visit';
    const unitRate = formatGbp(unitAmount);
    const amount = formatGbp(calc.amount);
    const applied = buildAppliedRuleFromPick(rule, {
      rateTypeOverride: 'FIXED_VISIT',
      unitRate,
      amount,
    });
    return {
      minutes,
      hoursLabel,
      rateType: calc.label,
      unitRate,
      amount,
      formula: `${formatGbp(unitAmount)}${durationSuffix}`,
      cardName: meta?.cardName ?? null,
      cardCode: meta?.cardCode ?? null,
      cardSource: meta?.cardSource ?? null,
      ruleLabel: ruleLabel ?? applied.label,
      appliedRules: [applied],
    };
  }

  const unitRate = `${formatGbp(unitAmount)}/hr`;
  const amount = formatGbp(calc.amount);
  const applied = buildAppliedRuleFromPick(rule, {
    rateTypeOverride: calc.label,
    unitRate,
    amount,
  });
  return {
    minutes,
    hoursLabel,
    rateType: calc.label,
    unitRate,
    amount,
    formula: `${hoursLabel} × ${formatGbp(unitAmount)}/hr = ${formatGbp(calc.amount)}`,
    cardName: meta?.cardName ?? null,
    cardCode: meta?.cardCode ?? null,
    cardSource: meta?.cardSource ?? null,
    ruleLabel: ruleLabel ?? applied.label,
    appliedRules: [applied],
  };
}
