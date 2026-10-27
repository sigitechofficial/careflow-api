import { VisitReconciliationStatus } from '@prisma/client';
import { addDaysToOperationalIso } from '../common/utils/operational-day.util';

export type FundingUsagePeriod = 'week' | 'month';

/** Organisation days (YYYY-MM-DD, inclusive) of the Monday–Sunday week or calendar month containing `date`. */
export function fundingUsagePeriodDays(
  period: FundingUsagePeriod,
  date: string,
): { from: string; to: string; days: number } {
  const day = date.slice(0, 10);
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  if (period === 'week') {
    const daysSinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    const from = addDaysToOperationalIso(day, -daysSinceMonday);
    return { from, to: addDaysToOperationalIso(from, 6), days: 7 };
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const month = day.slice(0, 7);
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}`, days: lastDay };
}

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

function dayNumber(iso: string): number {
  const [y = 1970, m = 1, d = 1] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export type FundingLineForUsage = {
  funderName: string | null;
  fundingTypeName: string | null;
  /** Organisation days; null = open. */
  startDate: string | null;
  endDate: string | null;
  weeklyBudget: number | null;
  hourlyRate: number | null;
  authorisedWeeklyHours: number | null;
};

/**
 * Budget for the period: each funding line's weekly budget spread over the days it is live in
 * the period (weekly budget ÷ 7 per day). Without a weekly budget, authorised weekly hours ×
 * hourly rate stands in for it. A line with neither adds hours only (when it has hours).
 */
export function fundingBudgetForPeriod(lines: FundingLineForUsage[], from: string, to: string) {
  const periodStart = dayNumber(from);
  const periodEnd = dayNumber(to);
  let amount = 0;
  let hours = 0;
  let hasAmount = false;
  let hasHours = false;
  const breakdown = lines.flatMap(line => {
    const start = Math.max(periodStart, line.startDate ? dayNumber(line.startDate) : periodStart);
    const end = Math.min(periodEnd, line.endDate ? dayNumber(line.endDate) : periodEnd);
    const liveDays = end >= start ? end - start + 1 : 0;
    if (liveDays === 0) return [];
    const weekly =
      line.weeklyBudget ??
      (line.authorisedWeeklyHours != null && line.hourlyRate != null
        ? line.authorisedWeeklyHours * line.hourlyRate
        : null);
    const lineAmount = weekly != null ? round2((weekly / 7) * liveDays) : null;
    const lineHours =
      line.authorisedWeeklyHours != null ? round2((line.authorisedWeeklyHours / 7) * liveDays) : null;
    if (lineAmount != null) {
      amount += lineAmount;
      hasAmount = true;
    }
    if (lineHours != null) {
      hours += lineHours;
      hasHours = true;
    }
    return [
      {
        funderName: line.funderName,
        fundingTypeName: line.fundingTypeName,
        liveDays,
        weeklyBudget: weekly != null ? round2(weekly) : null,
        budget: lineAmount,
        authorisedHours: lineHours,
      },
    ];
  });
  return {
    amount: hasAmount ? round2(amount) : null,
    hours: hasHours ? round2(hours) : null,
    lines: breakdown,
  };
}

export type ReconciliationForUsage = {
  scheduledVisitId: string;
  status: VisitReconciliationStatus;
  payableAmount: number | null;
  billableAmount: number | null;
  billableMinutes: number | null;
  paySettled: boolean;
  invoiced: boolean;
};

const PAY_APPROVED: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.APPROVED_FOR_PAY,
  VisitReconciliationStatus.APPROVED_FOR_BOTH,
  VisitReconciliationStatus.LOCKED,
];
const BILL_APPROVED: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.APPROVED_FOR_INVOICE,
  VisitReconciliationStatus.APPROVED_FOR_BOTH,
  VisitReconciliationStatus.LOCKED,
];
const PENDING: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.PENDING_REVIEW,
  VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
];

/**
 * Carer pay and client charge for a set of visit reconciliation rows (one row per carer on a
 * visit). Pay: settled by a pay run, approved and still due, or awaiting review. Charge: on an
 * invoice run, approved and not yet invoiced, or awaiting review. Rows the pay or invoice runs
 * would not take (rejected, or approved for the other side only) are left out of that side.
 * Summing charge across rows matches invoicing in both multi-carer modes: FIXED keeps the charge
 * on one row, COMBINED bills each carer's row.
 */
export function summariseFundingUsage(rows: ReconciliationForUsage[]) {
  const pay = { paid: 0, due: 0, pending: 0 };
  const charge = { invoiced: 0, toInvoice: 0, pending: 0 };
  let billableMinutes = 0;
  let pendingReview = 0;
  const visits = new Set<string>();
  for (const row of rows) {
    visits.add(row.scheduledVisitId);
    if (PENDING.includes(row.status)) pendingReview += 1;

    const payable = row.payableAmount ?? 0;
    if (row.paySettled) pay.paid += payable;
    else if (PAY_APPROVED.includes(row.status)) pay.due += payable;
    else if (PENDING.includes(row.status)) pay.pending += payable;

    const billable = row.billableAmount ?? 0;
    const charged = row.invoiced || BILL_APPROVED.includes(row.status) || PENDING.includes(row.status);
    if (row.invoiced) charge.invoiced += billable;
    else if (BILL_APPROVED.includes(row.status)) charge.toInvoice += billable;
    else if (PENDING.includes(row.status)) charge.pending += billable;
    if (charged) billableMinutes += row.billableMinutes ?? 0;
  }
  const payTotal = pay.paid + pay.due + pay.pending;
  const chargeTotal = charge.invoiced + charge.toInvoice + charge.pending;
  return {
    visits: visits.size,
    carerRows: rows.length,
    pendingReview,
    carerPay: {
      total: round2(payTotal),
      paid: round2(pay.paid),
      due: round2(pay.due),
      pending: round2(pay.pending),
    },
    clientCharge: {
      total: round2(chargeTotal),
      invoiced: round2(charge.invoiced),
      toInvoice: round2(charge.toInvoice),
      pending: round2(charge.pending),
    },
    billableHours: round2(billableMinutes / 60),
    margin: round2(chargeTotal - payTotal),
  };
}
