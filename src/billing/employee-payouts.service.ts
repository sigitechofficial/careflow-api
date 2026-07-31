import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeePayoutBatchStatus,
  EmployeePayoutLineStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollRunsService } from './payroll-runs.service';
import {
  CreateEmployeePayoutBatchDto,
  EmployeePayoutsQueryDto,
} from './dto/employee-payouts.dto';
import { formatMoney } from './billing-run.util';
import { periodRangeFromKey } from './employee-payout-period.util';

const OPEN_BATCH_STATUSES: EmployeePayoutBatchStatus[] = [
  EmployeePayoutBatchStatus.DRAFT,
  EmployeePayoutBatchStatus.APPROVED,
];

export const AUTO_PAYOUT_NOTES = 'Auto-executed on the 4th of the month (scheduled job)';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Previous calendar month as YYYY-MM (UTC). */
export function previousMonthPeriodKey(asOf: Date = new Date()): string {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth(); // 0-based current month
  const prev = new Date(Date.UTC(y, m - 1, 1));
  return `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}`;
}

@Injectable()
export class EmployeePayoutsService {
  private readonly logger = new Logger(EmployeePayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollRuns: PayrollRunsService,
  ) {}

  async list(query: EmployeePayoutsQueryDto) {
    const where: Prisma.EmployeePayoutBatchWhereInput = {};
    if (query.periodKey) where.periodKey = query.periodKey;

    const rows = await this.prisma.employeePayoutBatch.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { lines: true } },
      },
    });

    return {
      data: rows.map((r) => this.mapBatchSummary(r)),
    };
  }

  async getById(id: string) {
    const batch = await this.prisma.employeePayoutBatch.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!batch) throw new NotFoundException('Payout batch not found');

    const employeeIds = [...new Set(batch.lines.map((l) => l.employeeId))];
    const employees = employeeIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: employeeIds }, deletedAt: null },
          select: {
            id: true,
            personalDetail: { select: { firstName: true, lastName: true } },
            employment: { select: { employeeNumber: true } },
          },
        })
      : [];

    const empMeta = new Map(
      employees.map((e) => {
        const name =
          [e.personalDetail?.firstName, e.personalDetail?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || 'Unknown';
        return [
          e.id,
          { name, employeeNumber: e.employment?.employeeNumber ?? null },
        ] as const;
      }),
    );

    return {
      data: {
        ...this.mapBatchSummary(batch),
        notes: batch.notes,
        createdById: batch.createdById,
        approvedById: batch.approvedById,
        approvedAt: batch.approvedAt?.toISOString() ?? null,
        paidById: batch.paidById,
        paidAt: batch.paidAt?.toISOString() ?? null,
        lines: batch.lines
          .map((l) => {
            const meta = empMeta.get(l.employeeId);
            return {
              id: l.id,
              employeeId: l.employeeId,
              employeeName: meta?.name ?? 'Unknown',
              employeeNumber: meta?.employeeNumber ?? null,
              amount: formatMoney(Number(l.amount)),
              amountValue: Number(l.amount),
              status: l.status,
              notes: l.notes,
            };
          })
          .sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
      },
    };
  }

  async create(userId: string, dto: CreateEmployeePayoutBatchDto) {
    const { periodKey } = dto;
    const range = periodRangeFromKey(periodKey);

    const open = await this.prisma.employeePayoutBatch.findFirst({
      where: {
        periodKey,
        status: { in: OPEN_BATCH_STATUSES },
      },
      select: { id: true, status: true },
    });
    if (open) {
      throw new ConflictException(
        `An open ${open.status.toLowerCase()} payout batch already exists for ${periodKey}`,
      );
    }

    const salary = await this.payrollRuns.listEmployeeSalaries({
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    });
    const rows = salary.data.rows as Array<{
      employeeId: string;
      netSalaryAmountValue: number;
    }>;

    const committed = await this.sumCommittedPayoutsByEmployee(periodKey);
    const lineInputs: { employeeId: string; amount: number }[] = [];
    for (const row of rows) {
      const net = Number(row.netSalaryAmountValue) || 0;
      if (net <= 0) continue;
      const already = committed.get(row.employeeId) ?? 0;
      const remaining = Math.round((net - already) * 100) / 100;
      if (remaining <= 0) continue;
      lineInputs.push({ employeeId: row.employeeId, amount: remaining });
    }

    if (lineInputs.length === 0) {
      throw new BadRequestException(
        'No employees have outstanding visit-pay net to include in a payout batch for this period',
      );
    }

    const totalAmount =
      Math.round(lineInputs.reduce((s, l) => s + l.amount, 0) * 100) / 100;

    const created = await this.prisma.employeePayoutBatch.create({
      data: {
        periodKey,
        periodStart: range.periodStart,
        periodEnd: range.periodEnd,
        status: EmployeePayoutBatchStatus.DRAFT,
        currency: 'GBP',
        totalAmount,
        notes: dto.notes?.trim() || null,
        createdById: userId,
        lines: {
          create: lineInputs.map((l) => ({
            employeeId: l.employeeId,
            amount: l.amount,
            status: EmployeePayoutLineStatus.PENDING,
          })),
        },
      },
    });

    return this.getById(created.id);
  }

  async approve(userId: string, id: string) {
    const batch = await this.requireBatch(id);
    if (batch.status !== EmployeePayoutBatchStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT payout batches can be approved');
    }

    await this.prisma.employeePayoutBatch.update({
      where: { id },
      data: {
        status: EmployeePayoutBatchStatus.APPROVED,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });

    return this.getById(id);
  }

  async markPaid(userId: string, id: string) {
    const batch = await this.requireBatch(id);
    if (batch.status !== EmployeePayoutBatchStatus.APPROVED) {
      throw new BadRequestException('Only APPROVED payout batches can be marked paid');
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.employeePayoutBatch.update({
        where: { id },
        data: {
          status: EmployeePayoutBatchStatus.PAID,
          paidById: userId,
          paidAt: now,
        },
      }),
      this.prisma.employeePayoutLine.updateMany({
        where: {
          batchId: id,
          status: EmployeePayoutLineStatus.PENDING,
        },
        data: { status: EmployeePayoutLineStatus.PAID },
      }),
    ]);

    return this.getById(id);
  }

  async cancel(userId: string, id: string) {
    void userId;
    const batch = await this.requireBatch(id);
    if (
      batch.status !== EmployeePayoutBatchStatus.DRAFT &&
      batch.status !== EmployeePayoutBatchStatus.APPROVED
    ) {
      throw new BadRequestException('Only DRAFT or APPROVED payout batches can be cancelled');
    }

    await this.prisma.employeePayoutBatch.update({
      where: { id },
      data: { status: EmployeePayoutBatchStatus.CANCELLED },
    });

    return this.getById(id);
  }

  /**
   * Scheduled on the 4th of each month: pay out previous calendar month visit-pay net.
   * Completes any open DRAFT/APPROVED batch, otherwise creates → approves → marks paid.
   * Idempotent when there is nothing outstanding.
   */
  async executeAutomaticMonthlyPayout(asOf: Date = new Date()): Promise<{
    periodKey: string;
    outcome: 'paid' | 'skipped';
    reason?: string;
    batchId?: string;
  }> {
    const periodKey = previousMonthPeriodKey(asOf);
    const actorId = await this.resolveSystemActorId();
    if (!actorId) {
      this.logger.warn(
        `Auto payout skipped for ${periodKey} — no active user for audit actor`,
      );
      return {
        periodKey,
        outcome: 'skipped',
        reason: 'No active user for audit actor',
      };
    }

    const open = await this.prisma.employeePayoutBatch.findFirst({
      where: {
        periodKey,
        status: { in: OPEN_BATCH_STATUSES },
      },
      orderBy: { createdAt: 'asc' },
    });

    try {
      if (open?.status === EmployeePayoutBatchStatus.DRAFT) {
        await this.approve(actorId, open.id);
        const paid = await this.markPaid(actorId, open.id);
        this.logger.log(
          `Auto payout completed open DRAFT ${open.id} for ${periodKey} (${paid.data.totalAmount})`,
        );
        return { periodKey, outcome: 'paid', batchId: open.id };
      }

      if (open?.status === EmployeePayoutBatchStatus.APPROVED) {
        const paid = await this.markPaid(actorId, open.id);
        this.logger.log(
          `Auto payout completed open APPROVED ${open.id} for ${periodKey} (${paid.data.totalAmount})`,
        );
        return { periodKey, outcome: 'paid', batchId: open.id };
      }

      const created = await this.create(actorId, {
        periodKey,
        notes: AUTO_PAYOUT_NOTES,
      });
      const batchId = created.data.id;
      await this.approve(actorId, batchId);
      const paid = await this.markPaid(actorId, batchId);
      this.logger.log(
        `Auto payout created and paid ${batchId} for ${periodKey} (${paid.data.totalAmount})`,
      );
      return { periodKey, outcome: 'paid', batchId };
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof ConflictException) {
        const reason =
          typeof err.message === 'string'
            ? err.message
            : 'No outstanding payout for period';
        this.logger.log(`Auto payout skipped for ${periodKey}: ${reason}`);
        return { periodKey, outcome: 'skipped', reason };
      }
      throw err;
    }
  }

  private async resolveSystemActorId(): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /**
   * Sum of PAID line amounts + PENDING amounts in non-cancelled batches, per employee.
   */
  async sumCommittedPayoutsByEmployee(
    periodKey: string,
  ): Promise<Map<string, number>> {
    const lines = await this.prisma.employeePayoutLine.findMany({
      where: {
        batch: {
          periodKey,
          status: { not: EmployeePayoutBatchStatus.CANCELLED },
        },
        status: {
          in: [EmployeePayoutLineStatus.PAID, EmployeePayoutLineStatus.PENDING],
        },
      },
      select: { employeeId: true, amount: true },
    });

    const map = new Map<string, number>();
    for (const l of lines) {
      map.set(l.employeeId, (map.get(l.employeeId) ?? 0) + Number(l.amount));
    }
    return map;
  }

  /**
   * Paid-out (bank) amounts only — PAID lines for the period.
   */
  async sumPaidOutByEmployee(periodKey: string): Promise<Map<string, number>> {
    const lines = await this.prisma.employeePayoutLine.findMany({
      where: {
        status: EmployeePayoutLineStatus.PAID,
        batch: {
          periodKey,
          status: { not: EmployeePayoutBatchStatus.CANCELLED },
        },
      },
      select: { employeeId: true, amount: true },
    });

    const map = new Map<string, number>();
    for (const l of lines) {
      map.set(l.employeeId, (map.get(l.employeeId) ?? 0) + Number(l.amount));
    }
    return map;
  }

  private async requireBatch(id: string) {
    const batch = await this.prisma.employeePayoutBatch.findUnique({
      where: { id },
    });
    if (!batch) throw new NotFoundException('Payout batch not found');
    return batch;
  }

  private mapBatchSummary(
    batch: {
      id: string;
      periodKey: string;
      periodStart: Date;
      periodEnd: Date;
      status: EmployeePayoutBatchStatus;
      currency: string;
      totalAmount: Prisma.Decimal | number;
      createdAt: Date;
      updatedAt: Date;
      _count?: { lines: number };
      lines?: unknown[];
    },
  ) {
    const total = Number(batch.totalAmount);
    const lineCount =
      batch._count?.lines ??
      (Array.isArray(batch.lines) ? batch.lines.length : 0);
    return {
      id: batch.id,
      periodKey: batch.periodKey,
      periodStart: batch.periodStart.toISOString().slice(0, 10),
      periodEnd: batch.periodEnd.toISOString().slice(0, 10),
      status: batch.status,
      currency: batch.currency,
      totalAmount: formatMoney(total),
      totalAmountValue: total,
      lineCount,
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
    };
  }
}
