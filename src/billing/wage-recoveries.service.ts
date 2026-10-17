import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { assertDifferentUser } from './financial-controls.util';
import { recoveryPolicyInForce } from './wage-recovery.store';

type RecoveryRow = Prisma.WageRecoveryGetPayload<object>;
const num = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));

/**
 * Review of proposed wage recoveries (see wage-recovery.store.ts). Approving states the authority
 * for the deduction; rejecting writes the overpayment off. Neither changes a locked pay run: an
 * approved recovery is deducted by the next calculation of an open run that covers it, and only
 * while the employer has an approved recovery policy on record.
 *
 * The amount of a recovery is worked out by the pay calculation and cannot be entered or edited.
 */
@Injectable()
export class WageRecoveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async describe(rows: RecoveryRow[]) {
    const userIds = [...new Set(rows.flatMap((r) => [r.detectedById, r.decidedById]).filter((v): v is string => !!v))];
    const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
    const runIds = [...new Set(rows.flatMap((r) => [r.detectedInRunId, r.appliedInRunId]).filter((v): v is string => !!v))];
    const [users, employees, visitRuns, ukRuns] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
        : [],
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
          })
        : [],
      runIds.length
        ? this.prisma.payrollRun.findMany({ where: { id: { in: runIds } }, select: { id: true, periodLabel: true } })
        : [],
      runIds.length
        ? this.prisma.ukPayrollRun.findMany({ where: { id: { in: runIds } }, select: { id: true, label: true } })
        : [],
    ]);
    const userName = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]));
    const employeeName = new Map(
      employees.map((e) => [e.id, [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ').trim() || 'Employee']),
    );
    const runLabel = new Map<string, string>([
      ...visitRuns.map((r) => [r.id, `Visit pay run ${r.periodLabel}`] as [string, string]),
      ...ukRuns.map((r) => [r.id, `UK payroll run ${r.label}`] as [string, string]),
    ]);
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: employeeName.get(r.employeeId) ?? 'Employee',
      kind: r.kind,
      subjectKey: r.subjectKey,
      // The original payment, what is now due, and the difference proposed for recovery.
      paidAmount: num(r.paidAmount),
      dueAmount: num(r.dueAmount),
      amount: Number(r.amount),
      reason: r.reason,
      originalReference: r.originalReference,
      status: r.status,
      authorityBasis: r.authorityBasis,
      decisionNote: r.decisionNote,
      proposedAt: r.createdAt.toISOString(),
      proposedById: r.detectedById,
      proposedByName: r.detectedById ? (userName.get(r.detectedById) ?? null) : null,
      proposedInRun: r.detectedInRunId ? (runLabel.get(r.detectedInRunId) ?? null) : null,
      decidedById: r.decidedById,
      decidedByName: r.decidedById ? (userName.get(r.decidedById) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      appliedInRunId: r.appliedInRunId,
      appliedInRun: r.appliedInRunId ? (runLabel.get(r.appliedInRunId) ?? null) : null,
      appliedAt: r.appliedAt?.toISOString() ?? null,
    }));
  }

  async list(status?: string, employeeId?: string) {
    const rows = await this.prisma.wageRecovery.findMany({
      where: { ...(status ? { status } : {}), ...(employeeId ? { employeeId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return { message: 'Wage recoveries', data: await this.describe(rows) };
  }

  /** One recovery with what has happened to it: proposal, decisions, application. */
  async getById(id: string) {
    const row = await this.prisma.wageRecovery.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Wage recovery not found');
    const [described] = await this.describe([row]);
    const decisions = await this.prisma.auditLog.findMany({
      where: { recordType: 'WageRecovery', recordId: id },
      orderBy: { createdAt: 'asc' },
      select: { action: true, description: true, createdAt: true, userId: true, newValues: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: decisions.map((d) => d.userId).filter((v): v is string => !!v) } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const name = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]));
    const history = [
      {
        at: described.proposedAt,
        event: 'PROPOSED',
        by: described.proposedByName,
        detail: `${described.reason}${described.proposedInRun ? ` Found by ${described.proposedInRun}.` : ''}`,
      },
      ...decisions.map((d) => ({
        at: d.createdAt.toISOString(),
        event: d.action === AuditAction.WAGE_RECOVERY_APPROVED ? 'AUTHORISED' : 'REJECTED',
        by: d.userId ? (name.get(d.userId) ?? null) : null,
        detail: `${d.description ?? ''} (for £${Number((d.newValues as { amount?: number } | null)?.amount ?? 0).toFixed(2)})`.trim(),
      })),
      ...(row.status === 'PROPOSED' && row.decisionNote
        ? [{ at: row.updatedAt.toISOString(), event: 'PROPOSED_AGAIN', by: null, detail: row.decisionNote }]
        : []),
      ...(row.status === 'WITHDRAWN'
        ? [{ at: row.updatedAt.toISOString(), event: 'WITHDRAWN', by: null, detail: row.decisionNote ?? '' }]
        : []),
      ...(described.appliedAt
        ? [{ at: described.appliedAt, event: 'APPLIED', by: null, detail: `Deducted once, in ${described.appliedInRun ?? 'a pay run'}.` }]
        : []),
    ];
    return { message: 'Wage recovery', data: { ...described, history } };
  }

  // ------------------------------------------------------------------ employer policy (D-23)

  private mapPolicy(policy: Awaited<ReturnType<typeof recoveryPolicyInForce>>, recordedByName: string | null) {
    return policy
      ? { inForce: true, id: policy.id, reference: policy.reference, recordedAt: policy.recordedAt.toISOString(), recordedByName }
      : { inForce: false, id: null, reference: null, recordedAt: null, recordedByName: null };
  }

  /** Whether the employer has an approved recovery policy on record. Without one nothing is deducted. */
  async policy() {
    const policy = await recoveryPolicyInForce(this.prisma);
    const user = policy?.recordedById
      ? await this.prisma.user.findUnique({ where: { id: policy.recordedById }, select: { firstName: true, lastName: true, email: true } })
      : null;
    const name = user ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email : null;
    return { message: 'Wage recovery policy', data: this.mapPolicy(policy, name) };
  }

  async recordPolicy(userId: string, reference: string, meta?: RequestAuditMeta) {
    const row = await this.prisma.$transaction(async (tx) => {
      // A newer statement replaces the earlier one, which stays as history.
      await tx.wageRecoveryPolicy.updateMany({
        where: { withdrawnAt: null },
        data: { withdrawnAt: new Date(), withdrawnById: userId, withdrawnNote: 'Replaced by a newer record' },
      });
      const created = await tx.wageRecoveryPolicy.create({ data: { reference: reference.trim(), recordedById: userId } });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.WAGE_RECOVERY_POLICY_RECORDED,
        recordType: 'WageRecoveryPolicy',
        recordId: created.id,
        description: reference.trim(),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return created;
    });
    return {
      message: 'Recovery policy recorded. Authorised recoveries are deducted by the next calculation of an open pay run.',
      data: { id: row.id },
    };
  }

  async withdrawPolicy(userId: string, note: string, meta?: RequestAuditMeta) {
    const policy = await recoveryPolicyInForce(this.prisma);
    if (!policy) throw new BadRequestException('No recovery policy is on record.');
    await this.prisma.$transaction(async (tx) => {
      await tx.wageRecoveryPolicy.update({
        where: { id: policy.id },
        data: { withdrawnAt: new Date(), withdrawnById: userId, withdrawnNote: note.trim() },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.WAGE_RECOVERY_POLICY_WITHDRAWN,
        recordType: 'WageRecoveryPolicy',
        recordId: policy.id,
        description: note.trim(),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return { message: 'Recovery policy withdrawn. Nothing further is deducted until one is recorded.', data: { id: policy.id } };
  }

  // ------------------------------------------------------------------ decisions

  private async decide(
    userId: string,
    id: string,
    decision: { status: 'APPROVED' | 'REJECTED'; authorityBasis?: string; note: string },
    meta?: RequestAuditMeta,
  ) {
    const row = await this.prisma.wageRecovery.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Wage recovery not found');
    const open = decision.status === 'APPROVED' ? ['PROPOSED'] : ['PROPOSED', 'APPROVED'];
    if (!open.includes(row.status)) {
      throw new BadRequestException(
        row.status === 'APPLIED'
          ? 'This recovery has already been deducted in a locked pay run. Correct it with a pay correction.'
          : 'This recovery is not awaiting a decision.',
      );
    }
    if (decision.status === 'APPROVED') {
      assertDifferentUser(
        row.detectedById,
        userId,
        'A wage recovery is authorised by a different user from the one whose calculation proposed it.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.wageRecovery.updateMany({
        where: { id, status: row.status },
        data: {
          status: decision.status,
          authorityBasis: decision.status === 'APPROVED' ? decision.authorityBasis!.trim() : null,
          decisionNote: decision.note.trim(),
          decidedById: userId,
          decidedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new ConflictException('This recovery was changed by someone else. Reload and check.');
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: decision.status === 'APPROVED' ? AuditAction.WAGE_RECOVERY_APPROVED : AuditAction.WAGE_RECOVERY_REJECTED,
        recordType: 'WageRecovery',
        recordId: id,
        description:
          decision.status === 'APPROVED'
            ? `${decision.note.trim()} — authority: ${decision.authorityBasis!.trim()}`
            : decision.note.trim(),
        oldValues: { status: row.status },
        newValues: { status: decision.status, amount: Number(row.amount) },
        metadata: { employeeId: row.employeeId, kind: row.kind, subjectKey: row.subjectKey },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    const amount = `£${Number(row.amount).toFixed(2)}`;
    if (decision.status === 'REJECTED') {
      return { message: `Recovery rejected: ${amount} is written off and will not be deducted.`, data: { id, status: decision.status } };
    }
    const policy = await recoveryPolicyInForce(this.prisma);
    return {
      message: policy
        ? `Recovery of ${amount} authorised. Recalculate the open pay run that covers it: it is deducted there, once.`
        : `Recovery of ${amount} authorised. It is not deducted yet: no approved recovery policy of the employer is on record.`,
      data: { id, status: decision.status, deductionBlockedByPolicy: !policy },
    };
  }

  approve(userId: string, id: string, authorityBasis: string, reason: string, meta?: RequestAuditMeta) {
    return this.decide(userId, id, { status: 'APPROVED', authorityBasis, note: reason }, meta);
  }

  reject(userId: string, id: string, note: string, meta?: RequestAuditMeta) {
    return this.decide(userId, id, { status: 'REJECTED', note }, meta);
  }
}
