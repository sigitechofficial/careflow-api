/**
 * QuickBooks-style payment terms → calendar days until due.
 * Due date = invoice date + days (Due on receipt = 0; default Net 30).
 */

export const DEFAULT_PAYMENT_TERMS_LABEL = 'Net 30';
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

/** Parse charge-card / QBO terms text into calendar days. */
export function parsePaymentTermsDays(terms: string | null | undefined): number {
  const raw = (terms ?? '').trim();
  if (!raw) return DEFAULT_PAYMENT_TERMS_DAYS;

  if (/due\s+on\s+receipt/i.test(raw) || /^upon\s+receipt$/i.test(raw)) {
    return 0;
  }

  const net = raw.match(/net\s*(\d+)/i);
  if (net) {
    const days = Number(net[1]);
    if (Number.isFinite(days) && days >= 0) return Math.floor(days);
  }

  const bare = raw.match(/^(\d+)\s*days?$/i);
  if (bare) {
    const days = Number(bare[1]);
    if (Number.isFinite(days) && days >= 0) return Math.floor(days);
  }

  return DEFAULT_PAYMENT_TERMS_DAYS;
}

/** Normalize display label for snapshot (empty → Net 30). */
export function normalizePaymentTermsLabel(terms: string | null | undefined): string {
  const raw = (terms ?? '').trim();
  return raw || DEFAULT_PAYMENT_TERMS_LABEL;
}

/** UTC calendar date only (Y-M-D at 00:00 UTC). */
export function utcDateOnly(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Add calendar days to a UTC date-only value. */
export function addUtcCalendarDays(dateOnly: Date, days: number): Date {
  const base = utcDateOnly(dateOnly);
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() + Math.floor(days),
    ),
  );
}

export function computeInvoiceDueDate(
  invoiceDate: Date,
  paymentTerms: string | null | undefined,
): { dueDate: Date; paymentTermsLabel: string; netDays: number } {
  const paymentTermsLabel = normalizePaymentTermsLabel(paymentTerms);
  const netDays = parsePaymentTermsDays(paymentTerms);
  const dueDate = addUtcCalendarDays(invoiceDate, netDays);
  return { dueDate, paymentTermsLabel, netDays };
}
