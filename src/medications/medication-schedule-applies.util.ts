import { MedicationSchedulePattern } from '@prisma/client';

export const MEDICATION_DOW = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

export type MedicationDow = (typeof MEDICATION_DOW)[number];

export type ScheduleAppliesInput = {
  dayDate: Date;
  medicationStartDate: Date | null;
  schedulePattern: MedicationSchedulePattern | null;
  frequencyIntervalDays: number;
  daysOfWeek: string[];
  monthlyDayOfMonth: number | null;
  monthlyAnchorToStartDate: boolean;
};

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function effectiveMonthlyDay(
  year: number,
  monthIndex: number,
  targetDay: number,
): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.min(Math.max(1, targetDay), lastDay);
}

export function inferSchedulePatternFromLegacy(
  daysOfWeek: string[],
  frequencyIntervalDays: number,
): MedicationSchedulePattern {
  if (frequencyIntervalDays > 1) return MedicationSchedulePattern.DAILY;
  if (daysOfWeek.length > 0 && daysOfWeek.length < 7) {
    return MedicationSchedulePattern.WEEKLY;
  }
  return MedicationSchedulePattern.DAILY;
}

export function resolveSchedulePattern(
  schedulePattern: MedicationSchedulePattern | null,
  daysOfWeek: string[],
  frequencyIntervalDays: number,
): MedicationSchedulePattern {
  return (
    schedulePattern ??
    inferSchedulePatternFromLegacy(daysOfWeek, frequencyIntervalDays)
  );
}

export function scheduleAppliesOnDay(input: ScheduleAppliesInput): boolean {
  const pattern = resolveSchedulePattern(
    input.schedulePattern,
    input.daysOfWeek,
    input.frequencyIntervalDays,
  );

  if (pattern === MedicationSchedulePattern.MONTHLY) {
    const start = input.medicationStartDate
      ? utcMidnight(input.medicationStartDate)
      : null;
    const targetDay = input.monthlyAnchorToStartDate
      ? start?.getUTCDate()
      : input.monthlyDayOfMonth;
    if (targetDay == null || targetDay < 1) return false;
    const y = input.dayDate.getUTCFullYear();
    const m = input.dayDate.getUTCMonth();
    const effective = effectiveMonthlyDay(y, m, targetDay);
    return input.dayDate.getUTCDate() === effective;
  }

  if (pattern === MedicationSchedulePattern.WEEKLY) {
    if (!input.daysOfWeek.length) return false;
    const dow = MEDICATION_DOW[input.dayDate.getUTCDay()];
    return input.daysOfWeek.includes(dow);
  }

  const interval = Math.max(1, input.frequencyIntervalDays ?? 1);
  if (interval > 1) {
    if (!input.medicationStartDate) return true;
    const start = utcMidnight(input.medicationStartDate);
    const day = utcMidnight(input.dayDate);
    const daysFromStart = Math.floor((day.getTime() - start.getTime()) / 86_400_000);
    if (daysFromStart < 0) return false;
    return daysFromStart % interval === 0;
  }

  if (input.daysOfWeek.length > 0 && input.daysOfWeek.length < 7) {
    const dow = MEDICATION_DOW[input.dayDate.getUTCDay()];
    return input.daysOfWeek.includes(dow);
  }

  return true;
}

export function buildScheduleFrequencyText(input: {
  schedulePattern: MedicationSchedulePattern;
  frequencyIntervalDays: number;
  daysOfWeek: string[];
  monthlyDayOfMonth: number | null;
  monthlyAnchorToStartDate: boolean;
  medicationStartDate: Date | null;
  timesPerDay: number;
}): string {
  const times =
    input.timesPerDay === 1
      ? 'Once daily'
      : input.timesPerDay === 2
        ? 'Twice daily'
        : input.timesPerDay === 3
          ? 'Three times daily'
          : input.timesPerDay === 4
            ? 'Four times daily'
            : input.timesPerDay === 5
              ? 'Five times daily'
              : `${input.timesPerDay} times daily`;

  if (input.schedulePattern === MedicationSchedulePattern.WEEKLY) {
    const labels = input.daysOfWeek
      .map(d => d.charAt(0) + d.slice(1, 3).toLowerCase())
      .join(', ');
    return labels ? `${times} (${labels})` : `${times} (weekly)`;
  }

  if (input.schedulePattern === MedicationSchedulePattern.MONTHLY) {
    const day = input.monthlyAnchorToStartDate
      ? input.medicationStartDate?.getUTCDate()
      : input.monthlyDayOfMonth;
    return day != null ? `${times} (day ${day} of month)` : `${times} (monthly)`;
  }

  const interval = Math.max(1, input.frequencyIntervalDays);
  if (interval > 1) return `${times} (every ${interval} days)`;
  return times;
}
