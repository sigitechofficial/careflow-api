/**
 * Payable-source claims for visit pay runs.
 *
 * A claim key names one original earning: the source record plus the earning component.
 * `PayrollRunLine.claimKey` is unique across all runs, so the database refuses a second
 * original pay line for the same source, whichever run or request tries to write it.
 *
 * Derived lines (NMW top-up, overtime premium, rolled-up holiday pay) are worked out from the
 * claimed lines of their own run and carry no claim. Corrections to a paid earning are separate
 * pay items, each with its own PAY_ITEM claim.
 */

export type ClaimableLine = {
  visitReconciliationId?: string | null;
  employeePayItemId?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  lineType?: string | null;
};

export function payrollLineClaimKey(line: ClaimableLine): string | null {
  if (line.employeePayItemId) return `PAY_ITEM:${line.employeePayItemId}`;
  if (line.sourceType === 'NON_CORE_ACTIVITY' && line.sourceRef) {
    return `NON_CORE_ACTIVITY:${line.sourceRef}`;
  }
  if (
    line.visitReconciliationId &&
    line.lineType !== 'NMW_TOP_UP' &&
    (line.sourceType == null || line.sourceType === 'VISIT')
  ) {
    return `VISIT:${line.visitReconciliationId}:${line.lineType ?? 'VISIT_PAY'}`;
  }
  return null;
}

export const visitPayClaimKey = (reconciliationId: string) => `VISIT:${reconciliationId}:VISIT_PAY`;
export const payItemClaimKey = (payItemId: string) => `PAY_ITEM:${payItemId}`;
export const activityClaimKey = (activityId: string) => `NON_CORE_ACTIVITY:${activityId}`;

/** True when a Prisma error is the unique violation on PayrollRunLine.claimKey. */
export function isClaimConflict(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  if (!e || e.code !== 'P2002') return false;
  const target = Array.isArray(e.meta?.target) ? e.meta.target.join(',') : String(e.meta?.target ?? '');
  return target.includes('claimKey');
}
