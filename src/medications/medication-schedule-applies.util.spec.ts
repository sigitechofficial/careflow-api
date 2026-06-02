import { MedicationSchedulePattern } from '@prisma/client';
import { scheduleAppliesOnDay } from './medication-schedule-applies.util';

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe('scheduleAppliesOnDay', () => {
  const start = day('2026-05-12');

  it('applies daily on every day when interval is 1', () => {
    expect(
      scheduleAppliesOnDay({
        dayDate: day('2026-05-15'),
        medicationStartDate: start,
        schedulePattern: MedicationSchedulePattern.DAILY,
        frequencyIntervalDays: 1,
        daysOfWeek: [],
        monthlyDayOfMonth: null,
        monthlyAnchorToStartDate: true,
      }),
    ).toBe(true);
  });

  it('applies every N days from start', () => {
    expect(
      scheduleAppliesOnDay({
        dayDate: day('2026-05-14'),
        medicationStartDate: start,
        schedulePattern: MedicationSchedulePattern.DAILY,
        frequencyIntervalDays: 2,
        daysOfWeek: [],
        monthlyDayOfMonth: null,
        monthlyAnchorToStartDate: true,
      }),
    ).toBe(true);
    expect(
      scheduleAppliesOnDay({
        dayDate: day('2026-05-13'),
        medicationStartDate: start,
        schedulePattern: MedicationSchedulePattern.DAILY,
        frequencyIntervalDays: 2,
        daysOfWeek: [],
        monthlyDayOfMonth: null,
        monthlyAnchorToStartDate: true,
      }),
    ).toBe(false);
  });

  it('applies weekly only on selected weekdays', () => {
    expect(
      scheduleAppliesOnDay({
        dayDate: day('2026-05-11'),
        medicationStartDate: start,
        schedulePattern: MedicationSchedulePattern.WEEKLY,
        frequencyIntervalDays: 1,
        daysOfWeek: ['MONDAY', 'WEDNESDAY'],
        monthlyDayOfMonth: null,
        monthlyAnchorToStartDate: true,
      }),
    ).toBe(true);
    expect(
      scheduleAppliesOnDay({
        dayDate: day('2026-05-12'),
        medicationStartDate: start,
        schedulePattern: MedicationSchedulePattern.WEEKLY,
        frequencyIntervalDays: 1,
        daysOfWeek: ['MONDAY', 'WEDNESDAY'],
        monthlyDayOfMonth: null,
        monthlyAnchorToStartDate: true,
      }),
    ).toBe(false);
  });

  it('applies monthly on start-date anchor day', () => {
    expect(
      scheduleAppliesOnDay({
        dayDate: day('2026-05-12'),
        medicationStartDate: start,
        schedulePattern: MedicationSchedulePattern.MONTHLY,
        frequencyIntervalDays: 1,
        daysOfWeek: [],
        monthlyDayOfMonth: null,
        monthlyAnchorToStartDate: true,
      }),
    ).toBe(true);
    expect(
      scheduleAppliesOnDay({
        dayDate: day('2026-05-13'),
        medicationStartDate: start,
        schedulePattern: MedicationSchedulePattern.MONTHLY,
        frequencyIntervalDays: 1,
        daysOfWeek: [],
        monthlyDayOfMonth: null,
        monthlyAnchorToStartDate: true,
      }),
    ).toBe(false);
  });

  it('clamps monthly day to last day of short months', () => {
    expect(
      scheduleAppliesOnDay({
        dayDate: day('2026-02-28'),
        medicationStartDate: day('2026-01-31'),
        schedulePattern: MedicationSchedulePattern.MONTHLY,
        frequencyIntervalDays: 1,
        daysOfWeek: [],
        monthlyDayOfMonth: 31,
        monthlyAnchorToStartDate: false,
      }),
    ).toBe(true);
  });
});
