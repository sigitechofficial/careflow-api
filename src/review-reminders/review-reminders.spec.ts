import { Prisma } from '@prisma/client';
import {
  calendarDaysUntil,
  claimReviewReminder,
  reviewReminderKind,
} from './review-reminders';

describe('review reminders', () => {
  const today = new Date('2026-11-05T10:00:00Z');
  const due = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it('counts calendar days (UTC)', () => {
    expect(calendarDaysUntil(due('2026-11-05'), today)).toBe(0);
    expect(calendarDaysUntil(due('2026-11-12'), today)).toBe(7);
    expect(calendarDaysUntil(due('2026-11-01'), today)).toBe(-4);
  });

  it('sends one DUE_SOON per due date', () => {
    expect(reviewReminderKind('due_soon', due('2026-11-20'), today, 7)).toBe('DUE_SOON');
    expect(reviewReminderKind('ok', due('2027-01-01'), today, 7)).toBeNull();
    expect(reviewReminderKind('not_started', null, today, 7)).toBeNull();
  });

  it('repeats overdue reminders every repeatDays', () => {
    expect(reviewReminderKind('overdue', due('2026-11-04'), today, 7)).toBe('OVERDUE_0'); // 1 day
    expect(reviewReminderKind('overdue', due('2026-10-29'), today, 7)).toBe('OVERDUE_0'); // 7 days
    expect(reviewReminderKind('overdue', due('2026-10-28'), today, 7)).toBe('OVERDUE_1'); // 8 days
    expect(reviewReminderKind('overdue', due('2026-10-22'), today, 7)).toBe('OVERDUE_1'); // 14 days
    expect(reviewReminderKind('overdue', due('2026-10-21'), today, 7)).toBe('OVERDUE_2'); // 15 days
    expect(reviewReminderKind('overdue', due('2026-11-04'), today, 1)).toBe('OVERDUE_0');
    expect(reviewReminderKind('overdue', due('2026-11-03'), today, 1)).toBe('OVERDUE_1');
  });

  it('claims once: a duplicate claim returns null', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({ id: 'log-1' })
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' }),
      );
    const prisma = { reviewReminderLog: { create } } as never;
    const claim = {
      subjectType: 'ASSESSMENT' as const,
      subjectId: 'a',
      serviceUserId: 's',
      dueDate: due('2026-11-04'),
      kind: 'OVERDUE_0',
    };
    await expect(claimReviewReminder(prisma, claim)).resolves.toBe('log-1');
    await expect(claimReviewReminder(prisma, claim)).resolves.toBeNull();
  });

  it('rethrows other database errors', async () => {
    const prisma = { reviewReminderLog: { create: jest.fn().mockRejectedValue(new Error('down')) } } as never;
    await expect(
      claimReviewReminder(prisma, {
        subjectType: 'CARE_PLAN',
        subjectId: 'c',
        serviceUserId: 's',
        dueDate: due('2026-11-04'),
        kind: 'DUE_SOON',
      }),
    ).rejects.toThrow('down');
  });
});
