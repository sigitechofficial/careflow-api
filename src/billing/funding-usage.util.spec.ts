import { VisitReconciliationStatus as S } from '@prisma/client';
import {
  fundingBudgetForPeriod,
  fundingUsagePeriodDays,
  summariseFundingUsage,
  type FundingLineForUsage,
  type ReconciliationForUsage,
} from './funding-usage.util';

describe('fundingUsagePeriodDays', () => {
  it('gives the Monday–Sunday week containing the date', () => {
    expect(fundingUsagePeriodDays('week', '2026-10-24')).toEqual({ from: '2026-10-19', to: '2026-10-25', days: 7 });
    expect(fundingUsagePeriodDays('week', '2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-25', days: 7 });
    expect(fundingUsagePeriodDays('week', '2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25', days: 7 });
  });

  it('gives the calendar month containing the date', () => {
    expect(fundingUsagePeriodDays('month', '2026-10-24')).toEqual({ from: '2026-10-01', to: '2026-10-31', days: 31 });
    expect(fundingUsagePeriodDays('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29', days: 29 });
  });
});

const line = (over: Partial<FundingLineForUsage> = {}): FundingLineForUsage => ({
  funderName: 'Council',
  fundingTypeName: 'Local authority',
  startDate: null,
  endDate: null,
  weeklyBudget: null,
  hourlyRate: null,
  authorisedWeeklyHours: null,
  ...over,
});

describe('fundingBudgetForPeriod', () => {
  it('spreads the weekly budget over the days in the period', () => {
    expect(fundingBudgetForPeriod([line({ weeklyBudget: 700 })], '2026-10-19', '2026-10-25').amount).toBe(700);
    expect(fundingBudgetForPeriod([line({ weeklyBudget: 700 })], '2026-10-01', '2026-10-31').amount).toBe(3100);
  });

  it('counts only the days a line is live in the period', () => {
    const budget = fundingBudgetForPeriod(
      [line({ weeklyBudget: 70, startDate: '2026-10-22' }), line({ weeklyBudget: 140, endDate: '2026-10-20' })],
      '2026-10-19',
      '2026-10-25',
    );
    // 4 days × £10 + 2 days × £20
    expect(budget.amount).toBe(80);
    expect(budget.lines.map(l => l.liveDays)).toEqual([4, 2]);
  });

  it('leaves out a line that has ended before the period', () => {
    const budget = fundingBudgetForPeriod([line({ weeklyBudget: 70, endDate: '2026-09-30' })], '2026-10-01', '2026-10-31');
    expect(budget.amount).toBeNull();
    expect(budget.lines).toEqual([]);
  });

  it('uses authorised hours × hourly rate when there is no weekly budget, and reports hours', () => {
    const budget = fundingBudgetForPeriod(
      [line({ authorisedWeeklyHours: 14, hourlyRate: 20 })],
      '2026-10-19',
      '2026-10-25',
    );
    expect(budget.amount).toBe(280);
    expect(budget.hours).toBe(14);
  });

  it('has no amount when no line has a budget or a rate', () => {
    const budget = fundingBudgetForPeriod([line({ authorisedWeeklyHours: 7 })], '2026-10-19', '2026-10-25');
    expect(budget.amount).toBeNull();
    expect(budget.hours).toBe(7);
  });
});

const row = (over: Partial<ReconciliationForUsage> = {}): ReconciliationForUsage => ({
  scheduledVisitId: 'v1',
  status: S.APPROVED_FOR_BOTH,
  payableAmount: 20,
  billableAmount: 30,
  billableMinutes: 60,
  paySettled: false,
  invoiced: false,
  ...over,
});

describe('summariseFundingUsage', () => {
  it('splits carer pay into paid, due and pending review', () => {
    const usage = summariseFundingUsage([
      row({ scheduledVisitId: 'a', paySettled: true }),
      row({ scheduledVisitId: 'b' }),
      row({ scheduledVisitId: 'c', status: S.PENDING_REVIEW }),
    ]);
    expect(usage.carerPay).toEqual({ total: 60, paid: 20, due: 20, pending: 20 });
    expect(usage.pendingReview).toBe(1);
    expect(usage.visits).toBe(3);
  });

  it('splits client charge into invoiced, to invoice and pending review', () => {
    const usage = summariseFundingUsage([
      row({ scheduledVisitId: 'a', invoiced: true }),
      row({ scheduledVisitId: 'b', status: S.LOCKED }),
      row({ scheduledVisitId: 'c', status: S.REQUIRES_MANAGER_APPROVAL }),
    ]);
    expect(usage.clientCharge).toEqual({ total: 90, invoiced: 30, toInvoice: 30, pending: 30 });
    expect(usage.billableHours).toBe(3);
    expect(usage.margin).toBe(30);
  });

  it('leaves rejected sides and the other side of a one-sided approval out', () => {
    const usage = summariseFundingUsage([
      row({ scheduledVisitId: 'a', status: S.APPROVED_FOR_PAY }),
      row({ scheduledVisitId: 'b', status: S.APPROVED_FOR_INVOICE }),
      row({ scheduledVisitId: 'c', status: S.REJECTED_FOR_PAY }),
    ]);
    expect(usage.carerPay.total).toBe(20);
    expect(usage.clientCharge.total).toBe(30);
    expect(usage.billableHours).toBe(1);
  });

  it('counts a two-carer visit once but both carers’ pay and charge rows', () => {
    const usage = summariseFundingUsage([
      row({ scheduledVisitId: 'v1' }),
      // FIXED multi-carer mode: the second carer's row carries no charge.
      row({ scheduledVisitId: 'v1', billableAmount: 0, billableMinutes: 0 }),
    ]);
    expect(usage.visits).toBe(1);
    expect(usage.carerRows).toBe(2);
    expect(usage.carerPay.total).toBe(40);
    expect(usage.clientCharge.total).toBe(30);
  });

  it('still counts the pay of a settled visit that was later rejected', () => {
    const usage = summariseFundingUsage([row({ status: S.REJECTED_FOR_PAY, paySettled: true })]);
    expect(usage.carerPay.paid).toBe(20);
  });
});
