/**
 * Payment states of a payout batch (R-09 / decision D-04).
 *
 * The full vocabulary is defined so that a bank or payment-provider connection can be added later
 * without renaming anything. Today the system has no such connection: the only way a batch
 * becomes paid is a person typing a payment reference. That is a manually recorded payment. It is
 * not confirmation from a bank, and nothing here lets a batch reach CONFIRMED_SETTLEMENT.
 */
export const PAYMENT_STATES = [
  'DRAFT',
  'APPROVED',
  'PREPARED',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'REJECTED',
  'FAILED',
  'RETURNED',
  'MANUALLY_RECORDED',
  'CONFIRMED_SETTLEMENT',
  'CANCELLED',
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** How the system knows a batch was paid. */
export const SETTLEMENT_SOURCES = ['MANUAL_ENTRY', 'BANK_CONFIRMED'] as const;
export type SettlementSource = (typeof SETTLEMENT_SOURCES)[number];

/**
 * Every transition the model allows. PREPARED (payment file built), SUBMITTED / ACKNOWLEDGED /
 * REJECTED / FAILED / RETURNED (provider responses) and CONFIRMED_SETTLEMENT (matched to a bank
 * statement or provider report) need evidence from an interface that does not exist yet.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  DRAFT: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PREPARED', 'MANUALLY_RECORDED', 'CANCELLED'],
  PREPARED: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['ACKNOWLEDGED', 'REJECTED', 'FAILED'],
  ACKNOWLEDGED: ['CONFIRMED_SETTLEMENT', 'FAILED', 'RETURNED'],
  REJECTED: ['PREPARED', 'CANCELLED'],
  FAILED: ['PREPARED', 'CANCELLED'],
  RETURNED: ['PREPARED', 'CANCELLED'],
  MANUALLY_RECORDED: ['CONFIRMED_SETTLEMENT', 'RETURNED'],
  CONFIRMED_SETTLEMENT: ['RETURNED'],
  CANCELLED: [],
};

/** Transitions a current screen or endpoint can actually perform, with the evidence it has. */
export const SUPPORTED_PAYMENT_TRANSITIONS: ReadonlyArray<readonly [PaymentState, PaymentState]> = [
  ['DRAFT', 'APPROVED'],
  ['DRAFT', 'CANCELLED'],
  ['APPROVED', 'CANCELLED'],
  ['APPROVED', 'MANUALLY_RECORDED'],
];

export class UnsupportedPaymentTransitionError extends Error {}

export function isPaymentTransitionSupported(from: PaymentState, to: PaymentState): boolean {
  return SUPPORTED_PAYMENT_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

export function assertPaymentTransition(from: PaymentState, to: PaymentState): void {
  if (!PAYMENT_TRANSITIONS[from].includes(to)) {
    throw new UnsupportedPaymentTransitionError(`A payment cannot go from ${from} to ${to}.`);
  }
  if (!isPaymentTransitionSupported(from, to)) {
    throw new UnsupportedPaymentTransitionError(
      `${to} needs evidence from a bank or payment provider. No such connection is set up, so this state cannot be recorded.`,
    );
  }
}

/** The payment state of a stored batch. A paid batch is "confirmed" only when a bank said so. */
export function paymentStateOfBatch(batch: {
  status: string;
  settlementSource?: string | null;
}): PaymentState {
  switch (batch.status) {
    case 'DRAFT':
      return 'DRAFT';
    case 'APPROVED':
      return 'APPROVED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'PAID':
      return batch.settlementSource === 'BANK_CONFIRMED' ? 'CONFIRMED_SETTLEMENT' : 'MANUALLY_RECORDED';
    default:
      throw new Error(`Unknown payout batch status: ${batch.status}`);
  }
}

const LABELS: Record<PaymentState, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved — not paid yet',
  PREPARED: 'Payment prepared',
  SUBMITTED: 'Submitted to bank',
  ACKNOWLEDGED: 'Acknowledged by bank',
  REJECTED: 'Rejected by bank',
  FAILED: 'Payment failed',
  RETURNED: 'Payment returned',
  MANUALLY_RECORDED: 'Payment recorded manually',
  CONFIRMED_SETTLEMENT: 'Settlement confirmed',
  CANCELLED: 'Cancelled',
};

export function paymentStateLabel(state: PaymentState): string {
  return LABELS[state];
}

/** Money is treated as having left the account: recorded by a person, or confirmed by a bank. */
export function isPaymentRecorded(state: PaymentState): boolean {
  return state === 'MANUALLY_RECORDED' || state === 'CONFIRMED_SETTLEMENT';
}
