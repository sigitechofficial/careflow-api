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

  describe('sameDay uses the organisation-local calendar day', () => {
    // Visit 00:30 BST on 2026-07-16 (23:30Z on the 15th), moved to 07:00 BST, changed at 00:05 BST.
    const previousStart = new Date('2026-07-15T23:30:00.000Z');
    const newStart = new Date('2026-07-16T06:00:00.000Z');
    const changedAt = new Date('2026-07-15T23:05:00.000Z');

    it('Europe/London: all three instants are 2026-07-16 → SAME_DAY candidate', () => {
      const flags = deriveScheduleTimingFlags(previousStart, changedAt, newStart, undefined, 'Europe/London');
      expect(flags.sameDay).toBe(true);
    });

    it('UTC calendar would split them across two days', () => {
      expect(deriveScheduleTimingFlags(previousStart, changedAt, newStart).sameDay).toBe(false);
    });

    it('Asia/Karachi honoured: 2026-01-15 20:00Z and 2026-01-15 10:00Z are different PKT days', () => {
      const flags = deriveScheduleTimingFlags(
        new Date('2026-01-15T20:00:00.000Z'), // 01:00 PKT on the 16th
        new Date('2026-01-15T10:00:00.000Z'), // 15:00 PKT on the 15th
        new Date('2026-01-15T21:00:00.000Z'),
        undefined,
        'Asia/Karachi',
      );
      expect(flags.sameDay).toBe(false);
      expect(
        deriveScheduleTimingFlags(
          new Date('2026-01-15T20:00:00.000Z'),
          new Date('2026-01-15T10:00:00.000Z'),
          new Date('2026-01-15T21:00:00.000Z'),
          undefined,
          'Europe/London',
        ).sameDay,
      ).toBe(true);
    });
  });
});
