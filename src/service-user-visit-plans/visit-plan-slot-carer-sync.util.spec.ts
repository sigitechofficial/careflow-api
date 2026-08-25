import {
  visitPlanCarerEmployeeIds,
  visitPlanCarerSyncFromDateTime,
  targetEmployeeIdsForVisit,
  visitCarerPatternMismatchWarnings,
  desiredEmployeeIdsForVisitSync,
} from './visit-plan-slot-carer-sync.util';
import { DayOfWeek, VisitPlanSlotCarerRole } from '@prisma/client';
import type { EmployeePatternContext } from './visit-plan-carer-job-fit.util';

describe('visit-plan-slot-carer-sync.util', () => {
  describe('visitPlanCarerEmployeeIds', () => {
    it('prefers carer windows over legacy assignedEmployeeIds', () => {
      expect(
        visitPlanCarerEmployeeIds(
          [{ employeeId: 'window-id' }],
          ['legacy-id'],
          1,
        ),
      ).toEqual(['window-id']);
    });

    it('falls back to assignedEmployeeIds when carer windows are empty', () => {
      expect(visitPlanCarerEmployeeIds([], ['legacy-id', 'extra-id'], 1)).toEqual(['legacy-id']);
    });

    it('falls back when carer windows only have blank employee ids', () => {
      expect(
        visitPlanCarerEmployeeIds([{ employeeId: '' }, { employeeId: '  ' }], ['legacy-id'], 1),
      ).toEqual(['legacy-id']);
    });
  });

  describe('desiredEmployeeIdsForVisitSync', () => {
    const monday = new Date('2026-08-24T15:00:00.000Z');
    const wednesday = new Date('2026-08-26T15:00:00.000Z');
    const assignments = [
      {
        dayOfWeek: 1,
        employeeId: 'mon-carer',
        role: VisitPlanSlotCarerRole.LEAD,
        durationMinutes: null,
        plannedStartTime: null,
        plannedEndTime: null,
        sortOrder: 0,
      },
      {
        dayOfWeek: 3,
        employeeId: 'wed-carer',
        role: VisitPlanSlotCarerRole.LEAD,
        durationMinutes: null,
        plannedStartTime: null,
        plannedEndTime: null,
        sortOrder: 1,
      },
    ];

    it('picks the Monday carer for a Monday visit', () => {
      expect(
        desiredEmployeeIdsForVisitSync({
          visitStart: monday,
          requiredCarers: 1,
          assignedEmployeeIds: ['legacy'],
          carerAssignments: assignments,
        }),
      ).toEqual(['mon-carer']);
    });

    it('picks the Wednesday carer for a Wednesday visit', () => {
      expect(
        desiredEmployeeIdsForVisitSync({
          visitStart: wednesday,
          requiredCarers: 1,
          assignedEmployeeIds: ['legacy'],
          carerAssignments: assignments,
        }),
      ).toEqual(['wed-carer']);
    });

    it('prefers carer windows when provided (regenerate path)', () => {
      expect(
        desiredEmployeeIdsForVisitSync({
          visitStart: wednesday,
          requiredCarers: 1,
          assignedEmployeeIds: ['legacy'],
          carerAssignments: assignments,
          carerWindows: [{ employeeId: 'window-carer' }],
        }),
      ).toEqual(['window-carer']);
    });
  });

  describe('visitPlanCarerSyncFromDateTime', () => {
    it('uses start of the requested UTC day when fromDate is provided', () => {
      expect(visitPlanCarerSyncFromDateTime('2026-06-19').toISOString()).toBe('2026-06-19T00:00:00.000Z');
    });
  });

  describe('targetEmployeeIdsForVisit', () => {
    const patternCtx: EmployeePatternContext = {
      employeeId: 'emp-1',
      employeeName: 'Weekday carer',
      patterns: [
        {
          weekInCycle: 1,
          dayOfWeek: DayOfWeek.SATURDAY,
          startTime: null,
          endTime: null,
          isAvailable: false,
          notes: null,
        },
      ],
      cycleConfig: {
        workingPatternCycleWeeks: 1,
        workingPatternCycleAnchorDate: null,
        startDate: null,
        employeeCreatedAt: new Date('2025-01-01'),
      },
    };

    it('assigns carer when respecting pattern and visit overlaps working hours', () => {
      const weekdayCtx: EmployeePatternContext = {
        employeeId: 'emp-1',
        employeeName: 'Weekday carer',
        patterns: [
          {
            weekInCycle: 1,
            dayOfWeek: DayOfWeek.MONDAY,
            startTime: '09:00',
            endTime: '18:00',
            isAvailable: true,
            notes: null,
          },
        ],
        cycleConfig: {
          workingPatternCycleWeeks: 1,
          workingPatternCycleAnchorDate: null,
          startDate: null,
          employeeCreatedAt: new Date('2025-01-01'),
        },
      };
      const visit = {
        scheduledStartDateTime: new Date('2026-06-22T07:00:00.000Z'),
        scheduledEndDateTime: new Date('2026-06-22T10:00:00.000Z'),
        requiredCarers: 1,
      };
      const patternMap = new Map([['emp-1', weekdayCtx]]);
      const target = targetEmployeeIdsForVisit(['emp-1'], visit, 1, true, patternMap);
      expect(target).toEqual(['emp-1']);
    });

    it('skips carer when respecting pattern and visit does not overlap working hours', () => {
      const weekdayCtx: EmployeePatternContext = {
        employeeId: 'emp-1',
        employeeName: 'Weekday carer',
        patterns: [
          {
            weekInCycle: 1,
            dayOfWeek: DayOfWeek.MONDAY,
            startTime: '09:00',
            endTime: '18:00',
            isAvailable: true,
            notes: null,
          },
        ],
        cycleConfig: {
          workingPatternCycleWeeks: 1,
          workingPatternCycleAnchorDate: null,
          startDate: null,
          employeeCreatedAt: new Date('2025-01-01'),
        },
      };
      const visit = {
        scheduledStartDateTime: new Date('2026-06-22T07:00:00.000Z'),
        scheduledEndDateTime: new Date('2026-06-22T08:00:00.000Z'),
        requiredCarers: 1,
      };
      const patternMap = new Map([['emp-1', weekdayCtx]]);
      const target = targetEmployeeIdsForVisit(['emp-1'], visit, 1, true, patternMap);
      expect(target).toEqual([]);
    });

    it('assigns carer on Monday when respecting pattern and visit is within hours', () => {
      const weekdayCtx: EmployeePatternContext = {
        employeeId: 'emp-1',
        employeeName: 'Weekday carer',
        patterns: [
          {
            weekInCycle: 1,
            dayOfWeek: DayOfWeek.MONDAY,
            startTime: '08:00',
            endTime: '18:00',
            isAvailable: true,
            notes: null,
          },
        ],
        cycleConfig: {
          workingPatternCycleWeeks: 1,
          workingPatternCycleAnchorDate: null,
          startDate: null,
          employeeCreatedAt: new Date('2025-01-01'),
        },
      };
      const visit = {
        scheduledStartDateTime: new Date('2026-06-22T09:00:00.000Z'),
        scheduledEndDateTime: new Date('2026-06-22T10:00:00.000Z'),
        requiredCarers: 1,
      };
      const patternMap = new Map([['emp-1', weekdayCtx]]);
      const target = targetEmployeeIdsForVisit(['emp-1'], visit, 1, true, patternMap);
      expect(target).toEqual(['emp-1']);
    });

    it('skips carer on Saturday when respecting pattern', () => {
      const visit = {
        scheduledStartDateTime: new Date('2026-06-20T10:00:00.000Z'),
        scheduledEndDateTime: new Date('2026-06-20T11:00:00.000Z'),
        requiredCarers: 1,
      };
      const patternMap = new Map([['emp-1', patternCtx]]);
      const target = targetEmployeeIdsForVisit(['emp-1'], visit, 1, true, patternMap);
      expect(target).toEqual([]);
    });

    it('allocates Saturday visit when not respecting pattern', () => {
      const visit = {
        scheduledStartDateTime: new Date('2026-06-20T10:00:00.000Z'),
        scheduledEndDateTime: new Date('2026-06-20T11:00:00.000Z'),
        requiredCarers: 1,
      };
      const patternMap = new Map([['emp-1', patternCtx]]);
      const target = targetEmployeeIdsForVisit(['emp-1'], visit, 1, false, patternMap);
      expect(target).toEqual(['emp-1']);
    });
  });

  describe('visitCarerPatternMismatchWarnings', () => {
    it('does not warn when visit overlaps working pattern', () => {
      const ctx: EmployeePatternContext = {
        employeeId: 'emp-1',
        employeeName: 'Yusuf Ali',
        patterns: [
          {
            weekInCycle: 1,
            dayOfWeek: DayOfWeek.MONDAY,
            startTime: '09:00',
            endTime: '18:00',
            isAvailable: true,
            notes: null,
          },
        ],
        cycleConfig: {
          workingPatternCycleWeeks: 1,
          workingPatternCycleAnchorDate: null,
          startDate: null,
          employeeCreatedAt: new Date('2025-01-01'),
        },
      };
      const warnings = visitCarerPatternMismatchWarnings(
        ['emp-1'],
        {
          scheduledStartDateTime: new Date('2026-06-22T07:00:00.000Z'),
          scheduledEndDateTime: new Date('2026-06-22T10:00:00.000Z'),
        },
        new Map([['emp-1', ctx]]),
      );
      expect(warnings).toEqual([]);
    });
  });
});
