import {
  durationMinutesBetween,
  intervalsOverlap,
  isInheritedAllocationTiming,
  resolveAllocationWindow,
  resolveVisitWindow,
  validateAllocationTimingWithinVisit,
} from './allocation-window.util';

describe('allocation-window.util', () => {
  const visitStart = new Date('2026-07-30T09:00:00.000Z');
  const visitEnd = new Date('2026-07-30T11:00:00.000Z');
  const visit = {
    scheduledStartDateTime: visitStart,
    scheduledEndDateTime: visitEnd,
  };

  it('resolveVisitWindow uses estimated duration when end is null', () => {
    const w = resolveVisitWindow({
      scheduledStartDateTime: visitStart,
      scheduledEndDateTime: null,
      estimatedDurationMinutes: 90,
    });
    expect(w.end.toISOString()).toBe('2026-07-30T10:30:00.000Z');
  });

  it('falls back to visit window when allocation times are null', () => {
    const r = resolveAllocationWindow(
      { scheduledStartDateTime: null, scheduledEndDateTime: null },
      visit,
    );
    expect(r.hasExplicitTiming).toBe(false);
    expect(r.start).toEqual(visitStart);
    expect(r.end).toEqual(visitEnd);
    expect(r.durationMinutes).toBe(120);
  });

  it('uses explicit allocation timing when both ends set', () => {
    const start = new Date('2026-07-30T09:30:00.000Z');
    const end = new Date('2026-07-30T10:30:00.000Z');
    const r = resolveAllocationWindow(
      { scheduledStartDateTime: start, scheduledEndDateTime: end },
      visit,
    );
    expect(r.hasExplicitTiming).toBe(true);
    expect(r.start).toEqual(start);
    expect(r.end).toEqual(end);
    expect(r.durationMinutes).toBe(60);
  });

  it('detects inherited vs customized timing', () => {
    expect(
      isInheritedAllocationTiming(
        { scheduledStartDateTime: null, scheduledEndDateTime: null },
        visit,
      ),
    ).toBe(true);
    expect(
      isInheritedAllocationTiming(
        { scheduledStartDateTime: visitStart, scheduledEndDateTime: visitEnd },
        visit,
      ),
    ).toBe(true);
    expect(
      isInheritedAllocationTiming(
        {
          scheduledStartDateTime: new Date('2026-07-30T09:15:00.000Z'),
          scheduledEndDateTime: visitEnd,
        },
        visit,
      ),
    ).toBe(false);
  });

  it('rejects end before start and times outside visit window', () => {
    expect(
      validateAllocationTimingWithinVisit({
        assignmentStart: visitStart,
        assignmentEnd: visitStart,
        visitStart,
        visitEnd,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'scheduledEndDateTime' }),
      ]),
    );
    expect(
      validateAllocationTimingWithinVisit({
        assignmentStart: new Date('2026-07-30T08:00:00.000Z'),
        assignmentEnd: visitEnd,
        visitStart,
        visitEnd,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'scheduledStartDateTime' }),
      ]),
    );
    expect(
      validateAllocationTimingWithinVisit({
        assignmentStart: new Date('2026-07-30T09:30:00.000Z'),
        assignmentEnd: new Date('2026-07-30T10:30:00.000Z'),
        visitStart,
        visitEnd,
      }),
    ).toEqual([]);
  });

  it('intervalsOverlap and durationMinutesBetween', () => {
    expect(durationMinutesBetween(visitStart, visitEnd)).toBe(120);
    expect(
      intervalsOverlap(
        visitStart,
        new Date('2026-07-30T10:00:00.000Z'),
        new Date('2026-07-30T09:30:00.000Z'),
        visitEnd,
      ),
    ).toBe(true);
    expect(
      intervalsOverlap(
        visitStart,
        new Date('2026-07-30T10:00:00.000Z'),
        new Date('2026-07-30T10:00:00.000Z'),
        visitEnd,
      ),
    ).toBe(false);
  });
});
