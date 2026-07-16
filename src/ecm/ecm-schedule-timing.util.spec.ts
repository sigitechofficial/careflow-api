import {
  deriveScheduleTimingFlags,
  suggestChangeClass,
} from './ecm-schedule-timing.util';

describe('ecm-schedule-timing.util', () => {
  const due = new Date('2026-07-16T10:00:00.000Z');

  it('flags planned change well before due', () => {
    const changedAt = new Date('2026-07-15T10:00:00.000Z');
    const flags = deriveScheduleTimingFlags(due, changedAt, due);
    expect(flags.beforeDueTime).toBe(true);
    expect(flags.lateNotice).toBe(false);
    expect(flags.retrospective).toBe(false);
    expect(suggestChangeClass(flags)).toBe('PLANNED');
  });

  it('flags late-notice within 2h of due', () => {
    const changedAt = new Date('2026-07-16T09:00:00.000Z');
    const flags = deriveScheduleTimingFlags(due, changedAt, due);
    expect(flags.lateNotice).toBe(true);
    expect(suggestChangeClass(flags)).toBe('LATE_NOTICE');
  });

  it('flags retrospective after due start', () => {
    const changedAt = new Date('2026-07-16T11:00:00.000Z');
    const flags = deriveScheduleTimingFlags(due, changedAt, due);
    expect(flags.retrospective).toBe(true);
    expect(flags.beforeDueTime).toBe(false);
    expect(suggestChangeClass(flags)).toBe('RETROSPECTIVE');
  });
});
