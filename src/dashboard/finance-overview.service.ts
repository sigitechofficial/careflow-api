import { Injectable } from '@nestjs/common';
import { InvoiceRunStatus, PaymentRecordStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { operationalTodayIso } from '../common/utils/operational-day.util';

/** Invoice runs that have been approved for sending (i.e. count as invoiced income). */
const INVOICED: InvoiceRunStatus[] = [
  InvoiceRunStatus.APPROVED,
  InvoiceRunStatus.LOCKED,
  InvoiceRunStatus.SENT,
  InvoiceRunStatus.PART_PAID,
  InvoiceRunStatus.PAID,
  InvoiceRunStatus.DISPUTED,
];

const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

/**
 * Finance module dashboard figures: income invoiced this month vs last month (by the period the
 * invoice covers), cash received this month and disputed invoices. Organisation-wide (invoice runs
 * and payments are not branch-scoped).
 */
@Injectable()
export class FinanceOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async overview() {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const monthStartIso = `${today.slice(0, 8)}01`;
    const [y, m] = today.split('-').map(Number) as [number, number];
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    // periodEnd / receivedDate are calendar dates, so compare as dates.
    const monthStart = new Date(`${monthStartIso}T00:00:00.000Z`);
    const prevStart = new Date(`${prev}T00:00:00.000Z`);
    const nextDay = new Date(new Date(`${today}T00:00:00.000Z`).getTime() + 86_400_000);

    const invoicedIn = (from: Date, to: Date) =>
      this.prisma.invoiceRun.aggregate({
        where: { status: { in: INVOICED }, periodEnd: { gte: from, lt: to } },
        _sum: { netTotal: true },
        _count: { _all: true },
      });

    const [thisMonth, lastMonth, received, disputed, awaitingApproval] = await Promise.all([
      invoicedIn(monthStart, new Date(Date.UTC(y, m, 1))),
      invoicedIn(prevStart, monthStart),
      this.prisma.payment.aggregate({
        where: { recordStatus: PaymentRecordStatus.RECEIVED, receivedDate: { gte: monthStart, lt: nextDay } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.invoiceRun.aggregate({
        where: { status: InvoiceRunStatus.DISPUTED },
        _sum: { netTotal: true },
        _count: { _all: true },
      }),
      this.prisma.invoiceRun.count({
        where: { status: { in: [InvoiceRunStatus.READY_FOR_REVIEW, InvoiceRunStatus.EXCEPTION_FOUND] } },
      }),
    ]);

    const cnt = (a: { _count?: unknown }) =>
      typeof a._count === 'object' && a._count ? Number((a._count as { _all?: number })._all ?? 0) : 0;

    return {
      data: {
        month: monthStartIso.slice(0, 7),
        currency: 'GBP',
        invoicedThisMonth: { amount: money(thisMonth._sum.netTotal), runs: cnt(thisMonth) },
        invoicedLastMonth: { amount: money(lastMonth._sum.netTotal), runs: cnt(lastMonth) },
        receivedThisMonth: { amount: money(received._sum.amount), payments: cnt(received) },
        disputed: { amount: money(disputed._sum.netTotal), runs: cnt(disputed) },
        invoiceRunsAwaitingReview: awaitingApproval,
      },
    };
  }
}
