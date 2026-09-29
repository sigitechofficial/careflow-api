import { AuditStatus } from '@prisma/client';
import { AuditLogsService } from './audit-logs.service';
import { AuditAction } from './enums/audit-action.enum';
import { SecurityEventType } from './enums/security-event.enum';

type CreateArg = { data: Record<string, unknown> };
const dataOf = (fn: jest.Mock) => (fn.mock.calls[0] as [CreateArg])[0].data;

describe('AuditLogsService.logFailedLogin', () => {
  function prismaMock(fail = false) {
    const create = () =>
      jest.fn(
        fail
          ? () => Promise.reject(new Error('db down'))
          : (a: unknown) => Promise.resolve(a),
      );
    return {
      loginHistory: { create: create() },
      securityEvent: { create: create() },
      auditLog: { create: create() },
    };
  }

  const base = {
    channel: 'staff' as const,
    reason: 'bad_password' as const,
    identifier: 'nurse@example.com',
    userId: 'user-1',
    recordType: 'User',
    recordId: 'user-1',
    description: 'Failed login — bad password',
    ipAddress: '2.2.2.2',
    userAgent: 'jest',
  };

  it('writes login history, security event and a LOGIN_FAILED audit row (no password)', async () => {
    const prisma = prismaMock();
    const service = new AuditLogsService(prisma as never);

    await service.logFailedLogin({
      ...base,
      metadata: { email: 'nurse@example.com' },
    });

    const history = dataOf(prisma.loginHistory.create);
    expect(history).toMatchObject({
      userId: 'user-1',
      email: 'nurse@example.com',
      event: 'login_failed',
      status: AuditStatus.FAILED,
      failureReason: 'Invalid password',
      ipAddress: '2.2.2.2',
      userAgent: 'jest',
    });

    const sec = dataOf(prisma.securityEvent.create);
    expect(sec).toMatchObject({
      eventType: SecurityEventType.FAILED_LOGIN,
      ipAddress: '2.2.2.2',
      metadata: {
        email: 'nurse@example.com',
        attemptedEmail: 'nurse@example.com',
        reason: 'bad_password',
        channel: 'staff',
      },
    });

    const audit = dataOf(prisma.auditLog.create);
    expect(audit).toMatchObject({
      userId: 'user-1',
      module: 'AUTH',
      action: AuditAction.LOGIN_FAILED,
      recordType: 'User',
      recordId: 'user-1',
      status: AuditStatus.FAILED,
      ipAddress: '2.2.2.2',
      userAgent: 'jest',
      metadata: {
        attemptedEmail: 'nurse@example.com',
        reason: 'bad_password',
        channel: 'staff',
      },
    });

    const everything = JSON.stringify([
      prisma.loginHistory.create.mock.calls,
      prisma.securityEvent.create.mock.calls,
      prisma.auditLog.create.mock.calls,
    ]);
    expect(everything).not.toMatch(/password"\s*:/i);
  });

  it('records usernames under attemptedUsername', async () => {
    const prisma = prismaMock();
    const service = new AuditLogsService(prisma as never);
    await service.logFailedLogin({
      ...base,
      channel: 'temporary_inspector',
      reason: 'unknown_user',
      identifier: 'inspector.jones',
      identifierType: 'username',
      userId: null,
      recordType: 'TemporaryInspector',
      recordId: null,
    });
    const audit = dataOf(prisma.auditLog.create);
    expect(audit.metadata).toEqual({
      attemptedUsername: 'inspector.jones',
      reason: 'unknown_user',
      channel: 'temporary_inspector',
    });
    expect(dataOf(prisma.loginHistory.create).failureReason).toBe(
      'Unknown user',
    );
  });

  it('never throws when the audit writes fail', async () => {
    const prisma = prismaMock(true);
    const service = new AuditLogsService(prisma as never);
    await expect(service.logFailedLogin(base)).resolves.toBeUndefined();
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});
