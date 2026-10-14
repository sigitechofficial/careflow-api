/**
 * Sprint B4G — no run settles a visit whose corrected attendance times have not reached its pay.
 *
 * When the pay step of an office attendance correction fails, an ATTENDANCE_CORRECTION pay
 * calculation failure is recorded for the visit (B4F). The visit is normally also held for
 * review, but that hold can fail to save. The open failure is the authoritative record, so the
 * boundaries that settle visit pay (locking a visit pay run, closing a UK payroll run) read it
 * directly, inside their own transaction.
 *
 * Recording such a failure and settling visits take the same transaction-scoped advisory lock:
 * a failure recorded while a run is locking waits for it (and then finds the visit settled, which
 * the failure flags for a correction); a run locking while a failure is being recorded waits and
 * then sees it.
 */
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

const ATTENDANCE_PAY_LOCK = 'careflow:attendance-pay-failures';

/** Serialises recording an attendance pay failure with settling visit pay. Inside a transaction only. */
export async function lockAttendancePayFailures(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ATTENDANCE_PAY_LOCK}))`;
}

/**
 * Refuses to settle visits that have an open ATTENDANCE_CORRECTION failure. Throws when it finds
 * one, and lets any database error through, so that a check that cannot be made never passes.
 * The message names visit references and failure references only.
 */
export async function assertNoOpenAttendancePayFailures(
  tx: Prisma.TransactionClient,
  visitReconciliationIds: string[],
  action: 'lock this pay run' | 'close this payroll run',
): Promise<void> {
  if (!visitReconciliationIds.length) return;
  await lockAttendancePayFailures(tx);
  const rows = await tx.visitReconciliation.findMany({
    where: { id: { in: visitReconciliationIds } },
    select: { scheduledVisitId: true, visitRef: true },
  });
  const refByVisit = new Map(rows.map((r) => [r.scheduledVisitId, r.visitRef]));
  if (!refByVisit.size) return;
  const open = await tx.payEvaluationFailure.findMany({
    where: { status: 'OPEN', operation: 'ATTENDANCE_CORRECTION', scheduledVisitId: { in: [...refByVisit.keys()] } },
    select: { id: true, scheduledVisitId: true },
    orderBy: { firstOccurredAt: 'asc' },
  });
  if (!open.length) return;
  const list = open
    .slice(0, 20)
    .map((f) => `${refByVisit.get(f.scheduledVisitId as string) ?? 'visit'} (failure ${f.id.slice(0, 8)})`)
    .join(', ');
  throw new BadRequestException(
    `Cannot ${action}: corrected attendance times of ${open.length} visit(s) have not reached carer pay yet: ${list}${
      open.length > 20 ? ', …' : ''
    }. Retry them from Pay calculation failures, then recalculate and try again.`,
  );
}
