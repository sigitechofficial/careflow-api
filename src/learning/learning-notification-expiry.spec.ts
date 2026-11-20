import { LearningNotificationHook } from './learning-notification.hook';

function setup(alreadySent: string[] = []) {
  const prisma: any = {
    notification: {
      findFirst: jest.fn(async ({ where }: any) =>
        alreadySent.includes(where.metadata.equals) ? { id: 'n-1' } : null,
      ),
    },
    employeePortalAccount: { findMany: jest.fn().mockResolvedValue([{ email: 'c@x.test' }]) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'carer-user' }]) },
    employeePersonalDetail: { findFirst: jest.fn().mockResolvedValue({ firstName: 'Grace', lastName: 'Mensah' }) },
    organisationGeneralSettings: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const notifications = { notifyUsers: jest.fn().mockResolvedValue({}) };
  const hook = new LearningNotificationHook(prisma, notifications as any);
  jest.spyOn(hook, 'trainingManagerUserIds').mockResolvedValue(['manager-1']);
  return { prisma, notifications, hook };
}

const cert = {
  employeeId: 'e-1',
  certificateId: 'cert-1',
  certificateNumber: 'LC-1',
  expiresAt: new Date('2026-12-10T10:00:00Z'),
};

describe('Certificate expiry warnings (once each)', () => {
  it('carer: sent the first time', async () => {
    const { notifications, hook } = setup();
    await hook.notifyCertificateExpiring(cert);
    expect(notifications.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: ['carer-user'], recordId: 'cert-1' }),
    );
  });

  it('carer: not sent again on the next night', async () => {
    const { notifications, hook } = setup(['CERTIFICATE_EXPIRING']);
    await hook.notifyCertificateExpiring(cert);
    expect(notifications.notifyUsers).not.toHaveBeenCalled();
  });

  it('managers: sent to the branch training managers with the carer and course', async () => {
    const { notifications, hook } = setup(['CERTIFICATE_EXPIRING']);
    await hook.notifyManagersCertificateExpiring({ ...cert, courseTitle: 'Moving and handling' });
    expect(notifications.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: ['manager-1'],
        title: 'Carer certificate expiring',
        message: expect.stringContaining(`Grace Mensah's "Moving and handling" certificate (LC-1) expires on`),
        metadata: expect.objectContaining({ eventType: 'CERTIFICATE_EXPIRING_MANAGER' }),
      }),
    );
  });

  it('managers: not sent again', async () => {
    const { notifications, hook } = setup(['CERTIFICATE_EXPIRING_MANAGER']);
    await hook.notifyManagersCertificateExpiring({ ...cert, courseTitle: 'X' });
    expect(notifications.notifyUsers).not.toHaveBeenCalled();
  });

  it('managers: nobody to tell, nothing sent', async () => {
    const { notifications, hook } = setup();
    (hook.trainingManagerUserIds as jest.Mock).mockResolvedValue([]);
    await hook.notifyManagersCertificateExpiring({ ...cert, courseTitle: 'X' });
    expect(notifications.notifyUsers).not.toHaveBeenCalled();
  });

  it('managers: overdue course names the carer, course and due date', async () => {
    const { notifications, hook } = setup();
    await hook.notifyManagersOverdue({
      employeeId: 'e-1',
      assignmentId: 'a-1',
      courseTitle: 'Fire safety',
      dueAt: new Date('2026-11-17T10:00:00Z'),
    });
    expect(notifications.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: ['manager-1'],
        title: 'Carer training overdue',
        message: expect.stringContaining('Grace Mensah has not finished "Fire safety" (due'),
        recordId: 'a-1',
      }),
    );
  });

  it('managers: expired certificate, once', async () => {
    const first = setup();
    await first.hook.notifyManagersCertificateExpired({ ...cert, courseTitle: 'Moving and handling' });
    expect(first.notifications.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Carer certificate expired', recipientUserIds: ['manager-1'] }),
    );
    const again = setup(['CERTIFICATE_EXPIRED_MANAGER']);
    await again.hook.notifyManagersCertificateExpired({ ...cert, courseTitle: 'Moving and handling' });
    expect(again.notifications.notifyUsers).not.toHaveBeenCalled();
  });
});
