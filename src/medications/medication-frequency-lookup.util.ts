import { MedicationSchedulePattern } from '@prisma/client';

type FrequencyRow = { id: string; code: string };

export function resolveFrequencyIdForPattern(
  frequencies: FrequencyRow[],
  pattern: MedicationSchedulePattern,
  timesPerDay: number,
): string | undefined {
  const byCode = (code: string) => frequencies.find(f => f.code === code)?.id;
  if (pattern === MedicationSchedulePattern.WEEKLY) {
    return byCode('WEEKLY');
  }
  if (pattern === MedicationSchedulePattern.MONTHLY) {
    return byCode('MONTHLY');
  }
  if (timesPerDay >= 5) {
    return byCode('FIVE_TIMES_DAILY') ?? byCode('FOUR_TIMES_DAILY');
  }
  if (timesPerDay === 4) return byCode('FOUR_TIMES_DAILY');
  if (timesPerDay === 3) return byCode('THREE_TIMES_DAILY');
  if (timesPerDay === 2) return byCode('TWICE_DAILY');
  return byCode('ONCE_DAILY') ?? byCode('EVERY_1_DAY');
}
