/**
 * Payable-source claims for visit pay runs.
 *
 * A claim key names one original earning: the source record plus the earning component.
 * `PayrollRunLine.claimKey` is unique across all runs, so the database refuses a second
 * original pay line for the same source, whichever run or request tries to write it.
 *
 * Derived lines (NMW top-up, rolled-up holiday pay) are worked out from the claimed lines of
 * their own run and carry no claim. Corrections to a paid earning are separate pay items, each
 * with its own PAY_ITEM claim.
 *
 * Earnings of a whole working week (overtime premium, WM-18; guaranteed hours top-up, WM-07) are
 * claimed per employee and week: OVERTIME:<employee>:<Monday of the week>:<n> and
 * GUARANTEE:<employee>:<Monday>:<n> are the nth settlement of that week, so two runs cannot both
 * pay the same part of a week that is split between them.
 */

export const GUARANTEED_HOURS_SOURCE = 'GUARANTEED_HOURS';

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
  if (line.sourceType === 'OVERTIME' && line.sourceRef) {
    const claim = weekEarningClaimKey('OVERTIME', line.sourceRef);
    if (claim) return claim;
  }
  if (line.sourceType === GUARANTEED_HOURS_SOURCE && line.sourceRef) {
    return weekEarningClaimKey('GUARANTEE', line.sourceRef);
  }
  // Minimum wage top-up of a pay reference period: NMW:<employee>:<first day of the period>:<n>.
  if (line.sourceType === 'NMW_PERIOD' && line.sourceRef) {
    return weekEarningClaimKey('NMW', line.sourceRef);
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

/**
 * R-22 / R-27: a line that says an earning could not be worked out. It carries no amount and no
 * claim, so the earning stays payable; `sourceRef` names the run and what is held (`ACTIVITY:<id>`,
 * `PAY_ITEM:<id>`, `CARD:<employeeId>`, `VISIT:<reconciliationId>`), and the reason is the line's
 * exception message.
 */
export const HELD_EARNING_SOURCE = 'HELD_EARNING';
export const heldEarningRef = (subject: string) => `HELD:${subject}`;
export const heldEarningSubject = (sourceRef: string) => sourceRef.replace(/^HELD:/, '');

/**
 * Source reference of an earning of one employee's working week on a run:
 * <run id>:<employee id>:<Monday of the week>:<n>. Lines written before weeks were settled across
 * runs have no <n> and hold no claim.
 */
export const weekEarningRef = (runId: string, employeeId: string, weekKey: string, sequence: number) =>
  `${runId}:${employeeId}:${weekKey}:${sequence}`;
export function weekEarningParts(sourceRef: string | null | undefined) {
  const [, employeeId, weekKey, sequence] = (sourceRef ?? '').split(':');
  return { employeeId: employeeId ?? null, weekKey: weekKey ?? null, sequence: sequence ?? null };
}
export function weekEarningClaimKey(prefix: string, sourceRef: string): string | null {
  const { employeeId, weekKey, sequence } = weekEarningParts(sourceRef);
  return employeeId && weekKey && sequence ? `${prefix}:${employeeId}:${weekKey}:${sequence}` : null;
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
