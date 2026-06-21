import { DayOfWeek } from '@prisma/client';
import { evaluateCarerAvailability } from './visit-plan-carer-suggest.util';

const baseCycle = {
  workingPatternCycleWeeks: 2,
  workingPatternCycleAnchorDate: new Date(Date.UTC(2026, 0, 5)),
  startDate: null,
  employeeCreatedAt: new Date(Date.UTC(2025, 0, 1)),
};

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
