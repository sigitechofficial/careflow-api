import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { EmployeeAppAuthService } from './employee-app-auth.service';
import { EMPLOYEE_APP_SESSION_BLOCK_MESSAGE } from './employee-app-single-session.util';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-refresh'),
  compare: jest.fn(),
}));

const recent = new Date('2026-09-15T11:00:00.000Z');

function loginRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acct-1',
    employeeId: 'emp-1',
    email: 'carer@example.com',
    passwordHash: 'hash',
    isEnabled: true,
    deletedAt: null,
    refreshTokenHash: null,
    lastLoginAt: null,
    lastSeenAt: null,
    employee: {
      id: 'emp-1',
      deletedAt: null,
      isActive: true,
      personalDetail: { firstName: 'Amir', lastName: 'Khan', photoUrl: null },
    },
    ...overrides,
  };
}

describe('EmployeeAppAuthService', () => {
  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('jwt'),
    verifyAsync: jest.fn(),
  };
  const config = { get: jest.fn().mockReturnValue('secret') };
  const auditLogs = {
    getRequestMeta: jest.fn().mockReturnValue({ ipAddress: '1.1.1.1', userAgent: 'Dart' }),
    logSecurityEvent: jest.fn(),
    logLogin: jest.fn(),
    logAudit: jest.fn(),
  };
  const portalAccounts = {
    findByEmailForLogin: jest.fn(),
    assertLoginable: jest.fn(),
    verifyPassword: jest.fn(),
    setRefreshTokenHash: jest.fn(),
    activateSession: jest.fn(),
    touchLastSeen: jest.fn(),
    clearRefreshToken: jest.fn(),
    findForRefresh: jest.fn(),
  };
  const fcm = { areEmployeePushTokensDead: jest.fn(), deleteToken: jest.fn() };
  const orgSettings = { isSingleDeviceLoginCareApp: jest.fn() };

  const req = {} as never;
  let service: EmployeeAppAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh');
    service = new EmployeeAppAuthService(
      jwtService as unknown as JwtService,
      config as unknown as ConfigService,
      auditLogs as never,
      portalAccounts as never,
      fcm as never,
      orgSettings as never,
      {} as never,
    );
  });

  it('issues tokens on first login', async () => {
    portalAccounts.findByEmailForLogin.mockResolvedValue(loginRow());
    portalAccounts.verifyPassword.mockResolvedValue(true);
    orgSettings.isSingleDeviceLoginCareApp.mockResolvedValue(true);
    fcm.areEmployeePushTokensDead.mockResolvedValue(false);

    const result = await service.login(
      { email: 'carer@example.com', password: 'secret12' },
      req,
    );

    expect(result.message).toBe('Login successful');
    expect(portalAccounts.setRefreshTokenHash).toHaveBeenCalled();
    expect(portalAccounts.activateSession).toHaveBeenCalledWith('acct-1', {
      ipAddress: '1.1.1.1',
      userAgent: 'Dart',
    });
  });

  it('blocks a second login while another session is live', async () => {
    portalAccounts.findByEmailForLogin.mockResolvedValue(
      loginRow({ refreshTokenHash: 'existing', lastSeenAt: recent, lastLoginAt: recent }),
    );
    portalAccounts.verifyPassword.mockResolvedValue(true);
    orgSettings.isSingleDeviceLoginCareApp.mockResolvedValue(true);
    fcm.areEmployeePushTokensDead.mockResolvedValue(false);

    await expect(
      service.login({ email: 'carer@example.com', password: 'secret12' }, req),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.login({ email: 'carer@example.com', password: 'secret12' }, req),
    ).rejects.toThrow(EMPLOYEE_APP_SESSION_BLOCK_MESSAGE);

    expect(portalAccounts.setRefreshTokenHash).not.toHaveBeenCalled();
  });

  it('allows a second login after logout (no refresh hash)', async () => {
    portalAccounts.findByEmailForLogin.mockResolvedValue(
      loginRow({ refreshTokenHash: null, lastLoginAt: recent }),
    );
    portalAccounts.verifyPassword.mockResolvedValue(true);
    orgSettings.isSingleDeviceLoginCareApp.mockResolvedValue(true);
    fcm.areEmployeePushTokensDead.mockResolvedValue(false);

    await expect(
      service.login({ email: 'carer@example.com', password: 'secret12' }, req),
    ).resolves.toMatchObject({ message: 'Login successful' });
  });

  it('allows a second login when push tokens are dead (uninstall path)', async () => {
    portalAccounts.findByEmailForLogin.mockResolvedValue(
      loginRow({ refreshTokenHash: 'existing', lastSeenAt: recent, lastLoginAt: recent }),
    );
    portalAccounts.verifyPassword.mockResolvedValue(true);
    orgSettings.isSingleDeviceLoginCareApp.mockResolvedValue(true);
    fcm.areEmployeePushTokensDead.mockResolvedValue(true);

    await expect(
      service.login({ email: 'carer@example.com', password: 'secret12' }, req),
    ).resolves.toMatchObject({ message: 'Login successful' });
  });

  it('rejects a bad password before the session check', async () => {
    portalAccounts.findByEmailForLogin.mockResolvedValue(loginRow({ refreshTokenHash: 'existing' }));
    portalAccounts.verifyPassword.mockResolvedValue(false);

    await expect(
      service.login({ email: 'carer@example.com', password: 'wrong' }, req),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(orgSettings.isSingleDeviceLoginCareApp).not.toHaveBeenCalled();
  });
});
