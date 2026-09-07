import {
  buildInvoiceRunCsv,
  buildInvoiceRunXlsx,
  invoiceRunExportFilename,
  type InvoiceRunExportModel,
} from './invoice-run-export.util';

const model: InvoiceRunExportModel = {
  periodLabel: 'Week ending 20 Jul 2026',
  periodStart: '2026-07-14',
  periodEnd: '2026-07-20',
  status: 'LOCKED',
  currency: 'GBP',
  netTotalValue: 143.34,
  lines: [
    {
      funderName: 'NHS Continuing Healthcare',
      funderCode: 'NHS_CHC',
      serviceUserName: 'John Smith',
      serviceUserNumber: 'SU-001',
      visitRef: 'V-2026-07-AB',
      description: 'Morning call, 45 min',
      minutes: 45,
      splitPercent: 30,
      amountValue: 50,
      exceptionMessage: null,
    },
    {
      funderName: 'Family Funded',
      funderCode: null,
      serviceUserName: 'John Smith',
      serviceUserNumber: 'SU-001',
      visitRef: 'V-2026-07-AB',
      description: 'Morning call, 45 min',
      minutes: 45,
      splitPercent: 50,
      amountValue: 93.34,
      exceptionMessage: 'Rate estimated',
    },
  ],
};

describe('invoice-run export', () => {
  describe('buildInvoiceRunCsv', () => {
    const csv = buildInvoiceRunCsv(model);

    it('starts with column headers (no run metadata preamble)', () => {
      const body = csv.replace(/^\uFEFF/, '');
      expect(body.startsWith('Funder,Funder Code,Service User,')).toBe(true);
      expect(csv).not.toContain('Invoice Run,');
      expect(csv).not.toContain('Period,2026-07-14');
      expect(csv).not.toContain('Status,LOCKED');
      expect(csv).not.toContain('Currency,GBP');
    });

    it('renders a row per line with the amount to 2dp', () => {
      expect(csv).toContain('NHS Continuing Healthcare,NHS_CHC,John Smith,SU-001,V-2026-07-AB');
      expect(csv).toContain('50.00');
      expect(csv).toContain('93.34');
    });

    it('appends the exception note to the description', () => {
      expect(csv).toContain('Morning call, 45 min [Rate estimated]');
    });

    it('emits per-funder subtotals and a grand total', () => {
      expect(csv).toContain('Subtotal');
      expect(csv).toContain('Total,143.34');
    });

    it('quotes fields containing commas', () => {
      // "Morning call, 45 min" contains a comma so must be quoted.
      expect(csv).toContain('"Morning call, 45 min');
    });

    it('starts with a UTF-8 BOM for Excel', () => {
      expect(csv.charCodeAt(0)).toBe(0xfeff);
    });
  });

  describe('buildInvoiceRunXlsx', () => {
    it('produces a valid xlsx (zip) buffer', async () => {
      const buf = await buildInvoiceRunXlsx(model);
      expect(Buffer.isBuffer(buf)).toBe(true);
      // xlsx is a zip archive — starts with the PK signature.
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
      expect(buf.length).toBeGreaterThan(1000);
    });
  });

  describe('invoiceRunExportFilename', () => {
    it('slugs the period label', () => {
      expect(invoiceRunExportFilename(model, 'csv')).toBe('invoice-Week-ending-20-Jul-2026.csv');
      expect(invoiceRunExportFilename(model, 'xlsx')).toBe('invoice-Week-ending-20-Jul-2026.xlsx');
    });
  });
});
