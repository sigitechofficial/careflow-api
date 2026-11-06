import { daysUntil, dueText, reminderAudience, remindersDue } from './supervision-reminder.util';

const settings = { reminderDaysBefore: [14, 7, 1, 0], reminderDaysAfter: [1, 7, 14], escalateAfterDays: 7 };

describe('supervision-reminder.util', () => {
  it('counts whole days between calendar dates', () => {
    expect(daysUntil('2026-11-18', '2026-11-04')).toBe(14);
    expect(daysUntil('2026-11-04', '2026-11-04')).toBe(0);
    expect(daysUntil('2026-11-01', '2026-11-04')).toBe(-3);
    // across the October clock change
    expect(daysUntil('2026-10-26', '2026-10-24')).toBe(2);
  });

  it('sends the latest threshold crossed before the due date', () => {
    expect(remindersDue(30, settings)).toEqual([]);
    expect(remindersDue(14, settings).map((r) => r.kind)).toEqual(['DUE_IN_14']);
    // a missed day still sends the 7-day reminder once
    expect(remindersDue(5, settings).map((r) => r.kind)).toEqual(['DUE_IN_7']);
    expect(remindersDue(1, settings).map((r) => r.kind)).toEqual(['DUE_IN_1']);
    expect(remindersDue(0, settings)).toEqual([{ kind: 'DUE_TODAY', days: 0, beforeDue: true, escalation: false }]);
  });

  it('reminds when overdue and escalates once past the escalation point', () => {
    expect(remindersDue(-1, settings).map((r) => r.kind)).toEqual(['OVERDUE_1']);
    expect(remindersDue(-3, settings).map((r) => r.kind)).toEqual(['OVERDUE_1']);
    expect(remindersDue(-7, settings).map((r) => r.kind)).toEqual(['OVERDUE_7', 'ESCALATION']);
    // long overdue: one reminder and one escalation, never one per missed offset
    expect(remindersDue(-200, settings).map((r) => r.kind)).toEqual(['OVERDUE_14', 'ESCALATION']);
  });

  it('never escalates when escalation is off', () => {
    expect(remindersDue(-30, { ...settings, escalateAfterDays: 0 }).map((r) => r.kind)).toEqual(['OVERDUE_14']);
  });

  it('describes the due date', () => {
    expect(dueText(0)).toBe('due today');
    expect(dueText(1)).toBe('due tomorrow');
    expect(dueText(7)).toBe('due in 7 days');
    expect(dueText(-1)).toBe('overdue by 1 day');
    expect(dueText(-9)).toBe('overdue by 9 days');
  });

  describe('reminderAudience', () => {
    const on = { notifySupervisor: true, notifyCarer: true, managersOnAllReminders: false };

    it('tells the named supervisor and the carer', () => {
      expect(reminderAudience({ escalation: false }, on, true)).toEqual({ supervisor: true, managers: false, carer: true });
    });

    it('falls back to branch managers when no supervisor is named', () => {
      expect(reminderAudience({ escalation: false }, on, false)).toEqual({ supervisor: false, managers: true, carer: true });
    });

    it('copies managers on every reminder when asked', () => {
      expect(reminderAudience({ escalation: false }, { ...on, managersOnAllReminders: true }, true).managers).toBe(true);
    });

    it('escalates to managers and the supervisor, not the carer', () => {
      expect(reminderAudience({ escalation: true }, { ...on, notifySupervisor: false }, true)).toEqual({
        supervisor: true,
        managers: true,
        carer: false,
      });
    });
  });
});
