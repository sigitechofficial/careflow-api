import { Prisma } from '@prisma/client';
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '../organisation-general-settings/review-settings.util';
import { ComplianceExpiryRemindersService } from './compliance-expiry-reminders.service';

const NOW = new Date('2026-11-05T09:00:00Z');

function record(id: string, expiryIso: string, supervisorId: string | null = 'sup-1') {
  return {
    id,
    employeeId: `emp-${id}`,
    expiryDate: new Date(`${expiryIso}T00:00:00Z`),
    complianceType: { name: 'DBS', code: 'DBS' },
    employee: {
      personalDetail: { firstName: 'Ann', lastName: 'Lee', username: null },
      employment: {
        employeeNumber: '42',
        locationId: 'loc-1',
        baseLocationId: null,
        supervisor: supervisorId ? { id: supervisorId, isActive: true, deletedAt: null } : null,
      },
    },
  };
}

function setup(opts: { records: ReturnType<typeof record>[]; settings?: Partial<ReviewSettings>; claimed?: Set<string> }) {
  const claimed = opts.claimed ?? new Set<string>();
  const reminders: Array<{ id: string; data: Record<string, unknown> }> = [];
  const prisma = {
    employeeCompliance: { findMany: jest.fn().mockResolvedValue(opts.records) },
    complianceReminder: {
      create: jest.fn(({ data }: { data: { employeeComplianceId: string; reminderType: string; dueDate: Date } }) => {
        const key = `${data.employeeComplianceId}:${data.reminderType}:${data.dueDate.toISOString()}`;
        if (claimed.has(key)) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' }),
          );
        }
        claimed.add(key);
        const id = `rem-${reminders.length + 1}`;
        reminders.push({ id, data });
        return Promise.resolve({ id });
      }),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    role: { findMany: jest.fn().mockResolvedValue([]) },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
    notificationPreference: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const orgSettings = {
    getReviewSettings: jest.fn().mockResolvedValue({ ...DEFAULT_REVIEW_SETTINGS, ...opts.settings }),
    getOperationalTimezone: jest.fn().mockResolvedValue('Europe/London'),
  };
  const compliance = { runDailyComplianceCheck: jest.fn().mockResolvedValue({ updated: 2 }) };
  const notifications = { notifyUsers: jest.fn().mockResolvedValue(undefined) };
  const push = { sendToEmployees: jest.fn().mockResolvedValue({ sent: 1 }) };
  const config = { get: jest.fn().mockReturnValue('') };
  const service = new ComplianceExpiryRemindersService(
    prisma as never,
    orgSettings as never,
    compliance as never,
    notifications as never,
    config as never,
    push as never,
  );
  return { service, prisma, notifications, push, compliance, claimed, reminders };
}

describe('ComplianceExpiryRemindersService', () => {
  it('sends the latest stage crossed to the supervisor and the employee, once', async () => {
    const t = setup({ records: [record('a', '2026-11-25'), record('b', '2027-06-01'), record('c', '2026-11-01')] });
    const summary = await t.service.sendExpiryReminders(NOW);
    expect(summary).toMatchObject({ recordsChecked: 3, sent: 2, alreadySent: 0, statusesUpdated: 2 });
    expect(t.reminders.map((r) => r.data.reminderType)).toEqual(['EXPIRY_30_DAYS', 'EXPIRED']);
    expect(t.notifications.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: ['sup-1'], type: 'COMPLIANCE_EXPIRING', recordId: 'a' }),
    );
    expect(t.notifications.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'COMPLIANCE_EXPIRED', recordId: 'c' }),
    );
    expect(t.push.sendToEmployees).toHaveBeenCalledWith(['emp-a'], expect.any(Object), 'compliance-reminders');
    expect(t.prisma.complianceReminder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }),
    );

    // The next hourly run finds them already claimed.
    const again = setup({ records: [record('a', '2026-11-25'), record('c', '2026-11-01')], claimed: t.claimed });
    const second = await again.service.sendExpiryReminders(NOW);
    expect(second).toMatchObject({ sent: 0, alreadySent: 2 });
    expect(again.notifications.notifyUsers).not.toHaveBeenCalled();
  });

  it('only sends the enabled stages', async () => {
    const t = setup({
      records: [record('a', '2026-11-25'), record('c', '2026-11-01')],
      settings: { complianceReminderStages: ['EXPIRY_7_DAYS'] },
    });
    const summary = await t.service.sendExpiryReminders(NOW);
    expect(summary.sent).toBe(0);
    expect(t.prisma.complianceReminder.create).not.toHaveBeenCalled();
  });

  it('releases the claim when nothing could be delivered, so the next run retries', async () => {
    const t = setup({
      records: [record('a', '2026-11-25')],
      settings: { complianceNotifyEmployee: true },
    });
    t.notifications.notifyUsers.mockRejectedValue(new Error('socket down'));
    t.push.sendToEmployees.mockResolvedValue({ sent: 0 });
    const summary = await t.service.sendExpiryReminders(NOW);
    expect(summary).toMatchObject({ sent: 0, failed: 1 });
    expect(t.prisma.complianceReminder.delete).toHaveBeenCalledWith({ where: { id: 'rem-1' } });
  });

  it('counts records with nobody to tell', async () => {
    const t = setup({
      records: [record('a', '2026-11-25', null)],
      settings: { complianceNotifyEmployee: false },
    });
    const summary = await t.service.sendExpiryReminders(NOW);
    expect(summary).toMatchObject({ sent: 0, noRecipients: 1 });
  });
});
