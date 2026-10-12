import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PayCardsService } from './billing-cards.service';
import { PayCardConflictException } from './pay-card-assignment.util';
import { CreatePayItemDto, PayItemQueryDto, PayItemSuggestionQueryDto } from './dto/pay-items.dto';
import {
  PAY_ITEM_CONFIG,
  cardRuleOfType,
  isPayItemWageType,
  payItemAmount,
  roundPence,
  type PayItemUnit,
  type PayItemWageTypeCode,
} from './pay-items.util';

import { correctionDifference, isPaySettled, payCorrectionDisplayStatus } from './pay-settlement.util';

const toDate = (key: string) => new Date(`${key.slice(0, 10)}T00:00:00.000Z`);
const DAY_MS = 24 * 60 * 60 * 1000;

type Suggestion = {
  rate: number | null;
  source: 'PAY_CARD' | 'AVERAGE_PAY' | null;
  explanation: string;
  payCardId: string | null;
  payCardVersion: number | null;
};

@Injectable()
export class PayItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly payCards: PayCardsService,
  ) {}

  private async userNames(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]));
  }

  async list(query: PayItemQueryDto) {
    const where: Prisma.EmployeePayItemWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.wageTypeCode) where.wageTypeCode = query.wageTypeCode;
    const rows = await this.prisma.employeePayItem.findMany({
      where,
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } },
      select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
    });
    const employeeName = new Map(
      employees.map((e) => [e.id, [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ') || 'Carer']),
    );
    const names = await this.userNames(rows.flatMap((r) => [r.createdById, r.approvedById, r.rejectedById]));
    const runs = await this.prisma.payrollRun.findMany({
      where: { id: { in: rows.map((r) => r.includedInPayrollRunId).filter((v): v is string => !!v) } },
      select: { id: true, periodLabel: true },
    });
    const runLabel = new Map(runs.map((r) => [r.id, r.periodLabel]));
    return {
      data: rows.map((r) => ({
        ...r,
        employeeName: employeeName.get(r.employeeId) ?? 'Carer',
        createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
        approvedByName: r.approvedById ? (names.get(r.approvedById) ?? null) : null,
        rejectedByName: r.rejectedById ? (names.get(r.rejectedById) ?? null) : null,
        payrollRunLabel: r.includedInPayrollRunId ? (runLabel.get(r.includedInPayrollRunId) ?? null) : null,
        requiresSecondApprover: isPayItemWageType(r.wageTypeCode)
          ? PAY_ITEM_CONFIG[r.wageTypeCode].requiresSecondApprover
          : false,
      })),
    };
  }

  /**
   * Default rate for a pay item: the carer's pay card rate (on-call, live-in, training) on that date,
   * or — for holiday pay — the carer's average hourly / daily visit pay over the previous 52 weeks.
   * Always a suggestion: the person entering the item can change it.
   */
  async suggestRate(query: PayItemSuggestionQueryDto): Promise<{ data: Suggestion }> {
    const code = query.wageTypeCode as PayItemWageTypeCode;
    const unit = query.unit as PayItemUnit;
    const at = toDate(query.date);
    const config = PAY_ITEM_CONFIG[code];
    const cardRateType = config.cardRateType?.[unit];
    if (cardRateType) {
      const resolved = await this.payCards.resolveRulesForEmployeeAt(query.employeeId, at);
      const rule = resolved ? cardRuleOfType(resolved.rules, cardRateType) : null;
      if (resolved && rule) {
        return {
          data: {
            rate: Number(rule.amount),
            source: 'PAY_CARD',
            explanation: `${resolved.card.name} (v${resolved.version}) — ${rule.label ?? cardRateType}`,
            payCardId: resolved.card.id,
            payCardVersion: resolved.version,
          },
        };
      }
      return {
        data: {
          rate: null,
          source: null,
          explanation: resolved
            ? `${resolved.card.name} has no ${cardRateType.replace(/_/g, ' ').toLowerCase()} rate — enter a rate.`
            : 'No pay card applies to this carer on that date — enter a rate.',
          payCardId: resolved?.card.id ?? null,
          payCardVersion: resolved?.version ?? null,
        },
      };
    }
    if (code === 'HOLIDAY_PAY' && (unit === 'HOUR' || unit === 'DAY')) {
      const from = new Date(at.getTime() - 52 * 7 * DAY_MS);
      const recons = await this.prisma.visitReconciliation.findMany({
        where: {
          employeeId: query.employeeId,
          payableAmount: { not: null },
          payableMinutes: { gt: 0 },
          approvedPayStart: { gte: from, lt: at },
        },
        select: { payableAmount: true, payableMinutes: true, approvedPayStart: true },
      });
      const pay = recons.reduce((s, r) => s.add(r.payableAmount ?? 0), new Prisma.Decimal(0));
      const minutes = recons.reduce((s, r) => s + (r.payableMinutes ?? 0), 0);
      const days = new Set(recons.map((r) => r.approvedPayStart?.toISOString().slice(0, 10))).size;
      if (!minutes || pay.lte(0)) {
        return {
          data: { rate: null, source: null, explanation: 'No paid visits in the previous 52 weeks — enter a rate.', payCardId: null, payCardVersion: null },
        };
      }
      const rate = unit === 'HOUR' ? pay.div(minutes / 60) : pay.div(Math.max(1, days));
      return {
        data: {
          rate: Number(rate.toDecimalPlaces(4)),
          source: 'AVERAGE_PAY',
          explanation: `Average ${unit === 'HOUR' ? 'hourly' : 'daily'} visit pay over the previous 52 weeks (£${roundPence(pay).toFixed(2)} for ${(minutes / 60).toFixed(1)} h on ${days} days). Check against your holiday pay policy.`,
          payCardId: null,
          payCardVersion: null,
        },
      };
    }
    return { data: { rate: null, source: null, explanation: 'Enter the rate or amount.', payCardId: null, payCardVersion: null } };
  }

  async create(userId: string, dto: CreatePayItemDto, meta?: RequestAuditMeta) {
    if (!isPayItemWageType(dto.wageTypeCode)) throw new BadRequestException('Unsupported wage type for a pay item.');
    const config = PAY_ITEM_CONFIG[dto.wageTypeCode];
    const unit = dto.unit as PayItemUnit;
    if (!config.units.includes(unit)) {
      throw new BadRequestException(`${dto.wageTypeCode.replace(/_/g, ' ').toLowerCase()} can be entered as: ${config.units.join(', ').toLowerCase()}.`);
    }
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, deletedAt: null }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found');

    if (dto.sourceType || dto.sourceId) {
      if (!dto.sourceType || !dto.sourceId || !(config.sourceTypes as string[]).includes(dto.sourceType)) {
        throw new BadRequestException('This record cannot be linked to that wage type.');
      }
      const source =
        dto.sourceType === 'EMPLOYEE_HOLIDAY'
          ? await this.prisma.employeeHoliday.findFirst({ where: { id: dto.sourceId, employeeId: dto.employeeId, deletedAt: null }, select: { id: true } })
          : await this.prisma.employeeAbsenceRecord.findFirst({ where: { id: dto.sourceId, employeeId: dto.employeeId }, select: { id: true } });
      if (!source) throw new BadRequestException('Linked holiday / absence record not found for this carer.');
      const duplicate = await this.prisma.employeePayItem.findFirst({
        where: { sourceType: dto.sourceType, sourceId: dto.sourceId, wageTypeCode: dto.wageTypeCode, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
        select: { id: true },
      });
      if (duplicate) throw new BadRequestException('A pay item already exists for that record.');
    }

    let quantity: Prisma.Decimal | null = null;
    let rate: Prisma.Decimal | null = null;
    let amount: Prisma.Decimal;
    let payCardId: string | null = null;
    let payCardVersion: number | null = null;
    if (unit === 'AMOUNT') {
      if (dto.amount == null || dto.amount === 0) throw new BadRequestException('Enter an amount.');
      if (dto.amount < 0 && !config.allowNegative) throw new BadRequestException('Only manual adjustments can be negative.');
      amount = roundPence(dto.amount);
    } else {
      if (!(dto.quantity != null && dto.quantity > 0)) throw new BadRequestException('Enter how many units (more than zero).');
      quantity = new Prisma.Decimal(dto.quantity);
      if (dto.rate != null) {
        if (dto.rate < 0) throw new BadRequestException('Rate cannot be negative.');
        rate = new Prisma.Decimal(dto.rate);
      } else {
        const suggestion = await this.suggestRate({ employeeId: dto.employeeId, wageTypeCode: dto.wageTypeCode, unit, date: dto.workDate });
        if (suggestion.data.rate == null) throw new BadRequestException(suggestion.data.explanation);
        rate = new Prisma.Decimal(suggestion.data.rate);
      }
      amount = payItemAmount(quantity, rate);
    }
    if (config.cardRateType?.[unit]) {
      // The rate is already decided above; a card that cannot be decided (PC-32) only means the
      // item is not linked to one.
      const resolved = await this.payCards
        .resolveRulesForEmployeeAt(dto.employeeId, toDate(dto.workDate))
        .catch((err) => {
          if (err instanceof PayCardConflictException) return null;
          throw err;
        });
      payCardId = resolved?.card.id ?? null;
      payCardVersion = resolved?.version ?? null;
    }

    const item = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employeePayItem.create({
        data: {
          employeeId: dto.employeeId,
          wageTypeCode: dto.wageTypeCode,
          workDate: toDate(dto.workDate),
          unit,
          quantity,
          rate,
          amount,
          reason: dto.reason.trim(),
          notes: dto.notes?.trim() || null,
          sourceType: dto.sourceType ?? 'MANUAL',
          sourceId: dto.sourceId ?? null,
          payCardId,
          payCardVersion,
          status: 'PENDING_APPROVAL',
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.PAY_ITEM_CREATED,
        recordType: 'EmployeePayItem',
        recordId: created.id,
        newValues: {
          employeeId: created.employeeId,
          wageTypeCode: created.wageTypeCode,
          workDate: dto.workDate,
          unit,
          quantity: quantity?.toString() ?? null,
          rate: rate?.toString() ?? null,
          amount: amount.toString(),
          reason: created.reason,
        },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return created;
    });
    return { message: 'Pay item created — awaiting approval', data: item };
  }

  /**
   * Correction ledger for a visit whose pay is settled (locked visit pay run or closed UK run).
   *
   * The paid record is not edited. The caller states what the visit should have paid in total; the
   * difference against what has been settled so far (the original line plus earlier corrections)
   * becomes a manual adjustment that a second person approves and the next visit pay run pays.
   * Asking for the same corrected amount twice therefore yields no second payment.
   */
  async recordVisitCorrection(
    userId: string,
    dto: { visitReconciliationId: string; correctedAmount: number; reason: string },
    meta?: RequestAuditMeta,
  ) {
    const visit = await this.prisma.visitReconciliation.findUnique({
      where: { id: dto.visitReconciliationId },
      select: {
        id: true,
        visitRef: true,
        employeeId: true,
        payableAmount: true,
        approvedPayStart: true,
        plannedStartDateTime: true,
        payCardId: true,
        payCardVersion: true,
        includedInPayrollRunId: true,
        paidByUkPayrollRunId: true,
      },
    });
    if (!visit) throw new NotFoundException('Visit reconciliation not found');
    if (!isPaySettled(visit)) {
      throw new BadRequestException(
        'This visit is not in a locked payroll run yet. Change its payable time or amount directly.',
      );
    }
    if (!visit.employeeId) throw new BadRequestException('This visit has no carer to pay.');
    const employeeId = visit.employeeId;

    const item = await this.prisma.$transaction(async (tx) => {
      // One correction at a time per visit, also when two people submit together.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`visit-correction:${visit.id}`}))`;

      const ledger = await tx.employeePayItem.findMany({
        where: {
          sourceId: visit.id,
          sourceType: { in: ['VISIT_CORRECTION', 'REVERSAL'] },
          status: { in: ['PENDING_APPROVAL', 'APPROVED'] },
        },
        select: { amount: true, status: true, sourceType: true },
      });
      if (ledger.some((l) => l.status === 'PENDING_APPROVAL')) {
        throw new BadRequestException(
          'A pay correction for this visit is awaiting approval. Approve, reject or cancel it first.',
        );
      }
      const originalLine = await tx.payrollRunLine.findFirst({
        where: {
          visitReconciliationId: visit.id,
          lineType: 'VISIT_PAY',
          payrollRun: { status: { in: ['LOCKED', 'EXPORTED'] } },
        },
        select: { id: true, amount: true },
      });
      const originalAmount = Number(originalLine?.amount ?? visit.payableAmount ?? 0);
      const difference = correctionDifference(
        dto.correctedAmount,
        originalAmount,
        ledger.map((l) => Number(l.amount)),
      );
      if (difference === 0) {
        throw new BadRequestException(
          `This visit has already been settled at £${dto.correctedAmount.toFixed(2)}. There is nothing to correct.`,
        );
      }

      const created = await tx.employeePayItem.create({
        data: {
          employeeId,
          wageTypeCode: 'MANUAL_ADJUSTMENT',
          workDate: toDate((visit.approvedPayStart ?? visit.plannedStartDateTime).toISOString()),
          unit: 'AMOUNT',
          amount: roundPence(difference),
          reason: `Pay correction ${visit.visitRef}: ${dto.reason.trim()}`.slice(0, 500),
          sourceType: 'VISIT_CORRECTION',
          sourceId: visit.id,
          originalPayrollRunLineId: originalLine?.id ?? null,
          originalAmount: roundPence(originalAmount),
          correctedAmount: roundPence(dto.correctedAmount),
          payCardId: visit.payCardId,
          payCardVersion: visit.payCardVersion,
          status: 'PENDING_APPROVAL',
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.VISIT_PAY_CORRECTION_RECORDED,
        recordType: 'EmployeePayItem',
        recordId: created.id,
        description: dto.reason.trim(),
        oldValues: { settledAmount: (dto.correctedAmount - difference).toFixed(2), originalAmount: originalAmount.toFixed(2) },
        newValues: { correctedAmount: dto.correctedAmount.toFixed(2), difference: difference.toFixed(2) },
        metadata: {
          visitReconciliationId: visit.id,
          visitRef: visit.visitRef,
          employeeId,
          originalPayrollRunLineId: originalLine?.id ?? null,
          settledByVisitPayRunId: visit.includedInPayrollRunId,
          settledByUkPayrollRunId: visit.paidByUkPayrollRunId,
        },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return created;
    });
    return {
      message:
        Number(item.amount) > 0
          ? `Pay correction of £${Number(item.amount).toFixed(2)} recorded. After approval by a second person it is paid in the next visit pay run.`
          : `Pay correction of -£${Math.abs(Number(item.amount)).toFixed(2)} recorded. After approval by a second person it is recovered in the next visit pay run.`,
      data: item,
    };
  }

  /** Original line, corrections and reversals of one visit, with the net amount settled or pending. */
  async visitCorrectionHistory(visitReconciliationId: string) {
    const visit = await this.prisma.visitReconciliation.findUnique({
      where: { id: visitReconciliationId },
      select: {
        id: true,
        visitRef: true,
        employeeId: true,
        payableAmount: true,
        includedInPayrollRunId: true,
        paidByUkPayrollRunId: true,
      },
    });
    if (!visit) throw new NotFoundException('Visit reconciliation not found');
    const [originalLine, items] = await Promise.all([
      this.prisma.payrollRunLine.findFirst({
        where: {
          visitReconciliationId,
          lineType: 'VISIT_PAY',
          payrollRun: { status: { in: ['LOCKED', 'EXPORTED'] } },
        },
        select: { id: true, amount: true, payrollRunId: true, payrollRun: { select: { periodLabel: true, lockedAt: true } } },
      }),
      this.prisma.employeePayItem.findMany({
        where: { sourceId: visitReconciliationId, sourceType: { in: ['VISIT_CORRECTION', 'REVERSAL'] } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const active = items.filter((i) => i.status === 'PENDING_APPROVAL' || i.status === 'APPROVED');
    // A visit settled by a closed UK run has no visit pay line: its settled amount is on the visit.
    const originalAmount = new Prisma.Decimal(originalLine?.amount ?? visit.payableAmount ?? 0);
    const net = active.reduce((sum, i) => sum.add(i.amount), originalAmount);

    const [names, openLines, runs] = await Promise.all([
      this.userNames(items.flatMap((i) => [i.createdById, i.approvedById, i.rejectedById])),
      this.prisma.payrollRunLine.findMany({
        where: {
          employeePayItemId: { in: items.map((i) => i.id) },
          payrollRun: { status: { notIn: ['LOCKED', 'EXPORTED'] } },
        },
        select: { employeePayItemId: true },
      }),
      this.prisma.payrollRun.findMany({
        where: { id: { in: items.map((i) => i.includedInPayrollRunId).filter((v): v is string => !!v) } },
        select: { id: true, periodLabel: true },
      }),
    ]);
    const inOpenRun = new Set(openLines.map((l) => l.employeePayItemId));
    const runLabel = new Map(runs.map((r) => [r.id, r.periodLabel]));
    const reversalOf = new Map(
      items.filter((i) => i.reversesPayItemId).map((i) => [i.reversesPayItemId as string, i]),
    );
    const settled = isPaySettled(visit);
    const hasPending = items.some((i) => i.status === 'PENDING_APPROVAL');

    return {
      data: {
        visit: {
          id: visit.id,
          visitRef: visit.visitRef,
          employeeId: visit.employeeId,
          paySettled: settled,
          settledBy: visit.includedInPayrollRunId ? 'VISIT_PAY_RUN' : visit.paidByUkPayrollRunId ? 'UK_PAYROLL_RUN' : null,
        },
        originalLine,
        originalAmount: originalAmount.toFixed(2),
        netAmount: net.toFixed(2),
        differenceAmount: net.sub(originalAmount).toFixed(2),
        canRecordCorrection: settled && Boolean(visit.employeeId) && !hasPending,
        items: items.map((i) => {
          const reversal = reversalOf.get(i.id);
          const reversalLive = reversal && (reversal.status === 'PENDING_APPROVAL' || reversal.status === 'APPROVED');
          return {
            ...i,
            displayStatus: payCorrectionDisplayStatus({
              status: i.status,
              includedInPayrollRunId: i.includedInPayrollRunId,
              inOpenRun: inOpenRun.has(i.id),
              reversed: reversal?.status === 'APPROVED',
            }),
            createdByName: i.createdById ? (names.get(i.createdById) ?? null) : null,
            approvedByName: i.approvedById ? (names.get(i.approvedById) ?? null) : null,
            rejectedByName: i.rejectedById ? (names.get(i.rejectedById) ?? null) : null,
            payrollRunLabel: i.includedInPayrollRunId ? (runLabel.get(i.includedInPayrollRunId) ?? null) : null,
            reversalItemId: reversalLive ? reversal.id : null,
            // Paid, not itself a reversal, and not already reversed (or being reversed).
            canReverse:
              i.status === 'APPROVED' &&
              Boolean(i.includedInPayrollRunId) &&
              i.sourceType !== 'REVERSAL' &&
              !reversalLive,
          };
        }),
      },
    };
  }

  /**
   * Reverse a pay item that a locked run has already paid: an equal and opposite adjustment,
   * approved by a second person and applied in the next run. An item can be reversed once.
   * An item that has not been paid is cancelled instead.
   */
  async reverse(userId: string, id: string, reason: string, meta?: RequestAuditMeta) {
    const item = await this.loadForDecision(id);
    if (item.status !== 'APPROVED' || !item.includedInPayrollRunId) {
      throw new BadRequestException('Only a pay item that has been paid can be reversed. Cancel an unpaid item instead.');
    }
    if (item.sourceType === 'REVERSAL') {
      throw new BadRequestException('A reversal cannot itself be reversed. Enter a new adjustment instead.');
    }
    const reversal = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pay-item-reversal:${id}`}))`;
      const existing = await tx.employeePayItem.findUnique({ where: { reversesPayItemId: id } });
      if (existing && (existing.status === 'PENDING_APPROVAL' || existing.status === 'APPROVED')) {
        throw new BadRequestException('This pay item has already been reversed.');
      }
      // A rejected or cancelled reversal no longer stands in the way of a new one.
      if (existing) await tx.employeePayItem.update({ where: { id: existing.id }, data: { reversesPayItemId: null } });
      const created = await tx.employeePayItem.create({
        data: {
          employeeId: item.employeeId,
          wageTypeCode: 'MANUAL_ADJUSTMENT',
          workDate: item.workDate,
          unit: 'AMOUNT',
          amount: item.amount.negated(),
          reason: `Reversal: ${reason.trim()}`.slice(0, 500),
          notes: `Reverses pay item: ${item.reason}`.slice(0, 500),
          sourceType: 'REVERSAL',
          sourceId: item.sourceType === 'VISIT_CORRECTION' ? item.sourceId : null,
          reversesPayItemId: id,
          status: 'PENDING_APPROVAL',
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.PAY_ITEM_REVERSED,
        recordType: 'EmployeePayItem',
        recordId: created.id,
        description: reason.trim(),
        newValues: { amount: created.amount.toString(), reversesPayItemId: id },
        metadata: { employeeId: item.employeeId, reversedAmount: item.amount.toString() },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return created;
    });
    return { message: 'Reversal recorded. After approval by a second person it is applied in the next visit pay run.', data: reversal };
  }

  private async loadForDecision(id: string) {
    const item = await this.prisma.employeePayItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Pay item not found');
    return item;
  }

  async approve(userId: string, id: string, meta?: RequestAuditMeta) {
    const item = await this.loadForDecision(id);
    if (item.status !== 'PENDING_APPROVAL') throw new BadRequestException('Only pending pay items can be approved.');
    if (
      isPayItemWageType(item.wageTypeCode) &&
      PAY_ITEM_CONFIG[item.wageTypeCode].requiresSecondApprover &&
      item.createdById === userId
    ) {
      throw new ForbiddenException('Bonuses and manual adjustments must be approved by a different user from the one who entered them.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.employeePayItem.update({
        where: { id },
        data: { status: 'APPROVED', approvedAt: new Date(), approvedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.PAY_ITEM_APPROVED,
        recordType: 'EmployeePayItem',
        recordId: id,
        oldValues: { status: item.status },
        newValues: { status: row.status, amount: row.amount.toString() },
        metadata: { employeeId: item.employeeId, wageTypeCode: item.wageTypeCode },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return row;
    });
    return { message: 'Pay item approved — it will be paid in the next visit pay run that covers its date', data: updated };
  }

  async reject(userId: string, id: string, reason: string, meta?: RequestAuditMeta) {
    const item = await this.loadForDecision(id);
    if (item.status !== 'PENDING_APPROVAL') throw new BadRequestException('Only pending pay items can be rejected.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.employeePayItem.update({
        where: { id },
        data: { status: 'REJECTED', rejectedAt: new Date(), rejectedById: userId, rejectionReason: reason.trim() },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.PAY_ITEM_REJECTED,
        recordType: 'EmployeePayItem',
        recordId: id,
        oldValues: { status: item.status },
        newValues: { status: row.status, rejectionReason: row.rejectionReason },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return row;
    });
    return { message: 'Pay item rejected', data: updated };
  }

  /** Withdraw an item that has not been paid. Items in a locked pay run are frozen. */
  async cancel(userId: string, id: string, meta?: RequestAuditMeta) {
    const item = await this.loadForDecision(id);
    if (item.includedInPayrollRunId) {
      throw new BadRequestException('This pay item is in a locked pay run and cannot be changed. Enter a manual adjustment instead.');
    }
    if (item.status !== 'PENDING_APPROVAL' && item.status !== 'APPROVED') {
      throw new BadRequestException('Only pending or approved pay items can be cancelled.');
    }
    const inOpenRun = await this.prisma.payrollRunLine.count({ where: { employeePayItemId: id } });
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.employeePayItem.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.PAY_ITEM_CANCELLED,
        recordType: 'EmployeePayItem',
        recordId: id,
        oldValues: { status: item.status },
        newValues: { status: row.status },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return row;
    });
    return {
      message: inOpenRun
        ? 'Pay item cancelled — recalculate the visit pay run that included it'
        : 'Pay item cancelled',
      data: updated,
    };
  }
}
