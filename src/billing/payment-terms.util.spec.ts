import {
  computeInvoiceDueDate,
  DEFAULT_PAYMENT_TERMS_DAYS,
  parsePaymentTermsDays,
  normalizePaymentTermsLabel,
  addUtcCalendarDays,
  utcDateOnly,
} from './payment-terms.util';

describe('parsePaymentTermsDays', () => {
  it('parses Net 30', () => {
    expect(parsePaymentTermsDays('Net 30')).toBe(30);
  });

  it('parses Due on receipt as 0', () => {
    expect(parsePaymentTermsDays('Due on receipt')).toBe(0);
  });

  it('defaults missing/garbage to Net 30 days', () => {
    expect(parsePaymentTermsDays(null)).toBe(DEFAULT_PAYMENT_TERMS_DAYS);
    expect(parsePaymentTermsDays('')).toBe(DEFAULT_PAYMENT_TERMS_DAYS);
    expect(parsePaymentTermsDays('COD weird')).toBe(DEFAULT_PAYMENT_TERMS_DAYS);
  });

  it('parses Net 15 and Net 60', () => {
    expect(parsePaymentTermsDays('net15')).toBe(15);
    expect(parsePaymentTermsDays('NET 60')).toBe(60);
  });
});

describe('computeInvoiceDueDate', () => {
  it('sets dueDate = invoiceDate + 30 when terms missing', () => {
    const invoiceDate = utcDateOnly(new Date('2026-09-01T12:00:00.000Z'));
    const { dueDate, paymentTermsLabel, netDays } = computeInvoiceDueDate(
      invoiceDate,
      null,
    );
    expect(netDays).toBe(30);
    expect(paymentTermsLabel).toBe('Net 30');
    expect(dueDate.toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  it('Due on receipt keeps same calendar day', () => {
    const invoiceDate = utcDateOnly(new Date('2026-09-10T00:00:00.000Z'));
    const { dueDate } = computeInvoiceDueDate(invoiceDate, 'Due on receipt');
    expect(dueDate.toISOString().slice(0, 10)).toBe('2026-09-10');
  });

  it('addUtcCalendarDays crosses months', () => {
    const start = utcDateOnly(new Date('2026-01-31T00:00:00.000Z'));
    expect(addUtcCalendarDays(start, 1).toISOString().slice(0, 10)).toBe(
      '2026-02-01',
    );
  });

  it('normalizePaymentTermsLabel fills default', () => {
    expect(normalizePaymentTermsLabel(null)).toBe('Net 30');
    expect(normalizePaymentTermsLabel('  Net 15 ')).toBe('Net 15');
  });
});
