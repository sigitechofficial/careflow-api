import { Prisma } from '@prisma/client';

/**
 * Wage recoveries (Sprint B3).
 *
 * A calculation can find that an employee was paid more than is now due for a week or a period:
 * a salary lowered for a period already paid, a guaranteed-hours top-up that a late visit made
 * unnecessary, a minimum wage top-up overtaken by later pay. Finding that is arithmetic. Taking
 * it back out of wages is a deduction, which an employer may only make with authority (the
 * contract, the worker's written agreement, or the statutory overpayment-of-wages exception),
 * and which it may also choose not to make.
 *
 * So the calculation never deducts by itself. It records a proposed recovery and shows it. A
 * person with the pay approval power, who is not the person whose calculation proposed it,
 * approves it and states the authority, or rejects it (the overpayment is then written off for
 * that amount). Only an approved recovery becomes a negative pay line.
 */
type Db = Prisma.TransactionClient;

export const RECOVERY_NOT_AUTHORISED = 'RECOVERY_NOT_AUTHORISED';
export const WAGE_RECOVERY_KINDS = ['SALARY', 'GUARANTEED_HOURS', 'OVERTIME', 'NMW_TOP_UP'] as const;
export type WageRecoveryKind = (typeof WAGE_RECOVERY_KINDS)[number];

/**
 * APPLY: deduct on this run. HOLD: show it, deduct nothing. POLICY_BLOCKED: a person has authorised
 * it, but the employer has no approved recovery policy on record, so it is still shown and not
 * deducted. WRITTEN_OFF: nothing to do or show.
 */
export type RecoveryOutcome = 'APPLY' | 'HOLD' | 'POLICY_BLOCKED' | 'WRITTEN_OFF';

/**
 * The employer's recovery policy in force (D-23), or null. Authorising one recovery says who took
 * the decision and on what basis; it does not establish that the employer may deduct at all. That
 * is the policy, and until one is recorded nothing is deducted.
 */
export function recoveryPolicyInForce(db: Db) {
  return db.wageRecoveryPolicy.findFirst({ where: { withdrawnAt: null }, orderBy: { recordedAt: 'desc' } });
}

const pence = (n: number) => Math.round(n * 100);

/**
 * What a calculation does with an overpayment it has found. `subjectKey` is the claim the
 * deduction line would carry, so one settlement of a week or period has one recovery.
 * A decision is for an amount: if the overpayment has since changed, it is proposed again.
 */
export async function resolveWageRecovery(
  db: Db,
  input: {
    subjectKey: string;
    kind: WageRecoveryKind;
    employeeId: string;
    /** The overpayment, positive. */
    amount: number;
    reason: string;
    originalReference: string;
    /** What was originally paid for the week or period, and what is now due. */
    paidAmount?: number | null;
    dueAmount?: number | null;
    runId: string;
    userId?: string | null;
  },
): Promise<RecoveryOutcome> {
  const existing = await db.wageRecovery.findUnique({ where: { subjectKey: input.subjectKey } });
  const proposal = {
    amount: input.amount,
    reason: input.reason,
    originalReference: input.originalReference,
    paidAmount: input.paidAmount ?? null,
    dueAmount: input.dueAmount ?? null,
    detectedInRunId: input.runId,
    detectedById: input.userId ?? null,
  };
  if (!existing) {
    await db.wageRecovery.create({
      data: { subjectKey: input.subjectKey, kind: input.kind, employeeId: input.employeeId, ...proposal },
    });
    return 'HOLD';
  }
  const sameAmount = pence(Number(existing.amount)) === pence(input.amount);
  if (existing.status === 'APPLIED') return 'WRITTEN_OFF';
  if (existing.status === 'APPROVED' && sameAmount) {
    return (await recoveryPolicyInForce(db)) ? 'APPLY' : 'POLICY_BLOCKED';
  }
  if (existing.status === 'REJECTED' && sameAmount) return 'WRITTEN_OFF';
  if (existing.status === 'PROPOSED' && sameAmount && existing.detectedInRunId === input.runId) return 'HOLD';
  // Proposed, withdrawn, or decided for a different amount: it is (again) a proposal.
  const reopened = existing.status === 'APPROVED' || existing.status === 'REJECTED';
  await db.wageRecovery.update({
    where: { id: existing.id },
    data: {
      ...proposal,
      // A proposal already awaiting a decision keeps the person whose calculation first raised it.
      detectedById: existing.status === 'PROPOSED' ? existing.detectedById : proposal.detectedById,
      status: 'PROPOSED',
      authorityBasis: null,
      decidedById: null,
      decidedAt: null,
      decisionNote: reopened
        ? `The overpayment changed from £${Number(existing.amount).toFixed(2)} after it was ${existing.status.toLowerCase()}; it needs a new decision.`
        : null,
    },
  });
  return 'HOLD';
}

/** Proposals this run raised earlier that its latest calculation no longer finds. */
export function withdrawStaleRecoveries(db: Db, runId: string, confirmedKeys: string[]) {
  return db.wageRecovery.updateMany({
    where: { detectedInRunId: runId, status: 'PROPOSED', subjectKey: { notIn: confirmedKeys } },
    data: { status: 'WITHDRAWN', decisionNote: 'The calculation that proposed it no longer finds an overpayment.' },
  });
}

/** The run holding the deduction lines is now final: the approved recoveries are applied. */
export function markRecoveriesApplied(db: Db, runId: string, claimKeys: string[]) {
  if (!claimKeys.length) return Promise.resolve({ count: 0 });
  return db.wageRecovery.updateMany({
    where: { subjectKey: { in: claimKeys }, status: 'APPROVED' },
    data: { status: 'APPLIED', appliedInRunId: runId, appliedAt: new Date() },
  });
}

export const recoveryHeldMessage = (amount: number, outcome: RecoveryOutcome = 'HOLD') =>
  outcome === 'POLICY_BLOCKED'
    ? `£${amount.toFixed(2)} was paid above what is now due. Its recovery has been authorised, but no approved recovery policy of the employer is on record (Billing → wage recoveries), so nothing is deducted from pay.`
    : `£${amount.toFixed(2)} was paid above what is now due. It is a proposed recovery awaiting authorisation (Billing → wage recoveries); nothing is deducted from pay until a person with the authority approves it, and it may be written off.`;
