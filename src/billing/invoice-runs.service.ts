import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingRunExportStatus,
  InvoiceRunLineType,
  InvoiceRunStatus,
  Prisma,
  VisitReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBillingRunDto } from './dto/billing-runs.dto';
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
  ) {}

  async list(query?: BillingRunsQueryDto) {
    const where: Prisma.InvoiceRunWhereInput = {};
    if (query?.locationId) {
      const suIds = await serviceUserIdsForLocation(this.prisma, query.locationId);
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
      ...new Set(lines.map((l) => l.funderId).filter((id): id is string => Boolean(id))),
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
      else byRun.set(line.invoiceRunId, { run: line.invoiceRun, lines: [line] });
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
            funderName: funder?.name ?? (l.funderId ? 'Unknown funder' : 'Direct / family'),
            funderCode: funder?.code ?? null,
            description: l.description,
            minutes: l.minutes,
            splitPercent: l.splitPercent != null ? Number(l.splitPercent) : null,
            amount: formatMoney(Number(l.amount)),
            amountValue: Number(l.amount),
            exceptionMessage: l.exceptionMessage,
          };
        });
        const funderSummaries = this.buildFunderSummaries(mappedLines);
        const subtotal = mappedLines.reduce((sum, l) => sum + l.amountValue, 0);
        const exceptionCount = mappedLines.filter((l) => l.exceptionMessage).length;
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
          canSend:
            run.status === InvoiceRunStatus.LOCKED || run.status === InvoiceRunStatus.APPROVED,
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
      ...new Set(row.lines.map((l) => l.funderId).filter((id): id is string => Boolean(id))),
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
            su.preferredName?.trim() ||
            `${su.firstName} ${su.lastName}`.trim(),
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
        funderName: funder?.name ?? (l.funderId ? 'Unknown funder' : 'Direct / family'),
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

  async create(userId: string, dto: CreateBillingRunDto) {
    const periodStart = parseBillingDateOnly(dto.periodStart);
    const periodEnd = parseBillingDateOnly(dto.periodEnd);
    if (periodEnd < periodStart) {
      throw new BadRequestException('Period end must be on or after period start');
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
      throw new BadRequestException(`Cannot recalculate invoice run in status ${run.status}`);
    }

    await this.prisma.invoiceRun.update({
      where: { id },
      data: { status: InvoiceRunStatus.CALCULATING },
    });

    const periodEnd = endOfBillingDate(run.periodEnd);
    const reconciliations = await this.prisma.visitReconciliation.findMany({
      where: {
        status: { in: INVOICE_ELIGIBLE_RECON },
        includedInInvoiceRunId: null,
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
      const billAmt = recon.billableAmount != null ? Number(recon.billableAmount) : 0;
      // FIXED multi-carer mode zeroes secondary carers — skip empty charge lines.
      if (billMins <= 0 && billAmt <= 0) {
        continue;
      }

      const issues: string[] = [];
      if (recon.billableAmount == null) issues.push('Billable amount not calculated');
      if (!recon.approvedBillStart || !recon.approvedBillEnd) {
        issues.push('Approved billable time missing');
      }
      if (!recon.chargeCardId) issues.push('Charge card missing');

      const total = recon.billableAmount != null ? Number(recon.billableAmount) : 0;
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
    let exportStatus: BillingRunExportStatus = BillingRunExportStatus.NOT_STARTED;
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
      throw new BadRequestException('Only runs ready for review can be approved');
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

  async lock(userId: string, id: string) {
    const run = await this.prisma.invoiceRun.findUnique({
      where: { id },
      include: { lines: { select: { visitReconciliationId: true } } },
    });
    if (!run) throw new NotFoundException('Invoice run not found');
    if (run.status !== InvoiceRunStatus.APPROVED) {
      throw new BadRequestException('Approve the invoice run before locking');
    }

    const reconIds = [...new Set(run.lines.map((l) => l.visitReconciliationId))];

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
        await tx.visitReconciliation.updateMany({
          where: { id: { in: reconIds } },
          data: { includedInInvoiceRunId: id },
        });
      }
    });

    return this.getById(id);
  }

  async markSent(id: string) {
    const run = await this.prisma.invoiceRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Invoice run not found');
    if (run.status !== InvoiceRunStatus.LOCKED && run.status !== InvoiceRunStatus.APPROVED) {
      throw new BadRequestException('Lock the invoice run before marking as sent');
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
