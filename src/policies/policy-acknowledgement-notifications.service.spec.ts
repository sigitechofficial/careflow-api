import { Logger } from '@nestjs/common';
import { NotificationType, PolicyAcknowledgementStatus, PolicyStatus } from '@prisma/client';
import type { FcmPushService } from '../notifications/fcm-push.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import { PolicyAcknowledgementNotificationsService } from './policy-acknowledgement-notifications.service';
import { isoWeekKey } from './policy-acknowledgement-reminder.util';
import { daysAgo, seed, type Row } from './policy-acknowledgements.fake';

function setup(options: { pushFails?: boolean; managers?: Record<string, string[] | null> } = {}) {
  const fake = seed();
  const { store, prisma, service: acknowledgements } = fake;
  // Anna acknowledged v1.0 of POL-1 (carry-over to the current v1.1).
  store.acks.push({
    id: 'anna-v1-0',
    versionId: 'v1-0',
    employeeId: 'emp-anna',
    status: PolicyAcknowledgementStatus.ACKNOWLEDGED,
    viewedAt: daysAgo(29),
    acknowledgedAt: daysAgo(29),
    metadata: null,
    updatedAt: daysAgo(29),
  });

  const managers = options.managers ?? {};
  store.managerUserIds = Object.keys(managers);
  const notifyUsers = jest.fn(async (params: Row) => {
    store.notifications.push({
      type: params.type,
      metadata: params.metadata,
      recipients: params.recipientUserIds.map((userId: string) => ({ userId })),
    });
    return {};
  });
  const sendToEmployees = jest.fn(async (employeeIds: string[], _payload: { title: string; body: string; data?: Record<string, string> }) => {
    if (options.pushFails) throw new Error('FCM down');
    return { sent: employeeIds.length };
  });
  const users = {
    getAuthContext: jest.fn(async (id: string) => ({
      id,
      roles: ['Manager'],
      permissions: ['policies.acknowledgements.manage'],
      assignedLocationIds: managers[id] ?? null,
    })),
  };
  const orgSettings = { getOperationalTimezone: jest.fn(async () => 'Europe/London') };

  const service = new PolicyAcknowledgementNotificationsService(
    prisma as unknown as PrismaService,
    acknowledgements,
    { notifyUsers } as unknown as NotificationsService,
    orgSettings as unknown as OrganisationGeneralSettingsService,
    users as unknown as UsersService,
    { sendToEmployees } as unknown as FcmPushService,
  );
  return { ...fake, service, notifyUsers, sendToEmployees };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('PolicyAcknowledgementNotificationsService — on publish', () => {
  it('creates PENDING rows only for staff who still need to acknowledge (minor-version carry-over respected)', async () => {
    const { service, store, sendToEmployees, notifyUsers } = setup();
    const summary = await service.onVersionPublished('doc-1', 'v1-1');

    // Carers only: Anna is covered by her v1.0 acknowledgement, so only Ben.
    expect(summary).toMatchObject({ staff: 1, rowsCreated: 1, pushed: 1, webNotified: 0 });
    const rows = store.acks.filter((a) => a.versionId === 'v1-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employeeId: 'emp-ben', status: PolicyAcknowledgementStatus.PENDING });
    expect(rows[0]!.metadata).toMatchObject({ notifiedAt: expect.any(String), reminders: {} });

    expect(sendToEmployees).toHaveBeenCalledWith(['emp-ben'], {
      title: 'New policy to read: Safeguarding',
      body: expect.stringMatching(/^Please read and acknowledge POL-1 \(v1\.1\) by \d+ \w+ \d{4}\.$/),
      data: { type: 'POLICY_ACKNOWLEDGEMENT', documentId: 'doc-1' },
    });
    // Ben has no web account.
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it('sends a web notification to staff with a linked user account', async () => {
    const { service, notifyUsers, sendToEmployees } = setup();
    const summary = await service.onVersionPublished('doc-2', 'v2-0');
    expect(summary).toMatchObject({ staff: 3, rowsCreated: 3, webNotified: 1 });
    expect(sendToEmployees.mock.calls[0]![0]).toEqual(expect.arrayContaining(['emp-anna', 'emp-ben', 'emp-cara']));
    expect(notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: ['user-Cara@care.test'],
        type: NotificationType.POLICY_ACKNOWLEDGEMENT_DUE,
        title: 'New policy to read: Infection control',
        metadata: expect.objectContaining({ href: '/policies/doc-2', documentId: 'doc-2' }),
      }),
    );
  });

  it('does not create rows or notify twice', async () => {
    const { service, store, sendToEmployees } = setup();
    await service.onVersionPublished('doc-2', 'v2-0');
    const again = await service.onVersionPublished('doc-2', 'v2-0');
    expect(again.rowsCreated).toBe(0);
    expect(store.acks.filter((a) => a.versionId === 'v2-0')).toHaveLength(3);
    expect(sendToEmployees).toHaveBeenCalledTimes(1);
  });

  it('still creates rows and notifies the web when the push fails', async () => {
    const { service, store, notifyUsers } = setup({ pushFails: true });
    await expect(service.onVersionPublished('doc-2', 'v2-0')).resolves.toMatchObject({ rowsCreated: 3, pushed: 0 });
    expect(store.acks.filter((a) => a.versionId === 'v2-0')).toHaveLength(3);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a policy that does not need acknowledging', async () => {
    const { service, sendToEmployees } = setup();
    await expect(service.onVersionPublished('doc-3', 'v3-0')).resolves.toMatchObject({ staff: 0, rowsCreated: 0 });
    expect(sendToEmployees).not.toHaveBeenCalled();
  });
});

describe('PolicyAcknowledgementNotificationsService — daily reminders', () => {
  it('sends each reminder once (claimed in the row metadata) and stops after acknowledging', async () => {
    const { service, store, sendToEmployees } = setup();
    // POL-1's clock started with v1.0, 30 days ago: due 16 days ago → OVERDUE_15 for Ben.
    const first = await service.sendDueReminders();
    expect(first.sent).toBe(1);
    expect(sendToEmployees).toHaveBeenCalledTimes(1);
    expect(sendToEmployees).toHaveBeenCalledWith(['emp-ben'], {
      title: 'Policy overdue: Safeguarding',
      body: expect.stringContaining('overdue by 16 days'),
      data: { type: 'POLICY_ACKNOWLEDGEMENT', documentId: 'doc-1' },
    });
    // The job creates the row for staff who did not have one yet.
    const row = store.acks.find((a) => a.versionId === 'v1-1' && a.employeeId === 'emp-ben')!;
    expect(row.metadata.reminders.OVERDUE_15).toMatchObject({ pushed: true, notified: false });

    const second = await service.sendDueReminders();
    expect(second.sent).toBe(0);
    expect(second.alreadySent).toBe(1);
    expect(sendToEmployees).toHaveBeenCalledTimes(1);

    Object.assign(row, { status: PolicyAcknowledgementStatus.ACKNOWLEDGED, acknowledgedAt: new Date() });
    const third = await service.sendDueReminders();
    expect(third.outstanding).toBe(3); // POL-2 for Anna, Ben and Cara (not yet due)
    expect(third.alreadySent).toBe(0);
    expect(sendToEmployees).toHaveBeenCalledTimes(1);
  });

  it('reminds 3 days before the due date, through the existing row', async () => {
    const { service, store, sendToEmployees, notifyUsers } = setup();
    // POL-2 published 12 days ago: due in 2 days.
    store.versions.find((v) => v.id === 'v2-0')!.publishedAt = daysAgo(12);
    await service.onVersionPublished('doc-2', 'v2-0');
    sendToEmployees.mockClear();
    notifyUsers.mockClear();

    const run = await service.sendDueReminders();
    const pol2Push = sendToEmployees.mock.calls.find((call) => call[1].data?.documentId === 'doc-2');
    expect(pol2Push).toBeDefined();
    expect(pol2Push![1]).toMatchObject({ title: 'Policy to read: Infection control' });
    expect(pol2Push![1].body).toContain('due in 2 days');
    expect(notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: ['user-Cara@care.test'], metadata: expect.objectContaining({ reminderKind: 'DUE_IN_3' }) }),
    );
    expect(run.sent).toBe(4); // three for POL-2, Ben's overdue POL-1
    const caraRow = store.acks.find((a) => a.versionId === 'v2-0' && a.employeeId === 'emp-cara')!;
    expect(caraRow.metadata).toMatchObject({ notifiedAt: expect.any(String) });
    expect(caraRow.metadata.reminders.DUE_IN_3).toMatchObject({ notified: true });
  });

  it('releases the claim when every channel fails, so the next run retries', async () => {
    const { service, store } = setup({ pushFails: true });
    const run = await service.sendDueReminders();
    expect(run.failed).toBe(1);
    const row = store.acks.find((a) => a.versionId === 'v1-1' && a.employeeId === 'emp-ben')!;
    expect(row.metadata.reminders.OVERDUE_15).toBeUndefined();
  });
});

describe('PolicyAcknowledgementNotificationsService — weekly manager summary', () => {
  it('sends overdue counts per policy within each manager’s branches, once a week', async () => {
    const { service, notifyUsers, store } = setup({
      managers: { 'mgr-all': null, 'mgr-b': ['loc-b'], 'mgr-a': ['loc-a'] },
    });
    const run = await service.sendDueReminders();
    expect(run.managerSummary).toMatchObject({ notifications: 1, overdue: 1 });

    const summaryCalls = notifyUsers.mock.calls.filter(
      (call) => call[0].type === NotificationType.POLICY_ACKNOWLEDGEMENT_SUMMARY,
    );
    expect(summaryCalls).toHaveLength(1);
    // Ben (Branch B) is the only overdue carer: Branch A's manager gets nothing.
    expect(summaryCalls[0]![0]).toMatchObject({
      recipientUserIds: ['mgr-all', 'mgr-b'],
      title: 'Overdue: 1 staff member has not acknowledged POL-1',
      metadata: expect.objectContaining({
        href: '/policies/doc-1#staff-acknowledgements',
        documentId: 'doc-1',
        weekKey: isoWeekKey(run.today),
        overdue: 1,
      }),
    });
    expect(store.notifications).toHaveLength(1);

    const again = await service.sendDueReminders();
    expect(again.managerSummary).toMatchObject({ notifications: 0, alreadySent: 2 });
  });

  it('skips the summary when nothing is overdue', async () => {
    const { service, notifyUsers, store } = setup({ managers: { 'mgr-all': null } });
    store.versions.find((v) => v.id === 'v1-1')!.status = PolicyStatus.ARCHIVED;
    const run = await service.sendDueReminders();
    expect(run.managerSummary).toMatchObject({ notifications: 0, overdue: 0 });
    expect(
      notifyUsers.mock.calls.some((call) => call[0].type === NotificationType.POLICY_ACKNOWLEDGEMENT_SUMMARY),
    ).toBe(false);
  });
});
