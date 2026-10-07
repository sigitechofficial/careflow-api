import { RoleTaskRecurrence } from '@prisma/client';
import { roleTaskDueDates } from './role-task-schedule.util';

const base = { weekday: null, dayOfMonth: null };

describe('roleTaskDueDates', () => {
  it('one-off task is due only on its date', () => {
    const s = {
      ...base,
      recurrence: RoleTaskRecurrence.NONE,
      startDate: '2026-10-07',
    };
    expect(roleTaskDueDates(s, '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-07',
    ]);
    expect(roleTaskDueDates(s, '2026-10-08', '2026-10-31')).toEqual([]);
  });

  it('daily task never starts before its start date', () => {
    const s = {
      ...base,
      recurrence: RoleTaskRecurrence.DAILY,
      startDate: '2026-10-04',
    };
    expect(roleTaskDueDates(s, '2026-10-01', '2026-10-06')).toEqual([
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ]);
  });

  it('weekly task falls on the chosen weekday (0 = Sunday)', () => {
    const s = {
      ...base,
      recurrence: RoleTaskRecurrence.WEEKLY,
      startDate: '2026-10-01',
      weekday: 5,
    };
    expect(roleTaskDueDates(s, '2026-10-01', '2026-10-20')).toEqual([
      '2026-10-02',
      '2026-10-09',
      '2026-10-16',
    ]);
  });

  it('monthly task uses the last day in short months', () => {
    const s = {
      ...base,
      recurrence: RoleTaskRecurrence.MONTHLY,
      startDate: '2026-01-01',
      dayOfMonth: 31,
    };
    expect(roleTaskDueDates(s, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('caps the number of dates', () => {
    const s = {
      ...base,
      recurrence: RoleTaskRecurrence.DAILY,
      startDate: '2026-01-01',
    };
    expect(roleTaskDueDates(s, '2026-01-01', '2026-12-31', 10)).toHaveLength(
      10,
    );
  });
});
