import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceRunStatus,
  PaymentMatchStatus,
  PaymentRecordStatus,
  PaymentType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddPaymentAllocationDto,
  CreatePaymentDto,
  PaymentsQueryDto,
} from './dto/payments.dto';
import { formatMoney, parseBillingDateOnly } from './billing-run.util';
import { serviceUserIdsForLocation } from './billing-location-scope.util';

const RECEIVABLE_STATUSES: InvoiceRunStatus[] = [
  InvoiceRunStatus.LOCKED,
  InvoiceRunStatus.SENT,
];

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  [PaymentType.COUNCIL_REMITTANCE]: 'Council remittance',
  [PaymentType.BANK_TRANSFER]: 'Bank transfer',
  [PaymentType.DIRECT_DEBIT]: 'Direct Debit',
  [PaymentType.CARD]: 'Card payment',
  [PaymentType.OTHER]: 'Other',
};

const MATCH_STATUS_LABELS: Record<PaymentMatchStatus, string> = {
  [PaymentMatchStatus.UNMATCHED]: 'Unmatched',
  [PaymentMatchStatus.PARTIALLY_MATCHED]: 'Partial match',
  [PaymentMatchStatus.FULLY_MATCHED]: 'Fully matched',
};

const AGED_DEBT_BUCKETS = [
  { key: '0-7', label: '0–7 days', minDays: 0, maxDays: 7 },
  { key: '8-30', label: '8–30 days', minDays: 8, maxDays: 30 },
  { key: '31-60', label: '31–60 days', minDays: 31, maxDays: 60 },
  { key: '61-90', label: '61–90 days', minDays: 61, maxDays: 90 },
  { key: '90+', label: '90+ days', minDays: 91, maxDays: null },
] as const;

export type PaymentRow = {
  id: string;
  reference: string;
  type: string;
  amount: string;
  received: string;
  matched: string;
  unmatched: string;
  status: string;
  recordStatus: PaymentRecordStatus;
  matchStatus: PaymentMatchStatus;
};

export type AgedDebtBucket = {
  bucket: string;
  count: number;
  amount: string;
};

export type OutstandingInvoiceRun = {
  id: string;
  period: string;
  netTotal: string;
  paidAmount: string;
  outstanding: string;
  dueDate: string;
};

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query?: PaymentsQueryDto) {
    const where: Prisma.PaymentWhereInput = {};
    if (query?.locationId) {
      const suIds = await serviceUserIdsForLocation(this.prisma, query.locationId);
      where.OR = [
        { allocations: { none: {} } },
        ...(suIds.length
          ? [
              {
                allocations: {
                  some: {
                    invoiceRun: {
                      lines: { some: { serviceUserId: { in: suIds } } },
                    },
                  },
                },
              },
            ]
          : []),
      ];
    }
    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
    });
    return { data: rows.map((r) => this.mapRow(r)) };
  }

  async getSummary() {
    const [unmatchedPayments, agedDebt] = await Promise.all([
      this.countUnmatchedPayments(),
      this.computeAgedDebt(),
    ]);
    const overdueInvoices = agedDebt
      .filter((b) => b.key !== '0-7')
      .reduce((sum, b) => sum + b.count, 0);
    const overdueAmount = agedDebt
      .filter((b) => b.key !== '0-7')
      .reduce((sum, b) => sum + this.parseMoney(b.amount), 0);

    return {
      data: {
        unmatchedPayments,
        overdueInvoices,
        overdueAmount: formatMoney(overdueAmount),
        agedDebt: agedDebt.map(({ bucket, count, amount }) => ({
          bucket,
          count,
          amount,
        })),
      },
    };
  }

  async getAgedDebt() {
    const buckets = await this.computeAgedDebt();
    return {
      data: buckets.map(({ bucket, count, amount }) => ({ bucket, count, amount })),
    };
  }

  async listOutstandingInvoiceRuns(locationId?: string) {
    const rows = await this.loadReceivableInvoiceRuns(locationId);
    return {
      data: rows
        .map((row) => this.mapOutstandingInvoiceRun(row))
        .filter((row) => this.parseMoney(row.outstanding) > 0),
    };
  }

  async getById(id: string) {
    const row = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        allocations: {
          include: { invoiceRun: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Payment not found');
    return {
      data: {
        ...this.mapRow(row),
        notes: row.notes,
        funderId: row.funderId,
        allocations: row.allocations.map((a) => ({
          id: a.id,
          invoiceRunId: a.invoiceRunId,
          period: a.invoiceRun.periodLabel,
          amount: formatMoney(Number(a.amount)),
          notes: a.notes,
        })),
      },
    };
  }

  async create(userId: string, dto: CreatePaymentDto) {
    const recordStatus = dto.recordStatus ?? PaymentRecordStatus.RECEIVED;
    if (recordStatus === PaymentRecordStatus.FAILED && dto.amount > 0) {
      throw new BadRequestException('Failed payments must have zero amount');
    }
    if (recordStatus !== PaymentRecordStatus.FAILED && dto.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const receivedDate = dto.receivedDate
      ? parseBillingDateOnly(dto.receivedDate)
      : null;
    if (recordStatus === PaymentRecordStatus.RECEIVED && !receivedDate) {
      throw new BadRequestException('Received date is required for received payments');
    }

    const allocations = dto.allocations ?? [];
    if (recordStatus === PaymentRecordStatus.FAILED && allocations.length > 0) {
      throw new BadRequestException('Failed payments cannot be allocated');
    }
    this.validateAllocationTotal(dto.amount, allocations);

    const created = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          reference: dto.reference.trim(),
          paymentType: dto.paymentType,
          amount: dto.amount,
          receivedDate,
          recordStatus,
          currency: 'GBP',
          funderId: dto.funderId ?? null,
          notes: dto.notes?.trim() || null,
          createdById: userId,
          matchStatus:
            recordStatus === PaymentRecordStatus.FAILED
              ? PaymentMatchStatus.UNMATCHED
              : allocations.length === 0
                ? PaymentMatchStatus.UNMATCHED
                : PaymentMatchStatus.PARTIALLY_MATCHED,
          matchedAmount: 0,
        },
      });

      let matchedAmount = 0;
      for (const allocation of allocations) {
        await this.assertAllocatableInvoiceRun(tx, allocation.invoiceRunId, allocation.amount);
        await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceRunId: allocation.invoiceRunId,
            amount: allocation.amount,
            notes: allocation.notes?.trim() || null,
            createdById: userId,
          },
        });
        matchedAmount += allocation.amount;
      }

      if (matchedAmount > 0) {
        return tx.payment.update({
          where: { id: payment.id },
          data: {
            matchedAmount,
            matchStatus: this.resolveMatchStatus(dto.amount, matchedAmount),
          },
        });
      }

      return payment;
    });

    return { message: 'Payment recorded', data: this.mapRow(created) };
  }

  async addAllocation(userId: string, paymentId: string, dto: AddPaymentAllocationDto) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { allocations: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.recordStatus !== PaymentRecordStatus.RECEIVED) {
      throw new BadRequestException('Only received payments can be allocated');
    }

    const existing = payment.allocations.find((a) => a.invoiceRunId === dto.invoiceRunId);
    if (existing) {
      throw new BadRequestException('This invoice run is already linked to the payment');
    }

    const newMatched = Number(payment.matchedAmount) + dto.amount;
    if (newMatched > Number(payment.amount) + 0.001) {
      throw new BadRequestException('Allocation exceeds payment amount');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.assertAllocatableInvoiceRun(tx, dto.invoiceRunId, dto.amount);
      await tx.paymentAllocation.create({
        data: {
          paymentId,
          invoiceRunId: dto.invoiceRunId,
          amount: dto.amount,
          notes: dto.notes?.trim() || null,
          createdById: userId,
        },
      });
      return tx.payment.update({
        where: { id: paymentId },
        data: {
          matchedAmount: newMatched,
          matchStatus: this.resolveMatchStatus(Number(payment.amount), newMatched),
        },
      });
    });

    return { message: 'Allocation added', data: this.mapRow(updated) };
  }

  async removeAllocation(paymentId: string, allocationId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { allocations: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const allocation = payment.allocations.find((a) => a.id === allocationId);
    if (!allocation) throw new NotFoundException('Allocation not found');

    const newMatched = Number(payment.matchedAmount) - Number(allocation.amount);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.paymentAllocation.delete({ where: { id: allocationId } });
      return tx.payment.update({
        where: { id: paymentId },
        data: {
          matchedAmount: Math.max(0, newMatched),
          matchStatus: this.resolveMatchStatus(
            Number(payment.amount),
            Math.max(0, newMatched),
          ),
        },
      });
    });

    return { message: 'Allocation removed', data: this.mapRow(updated) };
  }

  private mapRow(row: {
    id: string;
    reference: string;
    paymentType: PaymentType;
    amount: Prisma.Decimal | number;
    receivedDate: Date | null;
    recordStatus: PaymentRecordStatus;
    matchStatus: PaymentMatchStatus;
    matchedAmount: Prisma.Decimal | number;
    currency: string;
  }): PaymentRow {
    const amount = Number(row.amount);
    const matched = Number(row.matchedAmount);
    const unmatched = Math.max(0, amount - matched);

    const status =
      row.recordStatus === PaymentRecordStatus.FAILED
        ? 'Failed'
        : row.recordStatus === PaymentRecordStatus.REFUNDED
          ? 'Refunded'
          : MATCH_STATUS_LABELS[row.matchStatus];

    return {
      id: row.id,
      reference: row.reference,
      type: PAYMENT_TYPE_LABELS[row.paymentType],
      amount: formatMoney(amount, row.currency),
      received: row.receivedDate ? this.formatDateOnly(row.receivedDate) : '—',
      matched: row.recordStatus === PaymentRecordStatus.FAILED ? '—' : formatMoney(matched),
      unmatched:
        row.recordStatus === PaymentRecordStatus.FAILED ? '—' : formatMoney(unmatched),
      status,
      recordStatus: row.recordStatus,
      matchStatus: row.matchStatus,
    };
  }

  private formatDateOnly(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private parseMoney(value: string): number {
    return Number(value.replace(/[£,\s]/g, '')) || 0;
  }

  private resolveMatchStatus(amount: number, matched: number): PaymentMatchStatus {
    if (matched <= 0) return PaymentMatchStatus.UNMATCHED;
    if (matched + 0.001 >= amount) return PaymentMatchStatus.FULLY_MATCHED;
    return PaymentMatchStatus.PARTIALLY_MATCHED;
  }

  private validateAllocationTotal(
    paymentAmount: number,
    allocations: Array<{ amount: number }>,
  ) {
    const total = allocations.reduce((sum, a) => sum + a.amount, 0);
    if (total > paymentAmount + 0.001) {
      throw new BadRequestException('Allocations exceed payment amount');
    }
  }

  private async assertAllocatableInvoiceRun(
    tx: Prisma.TransactionClient,
    invoiceRunId: string,
    amount: number,
  ) {
    const invoiceRun = await tx.invoiceRun.findUnique({
      where: { id: invoiceRunId },
      include: { paymentAllocations: true },
    });
    if (!invoiceRun) throw new BadRequestException('Invoice run not found');
    if (!RECEIVABLE_STATUSES.includes(invoiceRun.status)) {
      throw new BadRequestException('Invoice run must be locked or sent before payment allocation');
    }

    const paid = invoiceRun.paymentAllocations.reduce(
      (sum, a) => sum + Number(a.amount),
      0,
    );
    const outstanding = Number(invoiceRun.netTotal) - paid;
    if (amount > outstanding + 0.001) {
      throw new BadRequestException(
        `Allocation exceeds outstanding invoice balance (${formatMoney(outstanding)})`,
      );
    }
  }

  private async countUnmatchedPayments(): Promise<number> {
    return this.prisma.payment.count({
      where: {
        recordStatus: PaymentRecordStatus.RECEIVED,
        matchStatus: {
          in: [PaymentMatchStatus.UNMATCHED, PaymentMatchStatus.PARTIALLY_MATCHED],
        },
      },
    });
  }

  private async loadReceivableInvoiceRuns(locationId?: string) {
    const where: Prisma.InvoiceRunWhereInput = {
      status: { in: RECEIVABLE_STATUSES },
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
    const invoiceRuns = await this.prisma.invoiceRun.findMany({
      where,
      include: { paymentAllocations: true },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
    return invoiceRuns;
  }

  private mapOutstandingInvoiceRun(row: {
    id: string;
    periodLabel: string;
    netTotal: Prisma.Decimal | number;
    sentAt: Date | null;
    lockedAt: Date | null;
    periodEnd: Date;
    paymentAllocations: Array<{ amount: Prisma.Decimal | number }>;
  }): OutstandingInvoiceRun {
    const paid = row.paymentAllocations.reduce((sum, a) => sum + Number(a.amount), 0);
    const netTotal = Number(row.netTotal);
    const outstanding = Math.max(0, netTotal - paid);
    const dueDate = row.sentAt ?? row.lockedAt ?? row.periodEnd;
    return {
      id: row.id,
      period: row.periodLabel,
      netTotal: formatMoney(netTotal),
      paidAmount: formatMoney(paid),
      outstanding: formatMoney(outstanding),
      dueDate: this.formatDateOnly(dueDate),
    };
  }

  private async computeAgedDebt(): Promise<
    Array<AgedDebtBucket & { key: string }>
  > {
    const invoiceRuns = await this.loadReceivableInvoiceRuns();
    const today = new Date();
    const todayUtc = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
    );

    const buckets = AGED_DEBT_BUCKETS.map((b) => ({
      ...b,
      count: 0,
      amount: 0,
    }));

    for (const run of invoiceRuns) {
      const outstandingRow = this.mapOutstandingInvoiceRun(run);
      const outstanding = this.parseMoney(outstandingRow.outstanding);
      if (outstanding <= 0) continue;

      const due = run.sentAt ?? run.lockedAt ?? run.periodEnd;
      const dueUtc = Date.UTC(
        due.getUTCFullYear(),
        due.getUTCMonth(),
        due.getUTCDate(),
      );
      const daysOverdue = Math.max(0, Math.floor((todayUtc - dueUtc) / 86400000));

      const bucket =
        buckets.find((b) =>
          b.maxDays == null ? daysOverdue >= b.minDays : daysOverdue >= b.minDays && daysOverdue <= b.maxDays,
        ) ?? buckets[buckets.length - 1];

      bucket.count += 1;
      bucket.amount += outstanding;
    }

    return buckets.map((b) => ({
      key: b.key,
      bucket: b.label,
      count: b.count,
      amount: formatMoney(b.amount),
    }));
  }
}
