import { InvoiceRunsService } from './invoice-runs.service';

describe('InvoiceRunsService bill-to', () => {
  const prisma = {
    funder: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'f1',
          name: 'Kent Council',
          contactName: 'Finance team',
          email: 'inv@kent.example',
          addressLine1: '1 Test Street',
          addressLine2: null,
          town: 'Maidstone',
          county: null,
          postcode: 'ME14 1XQ',
        },
      ]),
    },
    serviceUserFunding: {
      findMany: jest.fn().mockResolvedValue([
        {
          serviceUserId: 'su1',
          funderId: 'f1',
          startDate: new Date('2026-01-01T00:00:00Z'),
          endDate: null,
          status: 'ACTIVE',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          billingContactName: null,
          billingContactEmail: null,
          billingAddressLine1: null,
          billingAddressLine2: null,
          billingTown: null,
          billingCounty: null,
          billingPostcode: null,
          purchaseOrderNumber: 'PO-77',
          fundingReference: 'PKG-12',
        },
      ]),
    },
  };
  const service = Object.create(InvoiceRunsService.prototype) as InvoiceRunsService;
  (service as unknown as { prisma: typeof prisma }).prisma = prisma;

  it('addresses a single-funder invoice to the funder, with PO and funding ref', async () => {
    const out = await (service as any).withBillTo(
      [{ serviceUserId: 'su1', funders: [{ funderId: 'f1' }] }],
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-11-07T00:00:00Z'),
    );
    expect(out[0].billTo).toEqual({
      name: 'Kent Council',
      attention: 'Finance team',
      email: 'inv@kent.example',
      addressLines: ['1 Test Street', 'Maidstone', 'ME14 1XQ'],
      purchaseOrderNumber: 'PO-77',
      fundingReference: 'PKG-12',
    });
    expect(out[0].funders[0].billTo?.name).toBe('Kent Council');
  });

  it('leaves Bill to empty for direct / family payments with no funder', async () => {
    const out = await (service as any).withBillTo(
      [{ serviceUserId: 'su2', funders: [{ funderId: null }] }],
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-11-07T00:00:00Z'),
    );
    expect(out[0].billTo).toBeNull();
  });
});
