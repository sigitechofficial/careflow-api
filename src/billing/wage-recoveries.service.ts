import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { assertDifferentUser } from './financial-controls.util';

/**
 * Review of proposed wage recoveries (see wage-recovery.store.ts). Approving states the authority
 * for the deduction; rejecting writes the overpayment off. Neither changes a locked pay run: an
 * approved recovery is deducted by the next calculation of an open run that covers it.
 */
@Injectable()
export class WageRecoveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(status?: string, employeeId?: string) {
    const rows = await this.prisma.wageRecovery.findMany({
      where: { ...(status ? { status } : {}), ...(employeeId ? { employeeId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return {
      message: 'Wage recoveries',
      data: rows.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        kind: r.kind,
        subjectKey: r.subjectKey,
        amount: Number(r.amount),
        reason: r.reason,
        originalReference: r.originalReference,
        status: r.status,
        authorityBasis: r.authorityBasis,
        decisionNote: r.decisionNote,
        detectedInRunId: r.detectedInRunId,
        detectedById: r.detectedById,
        decidedById: r.decidedById,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        appliedInRunId: r.appliedInRunId,
        appliedAt: r.appliedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  private async decide(
    userId: string,
    id: string,
    decision: { status: 'APPROVED' | 'REJECTED'; authorityBasis?: string; note?: string },
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
          decisionNote: decision.note?.trim() || null,
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
        description: decision.status === 'APPROVED' ? decision.authorityBasis!.trim() : decision.note?.trim(),
        oldValues: { status: row.status },
        newValues: { status: decision.status, amount: Number(row.amount) },
        metadata: { employeeId: row.employeeId, kind: row.kind, subjectKey: row.subjectKey },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return {
      message:
        decision.status === 'APPROVED'
          ? `Recovery of £${Number(row.amount).toFixed(2)} authorised. Recalculate the open pay run that covers it: it is deducted there, once.`
          : `Recovery rejected: £${Number(row.amount).toFixed(2)} is written off and will not be deducted.`,
      data: { id, status: decision.status },
    };
  }

  approve(userId: string, id: string, authorityBasis: string, note?: string, meta?: RequestAuditMeta) {
    return this.decide(userId, id, { status: 'APPROVED', authorityBasis, note }, meta);
  }

  reject(userId: string, id: string, note: string, meta?: RequestAuditMeta) {
    return this.decide(userId, id, { status: 'REJECTED', note }, meta);
  }
}
