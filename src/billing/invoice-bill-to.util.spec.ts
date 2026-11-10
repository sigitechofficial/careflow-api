import { pickFundingLineForPeriod, resolveInvoiceBillTo } from './invoice-bill-to.util';

const funder = {
  name: 'Bromley Council',
  contactName: 'Finance team',
  email: 'invoices@bromley.example',
  addressLine1: 'Civic Centre',
  addressLine2: null,
  town: 'Bromley',
  county: null,
  postcode: 'BR1 3UH',
};
const emptyLine = {
  billingContactName: null,
  billingContactEmail: null,
  billingAddressLine1: null,
  billingAddressLine2: null,
  billingTown: null,
  billingCounty: null,
  billingPostcode: null,
  purchaseOrderNumber: 'PO-77',
  fundingReference: 'PKG-12',
};

describe('resolveInvoiceBillTo', () => {
  it("uses the funder's billing details when the line has none", () => {
    expect(resolveInvoiceBillTo(funder, emptyLine)).toEqual({
      name: 'Bromley Council',
      attention: 'Finance team',
      email: 'invoices@bromley.example',
      addressLines: ['Civic Centre', 'Bromley', 'BR1 3UH'],
      purchaseOrderNumber: 'PO-77',
      fundingReference: 'PKG-12',
    });
  });
  it("uses the line's own details when someone else receives the invoice", () => {
    const r = resolveInvoiceBillTo(funder, {
      ...emptyLine,
      billingContactName: 'Jane Smith (appointee)',
      billingAddressLine1: '4 High St',
      billingPostcode: 'SE1 1AA',
    });
    expect(r.attention).toBe('Jane Smith (appointee)');
    expect(r.email).toBeNull();
    expect(r.addressLines).toEqual(['4 High St', 'SE1 1AA']);
  });
});

describe('pickFundingLineForPeriod', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  it('prefers the line live in the period', () => {
    const old = { id: 'a', startDate: d('2025-01-01'), endDate: d('2025-12-31'), status: 'ENDED', updatedAt: d('2026-01-01') };
    const now = { id: 'b', startDate: d('2026-01-01'), endDate: null, status: 'ACTIVE', updatedAt: d('2026-01-01') };
    expect(pickFundingLineForPeriod([old, now], d('2026-11-01'), d('2026-11-07'))?.id).toBe('b');
  });
});
