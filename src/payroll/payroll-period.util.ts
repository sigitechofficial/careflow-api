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

function clampDayOfMonth(year: number, monthIndex: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const safeDay = Math.min(Math.max(1, day), lastDay);
  return new Date(Date.UTC(year, monthIndex, safeDay));
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
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
  anchorDay: number;
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
    // UK monthly tax months: 6th → 5th of following month (12 periods per tax year).
    let periodStart = start;
    let sequence = 1;
    while (periodStart.getTime() <= end.getTime()) {
      const nextStart = new Date(
        Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 6),
      );
      // If we started mid-month after the 6th, next boundary is still next calendar month's 6th.
      const candidateEnd = addUtcDays(nextStart, -1);
      const periodEnd = candidateEnd.getTime() > end.getTime() ? end : candidateEnd;
      if (periodStart.getTime() > periodEnd.getTime()) break;

      const paymentDate = clampDayOfMonth(
        periodEnd.getUTCFullYear(),
        periodEnd.getUTCMonth(),
        params.anchorDay,
      );
      periods.push({
        sequence,
        label: `${MONTH_LABELS[periodStart.getUTCMonth()]} ${periodStart.getUTCFullYear()}`,
        periodStart: toDateOnly(periodStart),
        periodEnd: toDateOnly(periodEnd),
        paymentDate: toDateOnly(minDate(paymentDate, periodEnd)),
      });
      sequence += 1;
      periodStart = addUtcDays(periodEnd, 1);
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
    const paymentOffset = Math.min(Math.max(params.anchorDay, 1), stepDays) - 1;
    const paymentDate = minDate(addUtcDays(periodStart, paymentOffset), periodEnd);
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
