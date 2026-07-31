import { BadRequestException } from '@nestjs/common';
import { parseBillingDateOnly } from './billing-run.util';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoWeekPeriodKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}

function mondayOfIsoWeek(period: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(period);
  if (!match) return new Date(NaN);
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}

export function periodRangeFromKey(periodKey: string): {
  dateFrom: string;
  dateTo: string;
  periodStart: Date;
  periodEnd: Date;
} {
  if (/^\d{4}-\d{2}$/.test(periodKey)) {
    const [yRaw, mRaw] = periodKey.split('-');
    const y = Number(yRaw);
    const m = Number(mRaw);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
      throw new BadRequestException(`Invalid periodKey: ${periodKey}`);
    }
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 0));
    return {
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
      periodStart: parseBillingDateOnly(from.toISOString().slice(0, 10)),
      periodEnd: parseBillingDateOnly(to.toISOString().slice(0, 10)),
    };
  }

  if (/^\d{4}-W\d{2}$/.test(periodKey)) {
    const monday = mondayOfIsoWeek(periodKey);
    if (Number.isNaN(monday.getTime())) {
      throw new BadRequestException(`Invalid periodKey: ${periodKey}`);
    }
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const dateFrom = monday.toISOString().slice(0, 10);
    const dateTo = sunday.toISOString().slice(0, 10);
    return {
      dateFrom,
      dateTo,
      periodStart: parseBillingDateOnly(dateFrom),
      periodEnd: parseBillingDateOnly(dateTo),
    };
  }

  throw new BadRequestException(
    `periodKey must be YYYY-MM or YYYY-Www (got ${periodKey})`,
  );
}

/** Derive salary period key from a closed month or ISO week date range. */
export function derivePeriodKeyFromRange(
  dateFrom?: string | null,
  dateTo?: string | null,
): string | null {
  if (!dateFrom || !dateTo) return null;
  const from = parseBillingDateOnly(dateFrom);
  const to = parseBillingDateOnly(dateTo);

  const monthKey = `${from.getUTCFullYear()}-${pad2(from.getUTCMonth() + 1)}`;
  const monthRange = periodRangeFromKey(monthKey);
  if (monthRange.dateFrom === dateFrom && monthRange.dateTo === dateTo) {
    return monthKey;
  }

  const weekKey = isoWeekPeriodKey(from);
  const weekRange = periodRangeFromKey(weekKey);
  if (weekRange.dateFrom === dateFrom && weekRange.dateTo === dateTo) {
    return weekKey;
  }

  return null;
}
