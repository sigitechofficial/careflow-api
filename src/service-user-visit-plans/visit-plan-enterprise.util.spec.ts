import { VisitPlanSlotExceptionType, VisitPlanSlotKind } from '@prisma/client';
import { resolveCarerAssignmentsForDay, visitPlanSlotOccurrenceOnDay } from './visit-plan-slot-carer-resolve.util';
import { resolveSlotVisitWindow, resolveCarerWindows, envelopeWindow } from './visit-plan-slot-window.util';
import { VisitPlanScheduleFrequency } from '@prisma/client';

describe('visit-plan-slot-window.util', () => {
  // 2026-06-18 is BST (Europe/London = UTC+1)
  it('resolves overnight window when end <= start (org TZ → true UTC)', () => {
    const day = new Date(Date.UTC(2026, 5, 18));
    const w = resolveSlotVisitWindow(day, {
      plannedStartTime: '22:00',
      plannedEndTime: '07:00',
      slotKind: VisitPlanSlotKind.OVERNIGHT,
    });
    expect(w.start.toISOString()).toBe('2026-06-18T21:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-06-19T06:00:00.000Z');
    expect(w.isOvernight).toBe(true);
  });

  it('uses durationMinutes when set (org TZ → true UTC)', () => {
    const day = new Date(Date.UTC(2026, 5, 18));
    const w = resolveSlotVisitWindow(day, {
      plannedStartTime: '07:00',
      plannedEndTime: '09:00',
      durationMinutes: 60,
    });
    expect(w.durationMinutes).toBe(60);
    expect(w.start.toISOString()).toBe('2026-06-18T06:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-06-18T07:00:00.000Z');
  });

  it('supports asymmetric double-up carer windows', () => {
    const day = new Date(Date.UTC(2026, 5, 18));
    const slot = { plannedStartTime: '07:00', plannedEndTime: '08:00', durationMinutes: 60 };
    const carers = resolveCarerWindows(day, slot, [
      { employeeId: 'a', role: 'LEAD', durationMinutes: 60, sortOrder: 0 },
      { employeeId: 'b', role: 'SECONDARY', durationMinutes: 30, sortOrder: 1 },
    ]);
    expect(carers[0]!.durationMinutes).toBe(60);
    expect(carers[1]!.durationMinutes).toBe(30);
    const env = envelopeWindow(resolveSlotVisitWindow(day, slot), carers);
    expect(env.durationMinutes).toBe(60);
  });
});

describe('visit-plan-slot-carer-resolve.util', () => {
  const baseSlot = {
    slotCode: 'MORNING',
    daysOfWeek: [1, 3, 5],
    scheduleFrequency: VisitPlanScheduleFrequency.WEEKLY,
    repeatEvery: 1,
    monthlyDayMode: 'BY_DATE' as const,
    monthlyDaysOfMonth: [],
    monthlyPatternOrdinal: null,
    monthlyPatternWeekday: null,
    slotKind: VisitPlanSlotKind.STANDARD,
    slotEffectiveFrom: new Date(Date.UTC(2026, 5, 1)),
    slotEffectiveTo: new Date(Date.UTC(2026, 5, 30)),
    oneOffDate: null,
    isEnabled: true,
  };

  it('respects slot effective date range', () => {
    const anchor = new Date(Date.UTC(2026, 5, 1));
    expect(
      visitPlanSlotOccurrenceOnDay({
        slot: baseSlot,
        day: new Date(Date.UTC(2026, 4, 31)),
        planAnchor: anchor,
        planEffectiveTo: null,
        exceptions: [],
      }),
    ).toBe(false);
    expect(
      visitPlanSlotOccurrenceOnDay({
        slot: baseSlot,
        day: new Date(Date.UTC(2026, 5, 1)),
        planAnchor: anchor,
        planEffectiveTo: null,
        exceptions: [],
      }),
    ).toBe(true);
  });

  it('prefers day-specific carer assignments', () => {
    const mon = resolveCarerAssignmentsForDay(
      [
        {
          dayOfWeek: 1,
          employeeId: 'mon-carer',
          role: 'LEAD' as const,
          durationMinutes: null,
          plannedStartTime: null,
          plannedEndTime: null,
          sortOrder: 0,
        },
        {
          dayOfWeek: null,
          employeeId: 'default-carer',
          role: 'LEAD' as const,
          durationMinutes: null,
          plannedStartTime: null,
          plannedEndTime: null,
          sortOrder: 0,
        },
      ],
      1,
      1,
      [],
    );
    expect(mon[0]!.employeeId).toBe('mon-carer');
  });

  it('handles ONE_OFF slot kind', () => {
    const anchor = new Date(Date.UTC(2026, 5, 1));
    const slot = {
      ...baseSlot,
      slotKind: VisitPlanSlotKind.ONE_OFF,
      oneOffDate: new Date(Date.UTC(2026, 5, 15)),
      daysOfWeek: [],
    };
    expect(
      visitPlanSlotOccurrenceOnDay({
        slot,
        day: new Date(Date.UTC(2026, 5, 15)),
        planAnchor: anchor,
        planEffectiveTo: null,
        exceptions: [],
      }),
    ).toBe(true);
    expect(
      visitPlanSlotOccurrenceOnDay({
        slot,
        day: new Date(Date.UTC(2026, 5, 16)),
        planAnchor: anchor,
        planEffectiveTo: null,
        exceptions: [],
      }),
    ).toBe(false);
  });

  it('honours SKIP exception', () => {
    expect(
      visitPlanSlotOccurrenceOnDay({
        slot: baseSlot,
        day: new Date(Date.UTC(2026, 5, 2)),
        planAnchor: new Date(Date.UTC(2026, 5, 1)),
        planEffectiveTo: null,
        exceptions: [
          {
            exceptionDate: new Date(Date.UTC(2026, 5, 2)),
            exceptionType: VisitPlanSlotExceptionType.SKIP,
          },
        ],
      }),
    ).toBe(false);
  });
});
