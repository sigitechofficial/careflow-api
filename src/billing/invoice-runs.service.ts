import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingRunExportStatus,
  InvoiceRunLineType,
  InvoiceRunStatus,
  PaymentMatchStatus,
  Prisma,
  VisitReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateBillingRunDto } from './dto/billing-runs.dto';
import { EmailInvoiceToServiceUserDto } from './dto/email-invoice-service-user.dto';
import {
  buildFundingSplits,
  endOfBillingDate,
  formatMoney,
  formatPeriodLabel,
  parseBillingDateOnly,
  splitAmount,
} from './billing-run.util';
import { loadPerFunderChargeCalculation } from './multi-funder-charge.util';
import { InvoiceTemplatesService } from './invoice-templates.service';
import { BillingRunsQueryDto } from './dto/billing-runs.dto';
import {
  buildInvoiceRunCsv,
  buildInvoiceRunXlsx,
  invoiceRunExportFilename,
  type InvoiceRunExportModel,
} from './invoice-run-export.util';
import { serviceUserIdsForLocation } from './billing-location-scope.util';

const MUTABLE_STATUSES: InvoiceRunStatus[] = [
  InvoiceRunStatus.DRAFT,
  InvoiceRunStatus.EXCEPTION_FOUND,
  InvoiceRunStatus.READY_FOR_REVIEW,
];

const INVOICE_ELIGIBLE_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.APPROVED_FOR_INVOICE,
  VisitReconciliationStatus.APPROVED_FOR_BOTH,
];

export type InvoiceRunRow = {
  id: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  status: InvoiceRunStatus;
  serviceUsers: number;
  funders: number;
  netTotal: string;
  exceptions: number;
  exportStatus: BillingRunExportStatus;
};

@Injectable()
export class InvoiceRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceTemplates: InvoiceTemplatesService,
    private readonly mail: MailService,
  ) {}

  async list(query?: BillingRunsQueryDto) {
    const where: Prisma.InvoiceRunWhereInput = {};
    if (query?.locationId) {
      const suIds = await serviceUserIdsForLocation(
        this.prisma,
        query.locationId,
      );
      where.OR = [
        { lines: { none: {} } },
        ...(suIds.length
          ? [{ lines: { some: { serviceUserId: { in: suIds } } } }]
          : []),
      ];
    }
    const rows = await this.prisma.invoiceRun.findMany({
      where,
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
    return { data: rows.map((r) => this.mapRow(r)) };
  }

  async getSummary(locationId?: string) {
    const where: Prisma.InvoiceRunWhereInput = {
      status: {
        in: [
          InvoiceRunStatus.DRAFT,
          InvoiceRunStatus.CALCULATING,
          InvoiceRunStatus.EXCEPTION_FOUND,
          InvoiceRunStatus.READY_FOR_REVIEW,
        ],
      },
    };
    if (locationId) {
      const suIds = await serviceUserIdsForLocation(this.prisma, locationId);
      where.OR = [
        { lines: { none: {} } },
        ...(suIds.length
          ? [{ lines: { some: { serviceUserId: { in: suIds } } } }]
          : []),
      ];
    }
    const drafts = await this.prisma.invoiceRun.count({ where });
    return { data: { invoiceDrafts: drafts } };
  }

  /**
   * Invoice history for one service user — runs that include their lines,
   * with funder rollups and ready-to-invoice visit count.
   */
  async getForServiceUser(serviceUserId: string) {
    const serviceUser = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        serviceUserNumber: true,
      },
    });
    if (!serviceUser) throw new NotFoundException('Service user not found');

    const lines = await this.prisma.invoiceRunLine.findMany({
      where: { serviceUserId },
      include: {
        invoiceRun: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });

    const funderIds = [
      ...new Set(
        lines.map((l) => l.funderId).filter((id): id is string => Boolean(id)),
      ),
    ];
    const funders = funderIds.length
      ? await this.prisma.funder.findMany({
          where: { id: { in: funderIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const funderMap = new Map(funders.map((f) => [f.id, f]));

    const byRun = new Map<
      string,
      {
        run: (typeof lines)[number]['invoiceRun'];
        lines: typeof lines;
      }
    >();
    for (const line of lines) {
      const existing = byRun.get(line.invoiceRunId);
      if (existing) existing.lines.push(line);
      else
        byRun.set(line.invoiceRunId, { run: line.invoiceRun, lines: [line] });
    }

    // Funder payments recorded against each run (paid vs the run's net total).
    const paymentsByRun = await this.prisma.paymentAllocation.groupBy({
      by: ['invoiceRunId'],
      where: { invoiceRunId: { in: [...byRun.keys()] } },
      _sum: { amount: true },
    });
    const paidByRun = new Map(
      paymentsByRun.map((p) => [p.invoiceRunId, Number(p._sum.amount ?? 0)]),
    );

    // Per-funder paid: each payment carries the funder that sent it, so attribute
    // allocations to (run, funder) to show how much each funder has settled.
    const runFunderAllocations = await this.prisma.paymentAllocation.findMany({
      where: { invoiceRunId: { in: [...byRun.keys()] } },
      select: {
        invoiceRunId: true,
        amount: true,
        payment: { select: { funderId: true } },
      },
    });
    const runFunderKey = (runId: string, funderId: string | null) =>
      `${runId}::${funderId ?? '__direct__'}`;
    const paidByRunFunder = new Map<string, number>();
    for (const a of runFunderAllocations) {
      const key = runFunderKey(a.invoiceRunId, a.payment?.funderId ?? null);
      paidByRunFunder.set(key, (paidByRunFunder.get(key) ?? 0) + Number(a.amount));
    }

    const runs = [...byRun.values()]
      .sort((a, b) => b.run.periodEnd.getTime() - a.run.periodEnd.getTime())
      .map(({ run, lines: runLines }) => {
        const mappedLines = runLines.map((l) => {
          const funder = l.funderId ? funderMap.get(l.funderId) : null;
          return {
            id: l.id,
            visitRef: l.visitRef,
            serviceUserId: l.serviceUserId,
            serviceUserName:
              serviceUser.preferredName?.trim() ||
              `${serviceUser.firstName} ${serviceUser.lastName}`.trim(),
            serviceUserNumber: serviceUser.serviceUserNumber,
            funderId: l.funderId,
            funderName:
              funder?.name ??
              (l.funderId ? 'Unknown funder' : 'Direct / family'),
            funderCode: funder?.code ?? null,
            description: l.description,
            minutes: l.minutes,
            splitPercent:
              l.splitPercent != null ? Number(l.splitPercent) : null,
            amount: formatMoney(Number(l.amount)),
            amountValue: Number(l.amount),
            exceptionMessage: l.exceptionMessage,
          };
        });
        const funderSummaries = this.buildFunderSummaries(mappedLines).map(
          (fs) => {
            const paidF =
              Math.round(
                (paidByRunFunder.get(runFunderKey(run.id, fs.funderId)) ?? 0) *
                  100,
              ) / 100;
            const outstandingF = Math.max(
              0,
              Math.round((fs.subtotalValue - paidF) * 100) / 100,
            );
            const fsStatus: 'UNPAID' | 'PART_PAID' | 'PAID' =
              paidF <= 0
                ? 'UNPAID'
                : outstandingF <= 0.001
                  ? 'PAID'
                  : 'PART_PAID';
            return {
              ...fs,
              paid: formatMoney(paidF),
              paidValue: paidF,
              outstanding: formatMoney(outstandingF),
              outstandingValue: outstandingF,
              paymentStatus: fsStatus,
            };
          },
        );
        const subtotal = mappedLines.reduce((sum, l) => sum + l.amountValue, 0);
        const exceptionCount = mappedLines.filter(
          (l) => l.exceptionMessage,
        ).length;
        const sent =
          run.status === InvoiceRunStatus.SENT ||
          run.status === InvoiceRunStatus.PART_PAID ||
          run.status === InvoiceRunStatus.PAID ||
          run.exportStatus === BillingRunExportStatus.SENT;
        const runNetTotal = Number(run.netTotal ?? 0);
        const paid = Math.round((paidByRun.get(run.id) ?? 0) * 100) / 100;
        const outstanding = Math.max(
          0,
          Math.round((runNetTotal - paid) * 100) / 100,
        );
        const paymentStatus: 'UNPAID' | 'PART_PAID' | 'PAID' =
          paid <= 0 ? 'UNPAID' : outstanding <= 0.001 ? 'PAID' : 'PART_PAID';
        return {
          id: run.id,
          period: run.periodLabel,
          periodStart: run.periodStart.toISOString().slice(0, 10),
          periodEnd: run.periodEnd.toISOString().slice(0, 10),
          status: run.status,
          exportStatus: run.exportStatus,
          sentAt: run.sentAt?.toISOString() ?? null,
          lockedAt: run.lockedAt?.toISOString() ?? null,
          lineCount: mappedLines.length,
          subtotal: formatMoney(subtotal),
          subtotalValue: Math.round(subtotal * 100) / 100,
          exceptions: exceptionCount,
          funders: funderSummaries.length,
          funderSummaries,
          lines: mappedLines,
          runNetTotal: formatMoney(runNetTotal),
          runNetTotalValue: Math.round(runNetTotal * 100) / 100,
          paid: formatMoney(paid),
          paidValue: paid,
          outstanding: formatMoney(outstanding),
          outstandingValue: outstanding,
          paymentStatus,
          sent,
          canSend:
            run.status === InvoiceRunStatus.LOCKED ||
            run.status === InvoiceRunStatus.APPROVED,
        };
      });

    const readyToInvoiceCount = await this.prisma.visitReconciliation.count({
      where: {
        serviceUserId,
        includedInInvoiceRunId: null,
        status: { in: INVOICE_ELIGIBLE_RECON },
      },
    });

    const invoicedStatuses: InvoiceRunStatus[] = [
      InvoiceRunStatus.LOCKED,
      InvoiceRunStatus.SENT,
      InvoiceRunStatus.PART_PAID,
      InvoiceRunStatus.PAID,
    ];
    const totalInvoiced = runs
      .filter((r) => invoicedStatuses.includes(r.status))
      .reduce((sum, r) => sum + r.subtotalValue, 0);

    return {
      data: {
        serviceUserId,
        serviceUserName:
          serviceUser.preferredName?.trim() ||
          `${serviceUser.firstName} ${serviceUser.lastName}`.trim(),
        serviceUserNumber: serviceUser.serviceUserNumber,
        readyToInvoiceCount,
        totalInvoiced: formatMoney(totalInvoiced),
        totalInvoicedValue: Math.round(totalInvoiced * 100) / 100,
        runCount: runs.length,
        runs,
      },
    };
  }

  /**
   * Per-service-user invoice status across every invoice run (period). For each service user
   * it returns how many invoices they have, how many are sent vs still outstanding, and a
   * month-by-month breakdown. Optional `month` (YYYY-MM) filters to a single billing period.
   */
  async getServiceUserInvoicesOverview(params: { month?: string } = {}) {
    const runWhere: Prisma.InvoiceRunWhereInput = {};
    if (params.month && /^\d{4}-\d{2}$/.test(params.month)) {
      const [year, month] = params.month.split('-').map(Number);
      runWhere.periodStart = {
        gte: new Date(Date.UTC(year, month - 1, 1)),
        lt: new Date(Date.UTC(year, month, 1)),
      };
    }

    const runs = await this.prisma.invoiceRun.findMany({
      where: runWhere,
      select: {
        id: true,
        periodLabel: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        exportStatus: true,
        sentAt: true,
        netTotal: true,
      },
      orderBy: { periodStart: 'desc' },
    });

    const months = [
      ...new Set(runs.map((r) => r.periodStart.toISOString().slice(0, 7))),
    ].sort((a, b) => b.localeCompare(a));

    if (!runs.length) {
      return { data: { months, serviceUsers: [] } };
    }

    const runMap = new Map(runs.map((r) => [r.id, r]));
    const runIds = runs.map((r) => r.id);

    // Funder payments recorded against each run (paid = sum of allocations vs the run's net total).
    const paymentsByRun = await this.prisma.paymentAllocation.groupBy({
      by: ['invoiceRunId'],
      where: { invoiceRunId: { in: runIds } },
      _sum: { amount: true },
    });
    const paidByRun = new Map(
      paymentsByRun.map((p) => [p.invoiceRunId, Number(p._sum.amount ?? 0)]),
    );

    // Per-funder invoiced amount for each (service user, run) — the funder split of the invoice.
    const funderGrouped = await this.prisma.invoiceRunLine.groupBy({
      by: ['serviceUserId', 'invoiceRunId', 'funderId'],
      where: { invoiceRunId: { in: runIds } },
      _sum: { amount: true },
    });

    // Per-funder paid: allocations are recorded against a run, and each payment carries the
    // funder that sent it. Attribute paid amounts to (run, funder) so we can show who has paid.
    const funderAllocations = await this.prisma.paymentAllocation.findMany({
      where: { invoiceRunId: { in: runIds } },
      select: {
        invoiceRunId: true,
        amount: true,
        payment: { select: { funderId: true } },
      },
    });
    const runFunderKey = (runId: string, funderId: string | null) =>
      `${runId}::${funderId ?? '__direct__'}`;
    const paidByRunFunder = new Map<string, number>();
    for (const a of funderAllocations) {
      const key = runFunderKey(a.invoiceRunId, a.payment?.funderId ?? null);
      paidByRunFunder.set(key, (paidByRunFunder.get(key) ?? 0) + Number(a.amount));
    }

    const overviewFunderIds = [
      ...new Set(
        funderGrouped
          .map((f) => f.funderId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const overviewFunders = overviewFunderIds.length
      ? await this.prisma.funder.findMany({
          where: { id: { in: overviewFunderIds } },
          select: { id: true, name: true },
        })
      : [];
    const funderNameMap = new Map(overviewFunders.map((f) => [f.id, f.name]));

    const grouped = await this.prisma.invoiceRunLine.groupBy({
      by: ['serviceUserId', 'invoiceRunId'],
      where: { invoiceRunId: { in: runIds } },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const serviceUserIds = [...new Set(grouped.map((g) => g.serviceUserId))];
    const serviceUserRows = serviceUserIds.length
      ? await this.prisma.serviceUser.findMany({
          where: { id: { in: serviceUserIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            serviceUserNumber: true,
          },
        })
      : [];
    const suMap = new Map(serviceUserRows.map((s) => [s.id, s]));
    const suName = (id: string) => {
      const su = suMap.get(id);
      if (!su) return 'Unknown service user';
      return (
        su.preferredName?.trim() || `${su.firstName} ${su.lastName}`.trim()
      );
    };

    const sentStatuses: InvoiceRunStatus[] = [
      InvoiceRunStatus.SENT,
      InvoiceRunStatus.PART_PAID,
      InvoiceRunStatus.PAID,
    ];
    const isSent = (run: (typeof runs)[number]) =>
      sentStatuses.includes(run.status) ||
      run.exportStatus === BillingRunExportStatus.SENT;

    type MonthRow = {
      runId: string;
      period: string;
      periodStart: string;
      periodEnd: string;
      status: InvoiceRunStatus;
      exportStatus: BillingRunExportStatus;
      sent: boolean;
      sentAt: string | null;
      lineCount: number;
      subtotal: string;
      subtotalValue: number;
      /** Run-level funder payment status (the whole invoice run is what the funder pays). */
      runNetTotal: string;
      runNetTotalValue: number;
      paid: string;
      paidValue: number;
      outstanding: string;
      outstandingValue: number;
      paymentStatus: 'UNPAID' | 'PART_PAID' | 'PAID';
      canRecordPayment: boolean;
      /** Per-funder split of this invoice — who is invoiced, and how much each has paid. */
      funders: {
        funderId: string | null;
        funderName: string;
        invoiced: string;
        invoicedValue: number;
        paid: string;
        paidValue: number;
        outstanding: string;
        outstandingValue: number;
        paymentStatus: 'UNPAID' | 'PART_PAID' | 'PAID';
      }[];
    };
    type SuRow = {
      serviceUserId: string;
      serviceUserName: string;
      serviceUserNumber: string | null;
      invoiceCount: number;
      sentCount: number;
      pendingCount: number;
      totalInvoiced: string;
      totalInvoicedValue: number;
      lastPeriodEnd: string | null;
      months: MonthRow[];
    };

    const bySu = new Map<string, SuRow>();
    for (const g of grouped) {
      const run = runMap.get(g.invoiceRunId);
      if (!run) continue;
      const amount = Number(g._sum.amount ?? 0);
      const sent = isSent(run);
      const runNetTotal = Number(run.netTotal ?? 0);
      const paid = Math.round((paidByRun.get(run.id) ?? 0) * 100) / 100;
      const outstanding = Math.max(
        0,
        Math.round((runNetTotal - paid) * 100) / 100,
      );
      const paymentStatus: 'UNPAID' | 'PART_PAID' | 'PAID' =
        paid <= 0 ? 'UNPAID' : outstanding <= 0.001 ? 'PAID' : 'PART_PAID';
      let row = bySu.get(g.serviceUserId);
      if (!row) {
        row = {
          serviceUserId: g.serviceUserId,
          serviceUserName: suName(g.serviceUserId),
          serviceUserNumber:
            suMap.get(g.serviceUserId)?.serviceUserNumber ?? null,
          invoiceCount: 0,
          sentCount: 0,
          pendingCount: 0,
          totalInvoiced: formatMoney(0),
          totalInvoicedValue: 0,
          lastPeriodEnd: null,
          months: [],
        };
        bySu.set(g.serviceUserId, row);
      }
      row.invoiceCount += 1;
      if (sent) row.sentCount += 1;
      else row.pendingCount += 1;
      row.totalInvoicedValue += amount;

      const funders = funderGrouped
        .filter(
          (f) =>
            f.serviceUserId === g.serviceUserId &&
            f.invoiceRunId === g.invoiceRunId,
        )
        .map((f) => {
          const invoiced = Math.round(Number(f._sum.amount ?? 0) * 100) / 100;
          const paidF =
            Math.round(
              (paidByRunFunder.get(runFunderKey(run.id, f.funderId)) ?? 0) * 100,
            ) / 100;
          const outstandingF = Math.max(
            0,
            Math.round((invoiced - paidF) * 100) / 100,
          );
          const funderPaymentStatus: 'UNPAID' | 'PART_PAID' | 'PAID' =
            paidF <= 0 ? 'UNPAID' : outstandingF <= 0.001 ? 'PAID' : 'PART_PAID';
          return {
            funderId: f.funderId,
            funderName: f.funderId
              ? (funderNameMap.get(f.funderId) ?? 'Unknown funder')
              : 'Direct / family',
            invoiced: formatMoney(invoiced),
            invoicedValue: invoiced,
            paid: formatMoney(paidF),
            paidValue: paidF,
            outstanding: formatMoney(outstandingF),
            outstandingValue: outstandingF,
            paymentStatus: funderPaymentStatus,
          };
        })
        .sort((a, b) => b.invoicedValue - a.invoicedValue);

      row.months.push({
        runId: run.id,
        period: run.periodLabel,
        periodStart: run.periodStart.toISOString().slice(0, 10),
        periodEnd: run.periodEnd.toISOString().slice(0, 10),
        status: run.status,
        exportStatus: run.exportStatus,
        sent,
        sentAt: run.sentAt?.toISOString() ?? null,
        lineCount: g._count._all,
        subtotal: formatMoney(amount),
        subtotalValue: Math.round(amount * 100) / 100,
        runNetTotal: formatMoney(runNetTotal),
        runNetTotalValue: Math.round(runNetTotal * 100) / 100,
        paid: formatMoney(paid),
        paidValue: paid,
        outstanding: formatMoney(outstanding),
        outstandingValue: outstanding,
        paymentStatus,
        canRecordPayment: sent && outstanding > 0.001,
        funders,
      });
    }

    const serviceUsers = [...bySu.values()].map((row) => {
      row.months.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
      row.totalInvoicedValue = Math.round(row.totalInvoicedValue * 100) / 100;
      row.totalInvoiced = formatMoney(row.totalInvoicedValue);
      row.lastPeriodEnd = row.months[0]?.periodEnd ?? null;
      return row;
    });
    serviceUsers.sort(
      (a, b) =>
        b.pendingCount - a.pendingCount ||
        a.serviceUserName.localeCompare(b.serviceUserName),
    );

    return { data: { months, serviceUsers } };
  }

  async getById(id: string) {
    const row = await this.prisma.invoiceRun.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: [{ visitRef: 'asc' }, { description: 'asc' }],
          take: 500,
        },
        paymentAllocations: true,
      },
    });
    if (!row) throw new NotFoundException('Invoice run not found');

    const serviceUserIds = [...new Set(row.lines.map((l) => l.serviceUserId))];
    const funderIds = [
      ...new Set(
        row.lines
          .map((l) => l.funderId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const [serviceUsers, funders] = await Promise.all([
      serviceUserIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: serviceUserIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              serviceUserNumber: true,
            },
          })
        : Promise.resolve([]),
      funderIds.length
        ? this.prisma.funder.findMany({
            where: { id: { in: funderIds } },
            select: { id: true, name: true, code: true },
          })
        : Promise.resolve([]),
    ]);

    const serviceUserMap = new Map(
      serviceUsers.map((su) => [
        su.id,
        {
          name:
            su.preferredName?.trim() || `${su.firstName} ${su.lastName}`.trim(),
          number: su.serviceUserNumber,
        },
      ]),
    );
    const funderMap = new Map(funders.map((f) => [f.id, f]));

    const paidAmount = row.paymentAllocations.reduce(
      (sum, a) => sum + Number(a.amount),
      0,
    );
    const netTotal = Number(row.netTotal);
    const outstanding = Math.max(0, netTotal - paidAmount);

    const lines = row.lines.map((l) => {
      const su = serviceUserMap.get(l.serviceUserId);
      const funder = l.funderId ? funderMap.get(l.funderId) : null;
      return {
        id: l.id,
        visitRef: l.visitRef,
        serviceUserId: l.serviceUserId,
        serviceUserName: su?.name ?? 'Unknown service user',
        serviceUserNumber: su?.number ?? null,
        funderId: l.funderId,
        funderName:
          funder?.name ?? (l.funderId ? 'Unknown funder' : 'Direct / family'),
        funderCode: funder?.code ?? null,
        description: l.description,
        minutes: l.minutes,
        splitPercent: l.splitPercent != null ? Number(l.splitPercent) : null,
        amount: formatMoney(Number(l.amount)),
        amountValue: Number(l.amount),
        exceptionMessage: l.exceptionMessage,
      };
    });

    const funderSummaries = this.buildFunderSummaries(lines);

    return {
      data: {
        ...this.mapRow(row),
        notes: row.notes,
        lineCount: row.lines.length,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        lockedAt: row.lockedAt?.toISOString() ?? null,
        sentAt: row.sentAt?.toISOString() ?? null,
        paidAmount: formatMoney(paidAmount),
        outstanding: formatMoney(outstanding),
        paidAmountValue: paidAmount,
        outstandingValue: outstanding,
        netTotalValue: netTotal,
        lines,
        funderSummaries,
      },
    };
  }

  /** Build a downloadable CSV or Excel of the invoice run's lines + funder totals. */
  async exportRun(
    id: string,
    format: 'csv' | 'xlsx',
    serviceUserId?: string,
  ): Promise<{ filename: string; mime: string; body: string | Buffer }> {
    const row = await this.prisma.invoiceRun.findUnique({
      where: { id },
      include: {
        lines: {
          where: serviceUserId ? { serviceUserId } : undefined,
          orderBy: [{ visitRef: 'asc' }, { description: 'asc' }],
        },
      },
    });
    if (!row) throw new NotFoundException('Invoice run not found');
    if (serviceUserId && row.lines.length === 0) {
      throw new NotFoundException('No invoice lines for this service user on the run');
    }

    const serviceUserIds = [...new Set(row.lines.map((l) => l.serviceUserId))];
    const funderIds = [
      ...new Set(
        row.lines.map((l) => l.funderId).filter((f): f is string => Boolean(f)),
      ),
    ];
    const [serviceUsers, funders] = await Promise.all([
      serviceUserIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: serviceUserIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              serviceUserNumber: true,
            },
          })
        : Promise.resolve([]),
      funderIds.length
        ? this.prisma.funder.findMany({
            where: { id: { in: funderIds } },
            select: { id: true, name: true, code: true },
          })
        : Promise.resolve([]),
    ]);
    const suMap = new Map(
      serviceUsers.map((su) => [
        su.id,
        {
          name:
            su.preferredName?.trim() || `${su.firstName} ${su.lastName}`.trim(),
          number: su.serviceUserNumber,
        },
      ]),
    );
    const funderMap = new Map(funders.map((f) => [f.id, f]));

    const model: InvoiceRunExportModel = {
      periodLabel: row.periodLabel,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      status: row.status,
      currency: row.currency,
      netTotalValue: Number(row.netTotal),
      lines: row.lines.map((l) => {
        const su = suMap.get(l.serviceUserId);
        const funder = l.funderId ? funderMap.get(l.funderId) : null;
        return {
          funderName:
            funder?.name ?? (l.funderId ? 'Unknown funder' : 'Direct / family'),
          funderCode: funder?.code ?? null,
          serviceUserName: su?.name ?? 'Unknown service user',
          serviceUserNumber: su?.number ?? null,
          visitRef: l.visitRef,
          description: l.description,
          minutes: l.minutes,
          splitPercent: l.splitPercent != null ? Number(l.splitPercent) : null,
          amountValue: Number(l.amount),
          exceptionMessage: l.exceptionMessage,
        };
      }),
    };

    if (format === 'xlsx') {
      return {
        filename: invoiceRunExportFilename(model, 'xlsx'),
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: await buildInvoiceRunXlsx(model),
      };
    }
    return {
      filename: invoiceRunExportFilename(model, 'csv'),
      mime: 'text/csv; charset=utf-8',
      body: buildInvoiceRunCsv(model),
    };
  }

  async create(userId: string, dto: CreateBillingRunDto) {
    const periodStart = parseBillingDateOnly(dto.periodStart);
    const periodEnd = parseBillingDateOnly(dto.periodEnd);
    if (periodEnd < periodStart) {
      throw new BadRequestException(
        'Period end must be on or after period start',
      );
    }

    const created = await this.prisma.invoiceRun.create({
      data: {
        periodLabel: formatPeriodLabel(periodEnd),
        periodStart,
        periodEnd,
        notes: dto.notes?.trim() || null,
        createdById: userId,
      },
    });
    return { message: 'Invoice run created', data: this.mapRow(created) };
  }

  async calculate(id: string) {
    const run = await this.prisma.invoiceRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Invoice run not found');
    if (!MUTABLE_STATUSES.includes(run.status)) {
      throw new BadRequestException(
        `Cannot recalculate invoice run in status ${run.status}`,
      );
    }

    await this.prisma.invoiceRun.update({
      where: { id },
      data: { status: InvoiceRunStatus.CALCULATING },
    });

    const periodEnd = endOfBillingDate(run.periodEnd);

    // Visit reconciliations already sitting in ANOTHER invoice run's lines (draft or locked) must
    // not be pulled in here — otherwise an overlapping period would bill the same visit twice.
    const claimedElsewhere = await this.prisma.invoiceRunLine.findMany({
      where: { invoiceRunId: { not: id } },
      select: { visitReconciliationId: true },
    });
    const claimedReconIds = [
      ...new Set(claimedElsewhere.map((l) => l.visitReconciliationId)),
    ];

    const reconciliations = await this.prisma.visitReconciliation.findMany({
      where: {
        status: { in: INVOICE_ELIGIBLE_RECON },
        includedInInvoiceRunId: null,
        ...(claimedReconIds.length ? { id: { notIn: claimedReconIds } } : {}),
        approvedBillStart: { gte: run.periodStart, lte: periodEnd },
      },
      orderBy: { approvedBillStart: 'asc' },
    });

    const lineData: Prisma.InvoiceRunLineCreateManyInput[] = [];
    let exceptionCount = 0;
    let templateMissingCount = 0;
    const serviceUserIds = new Set<string>();
    const funderIds = new Set<string>();

    // Ensure an organisation-wide default exists for funders/contracts with no template.
    await this.invoiceTemplates.ensureOrganisationDefaultTemplate();

    for (const recon of reconciliations) {
      const billMins = recon.billableMinutes ?? 0;
      const billAmt =
        recon.billableAmount != null ? Number(recon.billableAmount) : 0;
      // FIXED multi-carer mode zeroes secondary carers — skip empty charge lines.
      if (billMins <= 0 && billAmt <= 0) {
        continue;
      }

      const issues: string[] = [];
      if (recon.billableAmount == null)
        issues.push('Billable amount not calculated');
      if (!recon.approvedBillStart || !recon.approvedBillEnd) {
        issues.push('Approved billable time missing');
      }
      if (!recon.chargeCardId) issues.push('Charge card missing');

      const total =
        recon.billableAmount != null ? Number(recon.billableAmount) : 0;
      serviceUserIds.add(recon.serviceUserId);

      const fundingLines = await this.prisma.serviceUserFunding.findMany({
        where: { serviceUserId: recon.serviceUserId, deletedAt: null },
        include: { funder: { select: { id: true, name: true } } },
      });
      const splits = buildFundingSplits(fundingLines);

      if (!splits.length) {
        issues.push('No active funding contract');
        exceptionCount += 1;
        lineData.push({
          invoiceRunId: id,
          visitReconciliationId: recon.id,
          serviceUserId: recon.serviceUserId,
          serviceUserFundingId: null,
          funderId: null,
          lineType: InvoiceRunLineType.VISIT_CHARGE,
          description: `Visit charge — ${recon.visitRef}`,
          minutes: recon.billableMinutes,
          amount: 0,
          chargeCardId: recon.chargeCardId,
          visitRef: recon.visitRef,
          exceptionMessage: issues.join('; '),
        });
        continue;
      }

      if (issues.length) exceptionCount += 1;

      const perFunderCharges =
        !issues.length &&
        recon.approvedBillStart &&
        recon.approvedBillEnd &&
        billMins > 0
          ? await loadPerFunderChargeCalculation(this.prisma, {
              serviceUserId: recon.serviceUserId,
              billMinutes: billMins,
              billRateAnchor: recon.approvedBillStart,
              approvedBillStart: recon.approvedBillStart,
              approvedBillEnd: recon.approvedBillEnd,
              isBankHoliday: false,
              isBankHolidayFn: () => false,
              nightDuty: null,
            })
          : null;

      const allocated = perFunderCharges
        ? perFunderCharges.lines
            .filter((line) => line.included && line.amount > 0)
            .map((line) => ({
              id: line.fundingId,
              funderId: line.funderId,
              funderName: line.funderName,
              splitPercent: line.splitPercent,
              splitPriority: line.splitPriority,
              isPrimary: line.isPrimary,
              amount: line.amount,
              chargeCardId: line.chargeCardId,
            }))
        : [];

      if (!perFunderCharges) {
        const legacyAllocated = splitAmount(issues.length ? 0 : total, splits);
        for (const split of legacyAllocated) {
          if (split.funderId) funderIds.add(split.funderId);

          const lineIssues = [...issues];
          const resolved = await this.invoiceTemplates.resolveForServiceUser(
            recon.serviceUserId,
            split.id,
          );
          if (!resolved.data.invoiceTemplate) {
            templateMissingCount += 1;
            lineIssues.push('Invoice template missing');
            if (!issues.length) exceptionCount += 1;
          }

          lineData.push({
            invoiceRunId: id,
            visitReconciliationId: recon.id,
            serviceUserId: recon.serviceUserId,
            serviceUserFundingId: split.id,
            funderId: split.funderId,
            lineType: InvoiceRunLineType.VISIT_CHARGE,
            description: split.funderName
              ? `Visit charge — ${recon.visitRef} (${split.funderName})`
              : `Visit charge — ${recon.visitRef}`,
            minutes: recon.billableMinutes,
            splitPercent: split.splitPercent,
            amount: split.amount,
            chargeCardId: recon.chargeCardId,
            visitRef: recon.visitRef,
            exceptionMessage: lineIssues.length ? lineIssues.join('; ') : null,
          });
        }
        continue;
      }

      for (const split of allocated) {
        if (split.funderId) funderIds.add(split.funderId);

        const lineIssues = [...issues];
        const resolved = await this.invoiceTemplates.resolveForServiceUser(
          recon.serviceUserId,
          split.id,
        );
        if (!resolved.data.invoiceTemplate) {
          templateMissingCount += 1;
          lineIssues.push('Invoice template missing');
          if (!issues.length) exceptionCount += 1;
        }

        lineData.push({
          invoiceRunId: id,
          visitReconciliationId: recon.id,
          serviceUserId: recon.serviceUserId,
          serviceUserFundingId: split.id,
          funderId: split.funderId,
          lineType: InvoiceRunLineType.VISIT_CHARGE,
          description: split.funderName
            ? `Visit charge — ${recon.visitRef} (${split.funderName})`
            : `Visit charge — ${recon.visitRef}`,
          minutes: recon.billableMinutes,
          splitPercent: split.splitPercent,
          amount: split.amount,
          chargeCardId: split.chargeCardId ?? recon.chargeCardId,
          visitRef: recon.visitRef,
          exceptionMessage: lineIssues.length ? lineIssues.join('; ') : null,
        });
      }
    }

    const netTotal = lineData.reduce((sum, l) => sum + Number(l.amount), 0);
    let exportStatus: BillingRunExportStatus =
      BillingRunExportStatus.NOT_STARTED;
    if (templateMissingCount > 0) {
      exportStatus = BillingRunExportStatus.TEMPLATE_MISSING;
    } else if (lineData.length > 0 && exceptionCount === 0) {
      exportStatus = BillingRunExportStatus.READY_TO_RENDER;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.invoiceRunLine.deleteMany({ where: { invoiceRunId: id } });
      if (lineData.length) {
        await tx.invoiceRunLine.createMany({ data: lineData });
      }
      await tx.invoiceRun.update({
        where: { id },
        data: {
          status:
            exceptionCount > 0
              ? InvoiceRunStatus.EXCEPTION_FOUND
              : lineData.length
                ? InvoiceRunStatus.READY_FOR_REVIEW
                : InvoiceRunStatus.DRAFT,
          serviceUserCount: serviceUserIds.size,
          funderCount: funderIds.size,
          netTotal,
          exceptionCount,
          exportStatus,
        },
      });
    });

    return this.getById(id);
  }

  async approve(userId: string, id: string) {
    const run = await this.prisma.invoiceRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Invoice run not found');
    if (
      run.status !== InvoiceRunStatus.READY_FOR_REVIEW &&
      run.status !== InvoiceRunStatus.EXCEPTION_FOUND
    ) {
      throw new BadRequestException(
        'Only runs ready for review can be approved',
      );
    }

    await this.prisma.invoiceRun.update({
      where: { id },
      data: {
        status: InvoiceRunStatus.APPROVED,
        approvedAt: new Date(),
        approvedById: userId,
      },
    });
    return this.getById(id);
  }

  /**
   * Delete every invoice run (destructive reset). Payment allocations reference runs with an
   * FK Restrict, so they are cleared first; reconciliations auto-unlink (SetNull) and run lines
   * cascade. Affected payments are reset to unmatched.
   */
  async deleteAll() {
    const deleted = await this.prisma.$transaction(async (tx) => {
      await tx.paymentAllocation.deleteMany({});
      await tx.payment.updateMany({
        data: { matchedAmount: 0, matchStatus: PaymentMatchStatus.UNMATCHED },
      });
      const result = await tx.invoiceRun.deleteMany({});
      return result.count;
    });
    return {
      message: `Deleted ${deleted} invoice run${deleted === 1 ? '' : 's'}`,
      data: { deleted },
    };
  }

  async lock(userId: string, id: string) {
    const run = await this.prisma.invoiceRun.findUnique({
      where: { id },
      include: { lines: { select: { visitReconciliationId: true } } },
    });
    if (!run) throw new NotFoundException('Invoice run not found');
    if (run.status !== InvoiceRunStatus.APPROVED) {
      throw new BadRequestException('Approve the invoice run before locking');
    }

    const reconIds = [
      ...new Set(run.lines.map((l) => l.visitReconciliationId)),
    ];

    await this.prisma.$transaction(async (tx) => {
      await tx.invoiceRun.update({
        where: { id },
        data: {
          status: InvoiceRunStatus.LOCKED,
          lockedAt: new Date(),
          approvedById: run.approvedById ?? userId,
          exportStatus: BillingRunExportStatus.EXPORTED,
        },
      });
      if (reconIds.length) {
        // Only claim reconciliations not already locked into another run — never steal one.
        await tx.visitReconciliation.updateMany({
          where: { id: { in: reconIds }, includedInInvoiceRunId: null },
          data: { includedInInvoiceRunId: id },
        });
      }
    });

    return this.getById(id);
  }

  async markSent(id: string) {
    const run = await this.prisma.invoiceRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Invoice run not found');
    if (
      run.status !== InvoiceRunStatus.LOCKED &&
      run.status !== InvoiceRunStatus.APPROVED
    ) {
      throw new BadRequestException(
        'Lock the invoice run before marking as sent',
      );
    }

    await this.prisma.invoiceRun.update({
      where: { id },
      data: {
        status: InvoiceRunStatus.SENT,
        sentAt: new Date(),
        exportStatus: BillingRunExportStatus.SENT,
      },
    });
    return this.getById(id);
  }

  /**
   * Resolve likely invoice email recipients for a service user on a run
   * (funding billing contacts first, then service user email).
   */
  async getServiceUserEmailPreview(runId: string, serviceUserId: string) {
    const run = await this.prisma.invoiceRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        periodLabel: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        currency: true,
      },
    });
    if (!run) throw new NotFoundException('Invoice run not found');

    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        serviceUserNumber: true,
        email: true,
      },
    });
    if (!su) throw new NotFoundException('Service user not found');

    const lines = await this.prisma.invoiceRunLine.findMany({
      where: { invoiceRunId: runId, serviceUserId },
      select: { amount: true, funderId: true },
    });
    if (!lines.length) {
      throw new NotFoundException('No invoice lines for this service user on the run');
    }

    const funderIds = [
      ...new Set(lines.map((l) => l.funderId).filter((id): id is string => Boolean(id))),
    ];
    const [fundings, funders] = await Promise.all([
      this.prisma.serviceUserFunding.findMany({
        where: { serviceUserId, deletedAt: null },
        select: {
          billingContactEmail: true,
          billingContactName: true,
          funderId: true,
        },
      }),
      funderIds.length
        ? this.prisma.funder.findMany({
            where: { id: { in: funderIds } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve([]),
    ]);

    type Suggestion = { email: string; source: string; label: string };
    const suggestions: Suggestion[] = [];
    const seen = new Set<string>();
    const push = (email: string | null | undefined, source: string, label: string) => {
      const e = email?.trim().toLowerCase();
      if (!e || seen.has(e)) return;
      seen.add(e);
      suggestions.push({ email: e, source, label });
    };

    for (const f of fundings) {
      push(
        f.billingContactEmail,
        'funding_billing_contact',
        f.billingContactName?.trim() || 'Funding billing contact',
      );
    }
    for (const f of funders) {
      push(f.email, 'funder', f.name);
    }
    push(su.email, 'service_user', 'Service user');

    const subtotal = lines.reduce((sum, l) => sum + Number(l.amount), 0);
    const name =
      su.preferredName?.trim() || `${su.firstName} ${su.lastName}`.trim();

    return {
      data: {
        runId: run.id,
        period: run.periodLabel,
        periodStart: run.periodStart.toISOString().slice(0, 10),
        periodEnd: run.periodEnd.toISOString().slice(0, 10),
        status: run.status,
        currency: run.currency,
        serviceUserId: su.id,
        serviceUserName: name,
        serviceUserNumber: su.serviceUserNumber,
        subtotal: formatMoney(subtotal),
        subtotalValue: subtotal,
        defaultToEmail: suggestions[0]?.email ?? null,
        suggestions,
        canMarkSent:
          run.status === InvoiceRunStatus.LOCKED ||
          run.status === InvoiceRunStatus.APPROVED,
      },
    };
  }

  /** Email this service user's invoice CSV to a billing / service-user address. */
  async emailToServiceUser(runId: string, dto: EmailInvoiceToServiceUserDto) {
    const preview = await this.getServiceUserEmailPreview(runId, dto.serviceUserId);
    const to =
      dto.toEmail?.trim().toLowerCase() || preview.data.defaultToEmail;
    if (!to) {
      throw new BadRequestException(
        'No email address found. Add a funding billing contact email or service user email, or enter an address manually.',
      );
    }

    const exported = await this.exportRun(runId, 'csv', dto.serviceUserId);
    const subject = `Invoice — ${preview.data.serviceUserName} — ${preview.data.period}`;
    const text = [
      `Dear recipient,`,
      ``,
      `Please find attached the invoice for ${preview.data.serviceUserName}`,
      preview.data.serviceUserNumber
        ? `(${preview.data.serviceUserNumber})`
        : '',
      `for the period ${preview.data.periodStart} to ${preview.data.periodEnd}.`,
      ``,
      `Amount: ${preview.data.subtotal} ${preview.data.currency}`,
      ``,
      `This message was sent from CareAdmin.`,
    ]
      .filter(Boolean)
      .join('\n');

    const sent = await this.mail.send({
      to,
      subject,
      text,
      html: `<p>Dear recipient,</p>
<p>Please find attached the invoice for <strong>${preview.data.serviceUserName}</strong>${
        preview.data.serviceUserNumber
          ? ` (${preview.data.serviceUserNumber})`
          : ''
      } for the period <strong>${preview.data.periodStart}</strong> to <strong>${preview.data.periodEnd}</strong>.</p>
<p>Amount: <strong>${preview.data.subtotal} ${preview.data.currency}</strong></p>
<p>This message was sent from CareAdmin.</p>`,
      attachments: [
        {
          filename: exported.filename,
          content: exported.body,
          contentType: exported.mime,
        },
      ],
    });

    const shouldMarkSent = dto.markSent !== false && preview.data.canMarkSent;
    let markedSent = false;
    if (shouldMarkSent) {
      await this.markSent(runId);
      markedSent = true;
    }

    return {
      message: markedSent
        ? 'Invoice emailed and run marked as sent'
        : 'Invoice emailed',
      data: {
        to,
        messageId: sent.messageId,
        mode: sent.mode,
        markedSent,
        runId,
        serviceUserId: dto.serviceUserId,
      },
    };
  }

  private buildFunderSummaries(
    lines: Array<{
      funderId: string | null;
      funderName: string;
      funderCode: string | null;
      serviceUserName: string;
      serviceUserNumber: string | null;
      visitRef: string | null;
      description: string;
      minutes: number | null;
      splitPercent: number | null;
      amount: string;
      amountValue: number;
    }>,
  ) {
    const groups = new Map<
      string,
      {
        funderId: string | null;
        funderName: string;
        funderCode: string | null;
        lines: typeof lines;
        subtotal: number;
      }
    >();

    for (const line of lines) {
      const key = line.funderId ?? '__direct__';
      const existing = groups.get(key);
      if (existing) {
        existing.lines.push(line);
        existing.subtotal += line.amountValue;
      } else {
        groups.set(key, {
          funderId: line.funderId,
          funderName: line.funderName,
          funderCode: line.funderCode,
          lines: [line],
          subtotal: line.amountValue,
        });
      }
    }

    return [...groups.values()]
      .sort((a, b) => a.funderName.localeCompare(b.funderName))
      .map((g) => ({
        funderId: g.funderId,
        funderName: g.funderName,
        funderCode: g.funderCode,
        lineCount: g.lines.length,
        subtotal: formatMoney(g.subtotal),
        subtotalValue: g.subtotal,
        lines: g.lines,
      }));
  }

  private mapRow(row: {
    id: string;
    periodLabel: string;
    periodStart: Date;
    periodEnd: Date;
    status: InvoiceRunStatus;
    serviceUserCount: number;
    funderCount: number;
    netTotal: Prisma.Decimal;
    exceptionCount: number;
    exportStatus: BillingRunExportStatus;
  }): InvoiceRunRow {
    return {
      id: row.id,
      period: row.periodLabel,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      status: row.status,
      serviceUsers: row.serviceUserCount,
      funders: row.funderCount,
      netTotal: formatMoney(Number(row.netTotal)),
      exceptions: row.exceptionCount,
      exportStatus: row.exportStatus,
    };
  }
}
