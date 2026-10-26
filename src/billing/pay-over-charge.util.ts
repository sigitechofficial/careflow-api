/** Carer pay above the client / funder charge for a visit. */
export type PayOverCharge = { visitPay: number; visitCharge: number; shortfall: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compares a whole visit: the pay of every carer on it against everything charged for it. Done per
 * visit, not per carer row, because a two-carer visit in FIXED multi-carer mode charges on one row
 * and leaves £0 on the other. Null when nothing is charged yet (no priced charge to compare with)
 * or pay is not above the charge.
 */
export function payOverCharge(
  visitPay: number | null,
  visitCharge: number | null,
): PayOverCharge | null {
  if (visitPay == null || visitCharge == null) return null;
  const shortfall = round2(visitPay - visitCharge);
  if (shortfall <= 0) return null;
  return { visitPay: round2(visitPay), visitCharge: round2(visitCharge), shortfall };
}
