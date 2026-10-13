import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { PayCardsService } from './billing-cards.service';
import {
  CreateDisruptionRuleDto,
  DecideDisruptionDto,
  DisruptionQueryDto,
  RecordDisruptionDto,
} from './dto/visit-disruptions.dto';
import { assertDifferentUser } from './financial-controls.util';
import { cardBaseHourlyRate } from './pay-items.util';
import {
  DISRUPTION_EVENT_LABELS,
  DisruptionEvent,
  DisruptionRule,
  proposeDisruptionPay,
  ruleForEvent,
} from './visit-disruption.util';

/** Pay item type of an approved disruption payment (see SYSTEM_PAY_ITEM_CONFIG). */
export const DISRUPTION_PAY = 'DISRUPTION_PAY';
const UNDECIDED_LOOKBACK_DAYS = 60;

const num = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));

/**
 * Q13: what a carer is paid when a visit does not go ahead as planned.
 *
 * A cancelled visit is not "no pay" by default. The event is recorded for the carer; the rule the
 * organisation approved proposes an amount, or — with no rule — a person decides. A second person
 * approves, and an approved amount is paid once through a pay item in the next visit pay run.
 */
@Injectable()
export class VisitDisruptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly payCards: PayCardsService,
  ) {}

  private toRule(row: {
    id: string;
    eventType: string;
    noticeBelowMinutes: number | null;
    outcome: string;
    percent: Prisma.Decimal | null;
    fixedAmount: Prisma.Decimal | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    status: string;
  }): DisruptionRule {
    return { ...row, percent: num(row.percent), fixedAmount: num(row.fixedAmount) };
  }

  // ------------------------------------------------------------------ rules

  async listRules() {
    const rows = await this.prisma.visitDisruptionPayRule.findMany({
      orderBy: [{ eventType: 'asc' }, { effectiveFrom: 'desc' }],
    });
    return {
      message: 'Rules for visits that do not go ahead as planned',
      data: rows.map((r) => ({
        ...this.toRule(r),
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: r.effectiveTo?.toISOString().slice(0, 10) ?? null,
        isSynthetic: r.isSynthetic,
        note: r.note,
        createdById: r.createdById,
        approvedById: r.approvedById,
        approvedAt: r.approvedAt?.toISOString() ?? null,
      })),
    };
  }

  async createRule(userId: string, dto: CreateDisruptionRuleDto, meta?: RequestAuditMeta) {
    if (dto.outcome === 'PERCENT_OF_SCHEDULED' && dto.percent == null) {
      throw new BadRequestException('Enter the percentage of the scheduled visit that is paid.');
    }
    if (dto.outcome === 'FIXED_AMOUNT' && dto.fixedAmount == null) {
      throw new BadRequestException('Enter the fixed amount that is paid.');
    }
    const effectiveFrom = new Date(`${dto.effectiveFrom.slice(0, 10)}T00:00:00.000Z`);
    const effectiveTo = dto.effectiveTo ? new Date(`${dto.effectiveTo.slice(0, 10)}T00:00:00.000Z`) : null;
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException('The rule cannot end before it starts.');
    }
    const row = await this.prisma.visitDisruptionPayRule.create({
      data: {
        eventType: dto.eventType,
        noticeBelowMinutes: dto.noticeBelowMinutes ?? null,
        outcome: dto.outcome,
        percent: dto.outcome === 'PERCENT_OF_SCHEDULED' ? dto.percent : null,
        fixedAmount: dto.outcome === 'FIXED_AMOUNT' ? dto.fixedAmount : null,
        effectiveFrom,
        effectiveTo,
        isSynthetic: dto.isSynthetic === true,
        note: dto.note?.trim() || null,
        createdById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.BILLING,
      action: AuditAction.DISRUPTION_RULE_CREATED,
      recordType: 'VisitDisruptionPayRule',
      recordId: row.id,
      newValues: { eventType: row.eventType, outcome: row.outcome, noticeBelowMinutes: row.noticeBelowMinutes },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
    return { message: 'Rule saved. It applies once a second person approves it.', data: { id: row.id } };
  }

  async approveRule(userId: string, id: string, meta?: RequestAuditMeta) {
    const rule = await this.prisma.visitDisruptionPayRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Rule not found');
    if (rule.status !== 'DRAFT') throw new BadRequestException('Only a rule that is not yet in effect can be approved.');
    assertDifferentUser(rule.createdById, userId, 'A pay rule is approved by a different user from the one who entered it.');
    const changed = await this.prisma.visitDisruptionPayRule.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'ACTIVE', approvedById: userId, approvedAt: new Date() },
    });
    if (changed.count !== 1) throw new ConflictException('This rule was changed by someone else. Reload and check.');
    await this.audit.logAudit({
      userId,
      module: AuditModule.BILLING,
      action: AuditAction.DISRUPTION_RULE_APPROVED,
      recordType: 'VisitDisruptionPayRule',
      recordId: id,
      oldValues: { status: 'DRAFT' },
      newValues: { status: 'ACTIVE' },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
    return { message: 'Rule approved. It applies to events from its start date.', data: { id } };
  }

  async retireRule(userId: string, id: string, meta?: RequestAuditMeta) {
    const rule = await this.prisma.visitDisruptionPayRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Rule not found');
    if (rule.status === 'RETIRED') throw new BadRequestException('This rule is already retired.');
    await this.prisma.visitDisruptionPayRule.update({ where: { id }, data: { status: 'RETIRED' } });
    await this.audit.logAudit({
      userId,
      module: AuditModule.BILLING,
      action: AuditAction.DISRUPTION_RULE_RETIRED,
      recordType: 'VisitDisruptionPayRule',
      recordId: id,
      oldValues: { status: rule.status },
      newValues: { status: 'RETIRED' },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
    return { message: 'Rule retired. Decisions already made under it are unchanged.', data: { id } };
  }

  // ------------------------------------------------------------------ events and decisions

  async list(query: DisruptionQueryDto) {
    const rows = await this.prisma.visitDisruptionPayDecision.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      },
      orderBy: { eventAt: 'desc' },
      take: 500,
    });
    return { message: 'Pay decisions for disrupted visits', data: rows.map((r) => this.mapDecision(r)) };
  }

  private mapDecision(r: Prisma.VisitDisruptionPayDecisionGetPayload<object>) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      scheduledJobId: r.scheduledJobId,
      visitReconciliationId: r.visitReconciliationId,
      eventType: r.eventType,
      eventLabel: DISRUPTION_EVENT_LABELS[r.eventType as DisruptionEvent] ?? r.eventType,
      eventAt: r.eventAt.toISOString(),
      noticeMinutes: r.noticeMinutes,
      scheduledMinutes: r.scheduledMinutes,
      affectedMinutes: r.affectedMinutes,
      hourlyRate: num(r.hourlyRate),
      ruleId: r.ruleId,
      proposedOutcome: r.proposedOutcome,
      proposedAmount: num(r.proposedAmount),
      amount: num(r.amount),
      status: r.status,
      reason: r.reason,
      decisionNote: r.decisionNote,
      payItemId: r.payItemId,
      createdById: r.createdById,
      decidedById: r.decidedById,
      approvedById: r.approvedById,
    };
  }

  /**
   * Cancelled visits that had a carer allocated and have no pay decision recorded. They are shown
   * so that none is treated as "nothing to pay" simply because nobody looked.
   */
  async undecidedCancellations() {
    const since = new Date(Date.now() - UNDECIDED_LOOKBACK_DAYS * 24 * 60 * 60_000);
    const cancellations = await this.prisma.scheduledJobCancellation.findMany({
      where: { reinstatedAt: null, cancelledAt: { gte: since } },
      select: {
        scheduledJobId: true,
        cancelledAt: true,
        reasonCode: true,
        scheduledJob: {
          select: { jobName: true, scheduledStartDateTime: true, scheduledEndDateTime: true, estimatedDurationMinutes: true },
        },
      },
      orderBy: { cancelledAt: 'desc' },
      take: 500,
    });
    const jobIds = cancellations.map((c) => c.scheduledJobId);
    if (!jobIds.length) return { message: 'Cancelled visits with no pay decision', data: [] };
    const [allocations, decisions] = await Promise.all([
      this.prisma.jobAllocation.findMany({
        where: { scheduledJobId: { in: jobIds } },
        select: { scheduledJobId: true, employeeId: true, isActive: true, unallocatedAt: true },
      }),
      this.prisma.visitDisruptionPayDecision.findMany({
        where: { scheduledJobId: { in: jobIds } },
        select: { scheduledJobId: true, employeeId: true },
      }),
    ]);
    const decided = new Set(decisions.map((d) => `${d.scheduledJobId}:${d.employeeId}`));
    const data = cancellations.flatMap((c) => {
      const start = c.scheduledJob.scheduledStartDateTime;
      const end = c.scheduledJob.scheduledEndDateTime;
      const scheduledMinutes =
        c.scheduledJob.estimatedDurationMinutes ?? (end ? Math.round((end.getTime() - start.getTime()) / 60_000) : null);
      return allocations
        .filter(
          (a) =>
            a.scheduledJobId === c.scheduledJobId &&
            // Allocated when the visit was cancelled (unallocating as part of cancelling still counts).
            (a.isActive || !a.unallocatedAt || a.unallocatedAt.getTime() >= c.cancelledAt.getTime() - 60_000) &&
            !decided.has(`${c.scheduledJobId}:${a.employeeId}`),
        )
        .map((a) => ({
          scheduledJobId: c.scheduledJobId,
          employeeId: a.employeeId,
          jobName: c.scheduledJob.jobName,
          scheduledStart: start.toISOString(),
          scheduledMinutes,
          cancelledAt: c.cancelledAt.toISOString(),
          noticeMinutes: Math.max(0, Math.round((start.getTime() - c.cancelledAt.getTime()) / 60_000)),
          reasonCode: c.reasonCode,
        }));
    });
    return { message: 'Cancelled visits with no pay decision', data };
  }

  async record(userId: string, dto: RecordDisruptionDto, meta?: RequestAuditMeta) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (!dto.scheduledJobId && !dto.visitReconciliationId) {
      throw new BadRequestException('Say which visit the event is about.');
    }
    const eventAt = new Date(dto.eventAt);
    const duplicate = await this.prisma.visitDisruptionPayDecision.findFirst({
      where: {
        employeeId: dto.employeeId,
        eventType: dto.eventType,
        status: { not: 'REJECTED' },
        ...(dto.scheduledJobId ? { scheduledJobId: dto.scheduledJobId } : { visitReconciliationId: dto.visitReconciliationId }),
      },
      select: { id: true },
    });
    if (duplicate) throw new BadRequestException('This event is already recorded for this carer and visit.');

    const rules = (await this.prisma.visitDisruptionPayRule.findMany({ where: { eventType: dto.eventType, status: 'ACTIVE' } })).map(
      (r) => this.toRule(r),
    );
    const rule = ruleForEvent(rules, { eventType: dto.eventType, eventAt, noticeMinutes: dto.noticeMinutes ?? null });
    const resolved = await this.payCards.resolveRulesForEmployeeAt(dto.employeeId, eventAt).catch(() => null);
    const baseRate = resolved ? cardBaseHourlyRate(resolved.rules) : 0;
    const hourlyRate = baseRate > 0 ? baseRate : null;
    const proposal = proposeDisruptionPay(rule, {
      hourlyRate,
      scheduledMinutes: dto.scheduledMinutes ?? null,
      affectedMinutes: dto.affectedMinutes ?? null,
    });
    const decidedByRule = proposal.amount != null;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.visitDisruptionPayDecision.create({
        data: {
          employeeId: dto.employeeId,
          scheduledJobId: dto.scheduledJobId ?? null,
          visitReconciliationId: dto.visitReconciliationId ?? null,
          eventType: dto.eventType,
          eventAt,
          noticeMinutes: dto.noticeMinutes ?? null,
          scheduledMinutes: dto.scheduledMinutes ?? null,
          affectedMinutes: dto.affectedMinutes ?? null,
          hourlyRate,
          ruleId: rule?.id ?? null,
          proposedOutcome: proposal.outcome,
          proposedAmount: proposal.amount,
          amount: proposal.amount,
          status: decidedByRule ? 'PENDING_APPROVAL' : 'NEEDS_DECISION',
          reason: dto.reason.trim(),
          decisionNote: proposal.explanation,
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.DISRUPTION_RECORDED,
        recordType: 'VisitDisruptionPayDecision',
        recordId: created.id,
        description: dto.reason.trim(),
        newValues: { eventType: created.eventType, proposedOutcome: proposal.outcome, proposedAmount: proposal.amount, status: created.status },
        metadata: { employeeId: dto.employeeId, scheduledJobId: dto.scheduledJobId ?? null, ruleId: rule?.id ?? null },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return created;
    });
    return {
      message: decidedByRule
        ? `${proposal.explanation} Awaiting approval by a second person.`
        : proposal.explanation,
      data: this.mapDecision(row),
    };
  }

  /** A person sets the amount: where no rule decides, or in place of what a rule proposed. */
  async decide(userId: string, id: string, dto: DecideDisruptionDto, meta?: RequestAuditMeta) {
    const row = await this.prisma.visitDisruptionPayDecision.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Decision not found');
    if (row.status !== 'NEEDS_DECISION' && row.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('This event has already been approved or rejected.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.visitDisruptionPayDecision.update({
        where: { id },
        data: {
          amount: dto.amount,
          status: 'PENDING_APPROVAL',
          decisionNote: dto.note.trim(),
          decidedById: userId,
          decidedAt: new Date(),
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.DISRUPTION_DECIDED,
        recordType: 'VisitDisruptionPayDecision',
        recordId: id,
        description: dto.note.trim(),
        oldValues: { amount: num(row.amount), status: row.status },
        newValues: { amount: dto.amount, status: 'PENDING_APPROVAL' },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return changed;
    });
    return { message: 'Amount recorded. Awaiting approval by a second person.', data: this.mapDecision(updated) };
  }

  async approve(userId: string, id: string, meta?: RequestAuditMeta) {
    const row = await this.prisma.visitDisruptionPayDecision.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Decision not found');
    if (row.status !== 'PENDING_APPROVAL' || row.amount == null) {
      throw new BadRequestException(
        row.status === 'NEEDS_DECISION'
          ? 'No rule covers this event. Record what is to be paid before it is approved.'
          : 'This event has already been approved or rejected.',
      );
    }
    const message = 'Pay for a disrupted visit is approved by a different user from the one who recorded or decided it.';
    assertDifferentUser(row.createdById, userId, message);
    assertDifferentUser(row.decidedById, userId, message);

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const approved = await tx.visitDisruptionPayDecision.updateMany({
        where: { id, status: 'PENDING_APPROVAL' },
        data: { status: 'APPROVED', approvedById: userId, approvedAt: now },
      });
      if (approved.count !== 1) throw new ConflictException('This event was changed by someone else. Reload and check.');
      let payItemId: string | null = null;
      if (row.amount!.gt(0)) {
        // Paid like any other earning: one pay item, claimed by one visit pay run.
        const item = await tx.employeePayItem.create({
          data: {
            employeeId: row.employeeId,
            wageTypeCode: DISRUPTION_PAY,
            workDate: new Date(`${row.eventAt.toISOString().slice(0, 10)}T00:00:00.000Z`),
            unit: 'AMOUNT',
            amount: row.amount!,
            reason: `${DISRUPTION_EVENT_LABELS[row.eventType as DisruptionEvent] ?? row.eventType}: ${row.reason}`.slice(0, 500),
            status: 'APPROVED',
            sourceType: 'VISIT_DISRUPTION',
            sourceId: row.id,
            createdById: row.decidedById ?? row.createdById,
            approvedById: userId,
            approvedAt: now,
          },
        });
        payItemId = item.id;
        await tx.visitDisruptionPayDecision.update({ where: { id }, data: { payItemId } });
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.DISRUPTION_APPROVED,
        recordType: 'VisitDisruptionPayDecision',
        recordId: id,
        oldValues: { status: 'PENDING_APPROVAL' },
        newValues: { status: 'APPROVED', amount: Number(row.amount), payItemId },
        metadata: { employeeId: row.employeeId, eventType: row.eventType },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return tx.visitDisruptionPayDecision.findUniqueOrThrow({ where: { id } });
    });
    return {
      message: row.amount.gt(0)
        ? `£${Number(row.amount).toFixed(2)} approved. It is paid in the next visit pay run.`
        : 'Approved: nothing is paid for this event.',
      data: this.mapDecision(updated),
    };
  }

  async reject(userId: string, id: string, note: string, meta?: RequestAuditMeta) {
    const row = await this.prisma.visitDisruptionPayDecision.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Decision not found');
    if (row.status === 'APPROVED' || row.status === 'REJECTED') {
      throw new BadRequestException('This event has already been approved or rejected.');
    }
    const updated = await this.prisma.visitDisruptionPayDecision.update({
      where: { id },
      data: { status: 'REJECTED', decisionNote: note.trim(), decidedById: userId, decidedAt: new Date() },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.BILLING,
      action: AuditAction.DISRUPTION_REJECTED,
      recordType: 'VisitDisruptionPayDecision',
      recordId: id,
      description: note.trim(),
      oldValues: { status: row.status },
      newValues: { status: 'REJECTED' },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
    return { message: 'Event rejected: it was recorded in error.', data: this.mapDecision(updated) };
  }
}
