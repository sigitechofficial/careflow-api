/** Who an invoice is addressed to, for one funder's share of a person's care. */
export type InvoiceBillTo = {
  /** The funder (organisation, or the person / family for self-funded). */
  name: string;
  /** The named billing contact, if any. */
  attention: string | null;
  email: string | null;
  addressLines: string[];
  purchaseOrderNumber: string | null;
  fundingReference: string | null;
};

type FunderBilling = {
  name: string;
  contactName: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
};

type LineBilling = {
  billingContactName: string | null;
  billingContactEmail: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingTown: string | null;
  billingCounty: string | null;
  billingPostcode: string | null;
  purchaseOrderNumber: string | null;
  fundingReference: string | null;
};

const t = (v: string | null | undefined) => v?.trim() || null;

/**
 * The funding line's own billing details win when it has any (someone other than the funder receives the
 * invoice, e.g. an appointee); otherwise the funder's details from Settings → Funders are used.
 */
export function resolveInvoiceBillTo(funder: FunderBilling, line: LineBilling | null): InvoiceBillTo {
  const lineAddress = line
    ? [line.billingAddressLine1, line.billingAddressLine2, line.billingTown, line.billingCounty, line.billingPostcode]
        .map(t)
        .filter((v): v is string => Boolean(v))
    : [];
  const funderAddress = [funder.addressLine1, funder.addressLine2, funder.town, funder.county, funder.postcode]
    .map(t)
    .filter((v): v is string => Boolean(v));
  const lineOwn = Boolean(lineAddress.length || t(line?.billingContactName) || t(line?.billingContactEmail));
  return {
    name: funder.name,
    attention: lineOwn ? t(line?.billingContactName) : t(funder.contactName),
    email: lineOwn ? t(line?.billingContactEmail) : t(funder.email),
    addressLines: lineOwn ? lineAddress : funderAddress,
    purchaseOrderNumber: t(line?.purchaseOrderNumber),
    fundingReference: t(line?.fundingReference),
  };
}

/** The funding line that applies to an invoice period: live within the period, latest start first. */
export function pickFundingLineForPeriod<
  T extends { startDate: Date | null; endDate: Date | null; status: string; updatedAt: Date },
>(lines: T[], periodStart: Date, periodEnd: Date): T | null {
  const overlaps = (l: T) =>
    (!l.startDate || l.startDate <= periodEnd) && (!l.endDate || l.endDate >= periodStart);
  const ranked = [...lines].sort((a, b) => {
    const o = Number(overlaps(b)) - Number(overlaps(a));
    if (o) return o;
    const live = Number(b.status !== 'ENDED' && b.status !== 'REJECTED') - Number(a.status !== 'ENDED' && a.status !== 'REJECTED');
    if (live) return live;
    return (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0) || b.updatedAt.getTime() - a.updatedAt.getTime();
  });
  return ranked[0] ?? null;
}
