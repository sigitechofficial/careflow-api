import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  dayKeyInTimeZone,
  formatHmsInTimeZone,
} from '../common/utils/operational-day.util';

export type PayrollVisitExportRow = {
  emonitored: 'LOGGED' | 'NOT LOG';
  carerId: string;
  carerFirstName: string;
  carerSecondName: string;
  carerAddress: string;
  carerPostCode: string;
  visitDate: string;
  careType: string;
  plannedArrival: string;
  plannedDeparture: string;
  actualArrival: string;
  actualDeparture: string;
  visitHours: string;
  visitPay: string;
  totalHoursWorked: string;
  grossPay: string;
};

const CARE_TYPE_EXPORT_CODES: Record<string, string> = {
  DOMICILIARY: 'PC',
  NURSING: 'NC',
  SUPPORTED_LIVING: 'SL',
  RESPITE: 'RP',
  DAY_CARE: 'DC',
  TRANSPORT: 'TR',
};

function escapeCsvField(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(escapeCsvField).join(',');
}

export function formatVisitDateMmDdYy(
  date: Date,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  const day = dayKeyInTimeZone(date, timeZone); // YYYY-MM-DD
  const [y, m, d] = day.split('-');
  return `${m}-${d}-${(y ?? '').slice(-2)}`;
}

export function formatTimeHhMmSs(
  date: Date,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  return formatHmsInTimeZone(date, timeZone);
}

export function formatTimeHhMmSsOrZero(
  date: Date | null | undefined,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  if (!date) return '00:00:00';
  return formatTimeHhMmSs(date, timeZone);
}

export function resolveCarerId(input: {
  payrollNumber?: string | null;
  employeeNumber?: string | null;
}): string {
  if (input.payrollNumber?.trim()) return input.payrollNumber.trim();
  if (input.employeeNumber?.trim()) return input.employeeNumber.trim();
  return '';
}

export function resolveCareTypeExportCode(code?: string | null): string {
  if (!code) return '';
  return CARE_TYPE_EXPORT_CODES[code] ?? code;
}

export function resolveCarerAddress(input: {
  addressLine1?: string | null;
  addressLine2?: string | null;
}): string {
  return [input.addressLine1, input.addressLine2].filter(Boolean).join(' ').trim();
}

export function resolveEmonitored(
  actualStart: Date | null | undefined,
  actualEnd: Date | null | undefined,
): 'LOGGED' | 'NOT LOG' {
  return actualStart && actualEnd ? 'LOGGED' : 'NOT LOG';
}

export function minutesToDecimalHours(minutes: number): string {
  if (minutes <= 0) return '0.00';
  return (minutes / 60).toFixed(2);
}

export function formatPayAmount(amount: number): string {
  return amount.toFixed(2);
}

const VISIT_LOG_HEADERS = [
  'EMONITORED',
  'Carer ID',
  'Carer First Name',
  'Carer Second Name',
  'Carer Address',
  'Carer Post Code',
  'Visit Date',
  'Care Type',
  'Planned Arrival',
  'Planned Departure',
  'Actual Arrival',
  'Actual Departure',
  'Hours',
  'Pay (£)',
  'Total Hours Worked',
  'Gross Pay (£)',
] as const;

export function buildPayrollRunVisitLogCsv(rows: PayrollVisitExportRow[]): string {
  const lines = [
    csvRow([...VISIT_LOG_HEADERS]),
    ...rows.map((row) =>
      csvRow([
        row.emonitored,
        row.carerId,
        row.carerFirstName,
        row.carerSecondName,
        row.carerAddress,
        row.carerPostCode,
        row.visitDate,
        row.careType,
        row.plannedArrival,
        row.plannedDeparture,
        row.actualArrival,
        row.actualDeparture,
        row.visitHours,
        row.visitPay,
        row.totalHoursWorked,
        row.grossPay,
      ]),
    ),
  ];

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function payrollRunExportFilename(periodStart: string, periodEnd: string): string {
  return `payroll-run-${periodStart}-to-${periodEnd}.csv`;
}
