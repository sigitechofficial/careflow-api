import { DayOfWeek } from '@prisma/client';

export type WorkingPatternRow = {
  weekInCycle: number;
  dayOfWeek: DayOfWeek;
  startTime: string | null;
  endTime: string | null;
  isAvailable: boolean;
  notes: string | null;
};

export type WorkingPatternCycleConfig = {
  workingPatternCycleWeeks: number;
  workingPatternCycleAnchorDate: Date | null;
  startDate: Date | null;
  employeeCreatedAt: Date;
};

export type ResolvedDayPattern = {
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
  isPartial: boolean;
};

const JS_DOW_TO_PRISMA: Record<number, DayOfWeek> = {
  0: DayOfWeek.SUNDAY,
  1: DayOfWeek.MONDAY,
  2: DayOfWeek.TUESDAY,
  3: DayOfWeek.WEDNESDAY,
  4: DayOfWeek.THURSDAY,
  5: DayOfWeek.FRIDAY,
  6: DayOfWeek.SATURDAY,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** UTC Monday 00:00:00 for the week containing `d`. */
export function utcMonday(d: Date): Date {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy;
}

export function parseIsoDateOnly(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0));
}

export function resolveCycleAnchorDate(config: WorkingPatternCycleConfig): Date {
  if (config.workingPatternCycleAnchorDate) {
    return utcMonday(config.workingPatternCycleAnchorDate);
  }
  if (config.startDate) {
    return utcMonday(config.startDate);
  }
  return utcMonday(config.employeeCreatedAt);
}

/** 1-based week index within the cycle (1 or 2 when cycleWeeks is 2). */
export function resolveCycleWeekIndex(
  date: Date,
  anchorDate: Date,
  cycleWeeks: number,
): number {
  if (cycleWeeks <= 1) return 1;
  const dateMonday = utcMonday(date);
  const anchorMonday = utcMonday(anchorDate);
  const weeksDiff = Math.floor((dateMonday.getTime() - anchorMonday.getTime()) / (7 * MS_PER_DAY));
  const idx = ((weeksDiff % cycleWeeks) + cycleWeeks) % cycleWeeks;
  return idx + 1;
}

export function resolvePatternForDate(
  rows: WorkingPatternRow[],
  config: WorkingPatternCycleConfig,
  dateIso: string,
): WorkingPatternRow | null {
  const date = parseIsoDateOnly(dateIso);
  if (!date) return null;

  const cycleWeeks = Math.max(1, config.workingPatternCycleWeeks ?? 1);
  const weekInCycle =
    cycleWeeks <= 1 ? 1 : resolveCycleWeekIndex(date, resolveCycleAnchorDate(config), cycleWeeks);

  const dow = JS_DOW_TO_PRISMA[date.getUTCDay()];
  return rows.find((r) => r.weekInCycle === weekInCycle && r.dayOfWeek === dow) ?? null;
}

export function resolvePatternForDateTime(
  rows: WorkingPatternRow[],
  config: WorkingPatternCycleConfig,
  dateTime: Date,
): WorkingPatternRow | null {
  const iso = `${dateTime.getUTCFullYear()}-${String(dateTime.getUTCMonth() + 1).padStart(2, '0')}-${String(dateTime.getUTCDate()).padStart(2, '0')}`;
  return resolvePatternForDate(rows, config, iso);
}

export function mapPatternToDayPattern(row: WorkingPatternRow | null): ResolvedDayPattern | null {
  if (!row) return null;
  return {
    isAvailable: row.isAvailable,
    startTime: row.startTime,
    endTime: row.endTime,
    isPartial: row.notes === 'partial',
  };
}

export function employmentToCycleConfig(
  employment: {
    workingPatternCycleWeeks?: number | null;
    workingPatternCycleAnchorDate?: Date | null;
    startDate?: Date | null;
  } | null | undefined,
  employeeCreatedAt: Date,
): WorkingPatternCycleConfig {
  return {
    workingPatternCycleWeeks: employment?.workingPatternCycleWeeks ?? 1,
    workingPatternCycleAnchorDate: employment?.workingPatternCycleAnchorDate ?? null,
    startDate: employment?.startDate ?? null,
    employeeCreatedAt,
  };
}
