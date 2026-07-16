import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EcmAuditEventType, EcmMissedClassification } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcmAuditService } from './ecm-audit.service';
import { EcmEvaluationService } from './ecm-evaluation.service';

@Injectable()
export class EcmMissedTriageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluation: EcmEvaluationService,
    private readonly audit: EcmAuditService,
  ) {}

  async applyTriage(
    scheduledJobId: string,
    userId: string,
    outcome: string,
    note?: string,
  ) {
    const allowed = new Set([
      'CONFIRMED_MISSED',
      'FALSE_ECM_ALERT',
      'DISPUTED',
      'ATTENDANCE_VERIFICATION_PENDING',
      'POTENTIAL_MISSED',
    ]);
    if (!allowed.has(outcome)) {
      throw new BadRequestException('Invalid missed triage outcome');
    }

    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: scheduledJobId, deletedAt: null },
      select: { id: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');

    const result = await this.evaluation.evaluateJob(scheduledJobId, {
      confirmedMissed: outcome === 'CONFIRMED_MISSED',
      falseEcmAlert: outcome === 'FALSE_ECM_ALERT',
      disputed: outcome === 'DISPUTED',
      attendanceClaimedWithoutEvidence: outcome === 'ATTENDANCE_VERIFICATION_PENDING',
    });

    // If outcome is POTENTIAL_MISSED, natural evaluate already applied.
    if (outcome === 'POTENTIAL_MISSED' && result.evaluation.missedClassification !== EcmMissedClassification.POTENTIAL_MISSED) {
      await this.prisma.ecmVisitEvaluation.update({
        where: { scheduledJobId },
        data: { missedClassification: EcmMissedClassification.POTENTIAL_MISSED },
      });
    }

    await this.audit.append({
      eventType: EcmAuditEventType.MANUAL_OVERRIDE,
      scheduledJobId,
      actorUserId: userId,
      summary: `Missed-visit triage → ${outcome}`,
      detail: { outcome, note: note ?? null },
    });

    return {
      data: {
        scheduledJobId,
        missedClassification: outcome,
        evaluationId: result.evaluation.id,
      },
    };
  }
}
