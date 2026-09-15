import {
  buildInvoiceExportVisitRow,
  buildInvoiceRunCsv,
  buildInvoiceRunXlsx,
  formatExportDurationMinutes,
  invoiceRunExportFilename,
  resolveExportDurationVariance,
  type InvoiceRunExportModel,
} from './invoice-run-export.util';

const plannedStart = new Date('2026-07-20T08:00:00.000Z');
const plannedEnd = new Date('2026-07-20T08:45:00.000Z');
const actualStart = new Date('2026-07-20T08:05:00.000Z');
const actualEnd = new Date('2026-07-20T08:40:00.000Z');

const model: InvoiceRunExportModel = {
  periodLabel: 'Week ending 20 Jul 2026',
  periodStart: '2026-07-14',
  periodEnd: '2026-07-20',
  periodStartLabel: '14/07/2026',
  periodEndLabel: '20/07/2026',
  status: 'LOCKED',
  currency: 'GBP',
  netTotalValue: 143.34,
  timeZone: 'UTC',
  dateDisplayFormat: 'DD_MM_YYYY',
  timeDisplayFormat: 'HH_MM',
  lines: [
    buildInvoiceExportVisitRow({
      visitRef: 'VIS-L09-20260720-0001',
      plannedStart,
      plannedEnd,
      actualStart,
      actualEnd,
      slot: 'Morning',
      serviceUserName: 'John Smith',
      carerName: 'Amy Carer',
      address: '12 High Street, SW1A 1AA',
      funderName: 'Family Funded',
      amountValue: 50,
      paidValue: 3,
      outstandingValue: 47,
      timeZone: 'UTC',
      dateDisplayFormat: 'DD_MM_YYYY',
      timeDisplayFormat: 'HH_MM',
    }),
    buildInvoiceExportVisitRow({
      visitRef: 'VIS-L09-20260720-0002',
      plannedStart: new Date('2026-07-20T12:00:00.000Z'),
      plannedEnd: new Date('2026-07-20T13:00:00.000Z'),
      actualStart: new Date('2026-07-20T12:00:00.000Z'),
      actualEnd: new Date('2026-07-20T13:20:00.000Z'),
      slot: 'Lunch',
      serviceUserName: 'John Smith',
      carerName: 'Amy Carer',
      address: '12 High Street, SW1A 1AA',
      funderName: 'NHS Continuing Healthcare',
      amountValue: 93.34,
      paidValue: 0,
      outstandingValue: 93.34,
      timeZone: 'UTC',
      dateDisplayFormat: 'DD_MM_YYYY',
      timeDisplayFormat: 'HH_MM',
    }),
  ],
  funderSummaries: [
    {
      funderName: 'Family Funded',
      invoicedValue: 50,
      paidValue: 3,
      outstandingValue: 47,
    },
    {
      funderName: 'NHS Continuing Healthcare',
      invoicedValue: 93.34,
      paidValue: 0,
      outstandingValue: 93.34,
    },
  ],
};

describe('invoice-run export', () => {
  describe('buildInvoiceRunCsv', () => {
    const csv = buildInvoiceRunCsv(model);

    it('starts with visit-detail column headers including funder payment', () => {
      const body = csv.replace(/^\uFEFF/, '');
      expect(body.startsWith('Visit reference,Date,Slot,Service user,Carer,')).toBe(
        true,
      );
      expect(csv).toContain(
        'Address,Funder,Amount,Paid,Outstanding',
      );
      expect(csv).not.toContain('Invoice Run,');
    });

    it('renders a row per visit with funder paid and outstanding', () => {
      expect(csv).toContain('VIS-L09-20260720-0001');
      expect(csv).toContain('Family Funded');
      expect(csv).toContain('NHS Continuing Healthcare');
      expect(csv).toContain('£50.00');
      expect(csv).toContain('£3.00');
      expect(csv).toContain('£47.00');
      expect(csv).toContain('£93.34');
    });

    it('uses organisation date display format and operational timezone clocks', () => {
      expect(csv).toContain('20/07/2026');
      expect(csv).toContain('08:00');
      expect(csv).toContain('08:45');
      expect(csv).not.toContain('2026-07-20');
    });

    it('does not append a funder payments summary section', () => {
      expect(csv).not.toContain('Funder payments');
      expect(csv).not.toContain('Funder,Invoiced,Paid,Outstanding');
    });

    it('quotes fields containing commas', () => {
      expect(csv).toContain('"12 High Street, SW1A 1AA"');
    });

    it('starts with a UTF-8 BOM for Excel', () => {
      expect(csv.charCodeAt(0)).toBe(0xfeff);
    });
  });

  describe('buildInvoiceExportVisitRow timezone + date format', () => {
    it('converts UTC instants into Asia/Karachi wall clock and DD/MM/YYYY', () => {
      const row = buildInvoiceExportVisitRow({
        visitRef: 'VIS-1',
        // 08:00 UTC = 13:00 Asia/Karachi
        plannedStart: new Date('2026-07-20T08:00:00.000Z'),
        plannedEnd: new Date('2026-07-20T08:45:00.000Z'),
        actualStart: new Date('2026-07-20T08:05:00.000Z'),
        actualEnd: new Date('2026-07-20T08:40:00.000Z'),
        slot: 'Morning',
        serviceUserName: 'John Smith',
        carerName: 'Amy Carer',
        address: '',
        funderName: 'Family Funded',
        amountValue: 50,
        paidValue: 0,
        outstandingValue: 50,
        timeZone: 'Asia/Karachi',
        dateDisplayFormat: 'DD_MM_YYYY',
        timeDisplayFormat: 'HH_MM',
      });
      expect(row.dateKey).toBe('2026-07-20');
      expect(row.date).toBe('20/07/2026');
      expect(row.plannedStart).toBe('13:00');
      expect(row.plannedEnd).toBe('13:45');
      expect(row.actualStart).toBe('13:05');
      expect(row.actualEnd).toBe('13:40');
    });

    it('supports MM/DD/YYYY date display format', () => {
      const row = buildInvoiceExportVisitRow({
        visitRef: 'VIS-1',
        plannedStart: new Date('2026-07-20T08:00:00.000Z'),
        plannedEnd: null,
        actualStart: null,
        actualEnd: null,
        slot: '',
        serviceUserName: 'John Smith',
        carerName: '',
        address: '',
        funderName: 'Family Funded',
        amountValue: 10,
        paidValue: 0,
        outstandingValue: 10,
        timeZone: 'UTC',
        dateDisplayFormat: 'MM_DD_YYYY',
      });
      expect(row.date).toBe('07/20/2026');
    });
  });

  describe('duration helpers', () => {
    it('formats duration minutes', () => {
      expect(formatExportDurationMinutes(45)).toBe('45m');
      expect(formatExportDurationMinutes(60)).toBe('1h');
      expect(formatExportDurationMinutes(75)).toBe('1h 15m');
      expect(formatExportDurationMinutes(null)).toBe('');
    });

    it('classifies duration variance', () => {
      expect(
        resolveExportDurationVariance({
          plannedStart,
          plannedEnd,
          actualStart,
          actualEnd,
        }),
      ).toMatch(/^On time/);
      expect(
        resolveExportDurationVariance({
          plannedStart,
          plannedEnd,
          actualStart: plannedStart,
          actualEnd: new Date('2026-07-20T09:10:00.000Z'),
        }),
      ).toMatch(/^Exceeded/);
      expect(
        resolveExportDurationVariance({
          plannedStart,
          plannedEnd,
          actualStart: plannedStart,
          actualEnd: new Date('2026-07-20T08:20:00.000Z'),
        }),
      ).toMatch(/^Short/);
      expect(
        resolveExportDurationVariance({
          plannedStart,
          plannedEnd,
          actualStart: null,
          actualEnd: null,
        }),
      ).toBe('Not assessed');
    });
  });

  describe('buildInvoiceRunXlsx', () => {
    it('produces a valid xlsx (zip) buffer', async () => {
      const buf = await buildInvoiceRunXlsx(model);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
      expect(buf.length).toBeGreaterThan(1000);
    });
  });

  describe('invoiceRunExportFilename', () => {
    it('slugs the period label', () => {
      expect(invoiceRunExportFilename(model, 'csv')).toBe(
        'invoice-Week-ending-20-Jul-2026.csv',
      );
      expect(invoiceRunExportFilename(model, 'xlsx')).toBe(
        'invoice-Week-ending-20-Jul-2026.xlsx',
      );
    });
  });
});
