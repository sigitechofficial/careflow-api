import ExcelJS from 'exceljs';

export type InvoiceRunExportLine = {
  funderName: string;
  funderCode: string | null;
  serviceUserName: string;
  serviceUserNumber: string | null;
  visitRef: string | null;
  description: string;
  minutes: number | null;
  splitPercent: number | null;
  amountValue: number;
  exceptionMessage: string | null;
};

export type InvoiceRunExportModel = {
  periodLabel: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  status: string;
  currency: string;
  netTotalValue: number;
  lines: InvoiceRunExportLine[];
};

const LINE_HEADERS = [
  'Funder',
  'Funder Code',
  'Service User',
  'Service User Number',
  'Visit Ref',
  'Description',
  'Minutes',
  'Split %',
  'Amount',
] as const;

/** Lines sorted by funder then service user for stable, funder-grouped output. */
function sortedLines(model: InvoiceRunExportModel): InvoiceRunExportLine[] {
  return [...model.lines].sort(
    (a, b) =>
      a.funderName.localeCompare(b.funderName) ||
      a.serviceUserName.localeCompare(b.serviceUserName) ||
      (a.visitRef ?? '').localeCompare(b.visitRef ?? ''),
  );
}

function funderSubtotals(
  lines: InvoiceRunExportLine[],
): { funder: string; code: string | null; total: number }[] {
  const map = new Map<
    string,
    { funder: string; code: string | null; total: number }
  >();
  for (const l of lines) {
    const key = `${l.funderName}|${l.funderCode ?? ''}`;
    const row = map.get(key) ?? {
      funder: l.funderName,
      code: l.funderCode,
      total: 0,
    };
    row.total += l.amountValue;
    map.set(key, row);
  }
  return [...map.values()];
}

export function invoiceRunExportFilename(
  model: InvoiceRunExportModel,
  ext: 'csv' | 'xlsx',
): string {
  const safe =
    model.periodLabel.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') ||
    'invoice-run';
  return `invoice-${safe}.${ext}`;
}

// --- CSV ---------------------------------------------------------------------

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(escapeCsv).join(',');
}

export function buildInvoiceRunCsv(model: InvoiceRunExportModel): string {
  const lines = sortedLines(model);
  const rows: string[] = [csvRow([...LINE_HEADERS])];
  for (const l of lines) {
    rows.push(
      csvRow([
        l.funderName,
        l.funderCode,
        l.serviceUserName,
        l.serviceUserNumber,
        l.visitRef,
        l.exceptionMessage
          ? `${l.description} [${l.exceptionMessage}]`
          : l.description,
        l.minutes,
        l.splitPercent,
        l.amountValue.toFixed(2),
      ]),
    );
  }
  rows.push('');
  rows.push(csvRow(['Funder totals', '', '', '', '', '', '', '', '']));
  for (const f of funderSubtotals(lines)) {
    rows.push(
      csvRow([
        f.funder,
        f.code,
        '',
        '',
        '',
        '',
        '',
        'Subtotal',
        f.total.toFixed(2),
      ]),
    );
  }
  rows.push(
    csvRow([
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'Total',
      model.netTotalValue.toFixed(2),
    ]),
  );
  // Prepend a UTF-8 BOM so Excel opens the file with correct encoding (e.g. £).
  const bom = String.fromCharCode(0xfeff);
  return `${bom}${rows.join('\r\n')}\r\n`;
}

// --- Excel -------------------------------------------------------------------

export async function buildInvoiceRunXlsx(
  model: InvoiceRunExportModel,
): Promise<Buffer> {
  const lines = sortedLines(model);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CareAdmin';
  const ws = wb.addWorksheet('Invoice');

  const currencyFmt = model.currency === 'GBP' ? '£#,##0.00' : '#,##0.00';

  const title = ws.addRow([`Invoice — ${model.periodLabel}`]);
  title.font = { bold: true, size: 14 };
  ws.addRow([`Period: ${model.periodStart} to ${model.periodEnd}`]);
  ws.addRow([`Status: ${model.status}`]);
  ws.addRow([]);

  const header = ws.addRow([...LINE_HEADERS]);
  header.font = { bold: true };
  header.eachCell((c) => {
    c.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFEFEF' },
    };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFBBBBBB' } } };
  });

  for (const l of lines) {
    const row = ws.addRow([
      l.funderName,
      l.funderCode ?? '',
      l.serviceUserName,
      l.serviceUserNumber ?? '',
      l.visitRef ?? '',
      l.exceptionMessage
        ? `${l.description} [${l.exceptionMessage}]`
        : l.description,
      l.minutes ?? '',
      l.splitPercent ?? '',
      l.amountValue,
    ]);
    row.getCell(9).numFmt = currencyFmt;
  }

  ws.addRow([]);
  const totalsHeader = ws.addRow(['Funder totals']);
  totalsHeader.font = { bold: true };
  for (const f of funderSubtotals(lines)) {
    const row = ws.addRow([
      f.funder,
      f.code ?? '',
      '',
      '',
      '',
      '',
      '',
      'Subtotal',
      f.total,
    ]);
    row.getCell(9).numFmt = currencyFmt;
  }
  const grand = ws.addRow([
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'Total',
    model.netTotalValue,
  ]);
  grand.font = { bold: true };
  grand.getCell(9).numFmt = currencyFmt;

  ws.columns.forEach((col, i) => {
    col.width = [22, 12, 24, 16, 16, 40, 10, 9, 14][i] ?? 14;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
