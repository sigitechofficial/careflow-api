import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingFrequency,
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
  buildInvoiceExportVisitRow,
  buildInvoiceRunCsv,
  buildInvoiceRunXlsx,
  invoiceRunExportFilename,
  type InvoiceRunExportModel,
} from './invoice-run-export.util';
import { serviceUserIdsForLocation } from './billing-location-scope.util';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  getOperationalTimeZone,
} from '../common/utils/operational-day.util';
import {
  computeInvoiceDueDate,
  utcDateOnly,
} from './payment-terms.util';

const MUTABLE_STATUSES: InvoiceRunStatus[] = [
  InvoiceRunStatus.DRAFT,
  InvoiceRunStatus.EXCEPTION_FOUND,
  InvoiceRunStatus.READY_FOR_REVIEW,
];

const INVOICE_ELIGIBLE_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.APPROVED_FOR_INVOICE,
  VisitReconciliationStatus.APPROVED_FOR_BOTH,
];

/** QBO-style display number from the global sequence (INV-1001, INV-1002, …). */
function formatInvoiceNumber(sequenceValue: number): string {
  return `INV-${sequenceValue}`;
}

/**
 * Infer invoice-run cadence from period span (matches BillingRunPeriodDialog).
 * Returns null for custom spans so calculate does not filter by SU cadence.
 */
function resolveInvoiceRunCadence(
  periodStart: Date,
  periodEnd: Date,
): 'WEEKLY' | 'MONTHLY' | null {
  const start = Date.UTC(
    periodStart.getUTCFullYear(),
    periodStart.getUTCMonth(),
    periodStart.getUTCDate(),
  );
  const end = Date.UTC(
    periodEnd.getUTCFullYear(),
    periodEnd.getUTCMonth(),
    periodEnd.getUTCDate(),
  );
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days >= 6 && days <= 8) return 'WEEKLY';
  if (days >= 28 && days <= 31) return 'MONTHLY';
  return null;
}

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
  /** Per–service-user invoices on the run that are fully paid. */
  invoicesPaid: number;
  /** Per–service-user invoices with no payment yet. */
  invoicesUnpaid: number;
  /** Per–service-user invoices with some but not all payment. */
  invoicesPartPaid: number;
  /** Sum of payment allocations on the run. */
  paidAmount: string;
  paidAmountValue: number;
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
      include: {
        lines: {
          select: {
            serviceUserId: true,
            funderId: true,
            amount: true,
          },
        },
        paymentAllocations: {
          select: {
            amount: true,
            payment: {
              select: { serviceUserId: true, funderId: true },
            },
          },
        },
      },
    });
    return {
      data: rows.map((r) => {
        const paymentStats = this.computeListPaymentStats(
          r.lines,
          r.paymentAllocations,
        );
        return this.mapRow(r, paymentStats);
      }),
    };
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
        address: {
          select: {
            addressLine1: true,
            addressLine2: true,
            postcode: true,
          },
        },
      },
    });
    if (!serviceUser) throw new NotFoundException('Service user not found');

    const address = [
      serviceUser.address?.addressLine1,
      serviceUser.address?.addressLine2,
      serviceUser.address?.postcode,
    ]
      .filter(Boolean)
      .join(', ')
      .trim();
    const serviceUserName =
      serviceUser.preferredName?.trim() ||
      `${serviceUser.firstName} ${serviceUser.lastName}`.trim();

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
    const reconIds = [
      ...new Set(lines.map((l) => l.visitReconciliationId).filter(Boolean)),
    ];
    const [funders, recons, orgTz] = await Promise.all([
      funderIds.length
        ? this.prisma.funder.findMany({
            where: { id: { in: funderIds } },
            select: { id: true, name: true, code: true },
          })
        : Promise.resolve([]),
      reconIds.length
        ? this.prisma.visitReconciliation.findMany({
            where: { id: { in: reconIds } },
            select: {
              id: true,
              visitRef: true,
              employeeId: true,
              scheduledVisitId: true,
              plannedStartDateTime: true,
              plannedEndDateTime: true,
              actualStartDateTime: true,
              actualEndDateTime: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.organisationGeneralSettings.findFirst({
        select: { timezone: true },
      }),
    ]);
    const timeZone =
      getOperationalTimeZone(orgTz?.timezone) || DEFAULT_OPERATIONAL_TIMEZONE;
    const funderMap = new Map(funders.map((f) => [f.id, f]));
    const reconMap = new Map(recons.map((r) => [r.id, r]));

    const employeeIds = [
      ...new Set(
        recons
          .map((r) => r.employeeId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const scheduledVisitIds = [
      ...new Set(recons.map((r) => r.scheduledVisitId).filter(Boolean)),
    ];
    const [employees, scheduledVisits] = await Promise.all([
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: {
              id: true,
              personalDetail: {
                select: { firstName: true, lastName: true },
              },
            },
          })
        : Promise.resolve([]),
      scheduledVisitIds.length
        ? this.prisma.scheduledVisit.findMany({
            where: { id: { in: scheduledVisitIds } },
            select: {
              id: true,
              visitName: true,
              visitPlanSlot: {
                select: {
                  slotCode: true,
                  medicationRoundCode: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);
    const empMap = new Map(
      employees.map((e) => {
        const name = [e.personalDetail?.firstName, e.personalDetail?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();
        return [e.id, name] as const;
      }),
    );
    const visitSlotMap = new Map(
      scheduledVisits.map((v) => {
        const slot =
          v.visitName?.trim() ||
          v.visitPlanSlot?.medicationRoundCode?.trim() ||
          v.visitPlanSlot?.slotCode?.trim() ||
          '';
        return [v.id, slot] as const;
      }),
    );

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

    const runIdsForDocs = [...byRun.keys()];
    if (runIdsForDocs.length) {
      await this.prisma.$transaction(async (tx) => {
        for (const runId of runIdsForDocs) {
          await this.syncInvoiceDocuments(tx, runId, [serviceUserId]);
        }
      });
    }
    const suInvoiceDocs = runIdsForDocs.length
      ? await this.prisma.invoiceDocument.findMany({
          where: {
            invoiceRunId: { in: runIdsForDocs },
            serviceUserId,
          },
          select: {
            invoiceRunId: true,
            invoiceNumber: true,
            dueDate: true,
            invoiceDate: true,
            paymentTerms: true,
            lastSentAt: true,
          },
        })
      : [];
    const invoiceNumberByRun = new Map(
      suInvoiceDocs.map((d) => [d.invoiceRunId, d.invoiceNumber]),
    );
    const dueMetaByRun = new Map(
      suInvoiceDocs.map((d) => [
        d.invoiceRunId,
        {
          dueDate: d.dueDate?.toISOString().slice(0, 10) ?? null,
          invoiceDate: d.invoiceDate?.toISOString().slice(0, 10) ?? null,
          paymentTerms: d.paymentTerms ?? null,
          sentAt: d.lastSentAt?.toISOString() ?? null,
        },
      ]),
    );

    // Per-funder paid: each payment carries the funder that sent it, so attribute
    // allocations to (run, funder) to show how much each funder has settled.
    const runFunderAllocations = await this.prisma.paymentAllocation.findMany({
      where: { invoiceRunId: { in: runIdsForDocs } },
      select: {
        invoiceRunId: true,
        amount: true,
        payment: { select: { funderId: true, serviceUserId: true } },
      },
    });

    const runs = [...byRun.values()]
      .sort((a, b) => b.run.periodEnd.getTime() - a.run.periodEnd.getTime())
      .map(({ run, lines: runLines }) => {
        const mappedLines = runLines.map((l) => {
          const funder = l.funderId ? funderMap.get(l.funderId) : null;
          const recon = reconMap.get(l.visitReconciliationId);
          const visitDetails = recon
            ? buildInvoiceExportVisitRow({
                visitRef: recon.visitRef || l.visitRef,
                plannedStart: recon.plannedStartDateTime,
                plannedEnd: recon.plannedEndDateTime,
                actualStart: recon.actualStartDateTime,
                actualEnd: recon.actualEndDateTime,
                slot: visitSlotMap.get(recon.scheduledVisitId) ?? '',
                serviceUserName,
                carerName: recon.employeeId
                  ? (empMap.get(recon.employeeId) ?? '')
                  : '',
                address,
                funderName:
                  funder?.name ??
                  (l.funderId ? 'Unknown funder' : 'Direct / family'),
                amountValue: Number(l.amount),
                paidValue: 0,
                outstandingValue: 0,
                timeZone,
              })
            : null;
          return {
            id: l.id,
            visitRef: l.visitRef ?? visitDetails?.visitRef ?? null,
            serviceUserId: l.serviceUserId,
            serviceUserName,
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
            date: visitDetails?.date ?? null,
            slot: visitDetails?.slot || null,
            carerName: visitDetails?.carerName || null,
            plannedStart: visitDetails?.plannedStart || null,
            plannedEnd: visitDetails?.plannedEnd || null,
            actualStart: visitDetails?.actualStart || null,
            actualEnd: visitDetails?.actualEnd || null,
            plannedDuration: visitDetails?.plannedDuration || null,
            actualDuration: visitDetails?.actualDuration || null,
            durationVariance: visitDetails?.durationVariance || null,
            address: visitDetails?.address || address || null,
          };
        });
        const baseSummaries = this.buildFunderSummaries(mappedLines);
        const paidForSu = new Map<string, number>();
        let unscopedPaid = 0;
        let directToThisSu = 0;
        for (const a of runFunderAllocations.filter(
          (row) => row.invoiceRunId === run.id,
        )) {
          const amount = Number(a.amount);
          const paymentSuId = a.payment?.serviceUserId ?? null;
          // Payments tagged to another service user do not count here.
          if (paymentSuId && paymentSuId !== serviceUser.id) continue;
          if (paymentSuId === serviceUser.id) {
            directToThisSu += amount;
            const key = a.payment?.funderId ?? '__direct__';
            if (baseSummaries.some((fs) => (fs.funderId ?? '__direct__') === key)) {
              paidForSu.set(key, (paidForSu.get(key) ?? 0) + amount);
            } else {
              unscopedPaid += amount;
            }
            continue;
          }
          const key = a.payment?.funderId ?? '__direct__';
          if (key === '__direct__') {
            unscopedPaid += amount;
            continue;
          }
          if (baseSummaries.some((fs) => fs.funderId === key)) {
            paidForSu.set(key, (paidForSu.get(key) ?? 0) + amount);
          }
        }
        if (unscopedPaid > 0) {
          paidForSu.set(
            '__direct__',
            (paidForSu.get('__direct__') ?? 0) + unscopedPaid,
          );
        }
        const attributedPaid = this.attributePaidToFunders(
          baseSummaries.map((fs) => ({
            funderId: fs.funderId,
            subtotalValue: fs.subtotalValue,
          })),
          paidForSu,
        );
        const funderSummaries = baseSummaries.map((fs) => {
          const key = fs.funderId ?? '__direct__';
          const paidF = attributedPaid.get(key) ?? 0;
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
        });
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
        const paidFromFunders = funderSummaries.reduce(
          (s, f) => s + f.paidValue,
          0,
        );
        const paid = Math.min(
          Math.round(
            Math.max(paidFromFunders, Math.min(directToThisSu, subtotal)) * 100,
          ) / 100,
          Math.round(subtotal * 100) / 100,
        );
        const outstanding = Math.max(
          0,
          Math.round((subtotal - paid) * 100) / 100,
        );
        const paymentStatus: 'UNPAID' | 'PART_PAID' | 'PAID' =
          paid <= 0 ? 'UNPAID' : outstanding <= 0.001 ? 'PAID' : 'PART_PAID';
        const dueMeta = dueMetaByRun.get(run.id);
        return {
          id: run.id,
          period: run.periodLabel,
          periodStart: run.periodStart.toISOString().slice(0, 10),
          periodEnd: run.periodEnd.toISOString().slice(0, 10),
          status: run.status,
          exportStatus: run.exportStatus,
          sentAt: dueMeta?.sentAt ?? run.sentAt?.toISOString() ?? null,
          lockedAt: run.lockedAt?.toISOString() ?? null,
          invoiceNumber: invoiceNumberByRun.get(run.id) ?? null,
          dueDate: dueMeta?.dueDate ?? null,
          invoiceDate: dueMeta?.invoiceDate ?? null,
          paymentTerms: dueMeta?.paymentTerms ?? null,
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
            run.status === InvoiceRunStatus.APPROVED ||
            run.status === InvoiceRunStatus.LOCKED ||
            run.status === InvoiceRunStatus.SENT ||
            run.status === InvoiceRunStatus.PART_PAID ||
            run.status === InvoiceRunStatus.PAID,
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
      InvoiceRunStatus.DRAFT,
      InvoiceRunStatus.READY_FOR_REVIEW,
      InvoiceRunStatus.EXCEPTION_FOUND,
      InvoiceRunStatus.APPROVED,
      InvoiceRunStatus.LOCKED,
      InvoiceRunStatus.SENT,
      InvoiceRunStatus.PART_PAID,
      InvoiceRunStatus.PAID,
    ];
    const totalInvoiced = runs
      .filter((r) => invoicedStatuses.includes(r.status) && r.subtotalValue > 0)
      .reduce((sum, r) => sum + r.subtotalValue, 0);
    const totalPaid = runs
      .filter((r) => r.subtotalValue > 0)
      .reduce((sum, r) => sum + r.paidValue, 0);
    const openBalance = runs
      .filter((r) => r.subtotalValue > 0)
      .reduce((sum, r) => sum + r.outstandingValue, 0);

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
        totalPaid: formatMoney(totalPaid),
        totalPaidValue: Math.round(totalPaid * 100) / 100,
        openBalance: formatMoney(openBalance),
        openBalanceValue: Math.round(openBalance * 100) / 100,
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
        payment: { select: { funderId: true, serviceUserId: true } },
      },
    });
    const runFunderKey = (runId: string, funderId: string | null) =>
      `${runId}::${funderId ?? '__direct__'}`;
    const paidByRunFunder = new Map<string, number>();
    /** `${runId}::${serviceUserId}::${funderId}` — funder-tagged payments for one SU */
    const paidByRunSuFunder = new Map<string, number>();
    /** `${runId}::${serviceUserId}` — SU-tagged payments with no funder (whole invoice) */
    const paidByRunSuOrphan = new Map<string, number>();
    for (const a of funderAllocations) {
      const amount = Number(a.amount);
      const suId = a.payment?.serviceUserId ?? null;
      const funderId = a.payment?.funderId ?? null;
      if (suId) {
        if (funderId) {
          const key = `${a.invoiceRunId}::${suId}::${funderId}`;
          paidByRunSuFunder.set(key, (paidByRunSuFunder.get(key) ?? 0) + amount);
        } else {
          const key = `${a.invoiceRunId}::${suId}`;
          paidByRunSuOrphan.set(
            key,
            (paidByRunSuOrphan.get(key) ?? 0) + amount,
          );
        }
      } else {
        const key = runFunderKey(a.invoiceRunId, funderId);
        paidByRunFunder.set(key, (paidByRunFunder.get(key) ?? 0) + amount);
      }
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

    const invoiceDocs = await this.prisma.invoiceDocument.findMany({
      where: { invoiceRunId: { in: runIds } },
      select: {
        invoiceRunId: true,
        serviceUserId: true,
        invoiceNumber: true,
        dueDate: true,
        invoiceDate: true,
        paymentTerms: true,
      },
    });
    const invoiceNumberByRunSu = new Map(
      invoiceDocs.map((d) => [
        `${d.invoiceRunId}::${d.serviceUserId}`,
        d.invoiceNumber,
      ]),
    );
    const dueMetaByRunSu = new Map(
      invoiceDocs.map((d) => [
        `${d.invoiceRunId}::${d.serviceUserId}`,
        {
          dueDate: d.dueDate?.toISOString().slice(0, 10) ?? null,
          invoiceDate: d.invoiceDate?.toISOString().slice(0, 10) ?? null,
          paymentTerms: d.paymentTerms ?? null,
        },
      ]),
    );

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
      /** QBO-style sequential number, e.g. INV-1001 */
      invoiceNumber: string | null;
      dueDate: string | null;
      invoiceDate: string | null;
      paymentTerms: string | null;
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
      serviceUserId?: string;
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
          const taggedPaid =
            f.funderId != null
              ? Math.round(
                  (paidByRunSuFunder.get(
                    `${run.id}::${g.serviceUserId}::${f.funderId}`,
                  ) ?? 0) * 100,
                ) / 100
              : 0;
          const unscopedFunderPaid =
            Math.round(
              (paidByRunFunder.get(runFunderKey(run.id, f.funderId)) ?? 0) * 100,
            ) / 100;
          // Whole-invoice SU payments (no funder): share across this SU's funders by invoiced.
          const suOrphan =
            Math.round(
              (paidByRunSuOrphan.get(`${run.id}::${g.serviceUserId}`) ?? 0) *
                100,
            ) / 100;
          const suInvoicedTotal = Math.round(amount * 100) / 100;
          const orphanShare =
            suInvoicedTotal > 0.001
              ? Math.round(((invoiced / suInvoicedTotal) * suOrphan) * 100) / 100
              : 0;
          const paidF = Math.min(
            invoiced,
            taggedPaid + unscopedFunderPaid + orphanShare,
          );
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

      const suPaidTagged = Math.round(
        [...paidByRunSuFunder.entries()]
          .filter(([k]) => k.startsWith(`${run.id}::${g.serviceUserId}::`))
          .reduce((s, [, v]) => s + v, 0) * 100,
      ) / 100;
      const suPaidOrphan =
        Math.round(
          (paidByRunSuOrphan.get(`${run.id}::${g.serviceUserId}`) ?? 0) * 100,
        ) / 100;
      const paidFromFunders = funders.reduce((s, f) => s + f.paidValue, 0);
      const suPaid = Math.min(
        Math.round(amount * 100) / 100,
        Math.max(
          paidFromFunders,
          Math.min(suPaidTagged + suPaidOrphan, amount),
        ),
      );
      const suOutstanding = Math.max(
        0,
        Math.round((amount - suPaid) * 100) / 100,
      );
      const suPaymentStatus: 'UNPAID' | 'PART_PAID' | 'PAID' =
        suPaid <= 0 ? 'UNPAID' : suOutstanding <= 0.001 ? 'PAID' : 'PART_PAID';
      const receivable =
        run.status === InvoiceRunStatus.APPROVED ||
        run.status === InvoiceRunStatus.LOCKED ||
        run.status === InvoiceRunStatus.SENT ||
        run.status === InvoiceRunStatus.PART_PAID;

      row.months.push({
        runId: run.id,
        period: run.periodLabel,
        periodStart: run.periodStart.toISOString().slice(0, 10),
        periodEnd: run.periodEnd.toISOString().slice(0, 10),
        status: run.status,
        exportStatus: run.exportStatus,
        sent,
        sentAt: run.sentAt?.toISOString() ?? null,
        invoiceNumber:
          invoiceNumberByRunSu.get(`${run.id}::${g.serviceUserId}`) ?? null,
        dueDate:
          dueMetaByRunSu.get(`${run.id}::${g.serviceUserId}`)?.dueDate ?? null,
        invoiceDate:
          dueMetaByRunSu.get(`${run.id}::${g.serviceUserId}`)?.invoiceDate ??
          null,
        paymentTerms:
          dueMetaByRunSu.get(`${run.id}::${g.serviceUserId}`)?.paymentTerms ??
          null,
        lineCount: g._count._all,
        subtotal: formatMoney(amount),
        subtotalValue: Math.round(amount * 100) / 100,
        runNetTotal: formatMoney(runNetTotal),
        runNetTotalValue: Math.round(runNetTotal * 100) / 100,
        paid: formatMoney(suPaid),
        paidValue: suPaid,
        outstanding: formatMoney(suOutstanding),
        outstandingValue: suOutstanding,
        paymentStatus: suPaymentStatus,
        canRecordPayment: receivable && suOutstanding > 0.001,
        serviceUserId: g.serviceUserId,
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
        paymentAllocations: {
          select: {
            id: true,
            amount: true,
            createdAt: true,
            notes: true,
            payment: {
              select: {
                id: true,
                reference: true,
                amount: true,
                receivedDate: true,
                createdAt: true,
                paymentType: true,
                funderId: true,
                serviceUserId: true,
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Invoice run not found');

    // Backfill QBO-style numbers for runs calculated before InvoiceDocument existed.
    const suIdsOnRun = [...new Set(row.lines.map((l) => l.serviceUserId))];
    if (suIdsOnRun.length) {
      await this.prisma.$transaction(async (tx) => {
        await this.syncInvoiceDocuments(tx, id, suIdsOnRun);
      });
    }

    const documents = await this.prisma.invoiceDocument.findMany({
      where: { invoiceRunId: id },
      select: {
        serviceUserId: true,
        invoiceNumber: true,
        lastSentAt: true,
        dueDate: true,
        invoiceDate: true,
        paymentTerms: true,
      },
    });
    const invoiceNumberBySu = new Map(
      documents.map((d) => [d.serviceUserId, d.invoiceNumber]),
    );
    const lastSentAtBySu = new Map(
      documents
        .filter((d) => d.lastSentAt)
        .map((d) => [d.serviceUserId, d.lastSentAt!.toISOString()]),
    );
    const dueDateBySu = new Map(
      documents
        .filter((d) => d.dueDate)
        .map((d) => [d.serviceUserId, d.dueDate!.toISOString().slice(0, 10)]),
    );
    const invoiceDateBySu = new Map(
      documents.map((d) => [
        d.serviceUserId,
        (d.invoiceDate ?? d.lastSentAt)?.toISOString().slice(0, 10) ?? null,
      ]),
    );
    const paymentTermsBySu = new Map(
      documents
        .filter((d) => d.paymentTerms)
        .map((d) => [d.serviceUserId, d.paymentTerms!]),
    );

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
              invoiceBillingFrequency: true,
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
          invoiceBillingFrequency: su.invoiceBillingFrequency,
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

    const paidByFunder = new Map<string, number>();
    const paidByServiceUserDirect = new Map<string, number>();
    const paidByFunderUnscoped = new Map<string, number>();
    /** SU + funder tagged payments: `${serviceUserId}::${funderKey}` */
    const paidBySuFunder = new Map<string, number>();
    /** SU-tagged payments with no funder (whole-invoice remit) — fill remaining funder balances. */
    const paidBySuOrphan = new Map<string, number>();
    for (const a of row.paymentAllocations) {
      const amount = Number(a.amount);
      const funderKey = a.payment?.funderId ?? '__direct__';
      paidByFunder.set(funderKey, (paidByFunder.get(funderKey) ?? 0) + amount);
      const suId = a.payment?.serviceUserId ?? null;
      if (suId) {
        paidByServiceUserDirect.set(
          suId,
          (paidByServiceUserDirect.get(suId) ?? 0) + amount,
        );
        if (a.payment?.funderId) {
          const suFunderKey = `${suId}::${a.payment.funderId}`;
          paidBySuFunder.set(
            suFunderKey,
            (paidBySuFunder.get(suFunderKey) ?? 0) + amount,
          );
        } else {
          paidBySuOrphan.set(suId, (paidBySuOrphan.get(suId) ?? 0) + amount);
        }
      } else {
        paidByFunderUnscoped.set(
          funderKey,
          (paidByFunderUnscoped.get(funderKey) ?? 0) + amount,
        );
      }
    }

    const lines = row.lines.map((l) => {
      const su = serviceUserMap.get(l.serviceUserId);
      const funder = l.funderId ? funderMap.get(l.funderId) : null;
      return {
        id: l.id,
        visitRef: l.visitRef,
        serviceUserId: l.serviceUserId,
        serviceUserName: su?.name ?? 'Unknown service user',
        serviceUserNumber: su?.number ?? null,
        invoiceBillingFrequency:
          su?.invoiceBillingFrequency ?? BillingFrequency.WEEKLY,
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

    const baseSummaries = this.buildFunderSummaries(lines);
    const attributedPaid = this.attributePaidToFunders(
      baseSummaries.map((fs) => ({
        funderId: fs.funderId,
        subtotalValue: fs.subtotalValue,
      })),
      paidByFunder,
    );

    const funderSummaries = baseSummaries.map((fs) => {
      const key = fs.funderId ?? '__direct__';
      const paid = attributedPaid.get(key) ?? 0;
      const outstandingF = Math.max(
        0,
        Math.round((fs.subtotalValue - paid) * 100) / 100,
      );
      const paymentStatus: 'UNPAID' | 'PART_PAID' | 'PAID' =
        paid <= 0 ? 'UNPAID' : outstandingF <= 0.001 ? 'PAID' : 'PART_PAID';
      const { lines: _funderLines, ...funderRest } = fs;
      return {
        ...funderRest,
        paid: formatMoney(paid),
        paidValue: paid,
        outstanding: formatMoney(outstandingF),
        outstandingValue: outstandingF,
        paymentStatus,
      };
    });

    const funderTotals = new Map(
      funderSummaries.map((fs) => [
        fs.funderId ?? '__direct__',
        fs.subtotalValue,
      ]),
    );

    type HistoryEvent = {
      id: string;
      type: 'CREATED' | 'APPROVED' | 'LOCKED' | 'SENT' | 'PAYMENT';
      at: string;
      label: string;
      detail: string | null;
      amount: string | null;
      amountValue: number | null;
      reference: string | null;
      funderName: string | null;
    };

    const runMilestones: HistoryEvent[] = [
      {
        id: `created-${row.id}`,
        type: 'CREATED',
        at: row.createdAt.toISOString(),
        label: 'Invoice created',
        detail: row.periodLabel,
        amount: null,
        amountValue: null,
        reference: null,
        funderName: null,
      },
    ];
    if (row.approvedAt) {
      runMilestones.push({
        id: `approved-${row.id}`,
        type: 'APPROVED',
        at: row.approvedAt.toISOString(),
        label: 'Invoice approved',
        detail: null,
        amount: null,
        amountValue: null,
        reference: null,
        funderName: null,
      });
    }
    if (row.lockedAt) {
      runMilestones.push({
        id: `locked-${row.id}`,
        type: 'LOCKED',
        at: row.lockedAt.toISOString(),
        label: 'Invoice locked',
        detail: null,
        amount: null,
        amountValue: null,
        reference: null,
        funderName: null,
      });
    }
    // Per–service-user email times are attached below (InvoiceDocument.lastSentAt).
    // Run-level sentAt remains a fallback when a document has never been emailed.

    const serviceUserSummaries = this.buildServiceUserSummaries(lines).map(
      (su) => {
        let paidRaw = paidByServiceUserDirect.get(su.serviceUserId) ?? 0;
        // Funder-only payments (no service user tag) still share across clients on that funder.
        for (const line of su.lines) {
          const key = line.funderId ?? '__direct__';
          const funderTotal = funderTotals.get(key) ?? 0;
          const funderPaid = paidByFunderUnscoped.get(key) ?? 0;
          if (funderTotal > 0.001 && funderPaid > 0) {
            paidRaw += (line.amountValue / funderTotal) * funderPaid;
          }
        }
        const paid = Math.min(
          Math.round(paidRaw * 100) / 100,
          su.subtotalValue,
        );
        const outstandingSu = Math.max(
          0,
          Math.round((su.subtotalValue - paid) * 100) / 100,
        );
        const paymentStatus: 'UNPAID' | 'PART_PAID' | 'PAID' =
          paid <= 0
            ? 'UNPAID'
            : outstandingSu <= 0.001
              ? 'PAID'
              : 'PART_PAID';

        const suFunderKeys = new Set(
          su.funders.map((f) => f.funderId ?? '__direct__'),
        );

        const paidForSuFunders = new Map<string, number>();
        for (const f of su.funders) {
          const key = f.funderId ?? '__direct__';
          let paidF = 0;
          if (f.funderId) {
            paidF +=
              paidBySuFunder.get(`${su.serviceUserId}::${f.funderId}`) ?? 0;
          }
          // Funder remittance with no SU tag — share across clients on this funder.
          const funderTotal = funderTotals.get(key) ?? 0;
          const funderPaidUnscoped = paidByFunderUnscoped.get(key) ?? 0;
          if (funderTotal > 0.001 && funderPaidUnscoped > 0) {
            paidF += (f.invoicedValue / funderTotal) * funderPaidUnscoped;
          }
          paidForSuFunders.set(key, paidF);
        }
        const suOrphan = paidBySuOrphan.get(su.serviceUserId) ?? 0;
        if (suOrphan > 0.001) {
          paidForSuFunders.set('__su_orphan__', suOrphan);
        }
        const attributedSuPaid = this.attributePaidToFunders(
          su.funders.map((f) => ({
            funderId: f.funderId,
            subtotalValue: f.invoicedValue,
          })),
          paidForSuFunders,
        );
        const fundersWithPaid = su.funders.map((f) => {
          const key = f.funderId ?? '__direct__';
          const paidF = attributedSuPaid.get(key) ?? 0;
          const outstandingF = Math.max(
            0,
            Math.round((f.invoicedValue - paidF) * 100) / 100,
          );
          const funderPaymentStatus: 'UNPAID' | 'PART_PAID' | 'PAID' =
            paidF <= 0
              ? 'UNPAID'
              : outstandingF <= 0.001
                ? 'PAID'
                : 'PART_PAID';
          return {
            ...f,
            paid: formatMoney(paidF),
            paidValue: paidF,
            outstanding: formatMoney(outstandingF),
            outstandingValue: outstandingF,
            paymentStatus: funderPaymentStatus,
          };
        });

        const history: HistoryEvent[] = runMilestones.map((event) => {
          if (event.type !== 'CREATED') return { ...event };
          return {
            ...event,
            id: `created-${row.id}-${su.serviceUserId}`,
            amount: formatMoney(su.subtotalValue),
            amountValue: su.subtotalValue,
            detail: row.periodLabel
              ? `${row.periodLabel} · ${su.funderLabel}`
              : su.funderLabel,
          };
        });

        const sentAt = lastSentAtBySu.get(su.serviceUserId) ?? null;
        if (sentAt) {
          history.push({
            id: `sent-${row.id}-${su.serviceUserId}`,
            type: 'SENT',
            at: sentAt,
            label: 'Invoice emailed',
            detail: null,
            amount: null,
            amountValue: null,
            reference: null,
            funderName: null,
          });
        }

        let paidAt: string | null = null;
        for (const a of row.paymentAllocations) {
          const pay = a.payment;
          if (!pay) continue;
          const amount = Number(a.amount);
          const paymentSuId = pay.serviceUserId ?? null;
          const funderKey = pay.funderId ?? '__direct__';
          if (paymentSuId && paymentSuId !== su.serviceUserId) continue;
          if (!paymentSuId && !suFunderKeys.has(funderKey)) continue;

          let displayAmount = amount;
          if (!paymentSuId) {
            const funderTotal = funderTotals.get(funderKey) ?? 0;
            const suFunderInvoiced = su.lines
              .filter((l) => (l.funderId ?? '__direct__') === funderKey)
              .reduce((s, l) => s + l.amountValue, 0);
            displayAmount =
              funderTotal > 0.001
                ? Math.round((suFunderInvoiced / funderTotal) * amount * 100) /
                  100
                : 0;
            if (displayAmount <= 0.001) continue;
          }

          const funderName = pay.funderId
            ? (funderMap.get(pay.funderId)?.name ?? 'Unknown funder')
            : 'Direct / family';
          // Prefer allocation/payment createdAt so History shows real clock time,
          // not date-only receivedDate (which serialises as 00:00).
          const at = (a.createdAt ?? pay.createdAt).toISOString();
          if (!paidAt || at > paidAt) paidAt = at;
          history.push({
            id: a.id,
            type: 'PAYMENT',
            at,
            label: 'Payment recorded',
            detail: paymentSuId
              ? funderName
              : `${funderName} · shared remittance`,
            amount: formatMoney(displayAmount),
            amountValue: displayAmount,
            reference: pay.reference,
            funderName,
          });
        }

        history.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

        const { lines: _lines, ...summary } = su;
        return {
          ...summary,
          invoiceNumber:
            invoiceNumberBySu.get(su.serviceUserId) ?? null,
          funders: fundersWithPaid,
          paid: formatMoney(paid),
          paidValue: paid,
          outstanding: formatMoney(outstandingSu),
          outstandingValue: outstandingSu,
          paymentStatus,
          paidAt,
          sentAt,
          dueDate: dueDateBySu.get(su.serviceUserId) ?? null,
          invoiceDate: invoiceDateBySu.get(su.serviceUserId) ?? null,
          paymentTerms: paymentTermsBySu.get(su.serviceUserId) ?? null,
          exceptionCount: su.lines.filter((l) => l.exceptionMessage).length,
          history,
        };
      },
    );

    return {
      data: {
        ...this.mapRow(row, {
          invoicesPaid: serviceUserSummaries.filter(
            (s) => s.paymentStatus === 'PAID',
          ).length,
          invoicesUnpaid: serviceUserSummaries.filter(
            (s) => s.paymentStatus === 'UNPAID',
          ).length,
          invoicesPartPaid: serviceUserSummaries.filter(
            (s) => s.paymentStatus === 'PART_PAID',
          ).length,
          paidAmountValue: paidAmount,
        }),
        notes: row.notes,
        lineCount: row.lines.length,
        createdAt: row.createdAt.toISOString(),
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
        serviceUserSummaries,
      },
    };
  }

  /** Build a downloadable CSV or Excel of the invoice run's visits (one row per visit × funder). */
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
          select: {
            visitReconciliationId: true,
            serviceUserId: true,
            visitRef: true,
            funderId: true,
            amount: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Invoice run not found');
    if (serviceUserId && row.lines.length === 0) {
      throw new NotFoundException('No invoice lines for this service user on the run');
    }

    const reconIds = [
      ...new Set(row.lines.map((l) => l.visitReconciliationId).filter(Boolean)),
    ];
    const funderIds = [
      ...new Set(
        row.lines.map((l) => l.funderId).filter((fid): fid is string => Boolean(fid)),
      ),
    ];
    const [recons, orgTz, funders, allocations] = await Promise.all([
      reconIds.length
        ? this.prisma.visitReconciliation.findMany({
            where: { id: { in: reconIds } },
            select: {
              id: true,
              visitRef: true,
              serviceUserId: true,
              employeeId: true,
              scheduledVisitId: true,
              plannedStartDateTime: true,
              plannedEndDateTime: true,
              actualStartDateTime: true,
              actualEndDateTime: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.organisationGeneralSettings.findFirst({
        select: { timezone: true },
      }),
      funderIds.length
        ? this.prisma.funder.findMany({
            where: { id: { in: funderIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      this.prisma.paymentAllocation.findMany({
        where: { invoiceRunId: id },
        select: {
          amount: true,
          payment: { select: { funderId: true } },
        },
      }),
    ]);
    const timeZone = getOperationalTimeZone(orgTz?.timezone) || DEFAULT_OPERATIONAL_TIMEZONE;
    const reconMap = new Map(recons.map((r) => [r.id, r]));
    const funderNameMap = new Map(funders.map((f) => [f.id, f.name]));

    const funderKey = (funderId: string | null | undefined) =>
      funderId ?? '__direct__';
    const funderLabel = (funderId: string | null | undefined) =>
      funderId
        ? (funderNameMap.get(funderId) ?? 'Unknown funder')
        : 'Direct / family';

    // Invoiced per funder within this export scope (optionally one service user).
    const invoicedByFunder = new Map<string, number>();
    for (const line of row.lines) {
      const key = funderKey(line.funderId);
      invoicedByFunder.set(
        key,
        (invoicedByFunder.get(key) ?? 0) + Number(line.amount),
      );
    }

    // Payments recorded against this run, attributed by paying funder.
    const paidByFunder = new Map<string, number>();
    for (const a of allocations) {
      const key = funderKey(a.payment?.funderId ?? null);
      paidByFunder.set(key, (paidByFunder.get(key) ?? 0) + Number(a.amount));
    }

    const funderPayment = (funderId: string | null | undefined) => {
      const key = funderKey(funderId);
      const invoiced = Math.round((invoicedByFunder.get(key) ?? 0) * 100) / 100;
      const paidRaw = Math.round((paidByFunder.get(key) ?? 0) * 100) / 100;
      // Cap paid at invoiced for this export scope so a run-level remittance
      // does not show more paid than this CSV's lines cover.
      const paid = Math.min(paidRaw, invoiced);
      const outstanding = Math.max(0, Math.round((invoiced - paid) * 100) / 100);
      return { invoiced, paid, outstanding };
    };

    const serviceUserIds = [
      ...new Set([
        ...row.lines.map((l) => l.serviceUserId),
        ...recons.map((r) => r.serviceUserId),
      ]),
    ];
    const employeeIds = [
      ...new Set(
        recons
          .map((r) => r.employeeId)
          .filter((eid): eid is string => Boolean(eid)),
      ),
    ];
    const scheduledVisitIds = [
      ...new Set(recons.map((r) => r.scheduledVisitId).filter(Boolean)),
    ];

    const [serviceUsers, employees, scheduledVisits] = await Promise.all([
      serviceUserIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: serviceUserIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              address: {
                select: {
                  addressLine1: true,
                  addressLine2: true,
                  postcode: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: {
              id: true,
              personalDetail: {
                select: { firstName: true, lastName: true },
              },
            },
          })
        : Promise.resolve([]),
      scheduledVisitIds.length
        ? this.prisma.scheduledVisit.findMany({
            where: { id: { in: scheduledVisitIds } },
            select: {
              id: true,
              visitName: true,
              visitPlanSlot: {
                select: {
                  slotCode: true,
                  medicationRoundCode: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const suMap = new Map(
      serviceUsers.map((su) => {
        const address = [
          su.address?.addressLine1,
          su.address?.addressLine2,
          su.address?.postcode,
        ]
          .filter(Boolean)
          .join(', ')
          .trim();
        return [
          su.id,
          {
            name:
              su.preferredName?.trim() ||
              `${su.firstName} ${su.lastName}`.trim(),
            address,
          },
        ] as const;
      }),
    );
    const empMap = new Map(
      employees.map((e) => {
        const name = [
          e.personalDetail?.firstName,
          e.personalDetail?.lastName,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();
        return [e.id, name] as const;
      }),
    );
    const visitMap = new Map(
      scheduledVisits.map((v) => {
        const slot =
          v.visitName?.trim() ||
          v.visitPlanSlot?.medicationRoundCode?.trim() ||
          v.visitPlanSlot?.slotCode?.trim() ||
          '';
        return [v.id, slot] as const;
      }),
    );

    // One CSV row per invoice line (visit × funder share).
    const exportLines: InvoiceRunExportModel['lines'] = [];
    for (const line of row.lines) {
      const recon = reconMap.get(line.visitReconciliationId);
      const su = suMap.get(recon?.serviceUserId ?? line.serviceUserId);
      const pay = funderPayment(line.funderId);
      const funderName = funderLabel(line.funderId);
      const amountValue = Number(line.amount);
      if (!recon) {
        exportLines.push(
          buildInvoiceExportVisitRow({
            visitRef: line.visitRef,
            plannedStart: row.periodStart,
            plannedEnd: null,
            actualStart: null,
            actualEnd: null,
            slot: '',
            serviceUserName: su?.name ?? 'Unknown service user',
            carerName: '',
            address: su?.address ?? '',
            funderName,
            amountValue,
            paidValue: pay.paid,
            outstandingValue: pay.outstanding,
            timeZone,
          }),
        );
        continue;
      }
      exportLines.push(
        buildInvoiceExportVisitRow({
          visitRef: recon.visitRef || line.visitRef,
          plannedStart: recon.plannedStartDateTime,
          plannedEnd: recon.plannedEndDateTime,
          actualStart: recon.actualStartDateTime,
          actualEnd: recon.actualEndDateTime,
          slot: visitMap.get(recon.scheduledVisitId) ?? '',
          serviceUserName: su?.name ?? 'Unknown service user',
          carerName: recon.employeeId
            ? (empMap.get(recon.employeeId) ?? '')
            : '',
          address: su?.address ?? '',
          funderName,
          amountValue,
          paidValue: pay.paid,
          outstandingValue: pay.outstanding,
          timeZone,
        }),
      );
    }

    const funderSummaries = [...invoicedByFunder.keys()]
      .map((key) => {
        const funderId = key === '__direct__' ? null : key;
        const pay = funderPayment(funderId);
        return {
          funderName: funderLabel(funderId),
          invoicedValue: pay.invoiced,
          paidValue: pay.paid,
          outstandingValue: pay.outstanding,
        };
      })
      .sort((a, b) => a.funderName.localeCompare(b.funderName));

    const model: InvoiceRunExportModel = {
      periodLabel: row.periodLabel,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      status: row.status,
      currency: row.currency,
      netTotalValue: Number(row.netTotal),
      lines: exportLines,
      funderSummaries,
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

    const runCadence = resolveInvoiceRunCadence(run.periodStart, run.periodEnd);
    let eligibleRecons = reconciliations;
    if (runCadence) {
      const reconSuIds = [...new Set(reconciliations.map((r) => r.serviceUserId))];
      const suCadenceRows = reconSuIds.length
        ? await this.prisma.serviceUser.findMany({
            where: { id: { in: reconSuIds } },
            select: { id: true, invoiceBillingFrequency: true },
          })
        : [];
      const cadenceBySu = new Map(
        suCadenceRows.map((s) => [s.id, s.invoiceBillingFrequency]),
      );
      eligibleRecons = reconciliations.filter((r) => {
        const freq = cadenceBySu.get(r.serviceUserId) ?? BillingFrequency.WEEKLY;
        return freq === runCadence;
      });
    }

    const lineData: Prisma.InvoiceRunLineCreateManyInput[] = [];
    let exceptionCount = 0;
    let templateMissingCount = 0;
    const serviceUserIds = new Set<string>();
    const funderIds = new Set<string>();

    // Ensure an organisation-wide default exists for funders/contracts with no template.
    await this.invoiceTemplates.ensureOrganisationDefaultTemplate();

    for (const recon of eligibleRecons) {
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
      await this.syncInvoiceDocuments(
        tx,
        id,
        [...serviceUserIds],
      );
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
    const run = await this.prisma.invoiceRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Invoice run not found');
    const sendable: InvoiceRunStatus[] = [
      InvoiceRunStatus.APPROVED,
      InvoiceRunStatus.LOCKED,
      InvoiceRunStatus.SENT,
      InvoiceRunStatus.PART_PAID,
      InvoiceRunStatus.PAID,
    ];
    if (!sendable.includes(run.status)) {
      throw new BadRequestException(
        'Approve the invoice run before sending invoices',
      );
    }

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

    const emailedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.syncInvoiceDocuments(tx, runId, [dto.serviceUserId]);
      await tx.invoiceDocument.updateMany({
        where: { invoiceRunId: runId, serviceUserId: dto.serviceUserId },
        data: { lastSentAt: emailedAt },
      });
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

  /**
   * Map payment amounts onto funder invoice buckets.
   * Funder-tagged payments land on that funder; unscoped / orphan amounts
   * (no funder, or funder not on this run) fill remaining balances in order.
   */
  private attributePaidToFunders(
    funders: Array<{ funderId: string | null; subtotalValue: number }>,
    paidByFunder: Map<string, number>,
  ): Map<string, number> {
    const result = new Map<string, number>();
    const keys = funders.map((f) => f.funderId ?? '__direct__');
    const keySet = new Set(keys);
    let orphanPool = 0;

    for (const [key, amount] of paidByFunder) {
      const rounded = Math.round(amount * 100) / 100;
      if (keySet.has(key)) {
        result.set(key, (result.get(key) ?? 0) + rounded);
      } else {
        orphanPool += rounded;
      }
    }

    if (orphanPool > 0.001) {
      for (const f of funders) {
        if (orphanPool <= 0.001) break;
        const key = f.funderId ?? '__direct__';
        const already = result.get(key) ?? 0;
        const room = Math.max(0, Math.round((f.subtotalValue - already) * 100) / 100);
        const take = Math.min(room, orphanPool);
        if (take > 0.001) {
          result.set(key, Math.round((already + take) * 100) / 100);
          orphanPool = Math.round((orphanPool - take) * 100) / 100;
        }
      }
    }

    for (const f of funders) {
      const key = f.funderId ?? '__direct__';
      const paid = Math.min(result.get(key) ?? 0, f.subtotalValue);
      result.set(key, Math.round(paid * 100) / 100);
    }
    return result;
  }

  private buildFunderSummaries(
    lines: Array<{
      funderId: string | null;
      funderName: string;
      funderCode: string | null;
      serviceUserId?: string;
      serviceUserName: string;
      serviceUserNumber: string | null;
      visitRef: string | null;
      description: string;
      minutes: number | null;
      splitPercent: number | null;
      amount: string;
      amountValue: number;
      exceptionMessage?: string | null;
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

  /** One invoice per service user (all funders/lines for that person on the run). */
  private buildServiceUserSummaries(
    lines: Array<{
      id?: string;
      funderId: string | null;
      funderName: string;
      funderCode: string | null;
      serviceUserId: string;
      serviceUserName: string;
      serviceUserNumber: string | null;
      invoiceBillingFrequency?: BillingFrequency | string | null;
      visitRef: string | null;
      description: string;
      minutes: number | null;
      splitPercent: number | null;
      amount: string;
      amountValue: number;
      exceptionMessage?: string | null;
    }>,
  ) {
    const groups = new Map<
      string,
      {
        serviceUserId: string;
        serviceUserName: string;
        serviceUserNumber: string | null;
        invoiceBillingFrequency: string;
        lines: typeof lines;
        subtotal: number;
        funders: Map<
          string,
          { funderId: string | null; funderName: string; funderCode: string | null; amount: number }
        >;
      }
    >();

    for (const line of lines) {
      const existing = groups.get(line.serviceUserId);
      const funderKey = line.funderId ?? '__direct__';
      const cadence =
        line.invoiceBillingFrequency === BillingFrequency.MONTHLY ||
        line.invoiceBillingFrequency === 'MONTHLY'
          ? 'MONTHLY'
          : 'WEEKLY';
      if (existing) {
        existing.lines.push(line);
        existing.subtotal += line.amountValue;
        const f = existing.funders.get(funderKey);
        if (f) f.amount += line.amountValue;
        else {
          existing.funders.set(funderKey, {
            funderId: line.funderId,
            funderName: line.funderName,
            funderCode: line.funderCode,
            amount: line.amountValue,
          });
        }
      } else {
        groups.set(line.serviceUserId, {
          serviceUserId: line.serviceUserId,
          serviceUserName: line.serviceUserName,
          serviceUserNumber: line.serviceUserNumber,
          invoiceBillingFrequency: cadence,
          lines: [line],
          subtotal: line.amountValue,
          funders: new Map([
            [
              funderKey,
              {
                funderId: line.funderId,
                funderName: line.funderName,
                funderCode: line.funderCode,
                amount: line.amountValue,
              },
            ],
          ]),
        });
      }
    }

    return [...groups.values()]
      .sort((a, b) => a.serviceUserName.localeCompare(b.serviceUserName))
      .map((g) => {
        const funders = [...g.funders.values()]
          .sort((a, b) => a.funderName.localeCompare(b.funderName))
          .map((f) => ({
            funderId: f.funderId,
            funderName: f.funderName,
            funderCode: f.funderCode,
            invoiced: formatMoney(f.amount),
            invoicedValue: Math.round(f.amount * 100) / 100,
          }));
        return {
          serviceUserId: g.serviceUserId,
          serviceUserName: g.serviceUserName,
          serviceUserNumber: g.serviceUserNumber,
          invoiceBillingFrequency: g.invoiceBillingFrequency,
          lineCount: g.lines.length,
          funderCount: funders.length,
          funderLabel:
            funders.length === 1
              ? funders[0].funderName
              : funders.length > 1
                ? `${funders.length} funders`
                : 'Direct / family',
          funders,
          subtotal: formatMoney(g.subtotal),
          subtotalValue: Math.round(g.subtotal * 100) / 100,
          lines: g.lines,
        };
      });
  }

  /**
   * Ensure each service user on the run has a persisted QBO-style invoice number
   * and due date (invoiceDate + payment terms). Existing numbers are kept.
   */
  private async syncInvoiceDocuments(
    tx: Prisma.TransactionClient,
    invoiceRunId: string,
    serviceUserIds: string[],
  ): Promise<void> {
    const uniqueIds = [...new Set(serviceUserIds.filter(Boolean))];
    if (!uniqueIds.length) return;

    const existing = await tx.invoiceDocument.findMany({
      where: { invoiceRunId, serviceUserId: { in: uniqueIds } },
      select: {
        id: true,
        serviceUserId: true,
        invoiceDate: true,
        dueDate: true,
        paymentTerms: true,
        createdAt: true,
      },
    });
    const have = new Set(existing.map((d) => d.serviceUserId));
    const missing = uniqueIds.filter((id) => !have.has(id));

    const termsBySu = await this.resolvePaymentTermsByServiceUser(
      tx,
      uniqueIds,
    );
    const invoiceDate = utcDateOnly(new Date());

    for (const serviceUserId of missing) {
      const sequenceValue = await this.allocateInvoiceSequence(tx);
      const termsRaw = termsBySu.get(serviceUserId) ?? null;
      const { dueDate, paymentTermsLabel } = computeInvoiceDueDate(
        invoiceDate,
        termsRaw,
      );
      await tx.invoiceDocument.create({
        data: {
          invoiceRunId,
          serviceUserId,
          sequenceValue,
          invoiceNumber: formatInvoiceNumber(sequenceValue),
          invoiceDate,
          dueDate,
          paymentTerms: paymentTermsLabel,
        },
      });
    }

    // Backfill due dates on existing docs that pre-date this feature.
    for (const doc of existing) {
      if (doc.dueDate && doc.paymentTerms) continue;
      const termsRaw = doc.paymentTerms ?? termsBySu.get(doc.serviceUserId) ?? null;
      const invDate = doc.invoiceDate
        ? utcDateOnly(doc.invoiceDate)
        : utcDateOnly(doc.createdAt);
      const { dueDate, paymentTermsLabel } = computeInvoiceDueDate(
        invDate,
        termsRaw,
      );
      await tx.invoiceDocument.update({
        where: { id: doc.id },
        data: {
          invoiceDate: invDate,
          dueDate: doc.dueDate ?? dueDate,
          paymentTerms: doc.paymentTerms ?? paymentTermsLabel,
        },
      });
    }
  }

  /**
   * Funder payment terms for service users (QBO: terms on customer/payer).
   * Uses current funding's funder; falls back to primary active funding funder.
   */
  private async resolvePaymentTermsByServiceUser(
    db: Prisma.TransactionClient | PrismaService,
    serviceUserIds: string[],
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (!serviceUserIds.length) return out;

    const rows = await db.serviceUser.findMany({
      where: { id: { in: serviceUserIds }, deletedAt: null },
      select: {
        id: true,
        currentFunding: {
          select: {
            funder: { select: { paymentTerms: true } },
          },
        },
        fundings: {
          where: {
            deletedAt: null,
            status: { notIn: ['ENDED', 'REJECTED'] },
          },
          orderBy: [{ isPrimary: 'desc' }, { splitPriority: 'asc' }, { createdAt: 'asc' }],
          take: 5,
          select: {
            isPrimary: true,
            funder: { select: { paymentTerms: true } },
          },
        },
      },
    });

    for (const su of rows) {
      const fromCurrent = su.currentFunding?.funder?.paymentTerms?.trim() || null;
      const fromPrimary =
        su.fundings.find((f) => f.isPrimary)?.funder?.paymentTerms?.trim() ||
        su.fundings.find((f) => f.funder?.paymentTerms)?.funder?.paymentTerms?.trim() ||
        null;
      out.set(su.id, fromCurrent || fromPrimary || null);
    }
    for (const id of serviceUserIds) {
      if (!out.has(id)) out.set(id, null);
    }
    return out;
  }

  /** Atomic global increment — same pattern as IncidentNumberSequence / QBO DocNumber. */
  private async allocateInvoiceSequence(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>(Prisma.sql`
      INSERT INTO "billing"."InvoiceNumberSequence" ("id", "lastValue", "updatedAt")
      VALUES (1, 1001, now())
      ON CONFLICT ("id")
      DO UPDATE SET "lastValue" = "InvoiceNumberSequence"."lastValue" + 1, "updatedAt" = now()
      RETURNING "lastValue"
    `);
    return rows[0]?.lastValue ?? 1001;
  }

  /**
   * List-row payment rollup: count of per–service-user invoices by payment
   * status + total allocated paid amount (same attribution rules as getById).
   */
  private computeListPaymentStats(
    lines: Array<{
      serviceUserId: string;
      funderId: string | null;
      amount: Prisma.Decimal | number;
    }>,
    allocations: Array<{
      amount: Prisma.Decimal | number;
      payment: {
        serviceUserId: string | null;
        funderId: string | null;
      } | null;
    }>,
  ): {
    invoicesPaid: number;
    invoicesUnpaid: number;
    invoicesPartPaid: number;
    paidAmountValue: number;
  } {
    const paidAmountValue = Math.round(
      allocations.reduce((sum, a) => sum + Number(a.amount), 0) * 100,
    ) / 100;

    const suTotals = new Map<string, number>();
    const funderTotals = new Map<string, number>();
    const linesBySu = new Map<
      string,
      Array<{ funderId: string | null; amountValue: number }>
    >();

    for (const l of lines) {
      const amountValue = Number(l.amount);
      suTotals.set(
        l.serviceUserId,
        (suTotals.get(l.serviceUserId) ?? 0) + amountValue,
      );
      const funderKey = l.funderId ?? '__direct__';
      funderTotals.set(
        funderKey,
        (funderTotals.get(funderKey) ?? 0) + amountValue,
      );
      const suLines = linesBySu.get(l.serviceUserId) ?? [];
      suLines.push({ funderId: l.funderId, amountValue });
      linesBySu.set(l.serviceUserId, suLines);
    }

    const paidByServiceUserDirect = new Map<string, number>();
    const paidByFunderUnscoped = new Map<string, number>();
    for (const a of allocations) {
      const amount = Number(a.amount);
      const funderKey = a.payment?.funderId ?? '__direct__';
      const suId = a.payment?.serviceUserId ?? null;
      if (suId) {
        paidByServiceUserDirect.set(
          suId,
          (paidByServiceUserDirect.get(suId) ?? 0) + amount,
        );
      } else {
        paidByFunderUnscoped.set(
          funderKey,
          (paidByFunderUnscoped.get(funderKey) ?? 0) + amount,
        );
      }
    }

    let invoicesPaid = 0;
    let invoicesUnpaid = 0;
    let invoicesPartPaid = 0;

    for (const [serviceUserId, subtotalValue] of suTotals) {
      let paidRaw = paidByServiceUserDirect.get(serviceUserId) ?? 0;
      for (const line of linesBySu.get(serviceUserId) ?? []) {
        const key = line.funderId ?? '__direct__';
        const funderTotal = funderTotals.get(key) ?? 0;
        const funderPaid = paidByFunderUnscoped.get(key) ?? 0;
        if (funderTotal > 0.001 && funderPaid > 0) {
          paidRaw += (line.amountValue / funderTotal) * funderPaid;
        }
      }
      const paid = Math.min(Math.round(paidRaw * 100) / 100, subtotalValue);
      const outstanding = Math.max(
        0,
        Math.round((subtotalValue - paid) * 100) / 100,
      );
      if (paid <= 0) invoicesUnpaid += 1;
      else if (outstanding <= 0.001) invoicesPaid += 1;
      else invoicesPartPaid += 1;
    }

    return {
      invoicesPaid,
      invoicesUnpaid,
      invoicesPartPaid,
      paidAmountValue,
    };
  }

  private mapRow(
    row: {
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
    },
    paymentStats?: {
      invoicesPaid: number;
      invoicesUnpaid: number;
      invoicesPartPaid: number;
      paidAmountValue: number;
    },
  ): InvoiceRunRow {
    const paidAmountValue = paymentStats?.paidAmountValue ?? 0;
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
      invoicesPaid: paymentStats?.invoicesPaid ?? 0,
      invoicesUnpaid: paymentStats?.invoicesUnpaid ?? 0,
      invoicesPartPaid: paymentStats?.invoicesPartPaid ?? 0,
      paidAmount: formatMoney(paidAmountValue),
      paidAmountValue,
    };
  }
}
