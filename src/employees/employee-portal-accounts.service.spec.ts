import { NotFoundException } from '@nestjs/common';
import { EmployeePortalAccountsService } from './employee-portal-accounts.service';

describe('EmployeePortalAccountsService session helpers', () => {
  const prisma = {
    employeePortalAccount: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
    },
    employeePersonalDetail: {
      findFirst: jest.fn(),
    },
    authSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const auditLogs = { logSecurityEvent: jest.fn() };
  let service: EmployeePortalAccountsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EmployeePortalAccountsService(prisma as never, auditLogs as never);
  });

  it('getAdminStatus reports an active session from the refresh hash', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
    prisma.employeePortalAccount.findFirst.mockResolvedValue({
      id: 'acct-1',
      email: 'carer@example.com',
      isEnabled: true,
      lastLoginAt: new Date('2026-09-15T10:00:00.000Z'),
      lastSeenAt: new Date('2026-09-15T11:00:00.000Z'),
      lastLoginUserAgent: 'Dart/3.5',
      refreshTokenHash: 'hash',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.getAdminStatus('emp-1')).resolves.toMatchObject({
      configured: true,
      hasActiveSession: true,
      lastLoginUserAgent: 'Dart/3.5',
      lastLoginAt: '2026-09-15T10:00:00.000Z',
      lastSeenAt: '2026-09-15T11:00:00.000Z',
    });
  });

  it('revokeSession clears the refresh hash and last seen', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
    prisma.employeePortalAccount.findFirst
      .mockResolvedValueOnce({ id: 'acct-1', employeeId: 'emp-1' })
      .mockResolvedValueOnce({
        id: 'acct-1',
        email: 'carer@example.com',
        isEnabled: true,
        lastLoginAt: new Date('2026-09-15T10:00:00.000Z'),
        lastSeenAt: null,
        lastLoginUserAgent: 'Dart/3.5',
        refreshTokenHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    prisma.employeePortalAccount.update.mockResolvedValue({});

    const status = await service.revokeSession('admin-1', 'emp-1');

    expect(prisma.employeePortalAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: {
        refreshTokenHash: null,
        lastSeenAt: null,
        updatedById: 'admin-1',
      },
    });
    // Every phone is signed out, and told the office did it.
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { kind: 'EMPLOYEE_APP', accountId: 'acct-1', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'ENDED_BY_OFFICE' },
    });
    expect(auditLogs.logSecurityEvent).toHaveBeenCalled();
    expect(status.hasActiveSession).toBe(false);
  });

  it('revokeSession fails when the portal account is missing', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
    prisma.employeePortalAccount.findFirst.mockResolvedValue(null);
    await expect(service.revokeSession('admin-1', 'emp-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
