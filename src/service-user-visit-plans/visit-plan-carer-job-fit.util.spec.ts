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
const LONDON = 'Europe/London';
const KARACHI = 'Asia/Karachi';

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
    expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end, LONDON)).toBe(false);
  });

  it('isEmployeeAvailableForVisit returns true on Monday within hours', () => {
    const start = new Date('2026-06-22T10:00:00.000Z'); // Monday
    const end = new Date('2026-06-22T11:00:00.000Z');
    expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end, LONDON)).toBe(true);
  });

  it('isEmployeeAvailableForVisit returns false when visit is before pattern start', () => {
    const start = new Date('2026-06-22T07:00:00.000Z');
    const end = new Date('2026-06-22T08:00:00.000Z');
    expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end, LONDON)).toBe(false);
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
    expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end, LONDON)).toBe(true);
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

  describe('isEmployeeAvailableForVisit reads weekday + HH:mm in the org timezone', () => {
    // Mon 09:00–17:00 London-local pattern; weekend off.
    it('London BST (2026-07-15 Wed): 08:30Z = 09:30 BST is inside the pattern', () => {
      const start = new Date('2026-07-15T08:30:00.000Z');
      const end = new Date('2026-07-15T09:30:00.000Z');
      expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end, LONDON)).toBe(true);
    });

    it('London BST: 07:00Z–07:45Z (08:00–08:45 BST) is fully before a 09:00 start', () => {
      const start = new Date('2026-07-15T07:00:00.000Z');
      const end = new Date('2026-07-15T07:45:00.000Z');
      expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end, LONDON)).toBe(false);
    });

    it('London GMT (2026-01-15 Thu): 08:00Z–08:45Z = 08:00–08:45 GMT is fully before a 09:00 start', () => {
      const start = new Date('2026-01-15T08:00:00.000Z');
      const end = new Date('2026-01-15T08:45:00.000Z');
      expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end, LONDON)).toBe(false);
      // Same instants are 13:00–13:45 in Karachi — inside the pattern there.
      expect(isEmployeeAvailableForVisit(weekdayPatterns, cycleConfig, start, end, KARACHI)).toBe(true);
    });

    it('late-evening London visit 23:30 BST Fri (22:30Z) stays on Friday, not Saturday', () => {
      const lateFriday: CarerPatternRow[] = weekdayPatterns.map((p) =>
        p.dayOfWeek === DayOfWeek.FRIDAY ? { ...p, startTime: '18:00', endTime: '23:59' } : p,
      );
      const start = new Date('2026-07-17T22:30:00.000Z'); // Fri 23:30 BST
      const end = new Date('2026-07-17T22:55:00.000Z');
      expect(isEmployeeAvailableForVisit(lateFriday, cycleConfig, start, end, LONDON)).toBe(true);
      // In Karachi the same instant is Sat 03:30 — carer is off on Saturday.
      expect(isEmployeeAvailableForVisit(lateFriday, cycleConfig, start, end, KARACHI)).toBe(false);
    });

    it('early-morning Karachi Monday 00:30 PKT (Sun 19:30Z) resolves Monday in Karachi', () => {
      const nightMonday: CarerPatternRow[] = weekdayPatterns.map((p) =>
        p.dayOfWeek === DayOfWeek.MONDAY ? { ...p, startTime: '00:00', endTime: '06:00' } : p,
      );
      const start = new Date('2026-08-23T19:30:00.000Z');
      const end = new Date('2026-08-23T20:00:00.000Z');
      expect(isEmployeeAvailableForVisit(nightMonday, cycleConfig, start, end, KARACHI)).toBe(true);
      // London: Sun 20:30 BST — Sunday is unavailable.
      expect(isEmployeeAvailableForVisit(nightMonday, cycleConfig, start, end, LONDON)).toBe(false);
    });

    it('around DST transitions (2026-03-29 spring forward, 2026-10-25 fall back)', () => {
      // 2026-03-30 Mon 09:15 BST = 08:15Z (clocks went forward on the 29th)
      expect(
        isEmployeeAvailableForVisit(
          weekdayPatterns,
          cycleConfig,
          new Date('2026-03-30T08:15:00.000Z'),
          new Date('2026-03-30T08:45:00.000Z'),
          LONDON,
        ),
      ).toBe(true);
      // 2026-10-26 Mon 08:30 GMT = 08:30Z (clocks went back on the 25th) — before 09:00
      expect(
        isEmployeeAvailableForVisit(
          weekdayPatterns,
          cycleConfig,
          new Date('2026-10-26T08:00:00.000Z'),
          new Date('2026-10-26T08:45:00.000Z'),
          LONDON,
        ),
      ).toBe(false);
      // DST days themselves are Sundays → unavailable regardless of clock.
      expect(
        isEmployeeAvailableForVisit(
          weekdayPatterns,
          cycleConfig,
          new Date('2026-03-29T10:00:00.000Z'),
          new Date('2026-03-29T11:00:00.000Z'),
          LONDON,
        ),
      ).toBe(false);
      expect(
        isEmployeeAvailableForVisit(
          weekdayPatterns,
          cycleConfig,
          new Date('2026-10-25T10:00:00.000Z'),
          new Date('2026-10-25T11:00:00.000Z'),
          LONDON,
        ),
      ).toBe(false);
    });
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
