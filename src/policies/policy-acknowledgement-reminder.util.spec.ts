import {
  daysUntil,
  isoWeekKey,
  policyDueText,
  policyReminderDue,
  readReminderMetadata,
  reminderAlreadySent,
  withReminder,
  withoutReminder,
} from './policy-acknowledgement-reminder.util';

describe('policy acknowledgement reminder schedule', () => {
  const kindFor = (days: number) => policyReminderDue(days)?.kind ?? null;

  it('sends nothing more than 3 days before the due date', () => {
    expect(kindFor(14)).toBeNull();
    expect(kindFor(4)).toBeNull();
  });

  it('reminds 3 days before (caught up on days 2 and 1 if a run was missed)', () => {
    expect(kindFor(3)).toBe('DUE_IN_3');
    expect(kindFor(2)).toBe('DUE_IN_3');
    expect(kindFor(1)).toBe('DUE_IN_3');
  });

  it('reminds on the due date', () => {
    expect(policyReminderDue(0)).toEqual({ kind: 'DUE_TODAY', days: 0, overdue: false });
  });

  it('reminds 1 day overdue, then every 7 days while overdue', () => {
    expect(policyReminderDue(-1)).toEqual({ kind: 'OVERDUE_1', days: -1, overdue: true });
    expect(kindFor(-7)).toBe('OVERDUE_1');
    expect(kindFor(-8)).toBe('OVERDUE_8');
    expect(kindFor(-14)).toBe('OVERDUE_8');
    expect(kindFor(-15)).toBe('OVERDUE_15');
    expect(kindFor(-22)).toBe('OVERDUE_22');
    expect(kindFor(-100)).toBe('OVERDUE_99');
  });

  it('gives one distinct kind per window, so each is sent once', () => {
    const kinds = new Set<string>();
    for (let d = 10; d >= -30; d -= 1) {
      const k = kindFor(d);
      if (k) kinds.add(k);
    }
    expect([...kinds]).toEqual(['DUE_IN_3', 'DUE_TODAY', 'OVERDUE_1', 'OVERDUE_8', 'OVERDUE_15', 'OVERDUE_22', 'OVERDUE_29']);
  });

  it('counts whole days between ISO dates', () => {
    expect(daysUntil('2026-11-10', '2026-11-07')).toBe(3);
    expect(daysUntil('2026-11-07', '2026-11-07')).toBe(0);
    expect(daysUntil('2026-11-07', '2026-11-15')).toBe(-8);
    // Across the end of British Summer Time.
    expect(daysUntil('2026-10-26', '2026-10-24')).toBe(2);
  });

  it('words the due date', () => {
    expect(policyDueText(3)).toBe('due in 3 days');
    expect(policyDueText(1)).toBe('due tomorrow');
    expect(policyDueText(0)).toBe('due today');
    expect(policyDueText(-1)).toBe('overdue by 1 day');
    expect(policyDueText(-8)).toBe('overdue by 8 days');
  });

  it('keys the weekly summary by the Monday of the ISO week', () => {
    expect(isoWeekKey('2026-11-09')).toBe('2026-11-09'); // Monday
    expect(isoWeekKey('2026-11-12')).toBe('2026-11-09'); // Thursday
    expect(isoWeekKey('2026-11-15')).toBe('2026-11-09'); // Sunday
    expect(isoWeekKey('2026-11-16')).toBe('2026-11-16');
  });

  it('keeps reminder state in the acknowledgement metadata', () => {
    expect(readReminderMetadata(null)).toEqual({});
    expect(readReminderMetadata(['x'])).toEqual({});
    const base = { notifiedAt: '2026-11-01T09:00:00.000Z', reminders: {} };
    const claimed = withReminder(base, 'DUE_IN_3', { at: '2026-11-12T08:35:00.000Z' });
    expect(claimed.notifiedAt).toBe(base.notifiedAt);
    expect(reminderAlreadySent(claimed as never, 'DUE_IN_3')).toBe(true);
    expect(reminderAlreadySent(claimed as never, 'DUE_TODAY')).toBe(false);
    const released = withoutReminder(claimed as never, 'DUE_IN_3');
    expect(reminderAlreadySent(released as never, 'DUE_IN_3')).toBe(false);
    expect(released.notifiedAt).toBe(base.notifiedAt);
  });
});
