import { DayOfWeek } from '@prisma/client';
import {
  timeWindowsOverlap,
  visitTimeFitsWithinPattern,
  visitPatternTimeMismatch,
  formatVisitPatternTimeMismatchMessage,
} from '../employee-working-patterns/working-pattern-time.util';import { DAY_LABEL, type CarerPatternRow } from './visit-plan-carer-suggest.util';
import {
  collectCarerPatternConflicts,
  isEmployeeAvailableForVisit,
  type EmployeePatternContext,
  type SlotCarerPatternInput,
} from './visit-plan-carer-job-fit.util';
import type { WorkingPatternCycleConfig } from '../employee-working-patterns/working-pattern-cycle.util';
describe('visit-plan-carer-job-fit.util', () => {
  const cycleConfig: WorkingPatternCycleConfig = {
    workingPatternCycleWeeks: 1,
    workingPatternCycleAnchorDate: null,
    startDate: null,
    employeeCreatedAt: new Date('2025-01-01'),
  };

  const weekdayPatterns: CarerPatternRow[] = [
    { weekInCycle: 1, dayOfWeek: DayOfWeek.MONDAY, startTime: '09:00', endTime: '17:00', isAvailable: true, notes: null },
    { weekInCycle: 1, dayOfWeek: DayOfWeek.TUESDAY, startTime: '09:00', endTime: '17:00', isAvailable: true, notes: null },
    { weekInCycle: 1, dayOfWeek: DayOfWeek.WEDNESDAY, startTime: '09:00', endTime: '17:00', isAvailable: true, notes: null },
    { weekInCycle: 1, dayOfWeek: DayOfWeek.THURSDAY, startTime: '09:00', endTime: '17:00', isAvailable: true, notes: null },
    { weekInCycle: 1, dayOfWeek: DayOfWeek.FRIDAY, startTime: '09:00', endTime: '17:00', isAvailable: true, notes: null },
    { weekInCycle: 1, dayOfWeek: DayOfWeek.SATURDAY, startTime: null, endTime: null, isAvailable: false, notes: null },
    { weekInCycle: 1, dayOfWeek: DayOfWeek.SUNDAY, startTime: null, endTime: null, isAvailable: false, notes: null },
  ];

  const employee: EmployeePatternContext = {
    employeeId: 'emp-1',
    employeeName: 'Yusuf Ali',
    patterns: weekdayPatterns,
    cycleConfig,
  };

  it('isEmployeeAvailableForVisit returns false on Saturday', () => {
    const start = new Date('2026-06-20T10:00:00.000Z'); // Saturday
    const end = new Date('2026-06-20T11:00:00.000Z');
    expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end)).toBe(false);
  });

  it('isEmployeeAvailableForVisit returns true on Monday within hours', () => {
    const start = new Date('2026-06-22T10:00:00.000Z'); // Monday
    const end = new Date('2026-06-22T11:00:00.000Z');
    expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end)).toBe(true);
  });

  it('isEmployeeAvailableForVisit returns false when visit is before pattern start', () => {
    const start = new Date('2026-06-22T07:00:00.000Z');
    const end = new Date('2026-06-22T08:00:00.000Z');
    expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end)).toBe(false);
  });

  it('collectCarerPatternConflicts flags weekend assignment on weekday-only carer', () => {
    const slot: SlotCarerPatternInput = {
      slotCode: 'MORNING',
      slotLabel: 'Morning',
      daysOfWeek: [1, 2, 3, 4, 5, 6],
      plannedStartTime: '09:00',
      plannedEndTime: '10:00',
      isEnabled: true,
      assignedEmployeeIds: ['emp-1'],
      carerAssignments: [],
    };
    const conflicts = collectCarerPatternConflicts([slot], [employee]);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].unavailableDayLabels).toContain('Sat');
    expect(conflicts[0].employeeName).toBe('Yusuf Ali');
  });

  it('isEmployeeAvailableForVisit returns true when visit overlaps working hours', () => {
    const start = new Date('2026-06-22T07:00:00.000Z');
    const end = new Date('2026-06-22T10:00:00.000Z');
    expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end)).toBe(true);
  });

  it('collectCarerPatternConflicts flags time outside pattern', () => {
    const slot: SlotCarerPatternInput = {
      slotCode: 'EARLY',
      slotLabel: 'Early',
      daysOfWeek: [1],
      plannedStartTime: '07:00',
      plannedEndTime: '08:00',
      isEnabled: true,
      assignedEmployeeIds: ['emp-1'],
    };
    const conflicts = collectCarerPatternConflicts([slot], [employee]);
    expect(conflicts.some((c) => c.timeOutsidePattern)).toBe(true);
  });

  it('collectCarerPatternConflicts allows partial-overlap visit (07:00-10:00 vs 09:00-17:00)', () => {
    const slot: SlotCarerPatternInput = {
      slotCode: 'EARLY_LONG',
      slotLabel: 'Early long',
      daysOfWeek: [1],
      plannedStartTime: '07:00',
      plannedEndTime: '10:00',
      isEnabled: true,
      assignedEmployeeIds: ['emp-1'],
    };
    const conflicts = collectCarerPatternConflicts([slot], [employee]);
    expect(conflicts).toEqual([]);
  });
});

describe('timeWindowsOverlap', () => {
  it('detects non-overlapping windows', () => {
    expect(timeWindowsOverlap('07:00', '08:00', '09:00', '17:00')).toBe(false);
  });

  it('allows partial overlap (legacy overlap rule)', () => {
    expect(timeWindowsOverlap('07:00', '10:00', '09:00', '17:00')).toBe(true);
  });
});

describe('visitTimeFitsWithinPattern', () => {
  it('rejects visit that starts before working hours even when it overlaps', () => {
    expect(visitTimeFitsWithinPattern('07:00', '10:00', '09:00', '18:00')).toBe(false);
  });

  it('accepts visit fully inside working hours', () => {
    expect(visitTimeFitsWithinPattern('09:00', '10:00', '09:00', '18:00')).toBe(true);
  });
});

describe('formatVisitPatternTimeMismatchMessage', () => {
  it('describes visit starting before working pattern', () => {
    const mismatch = visitPatternTimeMismatch('07:00', '10:00', '09:00', '18:00');
    expect(mismatch).toEqual({ minutesBeforeStart: 120, minutesAfterEnd: 0 });
    expect(
      formatVisitPatternTimeMismatchMessage('Mon', mismatch!, '09:00', '18:00'),
    ).toBe('On Mon, your visit is 2 hours before your working pattern (09:00–18:00)');
  });
});

describe('DAY_LABEL', () => {
  it('maps Sunday to Sun', () => {
    expect(DAY_LABEL[0]).toBe('Sun');
  });
});
