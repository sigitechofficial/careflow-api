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
import {
  CreateEmployeePayoutBatchDto,
  EmployeePayoutsQueryDto,
} from './dto/employee-payouts.dto';
import { formatMoney, parseBillingDateOnly } from './billing-run.util';
import { employeeIdsForLocation } from './billing-location-scope.util';
import {
  derivePeriodKeyFromRange,
  periodRangeFromKey,
} from './employee-payout-period.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { DEFAULT_OPERATIONAL_TIMEZONE } from '../common/utils/operational-day.util';

const OPEN_BATCH_STATUSES: EmployeePayoutBatchStatus[] = [
  EmployeePayoutBatchStatus.DRAFT,
  EmployeePayoutBatchStatus.APPROVED,
];

const PAYOUT_ELIGIBLE_UK_RUN_STATUSES = ['STATUTORY_CALCULATED', 'CLOSED'] as const;

export const AUTO_PAYOUT_NOTES = 'Auto-executed on the 4th of the month (UK net payout)';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Previous calendar month as YYYY-MM in the given IANA timezone. */
export function previousMonthPeriodKey(
  asOf: Date = new Date(),
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(asOf);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  return `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}`;
}

function periodKeyFromDates(periodStart: Date, periodEnd: Date): string {
  const dateFrom = periodStart.toISOString().slice(0, 10);
  const dateTo = periodEnd.toISOString().slice(0, 10);
  const derived = derivePeriodKeyFromRange(dateFrom, dateTo);
  if (derived) return derived;
  // Tax-year-clipped calendar months (e.g. 6–30 Apr) still map to YYYY-MM.
  if (
    periodStart.getUTCFullYear() === periodEnd.getUTCFullYear() &&
    periodStart.getUTCMonth() === periodEnd.getUTCMonth()
  ) {
    return `${periodStart.getUTCFullYear()}-${pad2(periodStart.getUTCMonth() + 1)}`;
  }
  return `${periodEnd.getUTCFullYear()}-${pad2(periodEnd.getUTCMonth() + 1)}`;
}

@Injectable()
export class EmployeePayoutsService {
  private readonly logger = new Logger(EmployeePayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async list(query: EmployeePayoutsQueryDto) {
    const where: Prisma.EmployeePayoutBatchWhereInput = {};
    if (query.periodKey) where.periodKey = query.periodKey;
    if (query.ukPayrollRunId) where.ukPayrollRunId = query.ukPayrollRunId;

    if (query.locationId) {
      const empIds = await employeeIdsForLocation(this.prisma, query.locationId);
      if (!empIds.length) {
        return { data: [] };
      }
      where.lines = { some: { employeeId: { in: empIds } } };
    }

    const rows = await this.prisma.employeePayoutBatch.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { lines: true } },
        ukPayrollRun: { select: { id: true, label: true, status: true } },
      },
    });

    return {
      data: rows.map((r) => this.mapBatchSummary(r)),
    };
  }

  async listPayoutEligibleUkRuns() {
    const rows = await this.prisma.ukPayrollRun.findMany({
      where: {
        deletedAt: null,
        status: { in: [...PAYOUT_ELIGIBLE_UK_RUN_STATUSES] },
        totalNetPay: { gt: 0 },
      },
      include: {
        period: { select: { periodStart: true, periodEnd: true, label: true } },
        _count: { select: { employees: true } },
      },
      orderBy: [{ statutoryCalculatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    return {
      data: rows.map((r) => ({
        id: r.id,
        label: r.label,
        status: r.status,
        totalNetPay: formatMoney(Number(r.totalNetPay)),
        totalNetPayValue: Number(r.totalNetPay),
        employeeCount: r._count.employees,
        periodLabel: r.period.label,
        periodStart: r.period.periodStart.toISOString().slice(0, 10),
        periodEnd: r.period.periodEnd.toISOString().slice(0, 10),
        periodKey: periodKeyFromDates(r.period.periodStart, r.period.periodEnd),
        statutoryCalculatedAt: r.statutoryCalculatedAt?.toISOString() ?? null,
      })),
    };
  }

  async getById(id: string) {
    const batch = await this.prisma.employeePayoutBatch.findUnique({
      where: { id },
      include: {
        lines: true,
        ukPayrollRun: { select: { id: true, label: true, status: true } },
      },
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
              ukPayrollRunEmployeeId: l.ukPayrollRunEmployeeId,
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
    const run = await this.prisma.ukPayrollRun.findFirst({
      where: { id: dto.ukPayrollRunId, deletedAt: null },
      include: {
        period: true,
        employees: true,
      },
    });
    if (!run) throw new NotFoundException('UK payroll run not found');

    if (
      !PAYOUT_ELIGIBLE_UK_RUN_STATUSES.includes(
        run.status as (typeof PAYOUT_ELIGIBLE_UK_RUN_STATUSES)[number],
      )
    ) {
      throw new BadRequestException(
        'UK payroll run must be STATUTORY_CALCULATED or CLOSED before creating a payout batch',
      );
    }

    const open = await this.prisma.employeePayoutBatch.findFirst({
      where: {
        ukPayrollRunId: run.id,
        status: { in: OPEN_BATCH_STATUSES },
      },
      select: { id: true, status: true },
    });
    if (open) {
      throw new ConflictException(
        `An open ${open.status.toLowerCase()} payout batch already exists for this UK payroll run`,
      );
    }

    const committed = await this.sumCommittedPayoutsByUkRun(run.id);
    const lineInputs: {
      employeeId: string;
      ukPayrollRunEmployeeId: string;
      amount: number;
    }[] = [];

    for (const emp of run.employees) {
      const net = Math.round(Number(emp.netPay) * 100) / 100;
      if (net <= 0) continue;
      const already = committed.get(emp.employeeId) ?? 0;
      const remaining = Math.round((net - already) * 100) / 100;
      if (remaining <= 0) continue;
      lineInputs.push({
        employeeId: emp.employeeId,
        ukPayrollRunEmployeeId: emp.id,
        amount: remaining,
      });
    }

    if (lineInputs.length === 0) {
      throw new BadRequestException(
        'No employees have outstanding UK net pay to include in a payout batch for this run',
      );
    }

    const totalAmount =
      Math.round(lineInputs.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const periodKey = periodKeyFromDates(run.period.periodStart, run.period.periodEnd);

    const created = await this.prisma.employeePayoutBatch.create({
      data: {
        ukPayrollRunId: run.id,
        periodKey,
        periodStart: run.period.periodStart,
        periodEnd: run.period.periodEnd,
        status: EmployeePayoutBatchStatus.DRAFT,
        currency: run.currency || 'GBP',
        totalAmount,
        notes: dto.notes?.trim() || null,
        createdById: userId,
        lines: {
          create: lineInputs.map((l) => ({
            employeeId: l.employeeId,
            ukPayrollRunEmployeeId: l.ukPayrollRunEmployeeId,
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

  async deleteAll(periodKey?: string): Promise<{ data: { deletedBatches: number } }> {
    const result = await this.prisma.employeePayoutBatch.deleteMany({
      where: periodKey ? { periodKey } : undefined,
    });
    this.logger.warn(
      `Purged ${result.count} employee payout batch(es)` +
        (periodKey ? ` for period ${periodKey}` : ' (all periods)'),
    );
    return { data: { deletedBatches: result.count } };
  }

  /**
   * Test/ops helper: remove all payout lines for one employee so Bank paid → £0.
   * Empty batches are deleted; remaining batches have totals recalculated.
   */
  async deleteLinesForEmployee(employeeId: string): Promise<{
    deletedLines: number;
    deletedBatches: number;
    updatedBatches: number;
  }> {
    const lines = await this.prisma.employeePayoutLine.findMany({
      where: { employeeId },
      select: { id: true, batchId: true },
    });
    if (lines.length === 0) {
      return { deletedLines: 0, deletedBatches: 0, updatedBatches: 0 };
    }

    const batchIds = [...new Set(lines.map((l) => l.batchId))];
    await this.prisma.employeePayoutLine.deleteMany({ where: { employeeId } });

    let deletedBatches = 0;
    let updatedBatches = 0;
    for (const batchId of batchIds) {
      const remaining = await this.prisma.employeePayoutLine.findMany({
        where: { batchId },
        select: { amount: true },
      });
      if (remaining.length === 0) {
        await this.prisma.employeePayoutBatch.delete({ where: { id: batchId } });
        deletedBatches += 1;
        continue;
      }
      const total = remaining.reduce((s, l) => s + Number(l.amount), 0);
      await this.prisma.employeePayoutBatch.update({
        where: { id: batchId },
        data: {
          totalAmount: Math.round(total * 100) / 100,
        },
      });
      updatedBatches += 1;
    }

    this.logger.warn(
      `Reset payouts for employee ${employeeId}: ${lines.length} line(s), ` +
        `${deletedBatches} empty batch(es) removed, ${updatedBatches} batch(es) retotalled`,
    );
    return {
      deletedLines: lines.length,
      deletedBatches,
      updatedBatches,
    };
  }

  /**
   * On the 4th: pay out eligible UK runs whose period falls in the previous calendar month.
   */
  async executeAutomaticMonthlyPayout(asOf: Date = new Date()): Promise<{
    periodKey: string;
    outcome: 'paid' | 'skipped';
    reason?: string;
    batchId?: string;
    paidBatchIds?: string[];
  }> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const periodKey = previousMonthPeriodKey(asOf, timeZone);
    const range = periodRangeFromKey(periodKey);
    const actorId = await this.resolveSystemActorId();
    if (!actorId) {
      return {
        periodKey,
        outcome: 'skipped',
        reason: 'No active user for audit actor',
      };
    }

    const runs = await this.prisma.ukPayrollRun.findMany({
      where: {
        deletedAt: null,
        status: { in: [...PAYOUT_ELIGIBLE_UK_RUN_STATUSES] },
        period: {
          periodStart: { lte: range.periodEnd },
          periodEnd: { gte: range.periodStart },
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (runs.length === 0) {
      return {
        periodKey,
        outcome: 'skipped',
        reason: 'No statutory/closed UK payroll run for previous month',
      };
    }

    const paidBatchIds: string[] = [];
    const skipReasons: string[] = [];

    for (const run of runs) {
      const open = await this.prisma.employeePayoutBatch.findFirst({
        where: {
          ukPayrollRunId: run.id,
          status: { in: OPEN_BATCH_STATUSES },
        },
        orderBy: { createdAt: 'asc' },
      });

      try {
        if (open?.status === EmployeePayoutBatchStatus.DRAFT) {
          await this.approve(actorId, open.id);
          await this.markPaid(actorId, open.id);
          paidBatchIds.push(open.id);
          continue;
        }
        if (open?.status === EmployeePayoutBatchStatus.APPROVED) {
          await this.markPaid(actorId, open.id);
          paidBatchIds.push(open.id);
          continue;
        }

        const created = await this.create(actorId, {
          ukPayrollRunId: run.id,
          notes: AUTO_PAYOUT_NOTES,
        });
        await this.approve(actorId, created.data.id);
        await this.markPaid(actorId, created.data.id);
        paidBatchIds.push(created.data.id);
      } catch (err) {
        if (err instanceof BadRequestException || err instanceof ConflictException) {
          skipReasons.push(
            typeof err.message === 'string' ? err.message : 'Skipped run',
          );
          continue;
        }
        throw err;
      }
    }

    if (paidBatchIds.length === 0) {
      return {
        periodKey,
        outcome: 'skipped',
        reason: skipReasons[0] ?? 'No outstanding UK net for previous month',
      };
    }

    this.logger.log(
      `Auto UK-net payout paid ${paidBatchIds.length} batch(es) for ${periodKey}`,
    );
    return {
      periodKey,
      outcome: 'paid',
      batchId: paidBatchIds[0],
      paidBatchIds,
    };
  }

  async sumCommittedPayoutsByUkRun(ukPayrollRunId: string): Promise<Map<string, number>> {
    const lines = await this.prisma.employeePayoutLine.findMany({
      where: {
        batch: {
          ukPayrollRunId,
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
   * UK net + bank paid maps for a salary date range (period overlap).
   */
  async ukNetAndPaidOutForDateRange(
    dateFrom?: string | null,
    dateTo?: string | null,
  ): Promise<{
    ukNetByEmployee: Map<string, number>;
    paidOutByEmployee: Map<string, number>;
    committedByEmployee: Map<string, number>;
    hasEligibleUkRun: boolean;
  }> {
    const ukNetByEmployee = new Map<string, number>();
    const paidOutByEmployee = new Map<string, number>();
    const committedByEmployee = new Map<string, number>();

    const periodFilter =
      dateFrom || dateTo
        ? {
            ...(dateFrom ? { periodEnd: { gte: parseBillingDateOnly(dateFrom) } } : {}),
            ...(dateTo ? { periodStart: { lte: parseBillingDateOnly(dateTo) } } : {}),
          }
        : {};

    const runs = await this.prisma.ukPayrollRun.findMany({
      where: {
        deletedAt: null,
        status: { in: [...PAYOUT_ELIGIBLE_UK_RUN_STATUSES] },
        ...(Object.keys(periodFilter).length
          ? { period: periodFilter }
          : {}),
      },
      select: {
        id: true,
        employees: { select: { employeeId: true, netPay: true } },
      },
    });

    for (const run of runs) {
      for (const emp of run.employees) {
        const net = Number(emp.netPay);
        if (net <= 0) continue;
        ukNetByEmployee.set(
          emp.employeeId,
          (ukNetByEmployee.get(emp.employeeId) ?? 0) + net,
        );
      }
    }

    const runIds = runs.map((r) => r.id);
    if (runIds.length) {
      const lines = await this.prisma.employeePayoutLine.findMany({
        where: {
          batch: {
            ukPayrollRunId: { in: runIds },
            status: { not: EmployeePayoutBatchStatus.CANCELLED },
          },
          status: {
            in: [EmployeePayoutLineStatus.PAID, EmployeePayoutLineStatus.PENDING],
          },
        },
        select: { employeeId: true, amount: true, status: true },
      });
      for (const line of lines) {
        const amount = Number(line.amount);
        committedByEmployee.set(
          line.employeeId,
          (committedByEmployee.get(line.employeeId) ?? 0) + amount,
        );
        if (line.status === EmployeePayoutLineStatus.PAID) {
          paidOutByEmployee.set(
            line.employeeId,
            (paidOutByEmployee.get(line.employeeId) ?? 0) + amount,
          );
        }
      }
    }

    return {
      ukNetByEmployee,
      paidOutByEmployee,
      committedByEmployee,
      hasEligibleUkRun: runs.length > 0,
    };
  }

  private async resolveSystemActorId(): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async requireBatch(id: string) {
    const batch = await this.prisma.employeePayoutBatch.findUnique({
      where: { id },
    });
    if (!batch) throw new NotFoundException('Payout batch not found');
    return batch;
  }

  private mapBatchSummary(batch: {
    id: string;
    periodKey: string;
    periodStart: Date;
    periodEnd: Date;
    status: EmployeePayoutBatchStatus;
    currency: string;
    totalAmount: Prisma.Decimal | number;
    createdAt: Date;
    updatedAt: Date;
    ukPayrollRunId?: string;
    ukPayrollRun?: { id: string; label: string; status: string } | null;
    _count?: { lines: number };
    lines?: unknown[];
  }) {
    const total = Number(batch.totalAmount);
    const lineCount =
      batch._count?.lines ??
      (Array.isArray(batch.lines) ? batch.lines.length : 0);
    return {
      id: batch.id,
      periodKey: batch.periodKey,
      periodStart: batch.periodStart.toISOString().slice(0, 10),
      periodEnd: batch.periodEnd.toISOString().slice(0, 10),
      ukPayrollRunId: batch.ukPayrollRunId ?? batch.ukPayrollRun?.id ?? null,
      ukPayrollRunLabel: batch.ukPayrollRun?.label ?? null,
      ukPayrollRunStatus: batch.ukPayrollRun?.status ?? null,
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
