/**
 * Where the pay for one visit has reached, the same answer on every earnings screen.
 *
 * A visit is "payroll processed" once a UK payroll run holding it is closed, and "payment recorded"
 * only when a payout for that run has been marked paid. Recording a payout is a manual statement by
 * the office: it is not confirmation from a bank, and no stage here claims that.
 */

export type EarningStage =
  | 'RECORDED'
  | 'RECONCILED'
  | 'APPROVED'
  | 'REJECTED'
  | 'IN_DRAFT_PAY_RUN'
  | 'IN_LOCKED_PAY_RUN'
  | 'IN_OPEN_UK_RUN'
  | 'IN_CLOSED_UK_RUN'
  | 'PAYMENT_PREPARED'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_RECORDED';

export type EarningPhase =
  | 'NOT_PAYABLE'
  | 'EARNED'
  | 'PAYROLL_PROCESSED'
  | 'PAYMENT_PREPARED'
  | 'PAYMENT_RECORDED';

/** Furthest state of a payout that covers the carer's net pay from the UK run. */
export type EarningPayoutState = 'DRAFT' | 'APPROVED' | 'PAID';

export type EarningCorrectionState = 'NONE' | 'PENDING_APPROVAL' | 'ADJUSTED';

export interface EarningStageInput {
  /** VisitReconciliationStatus of the row. */
  status: string;
  /** A payable amount has been calculated. */
  priced: boolean;
  /** Claimed by a visit pay run that is not locked yet. */
  inOpenPayRun: boolean;
  /** Included in a locked (or exported) visit pay run. */
  inLockedPayRun: boolean;
  /** Status of the UK payroll run holding the visit; a cancelled run holds nothing. */
  ukRunStatus?: string | null;
  payout?: EarningPayoutState | null;
}

const APPROVED_FOR_PAY = ['APPROVED_FOR_PAY', 'APPROVED_FOR_BOTH', 'LOCKED'];

export function earningStage(input: EarningStageInput): EarningStage {
  const ukRunStatus = input.ukRunStatus && input.ukRunStatus !== 'CANCELLED' ? input.ukRunStatus : null;
  if (ukRunStatus === 'CLOSED') {
    if (input.payout === 'PAID') return 'PAYMENT_RECORDED';
    if (input.payout === 'APPROVED') return 'PAYMENT_APPROVED';
    if (input.payout === 'DRAFT') return 'PAYMENT_PREPARED';
    return 'IN_CLOSED_UK_RUN';
  }
  if (ukRunStatus) return 'IN_OPEN_UK_RUN';
  if (input.inLockedPayRun) return 'IN_LOCKED_PAY_RUN';
  if (input.inOpenPayRun) return 'IN_DRAFT_PAY_RUN';
  if (input.status === 'REJECTED_FOR_PAY') return 'REJECTED';
  if (APPROVED_FOR_PAY.includes(input.status)) return 'APPROVED';
  return input.priced ? 'RECONCILED' : 'RECORDED';
}

export function earningPhase(stage: EarningStage): EarningPhase {
  switch (stage) {
    case 'REJECTED':
      return 'NOT_PAYABLE';
    case 'IN_CLOSED_UK_RUN':
      return 'PAYROLL_PROCESSED';
    case 'PAYMENT_PREPARED':
    case 'PAYMENT_APPROVED':
      return 'PAYMENT_PREPARED';
    case 'PAYMENT_RECORDED':
      return 'PAYMENT_RECORDED';
    default:
      return 'EARNED';
  }
}

const STAGE_LABELS: Record<EarningStage, string> = {
  RECORDED: 'Recorded',
  RECONCILED: 'Awaiting approval',
  APPROVED: 'Approved for payroll',
  REJECTED: 'Rejected',
  IN_DRAFT_PAY_RUN: 'In draft pay run',
  IN_LOCKED_PAY_RUN: 'In locked pay run',
  IN_OPEN_UK_RUN: 'In UK payroll (not closed)',
  IN_CLOSED_UK_RUN: 'Payroll processed',
  PAYMENT_PREPARED: 'Payment prepared',
  PAYMENT_APPROVED: 'Payment approved',
  PAYMENT_RECORDED: 'Payment recorded',
};

export function earningStageLabel(stage: EarningStage): string {
  return STAGE_LABELS[stage];
}

/** Furthest payout state from the (batch status, line status) pairs of one UK run employee. */
export function furthestPayoutState(
  lines: ReadonlyArray<{ batchStatus: string; lineStatus: string }>,
): EarningPayoutState | null {
  let best: EarningPayoutState | null = null;
  for (const line of lines) {
    if (line.lineStatus === 'SKIPPED' || line.batchStatus === 'CANCELLED') continue;
    if (line.batchStatus === 'PAID' && line.lineStatus === 'PAID') return 'PAID';
    if (line.batchStatus === 'APPROVED' || line.batchStatus === 'PAID') best = 'APPROVED';
    else if (line.batchStatus === 'DRAFT' && !best) best = 'DRAFT';
  }
  return best;
}

/** Corrections and reversals recorded against a settled visit (rejected and cancelled ones ignored). */
export function earningCorrectionState(
  items: ReadonlyArray<{ status: string }>,
): EarningCorrectionState {
  if (items.some((i) => i.status === 'PENDING_APPROVAL')) return 'PENDING_APPROVAL';
  return items.some((i) => i.status === 'APPROVED') ? 'ADJUSTED' : 'NONE';
}
