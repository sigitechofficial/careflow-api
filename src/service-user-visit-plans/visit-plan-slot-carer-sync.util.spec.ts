import {
  visitPlanCarerEmployeeIds,
  visitPlanCarerSyncFromDateTime,
  targetEmployeeIdsForVisit,
  visitCarerPatternMismatchWarnings,
  desiredEmployeeIdsForVisitSync,
  countVisitsSkippedIfRespecting,
  planSyncAllocationChanges,
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

    it('picks the Monday carer for a Monday visit in organisation timezone', () => {
      expect(
        desiredEmployeeIdsForVisitSync({
          visitStart: monday,
          requiredCarers: 1,
          assignedEmployeeIds: ['legacy'],
          carerAssignments: assignments,
        }),
      ).toEqual(['mon-carer']);
    });

    it('uses operational weekday when UTC weekday differs (early Karachi Monday)', () => {
      expect(
        desiredEmployeeIdsForVisitSync({
          visitStart: new Date('2026-08-23T19:30:00.000Z'), // Mon 00:30 Asia/Karachi
          requiredCarers: 1,
          assignedEmployeeIds: ['legacy'],
          carerAssignments: assignments,
          timeZone: 'Asia/Karachi',
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
    it('uses start of the requested operational day when fromDate is provided', () => {
      expect(visitPlanCarerSyncFromDateTime('2026-06-19', 'Asia/Karachi').toISOString()).toBe(
        '2026-06-18T19:00:00.000Z',
      );
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
      const target = targetEmployeeIdsForVisit(['emp-1'], visit, 1, true, patternMap, 'Europe/London');
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
        scheduledStartDateTime: new Date('2026-06-22T02:00:00.000Z'),
        scheduledEndDateTime: new Date('2026-06-22T03:00:00.000Z'),
        requiredCarers: 1,
      };
      const patternMap = new Map([['emp-1', weekdayCtx]]);
      const target = targetEmployeeIdsForVisit(['emp-1'], visit, 1, true, patternMap, 'Europe/London');
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
      const target = targetEmployeeIdsForVisit(['emp-1'], visit, 1, true, patternMap, 'Europe/London');
      expect(target).toEqual(['emp-1']);
    });

    it('skips carer on Saturday when respecting pattern', () => {
      const visit = {
        scheduledStartDateTime: new Date('2026-06-20T10:00:00.000Z'),
        scheduledEndDateTime: new Date('2026-06-20T11:00:00.000Z'),
        requiredCarers: 1,
      };
      const patternMap = new Map([['emp-1', patternCtx]]);
      const target = targetEmployeeIdsForVisit(['emp-1'], visit, 1, true, patternMap, 'Europe/London');
      expect(target).toEqual([]);
    });

    it('allocates Saturday visit when not respecting pattern', () => {
      const visit = {
        scheduledStartDateTime: new Date('2026-06-20T10:00:00.000Z'),
        scheduledEndDateTime: new Date('2026-06-20T11:00:00.000Z'),
        requiredCarers: 1,
      };
      const patternMap = new Map([['emp-1', patternCtx]]);
      const target = targetEmployeeIdsForVisit(['emp-1'], visit, 1, false, patternMap, 'Europe/London');
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
        'Europe/London',
      );
      expect(warnings).toEqual([]);
    });
  });

  describe('organisation timezone is honoured for working-pattern checks', () => {
    const fridayLateCtx: EmployeePatternContext = {
      employeeId: 'emp-1',
      employeeName: 'Late carer',
      patterns: [
        {
          weekInCycle: 1,
          dayOfWeek: DayOfWeek.FRIDAY,
          startTime: '18:00',
          endTime: '23:59',
          isAvailable: true,
          notes: null,
        },
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
    // Fri 2026-07-17 23:30 BST = 22:30Z; in Karachi it is Sat 03:30.
    const lateFridayVisit = {
      scheduledStartDateTime: new Date('2026-07-17T22:30:00.000Z'),
      scheduledEndDateTime: new Date('2026-07-17T22:55:00.000Z'),
      requiredCarers: 1,
    };

    it('London: late-evening Friday visit fits the Friday pattern (no warning, carer kept)', () => {
      const map = new Map([['emp-1', fridayLateCtx]]);
      expect(visitCarerPatternMismatchWarnings(['emp-1'], lateFridayVisit, map, 'Europe/London')).toEqual(
        [],
      );
      expect(targetEmployeeIdsForVisit(['emp-1'], lateFridayVisit, 1, true, map, 'Europe/London')).toEqual(
        ['emp-1'],
      );
    });

    it('Karachi: the same instant is Saturday — warning names Saturday and carer is skipped', () => {
      const map = new Map([['emp-1', fridayLateCtx]]);
      const warnings = visitCarerPatternMismatchWarnings(
        ['emp-1'],
        lateFridayVisit,
        map,
        'Asia/Karachi',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Sat');
      expect(targetEmployeeIdsForVisit(['emp-1'], lateFridayVisit, 1, true, map, 'Asia/Karachi')).toEqual(
        [],
      );
    });

    it('time-mismatch message uses org-local HH:mm (London GMT 2026-01-16 Fri 17:00–18:30)', () => {
      const map = new Map([['emp-1', fridayLateCtx]]);
      const warnings = visitCarerPatternMismatchWarnings(
        ['emp-1'],
        {
          scheduledStartDateTime: new Date('2026-01-16T17:00:00.000Z'),
          scheduledEndDateTime: new Date('2026-01-16T17:30:00.000Z'),
        },
        map,
        'Europe/London',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('1 hour before');
    });

    it('countVisitsSkippedIfRespecting uses the org timezone', () => {
      const map = new Map([['emp-1', fridayLateCtx]]);
      expect(countVisitsSkippedIfRespecting([lateFridayVisit], ['emp-1'], 1, map, 'Europe/London')).toBe(
        0,
      );
      expect(countVisitsSkippedIfRespecting([lateFridayVisit], ['emp-1'], 1, map, 'Asia/Karachi')).toBe(
        1,
      );
    });

    it('desiredEmployeeIdsForVisitSync: 00:30 BST Tuesday (Mon 23:30Z) picks the Tuesday carer in London', () => {
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
          dayOfWeek: 2,
          employeeId: 'tue-carer',
          role: VisitPlanSlotCarerRole.LEAD,
          durationMinutes: null,
          plannedStartTime: null,
          plannedEndTime: null,
          sortOrder: 1,
        },
      ];
      const visitStart = new Date('2026-07-13T23:30:00.000Z');
      expect(
        desiredEmployeeIdsForVisitSync({
          visitStart,
          requiredCarers: 1,
          assignedEmployeeIds: [],
          carerAssignments: assignments,
          timeZone: 'Europe/London',
        }),
      ).toEqual(['tue-carer']);
    });
  });

  describe('visitPlanCarerSyncFromDateTime (London)', () => {
    it('BST day starts 23:00Z the previous UTC day; GMT day starts at 00:00Z', () => {
      expect(visitPlanCarerSyncFromDateTime('2026-07-15', 'Europe/London').toISOString()).toBe(
        '2026-07-14T23:00:00.000Z',
      );
      expect(visitPlanCarerSyncFromDateTime('2026-01-15', 'Europe/London').toISOString()).toBe(
        '2026-01-15T00:00:00.000Z',
      );
    });
  });
  describe('planSyncAllocationChanges', () => {
    const row = (employeeId: string, fromVisitPlan: boolean) => ({ id: `a-${employeeId}`, employeeId, fromVisitPlan });

    it('keeps a carer chosen on the rota who is not on the plan slot', () => {
      const { toRemove, toAdd } = planSyncAllocationChanges({
        active: [row('rota-carer', false)],
        target: ['plan-carer'],
        removedByHand: new Set(),
        requiredCarers: 1,
      });
      expect(toRemove).toEqual([]);
      // The rota carer takes the only place: the plan carer is not added on top.
      expect(toAdd).toEqual([]);
    });

    it('replaces a plan carer when the plan slot has another carer', () => {
      const { toRemove, toAdd } = planSyncAllocationChanges({
        active: [row('old-plan-carer', true)],
        target: ['new-plan-carer'],
        removedByHand: new Set(),
        requiredCarers: 1,
      });
      expect(toRemove.map((r) => r.employeeId)).toEqual(['old-plan-carer']);
      expect(toAdd).toEqual(['new-plan-carer']);
    });

    it('does not put back a plan carer a person took off this visit', () => {
      const { toRemove, toAdd } = planSyncAllocationChanges({
        active: [],
        target: ['plan-carer'],
        removedByHand: new Set(['plan-carer']),
        requiredCarers: 1,
      });
      expect(toRemove).toEqual([]);
      expect(toAdd).toEqual([]);
    });

    it('fills the places left after the rota carers', () => {
      const { toAdd } = planSyncAllocationChanges({
        active: [row('rota-carer', false)],
        target: ['plan-a', 'plan-b'],
        removedByHand: new Set(),
        requiredCarers: 2,
      });
      expect(toAdd).toEqual(['plan-a']);
    });
  });
});
