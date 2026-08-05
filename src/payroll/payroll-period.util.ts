export type PayrollPayFrequencyCode = 'WEEKLY' | 'FORTNIGHTLY' | 'FOUR_WEEKLY' | 'MONTHLY';

export type GeneratedPayrollPeriod = {
  sequence: number;
  label: string;
  periodStart: string;
  periodEnd: string;
  paymentDate: string;
};

function parseDateOnly(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addUtcDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Generate pay periods for a schedule within a UK tax year window.
 * Dates are calendar DATE values as YYYY-MM-DD (UTC midnight representation).
 * Does not apply statutory pay rules — calendar scaffolding only.
 */
export function generatePayrollPeriods(params: {
  frequency: PayrollPayFrequencyCode;
  /** @deprecated Payment dates use period end; kept for caller compatibility. */
  anchorDay?: number;
  taxYearStart: string;
  taxYearEnd: string;
}): GeneratedPayrollPeriod[] {
  const start = parseDateOnly(params.taxYearStart);
  const end = parseDateOnly(params.taxYearEnd);
  if (start.getTime() > end.getTime()) {
    throw new Error('Tax year start must be on or before tax year end');
  }

  const periods: GeneratedPayrollPeriod[] = [];

  if (params.frequency === 'MONTHLY') {
    // Full calendar months: 1st → last day. Twelve months from the calendar month
    // of taxYearStart (e.g. Apr–Mar for a standard UK tax year). Payment date is
    // the last day of each month.
    let year = start.getUTCFullYear();
    let monthIndex = start.getUTCMonth();
    for (let sequence = 1; sequence <= 12; sequence += 1) {
      const periodStart = new Date(Date.UTC(year, monthIndex, 1));
      const periodEnd = new Date(Date.UTC(year, monthIndex + 1, 0));
      periods.push({
        sequence,
        label: `${MONTH_LABELS[monthIndex]} ${year}`,
        periodStart: toDateOnly(periodStart),
        periodEnd: toDateOnly(periodEnd),
        paymentDate: toDateOnly(periodEnd),
      });
      monthIndex += 1;
      if (monthIndex > 11) {
        monthIndex = 0;
        year += 1;
      }
    }
    return periods;
  }

  const stepDays =
    params.frequency === 'WEEKLY' ? 7 : params.frequency === 'FORTNIGHTLY' ? 14 : 28;

  let periodStart = start;
  let sequence = 1;
  while (periodStart.getTime() <= end.getTime()) {
    const rawEnd = addUtcDays(periodStart, stepDays - 1);
    const periodEnd = rawEnd.getTime() > end.getTime() ? end : rawEnd;
    // Payment on the last day of each weekly-style cycle.
    const paymentDate = periodEnd;
    periods.push({
      sequence,
      label: `P${sequence} ${toDateOnly(periodStart)} – ${toDateOnly(periodEnd)}`,
      periodStart: toDateOnly(periodStart),
      periodEnd: toDateOnly(periodEnd),
      paymentDate: toDateOnly(paymentDate),
    });
    sequence += 1;
    periodStart = addUtcDays(periodEnd, 1);
  }

  return periods;
}

/** UK tax year for a calendar date: 6 April YYYY → 5 April YYYY+1. */
export function ukTaxYearBoundsForDate(isoDate: string): {
  code: string;
  startDate: string;
  endDate: string;
  label: string;
} {
  const d = parseDateOnly(isoDate);
  const y = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const startsThisCalendarYear = month > 3 || (month === 3 && day >= 6);
  const startYear = startsThisCalendarYear ? y : y - 1;
  return ukTaxYearFromStartYear(startYear);
}

/** Build UK tax year bounds from the April start calendar year (e.g. 2026 → 2026-27). */
export function ukTaxYearFromStartYear(startYear: number): {
  code: string;
  startDate: string;
  endDate: string;
  label: string;
} {
  const endYear = startYear + 1;
  const code = `${startYear}-${String(endYear).slice(-2)}`;
  return {
    code,
    label: `Tax year ${code}`,
    startDate: `${startYear}-04-06`,
    endDate: `${endYear}-04-05`,
  };
}

/**
 * Standard UK tax years around a reference date.
 * Default: 2 previous + current + 1 next (4 years).
 */
export function listUkTaxYearsAroundDate(
  isoDate: string,
  options?: { yearsBefore?: number; yearsAfter?: number },
): Array<ReturnType<typeof ukTaxYearFromStartYear> & { isCurrent: boolean }> {
  const current = ukTaxYearBoundsForDate(isoDate);
  const currentStartYear = Number(current.startDate.slice(0, 4));
  const before = options?.yearsBefore ?? 2;
  const after = options?.yearsAfter ?? 1;
  const out: Array<ReturnType<typeof ukTaxYearFromStartYear> & { isCurrent: boolean }> = [];
  for (let y = currentStartYear - before; y <= currentStartYear + after; y += 1) {
    const def = ukTaxYearFromStartYear(y);
    out.push({ ...def, isCurrent: def.code === current.code });
  }
  return out;
}

export function parsePayrollDateOnly(value: string): Date {
  return parseDateOnly(value);
}

export function toPayrollDateOnly(d: Date): string {
  return toDateOnly(d);
}
