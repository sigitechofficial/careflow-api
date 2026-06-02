import { BadRequestException } from '@nestjs/common';

export type ChartDaySpec = {
  /** 1-based column index in the MAR grid */
  columnDay: number;
  /** YYYY-MM-DD */
  date: string;
  dateObj: Date;
};

export type ResolvedChartRange = {
  /** Primary month key (YYYY-MM) for labels and backward compatibility */
  month: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  daySpecs: ChartDaySpec[];
  lastDay: number;
};

const MAX_RANGE_DAYS = 93;
const MAX_EXPORT_MONTHS = 6;

function parseUtcDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new BadRequestException(`Invalid date: ${iso}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new BadRequestException(`Invalid date: ${iso}`);
  }
  return dt;
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthBounds(month: string): { start: Date; end: Date; lastDay: number } {
  const [yStr, mStr] = month.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m || m < 1 || m > 12) {
    throw new BadRequestException('month must be YYYY-MM');
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m - 1, lastDay)),
    lastDay,
  };
}

function formatUkPeriodLabel(start: string, end: string): string {
  const s = parseUtcDate(start);
  const e = parseUtcDate(end);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const a = s.toLocaleDateString('en-GB', opts);
  const b = e.toLocaleDateString('en-GB', opts);
  return a === b ? a : `${a} – ${b}`;
}

function buildDaySpecs(start: Date, end: Date): ChartDaySpec[] {
  const specs: ChartDaySpec[] = [];
  let cursor = new Date(start.getTime());
  let columnDay = 0;
  while (cursor <= end) {
    columnDay += 1;
    specs.push({
      columnDay,
      date: utcDayKey(cursor),
      dateObj: new Date(cursor.getTime()),
    });
    cursor = new Date(Date.UTC(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth(),
      cursor.getUTCDate() + 1,
    ));
  }
  return specs;
}

export function parseMedicationIdList(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const ids = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return undefined;
  return ids;
}

export function parseMonthList(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const months = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (months.length === 0) return undefined;
  for (const mo of months) {
    if (!/^\d{4}-\d{2}$/.test(mo)) {
      throw new BadRequestException(`Invalid month in list: ${mo}`);
    }
  }
  if (months.length > MAX_EXPORT_MONTHS) {
    throw new BadRequestException(`At most ${MAX_EXPORT_MONTHS} months per export`);
  }
  return months;
}

export function resolveChartRange(input: {
  month?: string;
  dateFrom?: string;
  dateTo?: string;
}): ResolvedChartRange {
  const { month, dateFrom, dateTo } = input;

  if (dateFrom || dateTo) {
    if (!dateFrom || !dateTo) {
      throw new BadRequestException('dateFrom and dateTo must both be provided');
    }
    const start = parseUtcDate(dateFrom);
    const end = parseUtcDate(dateTo);
    if (end < start) {
      throw new BadRequestException('dateTo must be on or after dateFrom');
    }
    const daySpecs = buildDaySpecs(start, end);
    if (daySpecs.length > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
    }
    const periodStart = utcDayKey(start);
    const periodEnd = utcDayKey(end);
    const monthKey = periodStart.slice(0, 7);
    return {
      month: month ?? monthKey,
      periodStart,
      periodEnd,
      periodLabel: formatUkPeriodLabel(periodStart, periodEnd),
      daySpecs,
      lastDay: daySpecs.length,
    };
  }

  if (!month) {
    throw new BadRequestException('Provide month (YYYY-MM) or dateFrom and dateTo');
  }

  const bounds = monthBounds(month);
  let start = bounds.start;
  let end = bounds.end;

  if (dateFrom) {
    const df = parseUtcDate(dateFrom);
    if (df > start) start = df;
  }
  if (dateTo) {
    const dt = parseUtcDate(dateTo);
    if (dt < end) end = dt;
  }
  if (end < start) {
    throw new BadRequestException('No days in range for the selected month and dates');
  }

  const daySpecs = buildDaySpecs(start, end);
  const periodStart = utcDayKey(start);
  const periodEnd = utcDayKey(end);

  return {
    month,
    periodStart,
    periodEnd,
    periodLabel:
      periodStart === `${month}-01` && periodEnd.endsWith(String(bounds.lastDay).padStart(2, '0'))
        ? new Date(bounds.start.getTime()).toLocaleDateString('en-GB', {
            month: 'long',
            year: 'numeric',
          })
        : formatUkPeriodLabel(periodStart, periodEnd),
    daySpecs,
    lastDay: daySpecs.length,
  };
}

export function resolveExportMonths(input: {
  month?: string;
  months?: string;
}): string[] {
  const list = parseMonthList(input.months);
  if (list?.length) return list;
  if (input.month) return [input.month];
  throw new BadRequestException('Provide month or months for export');
}
