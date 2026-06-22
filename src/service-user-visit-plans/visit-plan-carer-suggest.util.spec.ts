import { DayOfWeek } from '@prisma/client';
import {
  evaluateCarerAvailability,
  scheduledJobOverlapsVisitPlanSlot,
} from './visit-plan-carer-suggest.util';

const baseCycle = {
  workingPatternCycleWeeks: 2,
  workingPatternCycleAnchorDate: new Date(Date.UTC(2026, 0, 5)),
  startDate: null,
  employeeCreatedAt: new Date(Date.UTC(2025, 0, 1)),
};

const weekdayPattern = {
  weekInCycle: 1,
  dayOfWeek: DayOfWeek.MONDAY,
  startTime: '09:00',
  endTime: '18:00',
  isAvailable: true,
  notes: null,
};

describe('evaluateCarerAvailability visit containment', () => {
  it('flags partial-overlap visit that extends before working hours but keeps day assignable', () => {
    const result = evaluateCarerAvailability(
      [weekdayPattern],
      [1],
      '07:00',
      '10:00',
    );

    expect(result.timeWindowOk).toBe(false);
    expect(result.availableDays).toContain(1);
    expect(result.unavailableDays).not.toContain(1);
    expect(result.timeMismatchDays).toContain(1);
    expect(result.timeMismatchMessages).toEqual([
      'On Mon, your visit is 2 hours before your working pattern (09:00–18:00)',
    ]);
    expect(result.summary).toContain('2 hours before');
  });

  it('accepts visit fully inside working hours', () => {
    const result = evaluateCarerAvailability(
      [weekdayPattern],
      [1],
      '09:00',
      '10:00',
    );

    expect(result.timeWindowOk).toBe(true);
    expect(result.availableDays).toContain(1);
  });
});

describe('evaluateCarerAvailability fortnight', () => {
  it('requires both cycle weeks to pass for recurring weekdays', () => {
    const patterns = [
      {
        weekInCycle: 1,
        dayOfWeek: DayOfWeek.MONDAY,
        startTime: '09:00',
        endTime: '17:00',
        isAvailable: true,
        notes: null,
      },
      {
        weekInCycle: 2,
        dayOfWeek: DayOfWeek.MONDAY,
        startTime: null,
        endTime: null,
        isAvailable: false,
        notes: null,
      },
    ];

    const result = evaluateCarerAvailability(
      patterns,
      [1],
      '09:00',
      '10:00',
      baseCycle,
    );

    expect(result.unavailableDays).toContain(1);
    expect(result.summary).toContain('W1 ok');
    expect(result.summary).toContain('W2 off');
  });

  it('marks day available when both fortnight weeks match', () => {
    const patterns = [
      {
        weekInCycle: 1,
        dayOfWeek: DayOfWeek.MONDAY,
        startTime: '09:00',
        endTime: '17:00',
        isAvailable: true,
        notes: null,
      },
      {
        weekInCycle: 2,
        dayOfWeek: DayOfWeek.MONDAY,
        startTime: '09:00',
        endTime: '17:00',
        isAvailable: true,
        notes: null,
      },
    ];

    const result = evaluateCarerAvailability(
      patterns,
      [1],
      '09:00',
      '10:00',
      baseCycle,
    );

    expect(result.availableDays).toContain(1);
    expect(result.unavailableDays).not.toContain(1);
  });
});

describe('scheduledJobOverlapsVisitPlanSlot', () => {
  it('detects overlap on a matching weekday and time', () => {
    expect(
      scheduledJobOverlapsVisitPlanSlot({
        jobStart: new Date('2026-06-29T07:00:00.000Z'),
        jobEnd: new Date('2026-06-29T10:00:00.000Z'),
        slotDaysOfWeek: [1],
        plannedStartTime: '07:00',
        plannedEndTime: '10:00',
      }),
    ).toBe(true);
  });

  it('ignores jobs on non-matching weekdays', () => {
    expect(
      scheduledJobOverlapsVisitPlanSlot({
        jobStart: new Date('2026-06-30T07:00:00.000Z'),
        jobEnd: new Date('2026-06-30T10:00:00.000Z'),
        slotDaysOfWeek: [1],
        plannedStartTime: '07:00',
        plannedEndTime: '10:00',
      }),
    ).toBe(false);
  });

  it('ignores jobs that do not overlap the slot time', () => {
    expect(
      scheduledJobOverlapsVisitPlanSlot({
        jobStart: new Date('2026-06-29T11:00:00.000Z'),
        jobEnd: new Date('2026-06-29T12:00:00.000Z'),
        slotDaysOfWeek: [1],
        plannedStartTime: '07:00',
        plannedEndTime: '10:00',
      }),
    ).toBe(false);
  });
});
