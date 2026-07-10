import {
  BillingCardStatus,
  FinanceExceptionCode,
  Prisma,
  ScheduledVisitStatus,
  VisitReconciliationStatus,
} from '@prisma/client';
import { assessFundingBillingReadiness } from './funding-contract.util';

export type DetectedException = {
  code: FinanceExceptionCode;
  message: string;
};

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

const MANAGER_REVIEW_CODES = new Set<FinanceExceptionCode>([
  FinanceExceptionCode.OVERRUN,
  FinanceExceptionCode.UNDERRUN,
  FinanceExceptionCode.GPS_MISMATCH,
]);

export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

export function formatVisitRef(visitId: string, plannedStart: Date): string {
  const y = plannedStart.getUTCFullYear();
  const m = String(plannedStart.getUTCMonth() + 1).padStart(2, '0');
  const suffix = visitId.replace(/-/g, '').slice(0, 4).toUpperCase();
  return `V-${y}-${m}-${suffix}`;
}

/** Format HH:mm–HH:mm using UTC wall clock (matches scheduling rota / complete-visit UI). */
export function formatTimeRange(
  start: Date | null | undefined,
  end: Date | null | undefined,
): string {
  if (!start && !end) return '—';
  const fmt = (d: Date) => {
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };
  if (start && end) return `${fmt(start)}–${fmt(end)}`;
  if (start) return `${fmt(start)}–—`;
  return `—–${fmt(end!)}`;
}

export function formatDateOnly(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

type VisitSnapshot = {
  status: ScheduledVisitStatus;
  plannedStartDateTime: Date;
  plannedEndDateTime: Date | null;
  actualStartDateTime: Date | null;
  actualEndDateTime: Date | null;
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
    if (actualMinutes > plannedMinutes + 5) {
      exceptions.push({
        code: FinanceExceptionCode.OVERRUN,
        message: `Actual duration (${actualMinutes} min) exceeds planned (${plannedMinutes} min)`,
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

  if (exceptions.some((e) => BLOCKING_EXCEPTION_CODES.has(e.code))) {
    return VisitReconciliationStatus.PENDING_REVIEW;
  }
  if (exceptions.some((e) => MANAGER_REVIEW_CODES.has(e.code))) {
    return VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL;
  }
  return VisitReconciliationStatus.PENDING_REVIEW;
}

export function hasUnresolvedBlockingExceptions(exceptions: DetectedException[]): boolean {
  return exceptions.some((e) => BLOCKING_EXCEPTION_CODES.has(e.code));
}

export function resolveDefaultApprovedWindows(input: {
  plannedStartDateTime: Date;
  plannedEndDateTime: Date | null;
  actualStartDateTime: Date | null;
  actualEndDateTime: Date | null;
  exceptions: DetectedException[];
}): {
  approvedPayStart: Date;
  approvedPayEnd: Date;
  approvedBillStart: Date;
  approvedBillEnd: Date;
} {
  const { plannedStartDateTime, plannedEndDateTime, actualStartDateTime, actualEndDateTime, exceptions } =
    input;
  const plannedEnd =
    plannedEndDateTime ??
    new Date(plannedStartDateTime.getTime() + 30 * 60_000);

  const payStart = actualStartDateTime ?? plannedStartDateTime;
  const payEnd = actualEndDateTime ?? plannedEnd;

  const hasOverrun = exceptions.some((e) => e.code === FinanceExceptionCode.OVERRUN);
  const billStart = plannedStartDateTime;
  const billEnd = hasOverrun ? plannedEnd : (actualEndDateTime ?? plannedEnd);

  return {
    approvedPayStart: payStart,
    approvedPayEnd: payEnd,
    approvedBillStart: billStart,
    approvedBillEnd: billEnd,
  };
}

export type PayCardRuleLike = {
  label?: string | null;
  rateType: string;
  amount: Prisma.Decimal | number;
  dayType: string;
  minimumMinutes?: number | null;
  priority: number;
  sortOrder: number;
};

export type ChargeCardRuleLike = {
  label?: string | null;
  chargeMethod: string;
  rateType: string;
  amount: Prisma.Decimal | number;
  dayType: string;
  minimumMinutes?: number | null;
  priority: number;
  sortOrder: number;
};

export function resolveCalendarDayType(visitDate: Date): 'WEEKDAY' | 'SATURDAY' | 'SUNDAY' {
  const day = visitDate.getUTCDay();
  if (day === 0) return 'SUNDAY';
  if (day === 6) return 'SATURDAY';
  return 'WEEKDAY';
}

function dayTypeMatches(ruleDayType: string, visitDate: Date, isBankHoliday: boolean): boolean {
  if (ruleDayType === 'ANY') return true;
  if (isBankHoliday) return ruleDayType === 'BANK_HOLIDAY';
  if (ruleDayType === 'BANK_HOLIDAY') return false;
  return ruleDayType === resolveCalendarDayType(visitDate);
}

function pickBestRule<T extends PayCardRuleLike>(
  rules: T[],
  visitDate: Date,
  visitMinutes: number,
  isBankHoliday = false,
): T | null {
  if (!rules.length || visitMinutes <= 0) return null;

  const dayMatches = rules.filter((rule) => dayTypeMatches(rule.dayType, visitDate, isBankHoliday));
  if (!dayMatches.length) return null;

  const exactDuration = dayMatches.filter(
    (rule) => rule.minimumMinutes != null && rule.minimumMinutes > 0 && rule.minimumMinutes === visitMinutes,
  );
  const anyDuration = dayMatches.filter(
    (rule) => rule.minimumMinutes == null || rule.minimumMinutes <= 0,
  );

  const pool = exactDuration.length ? exactDuration : anyDuration;
  if (!pool.length) return null;

  return [...pool].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.sortOrder - b.sortOrder;
  })[0] ?? null;
}

export function calculatePayableAmount(
  rules: PayCardRuleLike[],
  visitDate: Date,
  minutes: number,
  isBankHoliday = false,
): { amount: number; label: string } | null {
  const rule = pickBestRule(rules, visitDate, minutes, isBankHoliday);
  if (!rule || minutes <= 0) return null;
  const amount = Number(rule.amount);
  if (rule.rateType === 'FIXED' || rule.rateType === 'PER_VISIT_FEE') {
    return { amount, label: rule.rateType };
  }
  const hourly = amount * (minutes / 60);
  return { amount: Math.round(hourly * 100) / 100, label: 'HOURLY' };
}

export function calculateBillableAmount(
  rules: ChargeCardRuleLike[],
  visitDate: Date,
  minutes: number,
  defaultChargeMethod: string,
  isBankHoliday = false,
): { amount: number; label: string } | null {
  const rule = pickBestRule(rules, visitDate, minutes, isBankHoliday);
  if (!rule || minutes <= 0) return null;
  const amount = Number(rule.amount);
  const method = rule.chargeMethod || defaultChargeMethod;
  if (method === 'FIXED_VISIT' || rule.rateType === 'FIXED') {
    return { amount, label: method };
  }
  const hourly = amount * (minutes / 60);
  return { amount: Math.round(hourly * 100) / 100, label: method };
}

export function formatMinutesAsHours(minutes: number): string {
  if (minutes <= 0) return '0 hrs';
  const hrs = minutes / 60;
  if (minutes % 60 === 0) return `${hrs.toFixed(0)} hrs`;
  return `${hrs.toFixed(2)} hrs`;
}

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
};

function formatGbp(amount: number): string {
  return `£${amount.toFixed(2)}`;
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
): RateBreakdown | null {
  if (minutes <= 0) return null;
  const rule = pickBestRule(rules, visitDate, minutes, isBankHoliday);
  if (!rule) return null;

  const unitAmount = Number(rule.amount);
  const calc = calculatePayableAmount(rules, visitDate, minutes, isBankHoliday);
  if (!calc) return null;

  const hoursLabel = formatMinutesAsHours(minutes);
  const ruleLabel = rule.label ?? null;

  if (calc.label === 'FIXED' || calc.label === 'PER_VISIT_FEE') {
    return {
      minutes,
      hoursLabel,
      rateType: calc.label,
      unitRate: formatGbp(unitAmount),
      amount: formatGbp(calc.amount),
      formula: `${formatGbp(unitAmount)} per visit`,
      cardName: meta?.cardName ?? null,
      cardCode: meta?.cardCode ?? null,
      cardSource: meta?.cardSource ?? null,
      ruleLabel,
    };
  }

  const hrs = minutes / 60;
  return {
    minutes,
    hoursLabel,
    rateType: 'HOURLY',
    unitRate: `${formatGbp(unitAmount)}/hr`,
    amount: formatGbp(calc.amount),
    formula: `${hoursLabel} × ${formatGbp(unitAmount)}/hr = ${formatGbp(calc.amount)}`,
    cardName: meta?.cardName ?? null,
    cardCode: meta?.cardCode ?? null,
    cardSource: meta?.cardSource ?? null,
    ruleLabel,
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
): RateBreakdown | null {
  if (minutes <= 0) return null;
  const rule = pickBestRule(rules, visitDate, minutes, isBankHoliday);
  if (!rule) return null;

  const unitAmount = Number(rule.amount);
  const calc = calculateBillableAmount(rules, visitDate, minutes, defaultChargeMethod, isBankHoliday);
  if (!calc) return null;

  const hoursLabel = formatMinutesAsHours(minutes);
  const ruleLabel = rule.label ?? null;

  if (calc.label === 'FIXED_VISIT' || calc.label === 'FIXED') {
    return {
      minutes,
      hoursLabel,
      rateType: calc.label,
      unitRate: formatGbp(unitAmount),
      amount: formatGbp(calc.amount),
      formula: `${formatGbp(unitAmount)} per visit`,
      cardName: meta?.cardName ?? null,
      cardCode: meta?.cardCode ?? null,
      cardSource: meta?.cardSource ?? null,
      ruleLabel,
    };
  }

  return {
    minutes,
    hoursLabel,
    rateType: calc.label,
    unitRate: `${formatGbp(unitAmount)}/hr`,
    amount: formatGbp(calc.amount),
    formula: `${hoursLabel} × ${formatGbp(unitAmount)}/hr = ${formatGbp(calc.amount)}`,
    cardName: meta?.cardName ?? null,
    cardCode: meta?.cardCode ?? null,
    cardSource: meta?.cardSource ?? null,
    ruleLabel,
  };
}
