import { OFFICE_TEST_ALERTS, OfficeTestAlertsService } from './office-test-alerts.service';

const job = {
  id: 'job-1',
  jobName: 'Morning — Ann',
  serviceUserId: 'su-1',
  scheduledStartDateTime: new Date('2026-11-11T08:00:00Z'),
  serviceUser: { firstName: 'Ann', lastName: 'Lee', preferredName: null },
  allocations: [{ employeeId: 'emp-1', isLeadCarer: true, actualStartDateTime: new Date(), actualEndDateTime: null }],
};

function make() {
  const prisma = {
    scheduledJob: { findFirst: jest.fn().mockResolvedValue(job) },
    ecmException: { create: jest.fn().mockImplementation(({ data }) => ({ id: `ex-${data.kind}`, ...data })), deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
  };
  const alerts = { applySlaAndAlert: jest.fn() };
  const notifications = { notifyUsers: jest.fn() };
  return { prisma, alerts, notifications, svc: new OfficeTestAlertsService(prisma as never, alerts as never, notifications as never) };
}

describe('test office alerts', () => {
  it('raises an SOS as a real visit exception, marked [TEST], to the person who asked only', async () => {
    const t = make();
    const r = await t.svc.trigger('user-1', ['CARER_SOS'], undefined);
    expect(t.prisma.ecmException.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scheduledJobId: 'job-1', kind: 'CARER_SOS', title: '[TEST] Carer SOS', context: expect.objectContaining({ test: true, employeeId: 'emp-1' }) }),
    });
    expect(t.alerts.applySlaAndAlert).toHaveBeenCalledWith({ exceptionId: 'ex-CARER_SOS', criticality: 'TIME_CRITICAL', recipientUserIds: ['user-1'] });
    expect(r.data.raised).toEqual(['Carer SOS']);
  });

  it('sends medication and late-visit alerts as the real notifications, with a link and the test mark', async () => {
    const t = make();
    await t.svc.trigger('user-1', ['MED_MISSED', 'LATE_START'], undefined);
    // In catalogue order: the late visit comes before medication.
    const calls = t.notifications.notifyUsers.mock.calls.map((c) => c[0]);
    expect(calls[1]).toMatchObject({
      recipientUserIds: ['user-1'],
      type: 'MEDICATION_ALERT',
      title: '[TEST] Medication missed — Ann Lee',
      metadata: expect.objectContaining({ test: true, href: '/medication/exceptions' }),
    });
    expect(calls[0]).toMatchObject({ recordType: 'ScheduledJob', recordId: 'job-1', metadata: expect.objectContaining({ test: true, href: expect.stringContaining('jobId=job-1') }) });
  });

  it('refuses an empty choice and removes all test alerts on request', async () => {
    const t = make();
    await expect(t.svc.trigger('user-1', ['NOPE'], undefined)).rejects.toThrow(/Choose at least one/);
    const r = await t.svc.clear('user-1');
    expect(t.prisma.ecmException.deleteMany).toHaveBeenCalledWith({ where: { context: { path: ['test'], equals: true } } });
    expect(r.data).toMatchObject({ removedExceptions: 2, removedNotifications: 3 });
  });

  it('lists every alert once', () => {
    const keys = OFFICE_TEST_ALERTS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(OFFICE_TEST_ALERTS.every((a) => Boolean(a.ecm) !== Boolean(a.notification))).toBe(true);
  });
});
