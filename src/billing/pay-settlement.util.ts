/**
 * "Pay settled": the carer pay of a visit is part of a locked visit pay run, or was taken as a
 * provisional input by a UK payroll run that has closed. From then on the pay snapshot of the
 * visit reconciliation is history. It is not edited; a difference is paid (or recovered) through
 * a pay correction in a later run.
 */
export type PaySettlementRef = {
  includedInPayrollRunId?: string | null;
  paidByUkPayrollRunId?: string | null;
};

export function isPaySettled(row: PaySettlementRef): boolean {
  return Boolean(row.includedInPayrollRunId || row.paidByUkPayrollRunId);
}

export const PAY_SETTLED_MESSAGE =
  'The pay of this visit is in a locked payroll run and cannot be changed. Record a pay correction instead; it is paid in the next run.';

/** Columns of the pay snapshot (the database trigger protects the same list). */
export const PAY_SNAPSHOT_FIELDS = [
  'employeeId',
  'payableAmount',
  'payableMinutes',
  'approvedPayStart',
  'approvedPayEnd',
  'payCardId',
  'payCardVersion',
  'payCardSource',
  'travelMiles',
  'travelMinutes',
  'unpaidTravelMinutes',
  'passengerMiles',
] as const;

/** Drops pay snapshot columns from an update payload (used when a settled row is re-evaluated). */
export function withoutPaySnapshotFields<T extends Record<string, unknown>>(data: T): T {
  const copy: Record<string, unknown> = { ...data };
  for (const field of PAY_SNAPSHOT_FIELDS) delete copy[field];
  return copy as T;
}

/**
 * Amount still to pay (positive) or recover (negative) so that a settled visit ends up at
 * `correctedAmount`: the corrected figure less what the original line and earlier corrections
 * already paid. Pence-exact.
 */
export function correctionDifference(
  correctedAmount: number,
  originalAmount: number,
  earlierCorrections: number[],
): number {
  const pence = (n: number) => Math.round(n * 100);
  const settled = pence(originalAmount) + earlierCorrections.reduce((sum, n) => sum + pence(n), 0);
  return (pence(correctedAmount) - settled) / 100;
}

/** Where one correction or reversal has got to, in the words the office sees. */
export type PayCorrectionDisplayStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED_FOR_PAYROLL'
  | 'INCLUDED_IN_PAYROLL'
  | 'SETTLED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REVERSED';

export function payCorrectionDisplayStatus(item: {
  status: string;
  /** Set when a visit pay run holding the item is locked. */
  includedInPayrollRunId?: string | null;
  /** A visit pay run that is not locked yet has picked the item up. */
  inOpenRun: boolean;
  /** An approved reversal cancels the item out. */
  reversed: boolean;
}): PayCorrectionDisplayStatus {
  if (item.status === 'PENDING_APPROVAL') return 'PENDING_APPROVAL';
  if (item.status === 'REJECTED') return 'REJECTED';
  if (item.status !== 'APPROVED') return 'CANCELLED';
  if (item.reversed) return 'REVERSED';
  if (item.includedInPayrollRunId) return 'SETTLED';
  return item.inOpenRun ? 'INCLUDED_IN_PAYROLL' : 'APPROVED_FOR_PAYROLL';
}
