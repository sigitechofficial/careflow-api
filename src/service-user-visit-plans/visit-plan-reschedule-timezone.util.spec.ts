import { resolveOperationalStartEnd } from './visit-plan-amendment-impact.util';
import { resolveCarerWindows, resolveSlotVisitWindow, wallClockVisitEnd } from './visit-plan-slot-window.util';

describe('resolveOperationalStartEnd', () => {
  const tz = 'Europe/London';

  it('applies the new time as UK wall-clock time during British Summer Time', () => {
    // 16 Oct 2026 is BST (UTC+1): a visit at 07:00 UK is stored as 06:00Z.
    const { start, end } = resolveOperationalStartEnd(new Date('2026-10-16T06:00:00.000Z'), '07:30', '08:30', tz);
    expect(start.toISOString()).toBe('2026-10-16T06:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-16T07:30:00.000Z');
  });

  it('applies the new time as UK wall-clock time in winter (GMT)', () => {
    const { start, end } = resolveOperationalStartEnd(new Date('2026-10-26T07:00:00.000Z'), '07:30', '08:30', tz);
    expect(start.toISOString()).toBe('2026-10-26T07:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-26T08:30:00.000Z');
  });

  it('keeps the visit on its own day when it starts just after midnight UK time', () => {
    // 00:30 UK on 16 Oct (BST) is 23:30Z on the 15th.
    const { start } = resolveOperationalStartEnd(new Date('2026-10-15T23:30:00.000Z'), '01:00', '02:00', tz);
    expect(start.toISOString()).toBe('2026-10-16T00:00:00.000Z');
  });

  it('ends the next day when the end time is not after the start time', () => {
    const { start, end } = resolveOperationalStartEnd(new Date('2026-10-26T22:00:00.000Z'), '22:00', '07:00', tz);
    expect(end.getTime() - start.getTime()).toBe(9 * 3600000);
  });
});

describe('overnight visits on the nights the clocks change', () => {
  const tz = 'Europe/London';
  const hours = (w: { start: Date; end: Date }) => (w.end.getTime() - w.start.getTime()) / 3600000;
  const night = { plannedStartTime: '22:00', plannedEndTime: '07:00', durationMinutes: 540 };

  it('a 22:00-07:00 visit ends at 07:00 UK time on an ordinary night (9 hours)', () => {
    const w = resolveSlotVisitWindow(new Date('2026-10-17T00:00:00.000Z'), night, tz);
    expect(w.start.toISOString()).toBe('2026-10-17T21:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-18T06:00:00.000Z');
    expect(w.durationMinutes).toBe(540);
  });

  it('ends at 07:00 GMT when the clocks go back (25 Oct 2026, 10 hours)', () => {
    const w = resolveSlotVisitWindow(new Date('2026-10-24T00:00:00.000Z'), night, tz);
    expect(w.start.toISOString()).toBe('2026-10-24T21:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-25T07:00:00.000Z');
    expect(w.durationMinutes).toBe(600);
  });

  it('ends at 07:00 BST when the clocks go forward (28 Mar 2027, 8 hours)', () => {
    const w = resolveSlotVisitWindow(new Date('2027-03-27T00:00:00.000Z'), night, tz);
    expect(w.end.toISOString()).toBe('2027-03-28T06:00:00.000Z');
    expect(w.durationMinutes).toBe(480);
  });

  it('works the same without a stored duration', () => {
    const w = resolveSlotVisitWindow(
      new Date('2026-10-24T00:00:00.000Z'),
      { plannedStartTime: '22:00', plannedEndTime: '07:00' },
      tz,
    );
    expect(hours(w)).toBe(10);
  });

  it('keeps a duration that does not match the times', () => {
    const w = resolveSlotVisitWindow(
      new Date('2026-10-24T00:00:00.000Z'),
      { plannedStartTime: '22:00', plannedEndTime: '07:00', durationMinutes: 60 },
      tz,
    );
    expect(w.end.toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });

  it('day visits are unchanged', () => {
    const w = resolveSlotVisitWindow(
      new Date('2026-10-25T00:00:00.000Z'),
      { plannedStartTime: '09:00', plannedEndTime: '10:00', durationMinutes: 60 },
      tz,
    );
    expect(w.start.toISOString()).toBe('2026-10-25T09:00:00.000Z');
    expect(w.durationMinutes).toBe(60);
  });

  it('a carer with their own end time also ends at the clock time', () => {
    const [carer] = resolveCarerWindows(
      new Date('2026-10-24T00:00:00.000Z'),
      night,
      [{ employeeId: 'e1', role: 'LEAD', plannedStartTime: '22:00', plannedEndTime: '07:00', sortOrder: 0 }],
      tz,
    );
    expect(carer.end.toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });

  it('rescheduling to 22:00-07:00 on the clock-change night ends at 07:00', () => {
    const { end } = resolveOperationalStartEnd(new Date('2026-10-24T21:00:00.000Z'), '22:00', '07:00', tz);
    expect(end.toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });

  it('wallClockVisitEnd keeps same-day ends on the same day', () => {
    expect(wallClockVisitEnd('2026-10-25', '09:00', '10:00', tz).toISOString()).toBe('2026-10-25T10:00:00.000Z');
  });
});
