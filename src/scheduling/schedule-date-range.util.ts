import { BadRequestException } from '@nestjs/common';
import {
  dayKeyInTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import { parseScheduleDate, formatScheduleDate } from '../schedules/schedules-date.util';

export function utcDayBounds(dateStr: string): { start: Date; end: Date; date: string } {
  const start = parseScheduleDate(dateStr);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 23, 59, 59, 999));
  return { start, end, date: formatScheduleDate(start) };
}

/** Monday-based week; `weekStart` must be YYYY-MM-DD (any day in week — normalized to Monday UTC). */
export function utcWeekBounds(weekStartStr: string): {
  weekStart: Date;
  weekEnd: Date;
  weekStartLabel: string;
  weekEndLabel: string;
} {
  const anchor = parseScheduleDate(weekStartStr);
  const dow = anchor.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(anchor);
  weekStart.setUTCDate(weekStart.getUTCDate() + mondayOffset);
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);
  return {
    weekStart,
    weekEnd,
    weekStartLabel: formatScheduleDate(weekStart),
    weekEndLabel: formatScheduleDate(weekEnd),
  };
}

/** `yearMonth` = YYYY-MM */
export function utcMonthBounds(yearMonth: string): {
  monthStart: Date;
  monthEnd: Date;
  label: string;
} {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!m) throw new BadRequestException('month must be YYYY-MM');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new BadRequestException('Invalid month');
  const monthStart = new Date(Date.UTC(y, mo - 1, 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(y, mo, 0, 23, 59, 59, 999));
  return { monthStart, monthEnd, label: yearMonth };
}

/**
 * Inclusive UTC instants covering a civil YYYY-MM-DD in the organisation timezone.
 * Use for filtering scheduledStartDateTime onto the schedule-jobs board day.
 */
export function operationalScheduleDayBounds(
  dateStr: string,
  timeZone: string,
): { start: Date; end: Date; date: string } {
  const civil = utcDayBounds(dateStr);
  return operationalDayBounds(civil.date, timeZone);
}

/** Monday–Sunday civil week, with instants spanning those days in the organisation timezone. */
export function operationalScheduleWeekBounds(
  weekStartStr: string,
  timeZone: string,
): {
  weekStart: Date;
  weekEnd: Date;
  weekStartLabel: string;
  weekEndLabel: string;
} {
  const civil = utcWeekBounds(weekStartStr);
  return {
    weekStart: operationalDayBounds(civil.weekStartLabel, timeZone).start,
    weekEnd: operationalDayBounds(civil.weekEndLabel, timeZone).end,
    weekStartLabel: civil.weekStartLabel,
    weekEndLabel: civil.weekEndLabel,
  };
}

/** Calendar month in organisation timezone (civil YYYY-MM labels unchanged). */
export function operationalScheduleMonthBounds(
  yearMonth: string,
  timeZone: string,
): { monthStart: Date; monthEnd: Date; label: string } {
  const civil = utcMonthBounds(yearMonth);
  const startLabel = formatScheduleDate(civil.monthStart);
  const endLabel = formatScheduleDate(civil.monthEnd);
  return {
    monthStart: operationalDayBounds(startLabel, timeZone).start,
    monthEnd: operationalDayBounds(endLabel, timeZone).end,
    label: civil.label,
  };
}

/** Weekday index (0=Sun … 6=Sat) of an instant on the organisation calendar. */
export function weekdayIndexInTimeZone(instant: Date, timeZone: string): number {
  const key = dayKeyInTimeZone(instant, timeZone);
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

export function assertDateRangeMaxDays(from: Date, to: Date, maxDays: number): void {
  const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > maxDays) {
    throw new BadRequestException(`Date range must not exceed ${maxDays} days`);
  }
}

export function jobDurationMinutes(job: {
  scheduledStartDateTime: Date;
  scheduledEndDateTime: Date | null;
  estimatedDurationMinutes: number | null;
}): number {
  if (job.estimatedDurationMinutes) return job.estimatedDurationMinutes;
  const end =
    job.scheduledEndDateTime ??
    new Date(job.scheduledStartDateTime.getTime() + 60 * 60_000);
  return Math.max(1, Math.round((end.getTime() - job.scheduledStartDateTime.getTime()) / 60_000));
}
