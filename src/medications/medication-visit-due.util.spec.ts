import { MedicationSchedulePattern } from '@prisma/client';
import {
  filterSchedulesDueOnVisit,
  medicationActiveOnDayKey,
  medicationScheduleDueOnVisit,
  resolveDoseDayKey,
} from './medication-visit-due.util';

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

// 2026-10-12 is a Monday.
const MONDAY = '2026-10-12';
const morning = { startHm: '07:30', endHm: '09:30' };
const overnight = { startHm: '22:00', endHm: '06:00' };

const daily = {
  startDate: day('2026-10-01'),
  endDate: null,
  schedulePattern: MedicationSchedulePattern.DAILY,
  frequencyIntervalDays: 1,
  monthlyDayOfMonth: null,
  monthlyAnchorToStartDate: true,
};

describe('medicationScheduleDueOnVisit', () => {
  it('is due for a daily medicine whose time is inside the visit window', () => {
    expect(
      medicationScheduleDueOnVisit({
        medication: daily,
        schedule: { dueTime: '08:00', daysOfWeek: [] },
        visitDayKey: MONDAY,
        window: morning,
      }),
    ).toBe(true);
  });

  it('is not due when the time is outside the visit window', () => {
    expect(
      medicationScheduleDueOnVisit({
        medication: daily,
        schedule: { dueTime: '18:10', daysOfWeek: [] },
        visitDayKey: MONDAY,
        window: morning,
      }),
    ).toBe(false);
  });

  it('hides a weekly medicine on a day that is not selected', () => {
    const weekly = { ...daily, schedulePattern: MedicationSchedulePattern.WEEKLY };
    const schedule = { dueTime: '08:00', daysOfWeek: ['TUESDAY'] };
    expect(
      medicationScheduleDueOnVisit({ medication: weekly, schedule, visitDayKey: MONDAY, window: morning }),
    ).toBe(false);
    expect(
      medicationScheduleDueOnVisit({
        medication: weekly,
        schedule,
        visitDayKey: '2026-10-13',
        window: morning,
      }),
    ).toBe(true);
  });

  it('hides a medicine before its start date and shows it on the start date', () => {
    const med = { ...daily, startDate: day('2026-10-20') };
    const schedule = { dueTime: '08:00', daysOfWeek: [] };
    expect(
      medicationScheduleDueOnVisit({ medication: med, schedule, visitDayKey: MONDAY, window: morning }),
    ).toBe(false);
    expect(
      medicationScheduleDueOnVisit({
        medication: med,
        schedule,
        visitDayKey: '2026-10-20',
        window: morning,
      }),
    ).toBe(true);
  });

  it('ignores a time part on the start date', () => {
    const med = { ...daily, startDate: new Date('2026-10-12T17:16:36.291Z') };
    expect(
      medicationScheduleDueOnVisit({
        medication: med,
        schedule: { dueTime: '08:00', daysOfWeek: [] },
        visitDayKey: MONDAY,
        window: morning,
      }),
    ).toBe(true);
  });

  it('shows a medicine on its end date and hides it the day after', () => {
    const med = { ...daily, endDate: day('2026-10-12') };
    const schedule = { dueTime: '08:00', daysOfWeek: [] };
    expect(
      medicationScheduleDueOnVisit({ medication: med, schedule, visitDayKey: MONDAY, window: morning }),
    ).toBe(true);
    expect(
      medicationScheduleDueOnVisit({
        medication: med,
        schedule,
        visitDayKey: '2026-10-13',
        window: morning,
      }),
    ).toBe(false);
  });

  it('follows an every-N-days interval from the start date', () => {
    const med = { ...daily, startDate: day('2026-10-10'), frequencyIntervalDays: 2 };
    const schedule = { dueTime: '08:00', daysOfWeek: [] };
    expect(
      medicationScheduleDueOnVisit({ medication: med, schedule, visitDayKey: MONDAY, window: morning }),
    ).toBe(true);
    expect(
      medicationScheduleDueOnVisit({
        medication: med,
        schedule,
        visitDayKey: '2026-10-13',
        window: morning,
      }),
    ).toBe(false);
  });

  it('follows a monthly fixed day', () => {
    const med = {
      ...daily,
      schedulePattern: MedicationSchedulePattern.MONTHLY,
      monthlyAnchorToStartDate: false,
      monthlyDayOfMonth: 12,
    };
    const schedule = { dueTime: '08:00', daysOfWeek: [] };
    expect(
      medicationScheduleDueOnVisit({ medication: med, schedule, visitDayKey: MONDAY, window: morning }),
    ).toBe(true);
    expect(
      medicationScheduleDueOnVisit({
        medication: med,
        schedule,
        visitDayKey: '2026-10-13',
        window: morning,
      }),
    ).toBe(false);
  });

  it('keeps a legacy medicine with no pattern due every day', () => {
    expect(
      medicationScheduleDueOnVisit({
        medication: { ...daily, schedulePattern: null },
        schedule: { dueTime: '08:00', daysOfWeek: [] },
        visitDayKey: MONDAY,
        window: morning,
      }),
    ).toBe(true);
  });

  it('keeps a weekly medicine with no weekday saved visible every day', () => {
    expect(
      medicationScheduleDueOnVisit({
        medication: { ...daily, schedulePattern: MedicationSchedulePattern.WEEKLY },
        schedule: { dueTime: '08:00', daysOfWeek: [] },
        visitDayKey: MONDAY,
        window: morning,
      }),
    ).toBe(true);
  });

  it('uses the next day for a dose after midnight on an overnight visit', () => {
    const weekly = { ...daily, schedulePattern: MedicationSchedulePattern.WEEKLY };
    // Monday 22:00 – Tuesday 06:00: the 02:00 dose is a Tuesday dose.
    expect(
      medicationScheduleDueOnVisit({
        medication: weekly,
        schedule: { dueTime: '02:00', daysOfWeek: ['TUESDAY'] },
        visitDayKey: MONDAY,
        window: overnight,
      }),
    ).toBe(true);
    expect(
      medicationScheduleDueOnVisit({
        medication: weekly,
        schedule: { dueTime: '02:00', daysOfWeek: ['MONDAY'] },
        visitDayKey: MONDAY,
        window: overnight,
      }),
    ).toBe(false);
    expect(
      medicationScheduleDueOnVisit({
        medication: weekly,
        schedule: { dueTime: '23:00', daysOfWeek: ['MONDAY'] },
        visitDayKey: MONDAY,
        window: overnight,
      }),
    ).toBe(true);
  });
});

describe('resolveDoseDayKey', () => {
  it('keeps the visit day for a same-day window', () => {
    expect(resolveDoseDayKey(MONDAY, '08:00', morning)).toBe(MONDAY);
  });

  it('moves to the next day after midnight on an overnight window', () => {
    expect(resolveDoseDayKey(MONDAY, '02:00', overnight)).toBe('2026-10-13');
    expect(resolveDoseDayKey(MONDAY, '23:00', overnight)).toBe(MONDAY);
  });
});

describe('medicationActiveOnDayKey', () => {
  it('treats missing dates as open-ended', () => {
    expect(medicationActiveOnDayKey({ startDate: null, endDate: null }, MONDAY)).toBe(true);
  });
});

describe('filterSchedulesDueOnVisit', () => {
  it('returns only the times due in this visit', () => {
    const med = {
      ...daily,
      schedules: [
        { dueTime: '08:00', daysOfWeek: [] },
        { dueTime: '18:10', daysOfWeek: [] },
      ],
    };
    expect(filterSchedulesDueOnVisit(med, MONDAY, morning)).toEqual([
      { dueTime: '08:00', daysOfWeek: [] },
    ]);
  });

  it('uses weekdays from another time slot when one slot has none', () => {
    const med = {
      ...daily,
      schedulePattern: MedicationSchedulePattern.WEEKLY,
      schedules: [
        { dueTime: '08:00', daysOfWeek: [] },
        { dueTime: '18:10', daysOfWeek: ['TUESDAY'] },
      ],
    };
    expect(filterSchedulesDueOnVisit(med, MONDAY, morning)).toEqual([]);
  });
});
