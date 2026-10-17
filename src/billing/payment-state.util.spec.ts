import {
  assertPaymentTransition,
  isPaymentRecorded,
  isPaymentTransitionSupported,
  PAYMENT_STATES,
  PAYMENT_TRANSITIONS,
  paymentStateLabel,
  paymentStateOfBatch,
  SUPPORTED_PAYMENT_TRANSITIONS,
} from './payment-state.util';

describe('payment states (R-09)', () => {
  it('covers the whole vocabulary, and every supported transition is one the model allows', () => {
    expect([...PAYMENT_STATES].sort()).toEqual(
      [
        'ACKNOWLEDGED', 'APPROVED', 'CANCELLED', 'CONFIRMED_SETTLEMENT', 'DRAFT', 'FAILED',
        'MANUALLY_RECORDED', 'PREPARED', 'REJECTED', 'RETURNED', 'SUBMITTED',
      ].sort(),
    );
    for (const state of PAYMENT_STATES) expect(PAYMENT_TRANSITIONS[state]).toBeDefined();
    for (const [from, to] of SUPPORTED_PAYMENT_TRANSITIONS) expect(PAYMENT_TRANSITIONS[from]).toContain(to);
  });

  it('a typed reference records a payment manually; it never confirms settlement', () => {
    expect(paymentStateOfBatch({ status: 'PAID', settlementSource: 'MANUAL_ENTRY' })).toBe('MANUALLY_RECORDED');
    // A batch paid before the source was stored was also marked by a person.
    expect(paymentStateOfBatch({ status: 'PAID', settlementSource: null })).toBe('MANUALLY_RECORDED');
    expect(paymentStateOfBatch({ status: 'PAID' })).toBe('MANUALLY_RECORDED');
    expect(paymentStateLabel('MANUALLY_RECORDED')).toBe('Payment recorded manually');
    expect(paymentStateLabel('MANUALLY_RECORDED')).not.toMatch(/confirm|bank/i);
  });

  it('only a bank-confirmed source reads as confirmed settlement', () => {
    expect(paymentStateOfBatch({ status: 'PAID', settlementSource: 'BANK_CONFIRMED' })).toBe('CONFIRMED_SETTLEMENT');
    expect(paymentStateOfBatch({ status: 'APPROVED', settlementSource: 'BANK_CONFIRMED' })).toBe('APPROVED');
  });

  it('maps the stored statuses and refuses an unknown one', () => {
    expect(paymentStateOfBatch({ status: 'DRAFT' })).toBe('DRAFT');
    expect(paymentStateOfBatch({ status: 'APPROVED' })).toBe('APPROVED');
    expect(paymentStateOfBatch({ status: 'CANCELLED' })).toBe('CANCELLED');
    expect(() => paymentStateOfBatch({ status: 'SENT' })).toThrow(/Unknown payout batch status/);
  });

  it('allows today only what a person can evidence', () => {
    expect(() => assertPaymentTransition('DRAFT', 'APPROVED')).not.toThrow();
    expect(() => assertPaymentTransition('APPROVED', 'MANUALLY_RECORDED')).not.toThrow();
    expect(() => assertPaymentTransition('DRAFT', 'CANCELLED')).not.toThrow();
    expect(() => assertPaymentTransition('APPROVED', 'CANCELLED')).not.toThrow();
  });

  it('refuses states that need a bank connection, and transitions that make no sense', () => {
    const needsBank = /needs evidence from a bank or payment provider/;
    expect(() => assertPaymentTransition('MANUALLY_RECORDED', 'CONFIRMED_SETTLEMENT')).toThrow(needsBank);
    expect(() => assertPaymentTransition('APPROVED', 'PREPARED')).toThrow(needsBank);
    expect(() => assertPaymentTransition('MANUALLY_RECORDED', 'RETURNED')).toThrow(needsBank);
    expect(() => assertPaymentTransition('DRAFT', 'MANUALLY_RECORDED')).toThrow(/cannot go from DRAFT/);
    expect(() => assertPaymentTransition('APPROVED', 'CONFIRMED_SETTLEMENT')).toThrow(/cannot go from APPROVED/);
    expect(() => assertPaymentTransition('MANUALLY_RECORDED', 'DRAFT')).toThrow(/cannot go from/);
    expect(() => assertPaymentTransition('CANCELLED', 'APPROVED')).toThrow(/cannot go from/);
    expect(isPaymentTransitionSupported('ACKNOWLEDGED', 'CONFIRMED_SETTLEMENT')).toBe(false);
  });

  it('treats recorded and confirmed payments as paid out, and nothing else', () => {
    expect(PAYMENT_STATES.filter(isPaymentRecorded)).toEqual(['MANUALLY_RECORDED', 'CONFIRMED_SETTLEMENT']);
  });
});
