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
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { assertDifferentUser, assertFinancialResetEnvironment } from './financial-controls.util';
import {
  assertPaymentTransition,
  paymentStateLabel,
  paymentStateOfBatch,
  type SettlementSource,
} from './payment-state.util';

const OPEN_BATCH_STATUSES: EmployeePayoutBatchStatus[] = [
  EmployeePayoutBatchStatus.DRAFT,
  EmployeePayoutBatchStatus.APPROVED,
];

/** Only a closed UK run has final net pay (year-to-date posted); payouts are prepared from those. */
const PAYOUT_ELIGIBLE_UK_RUN_STATUSES = ['CLOSED'] as const;

/** Runs whose net pay figure is shown on the earnings overview (not a payout permission). */
const UK_NET_VISIBLE_RUN_STATUSES = ['STATUTORY_CALCULATED', 'CLOSED'] as const;

export const AUTO_PAYOUT_NOTES =
  'Proposed automatically on the 4th of the month. Review, approve and record the bank payment.';

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
    private readonly audit: AuditLogsService,
  ) {}

  private auditBatch(
    action: AuditAction,
    userId: string | null,
    batchId: string,
    values: { oldValues?: Record<string, unknown>; newValues?: Record<string, unknown>; reason?: string | null },
    meta?: RequestAuditMeta,
    tx?: Prisma.TransactionClient,
  ) {
    return this.audit.logAudit({
      tx,
      userId: userId ?? undefined,
      module: AuditModule.BILLING,
      action,
      recordType: 'EmployeePayoutBatch',
      recordId: batchId,
      description: values.reason?.trim() || undefined,
      oldValues: values.oldValues,
      newValues: values.newValues,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
  }

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
        paymentReference: batch.paymentReference,
        settledOn: batch.settledOn?.toISOString().slice(0, 10) ?? null,
        settlementEvidence: batch.settlementEvidence,
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

  /** `userId` is null for a batch proposed by the scheduled job (no person prepared it). */
  async create(userId: string | null, dto: CreateEmployeePayoutBatchDto, meta?: RequestAuditMeta) {
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
        'Close the UK payroll run before creating a payout batch (net pay is final only once the run is closed)',
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
    await this.auditBatch(
      AuditAction.EMPLOYEE_PAYOUT_BATCH_CREATED,
      userId,
      created.id,
      {
        newValues: {
          ukPayrollRunId: run.id,
          periodKey,
          totalAmount: totalAmount.toFixed(2),
          lines: lineInputs.length,
          proposedByScheduledJob: userId == null,
        },
      },
      meta,
    );

    return this.getById(created.id);
  }

  async approve(userId: string, id: string, meta?: RequestAuditMeta) {
    const batch = await this.requireBatch(id);
    if (batch.status !== EmployeePayoutBatchStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT payout batches can be approved');
    }
    assertDifferentUser(
      batch.createdById,
      userId,
      'A payout batch must be approved by a different user from the one who created it.',
    );

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.employeePayoutBatch.updateMany({
        where: { id, status: EmployeePayoutBatchStatus.DRAFT },
        data: {
          status: EmployeePayoutBatchStatus.APPROVED,
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('This payout batch was changed by someone else. Reload and try again.');
      }
      await this.auditBatch(
        AuditAction.EMPLOYEE_PAYOUT_BATCH_APPROVED,
        userId,
        id,
        {
          oldValues: { status: batch.status },
          newValues: { status: EmployeePayoutBatchStatus.APPROVED, totalAmount: batch.totalAmount.toString() },
        },
        meta,
        tx,
      );
    });

    return this.getById(id);
  }

  /**
   * Record that an approved batch has left the bank. PAID means settled: it needs the bank or
   * provider reference and the value date, and it is audited. Nothing in the system sets PAID
   * without a person supplying that evidence.
   */
  async markPaid(
    userId: string,
    id: string,
    dto: { paymentReference?: string; settledOn?: string; settlementEvidence?: string },
    meta?: RequestAuditMeta,
  ) {
    const batch = await this.requireBatch(id);
    if (batch.status !== EmployeePayoutBatchStatus.APPROVED) {
      throw new BadRequestException('Only APPROVED payout batches can be marked paid');
    }
    const paymentReference = dto?.paymentReference?.trim();
    if (!paymentReference || paymentReference.length < 3) {
      throw new BadRequestException('Enter the bank or provider payment reference for this batch.');
    }
    if (!dto.settledOn || !/^\d{4}-\d{2}-\d{2}$/.test(dto.settledOn)) {
      throw new BadRequestException('Enter the date the payment left the account (YYYY-MM-DD).');
    }
    const settledOn = parseBillingDateOnly(dto.settledOn);
    if (settledOn.getTime() > Date.now()) {
      throw new BadRequestException('The payment date cannot be in the future.');
    }
    const settlementEvidence = dto.settlementEvidence?.trim() || null;

    // A reference typed by a person records the payment; it does not confirm settlement.
    assertPaymentTransition(paymentStateOfBatch(batch), 'MANUALLY_RECORDED');
    const settlementSource: SettlementSource = 'MANUAL_ENTRY';

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.employeePayoutBatch.updateMany({
        where: { id, status: EmployeePayoutBatchStatus.APPROVED },
        data: {
          status: EmployeePayoutBatchStatus.PAID,
          paidById: userId,
          paidAt: now,
          paymentReference,
          settledOn,
          settlementEvidence,
          settlementSource,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('This payout batch was changed by someone else. Reload and try again.');
      }
      await tx.employeePayoutLine.updateMany({
        where: {
          batchId: id,
          status: EmployeePayoutLineStatus.PENDING,
        },
        data: { status: EmployeePayoutLineStatus.PAID },
      });
      await this.auditBatch(
        AuditAction.EMPLOYEE_PAYOUT_BATCH_SETTLED,
        userId,
        id,
        {
          oldValues: { status: batch.status },
          newValues: {
            status: EmployeePayoutBatchStatus.PAID,
            totalAmount: batch.totalAmount.toString(),
            paymentReference,
            settledOn: dto.settledOn,
            settlementEvidence,
            settlementSource,
          },
        },
        meta,
        tx,
      );
    });

    return this.getById(id);
  }

  async cancel(userId: string, id: string, reason?: string, meta?: RequestAuditMeta) {
    const batch = await this.requireBatch(id);
    if (
      batch.status !== EmployeePayoutBatchStatus.DRAFT &&
      batch.status !== EmployeePayoutBatchStatus.APPROVED
    ) {
      throw new BadRequestException('Only DRAFT or APPROVED payout batches can be cancelled');
    }

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.employeePayoutBatch.updateMany({
        where: { id, status: batch.status },
        data: { status: EmployeePayoutBatchStatus.CANCELLED },
      });
      if (changed.count !== 1) {
        throw new ConflictException('This payout batch was changed by someone else. Reload and try again.');
      }
      await this.auditBatch(
        AuditAction.EMPLOYEE_PAYOUT_BATCH_CANCELLED,
        userId,
        id,
        {
          oldValues: { status: batch.status },
          newValues: { status: EmployeePayoutBatchStatus.CANCELLED },
          reason,
        },
        meta,
        tx,
      );
    });

    return this.getById(id);
  }

  /** Test reset only: refused in production and unless the server opts in (SI-06). */
  async deleteAll(
    userId: string,
    periodKey?: string,
    meta?: RequestAuditMeta,
  ): Promise<{ data: { deletedBatches: number } }> {
    assertFinancialResetEnvironment();
    const result = await this.prisma.employeePayoutBatch.deleteMany({
      where: periodKey ? { periodKey } : undefined,
    });
    this.logger.warn(
      `Purged ${result.count} employee payout batch(es)` +
        (periodKey ? ` for period ${periodKey}` : ' (all periods)'),
    );
    await this.audit.logAudit({
      userId,
      module: AuditModule.BILLING,
      action: AuditAction.FINANCIAL_TEST_DATA_RESET,
      recordType: 'EmployeePayoutBatch',
      recordId: periodKey ?? 'all',
      newValues: { operation: 'delete payout batches', deletedBatches: result.count },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
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
    assertFinancialResetEnvironment();
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
   * On the 4th: propose a DRAFT payout batch for each closed UK run of the previous calendar month
   * that has net pay outstanding and no open batch.
   *
   * The job never approves a batch and never marks one paid (SI-09). Approval needs a person other
   * than the one who prepared the batch, and PAID needs bank settlement evidence. A proposal has no
   * `createdById`: no user is credited with work the scheduler did.
   */
  async executeAutomaticMonthlyPayout(asOf: Date = new Date()): Promise<{
    periodKey: string;
    outcome: 'drafted' | 'skipped';
    reason?: string;
    batchId?: string;
    draftBatchIds?: string[];
  }> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const periodKey = previousMonthPeriodKey(asOf, timeZone);
    const range = periodRangeFromKey(periodKey);

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
        reason: 'No closed UK payroll run for previous month',
      };
    }

    const draftBatchIds: string[] = [];
    const skipReasons: string[] = [];

    for (const run of runs) {
      const open = await this.prisma.employeePayoutBatch.findFirst({
        where: {
          ukPayrollRunId: run.id,
          status: { in: OPEN_BATCH_STATUSES },
        },
        select: { id: true },
      });
      // A batch someone is already working on is theirs to approve and settle.
      if (open) {
        skipReasons.push('An open payout batch already exists for this run');
        continue;
      }

      try {
        const created = await this.create(null, {
          ukPayrollRunId: run.id,
          notes: AUTO_PAYOUT_NOTES,
        });
        draftBatchIds.push(created.data.id);
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

    if (draftBatchIds.length === 0) {
      return {
        periodKey,
        outcome: 'skipped',
        reason: skipReasons[0] ?? 'No outstanding UK net for previous month',
      };
    }

    this.logger.log(
      `Proposed ${draftBatchIds.length} draft payout batch(es) for ${periodKey}; awaiting approval and settlement`,
    );
    return {
      periodKey,
      outcome: 'drafted',
      batchId: draftBatchIds[0],
      draftBatchIds,
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
        status: { in: [...UK_NET_VISIBLE_RUN_STATUSES] },
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
    settlementSource?: string | null;
    _count?: { lines: number };
    lines?: unknown[];
  }) {
    const total = Number(batch.totalAmount);
    const paymentState = paymentStateOfBatch(batch);
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
      /** PAID means a person recorded the payment, unless a bank confirmed it (see payment-state.util). */
      paymentState,
      paymentStateLabel: paymentStateLabel(paymentState),
      settlementSource: batch.status === EmployeePayoutBatchStatus.PAID ? (batch.settlementSource ?? 'MANUAL_ENTRY') : null,
      settlementConfirmed: paymentState === 'CONFIRMED_SETTLEMENT',
      currency: batch.currency,
      totalAmount: formatMoney(total),
      totalAmountValue: total,
      lineCount,
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
    };
  }
}
