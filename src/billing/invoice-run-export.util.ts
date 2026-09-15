import ExcelJS from 'exceljs';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  formatHmInTimeZone,
} from '../common/utils/operational-day.util';
import {
  DEFAULT_DATE_DISPLAY_FORMAT,
  DEFAULT_TIME_DISPLAY_FORMAT,
  formatOrganisationHm,
  formatOrganisationIsoDate,
  type DateDisplayFormat,
  type TimeDisplayFormat,
} from '../common/utils/organisation-display-format.util';
import {
  formatDateOnly,
  minutesBetween,
} from './visit-reconciliation.util';
import { formatMoney } from './billing-run.util';

/** Align with admin visits export: underrun under this is still "On time". */
export const INVOICE_EXPORT_DURATION_UNDERRUN_TOLERANCE_MINUTES = 15;

export type InvoiceRunExportLine = {
  visitRef: string | null;
  /** YYYY-MM-DD in org timezone — used for sorting only. */
  dateKey: string;
  /** Organisation date display format for CSV/Excel. */
  date: string;
  slot: string;
  serviceUserName: string;
  carerName: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string;
  actualEnd: string;
  plannedDuration: string;
  actualDuration: string;
  durationVariance: string;
  address: string;
  funderName: string;
  /** Invoiced amount for this visit × funder line. */
  amountValue: number;
  /** Total paid by this funder on the exported invoice scope. */
  paidValue: number;
  /** Remaining for this funder on the exported invoice scope. */
  outstandingValue: number;
};

export type InvoiceRunExportFunderSummary = {
  funderName: string;
  invoicedValue: number;
  paidValue: number;
  outstandingValue: number;
};

export type InvoiceRunExportModel = {
  periodLabel: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  /** Period bounds formatted with organisation date display format. */
  periodStartLabel: string;
  periodEndLabel: string;
  status: string;
  currency: string;
  netTotalValue: number;
  timeZone: string;
  dateDisplayFormat: DateDisplayFormat;
  timeDisplayFormat: TimeDisplayFormat;
  lines: InvoiceRunExportLine[];
  funderSummaries: InvoiceRunExportFunderSummary[];
};

const LINE_HEADERS = [
  'Visit reference',
  'Date',
  'Slot',
  'Service user',
  'Carer',
  'Planned start',
  'Planned end',
  'Actual start',
  'Actual end',
  'Planned duration',
  'Actual duration',
  'Duration variance',
  'Address',
  'Funder',
  'Amount',
  'Paid',
  'Outstanding',
] as const;

/** Lines sorted by date then visit ref for stable output. */
function sortedLines(model: InvoiceRunExportModel): InvoiceRunExportLine[] {
  return [...model.lines].sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) ||
      (a.visitRef ?? '').localeCompare(b.visitRef ?? '') ||
      a.serviceUserName.localeCompare(b.serviceUserName) ||
      a.funderName.localeCompare(b.funderName),
  );
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

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(escapeCsv).join(',');
}

function money(n: number, currency = 'GBP'): string {
  return formatMoney(n, currency);
}

export function formatExportDurationMinutes(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatExportClockTime(
  date: Date | null | undefined,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
  timeDisplayFormat: TimeDisplayFormat = DEFAULT_TIME_DISPLAY_FORMAT,
): string {
  if (!date) return '';
  return formatOrganisationHm(
    formatHmInTimeZone(date, timeZone),
    timeDisplayFormat,
  );
}

/**
 * Authority-friendly duration variance label (same categories as employee visits CSV).
 */
export function resolveExportDurationVariance(input: {
  plannedStart: Date;
  plannedEnd: Date | null | undefined;
  actualStart: Date | null | undefined;
  actualEnd: Date | null | undefined;
}): string {
  if (!input.plannedEnd || !input.actualStart || !input.actualEnd) {
    return 'Not assessed';
  }
  const plannedMinutes = minutesBetween(input.plannedStart, input.plannedEnd);
  const actualMinutes = minutesBetween(input.actualStart, input.actualEnd);
  if (plannedMinutes <= 0 || actualMinutes < 0) return 'Not assessed';

  const delta = actualMinutes - plannedMinutes;
  if (actualMinutes > plannedMinutes) {
    return delta > 0 ? `Exceeded (+${delta})` : 'Exceeded';
  }
  if (
    actualMinutes <
    plannedMinutes - INVOICE_EXPORT_DURATION_UNDERRUN_TOLERANCE_MINUTES
  ) {
    return `Short (${delta})`;
  }
  return delta === 0
    ? 'On time'
    : `On time (${delta > 0 ? '+' : ''}${delta})`;
}

export function buildInvoiceExportVisitRow(input: {
  visitRef: string | null;
  plannedStart: Date;
  plannedEnd: Date | null | undefined;
  actualStart: Date | null | undefined;
  actualEnd: Date | null | undefined;
  slot: string;
  serviceUserName: string;
  carerName: string;
  address: string;
  funderName: string;
  amountValue: number;
  paidValue: number;
  outstandingValue: number;
  timeZone?: string;
  dateDisplayFormat?: DateDisplayFormat;
  timeDisplayFormat?: TimeDisplayFormat;
}): InvoiceRunExportLine {
  const timeZone = input.timeZone ?? DEFAULT_OPERATIONAL_TIMEZONE;
  const dateDisplayFormat =
    input.dateDisplayFormat ?? DEFAULT_DATE_DISPLAY_FORMAT;
  const timeDisplayFormat =
    input.timeDisplayFormat ?? DEFAULT_TIME_DISPLAY_FORMAT;
  const dateKey = formatDateOnly(input.plannedStart, timeZone);
  const plannedMinutes =
    input.plannedEnd != null
      ? minutesBetween(input.plannedStart, input.plannedEnd)
      : null;
  const actualMinutes =
    input.actualStart && input.actualEnd
      ? minutesBetween(input.actualStart, input.actualEnd)
      : null;

  return {
    visitRef: input.visitRef,
    dateKey,
    date: formatOrganisationIsoDate(dateKey, dateDisplayFormat),
    slot: input.slot,
    serviceUserName: input.serviceUserName,
    carerName: input.carerName,
    plannedStart: formatExportClockTime(
      input.plannedStart,
      timeZone,
      timeDisplayFormat,
    ),
    plannedEnd: formatExportClockTime(
      input.plannedEnd,
      timeZone,
      timeDisplayFormat,
    ),
    actualStart: formatExportClockTime(
      input.actualStart,
      timeZone,
      timeDisplayFormat,
    ),
    actualEnd: formatExportClockTime(
      input.actualEnd,
      timeZone,
      timeDisplayFormat,
    ),
    plannedDuration: formatExportDurationMinutes(plannedMinutes),
    actualDuration: formatExportDurationMinutes(actualMinutes),
    durationVariance: resolveExportDurationVariance({
      plannedStart: input.plannedStart,
      plannedEnd: input.plannedEnd,
      actualStart: input.actualStart,
      actualEnd: input.actualEnd,
    }),
    address: input.address,
    funderName: input.funderName,
    amountValue: Math.round(input.amountValue * 100) / 100,
    paidValue: Math.round(input.paidValue * 100) / 100,
    outstandingValue: Math.round(input.outstandingValue * 100) / 100,
  };
}

/** Build funder roll-up from visit lines (unique by funder name). */
export function buildFunderSummariesFromLines(
  lines: InvoiceRunExportLine[],
): InvoiceRunExportFunderSummary[] {
  const map = new Map<string, InvoiceRunExportFunderSummary>();
  for (const l of lines) {
    const existing = map.get(l.funderName);
    if (existing) {
      existing.invoicedValue =
        Math.round((existing.invoicedValue + l.amountValue) * 100) / 100;
      // Paid/outstanding are funder totals — keep first seen values.
    } else {
      map.set(l.funderName, {
        funderName: l.funderName,
        invoicedValue: l.amountValue,
        paidValue: l.paidValue,
        outstandingValue: l.outstandingValue,
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.funderName.localeCompare(b.funderName),
  );
}

function lineToFields(
  l: InvoiceRunExportLine,
  currency: string,
): (string | number | null)[] {
  return [
    l.visitRef,
    l.date,
    l.slot,
    l.serviceUserName,
    l.carerName,
    l.plannedStart,
    l.plannedEnd,
    l.actualStart,
    l.actualEnd,
    l.plannedDuration,
    l.actualDuration,
    l.durationVariance,
    l.address,
    l.funderName,
    money(l.amountValue, currency),
    money(l.paidValue, currency),
    money(l.outstandingValue, currency),
  ];
}

// --- CSV ---------------------------------------------------------------------

export function buildInvoiceRunCsv(model: InvoiceRunExportModel): string {
  const lines = sortedLines(model);
  const rows: string[] = [csvRow([...LINE_HEADERS])];
  for (const l of lines) {
    rows.push(csvRow(lineToFields(l, model.currency)));
  }
  // Prepend a UTF-8 BOM so Excel opens the file with correct encoding.
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
  const ws = wb.addWorksheet('Invoice visits');

  const currencyFmt = model.currency === 'GBP' ? '£#,##0.00' : '#,##0.00';

  const title = ws.addRow([`Invoice — ${model.periodLabel}`]);
  title.font = { bold: true, size: 14 };
  ws.addRow([
    `Period: ${model.periodStartLabel} to ${model.periodEndLabel}`,
  ]);
  ws.addRow([`Status: ${model.status}`]);
  ws.addRow([`Times in ${model.timeZone}`]);
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
      l.visitRef ?? '',
      l.date,
      l.slot,
      l.serviceUserName,
      l.carerName,
      l.plannedStart,
      l.plannedEnd,
      l.actualStart,
      l.actualEnd,
      l.plannedDuration,
      l.actualDuration,
      l.durationVariance,
      l.address,
      l.funderName,
      l.amountValue,
      l.paidValue,
      l.outstandingValue,
    ]);
    row.getCell(15).numFmt = currencyFmt;
    row.getCell(16).numFmt = currencyFmt;
    row.getCell(17).numFmt = currencyFmt;
  }

  const widths = [
    22, 12, 14, 22, 18, 12, 12, 12, 12, 14, 14, 16, 36, 22, 12, 12, 12,
  ];
  ws.columns.forEach((col, i) => {
    col.width = widths[i] ?? 14;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
