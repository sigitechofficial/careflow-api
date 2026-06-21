import { BadRequestException } from '@nestjs/common';
import type { VisitCancellationReasonCode } from './visit-cancellation-reason.util';
import { visitCancellationReasonMeta } from './visit-cancellation-reason.util';

export type VisitCancellationInput = {
  reasonCode: VisitCancellationReasonCode;
  reasonNotes?: string;
  outcome: 'CANCELLED' | 'CALLED_OFF';
  welfareChecked: boolean;
  familyNotified: boolean;
  commissionerNotified: boolean;
  chargeDecision: string;
  chargeDecisionNotes?: string;
  timeCriticalVisit: boolean;
};

export function assertVisitCancellationCompliance(input: VisitCancellationInput): void {
  const reason = visitCancellationReasonMeta(input.reasonCode);
  if (reason.requiresNotes && !input.reasonNotes?.trim()) {
    throw new BadRequestException('Reason notes are required for this cancellation reason');
  }

  const requiresWelfare =
    input.timeCriticalVisit ||
    input.outcome === 'CALLED_OFF' ||
    input.reasonCode === 'CLIENT_UNAVAILABLE' ||
    input.reasonCode === 'PROVIDER_UNABLE_TO_STAFF';

  if (requiresWelfare && !input.welfareChecked) {
    throw new BadRequestException(
      input.timeCriticalVisit
        ? 'Welfare check confirmation is required for time-critical visits'
        : 'Welfare check confirmation is required when recording a call-off or missed visit',
    );
  }

  if (input.timeCriticalVisit && !input.commissionerNotified && !input.familyNotified) {
    throw new BadRequestException(
      'Time-critical visit cancellation requires family/representative or commissioner notification',
    );
  }

  if (input.chargeDecision === 'CHARGE' && !input.chargeDecisionNotes?.trim() && !input.reasonNotes?.trim()) {
    throw new BadRequestException('Billing notes are required when charging for a cancelled visit');
  }
}
