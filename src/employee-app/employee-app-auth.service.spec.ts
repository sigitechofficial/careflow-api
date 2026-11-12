import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { EmployeeAppAuthService } from './employee-app-auth.service';
import { SignInSessionsService } from '../auth/sign-in-sessions/sign-in-sessions.service';
import { fakeSignInPrisma } from '../auth/sign-in-sessions/sign-in-sessions.testing';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-refresh'),
  compare: jest.fn(),
}));

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
  let n = 0;
  const jwtService = {
    // A different token each time, as real tokens are.
    signAsync: jest.fn(async () => `jwt-${++n}`),
    verifyAsync: jest.fn(),
    decode: jest.fn(() => ({ exp: Math.floor(Date.now() / 1000) + 7 * 86400 })),
  };
  const config = { get: jest.fn().mockReturnValue('secret') };
  const auditLogs = {
    getRequestMeta: jest.fn().mockReturnValue({ ipAddress: '1.1.1.1', userAgent: 'Dart' }),
    logSecurityEvent: jest.fn(),
    logLogin: jest.fn(),
    logAudit: jest.fn(),
    logFailedLogin: jest.fn(),
  };
  const portalAccounts = {
    findByEmailForLogin: jest.fn(),
    assertLoginable: jest.fn(),
    verifyPassword: jest.fn(),
    activateSession: jest.fn(),
    touchLastSeen: jest.fn(),
    clearRefreshToken: jest.fn(),
    clearLegacyRefreshToken: jest.fn(),
    findForRefresh: jest.fn(),
  };
  const fcm = { deleteToken: jest.fn() };

  const req = {} as never;
  let db: ReturnType<typeof fakeSignInPrisma>;
  let service: EmployeeAppAuthService;
  const login = () => service.login({ email: 'carer@example.com', password: 'secret12' }, req);
  const active = () => db.rows.filter((r) => !r.revokedAt);

  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh');
    portalAccounts.findByEmailForLogin.mockResolvedValue(loginRow());
    portalAccounts.verifyPassword.mockResolvedValue(true);
    db = fakeSignInPrisma();
    service = new EmployeeAppAuthService(
      jwtService as unknown as JwtService,
      config as unknown as ConfigService,
      auditLogs as never,
      portalAccounts as never,
      fcm as never,
      {} as never,
      {} as never,
      new SignInSessionsService(db as never),
    );
  });

  it('issues tokens on first login, on a sign-in of its own for this phone', async () => {
    const result = await login();
    expect(result.message).toBe('Login successful');
    expect(active()).toEqual([expect.objectContaining({ kind: 'EMPLOYEE_APP', accountId: 'acct-1', userAgent: 'Dart' })]);
    expect(portalAccounts.activateSession).toHaveBeenCalledWith('acct-1', { ipAddress: '1.1.1.1', userAgent: 'Dart' });
  });

  it('more than one phone allowed (no limit): every phone stays signed in', async () => {
    await login();
    await login();
    await login();
    expect(active()).toHaveLength(3);
  });

  it('one phone only: signing in on a second phone signs the first out, with the reason', async () => {
    db.settings.appSettingSingleDeviceLoginCareApp = true;
    await login();
    const first = db.rows[0];
    await expect(login()).resolves.toMatchObject({ message: 'Login successful' });
    expect(first).toMatchObject({ revokedReason: 'SIGNED_IN_ELSEWHERE' });
    expect(active()).toHaveLength(1);
  });

  it('a limit of 2 phones: the third sign-in signs out the oldest', async () => {
    db.settings.appSettingMaxDevicesCareApp = 2;
    await login();
    await login();
    await login();
    expect(db.rows.map((r) => r.revokedReason)).toEqual(['SIGNED_IN_ELSEWHERE', null, null]);
  });

  it('rejects a bad password: no sign-in is made', async () => {
    portalAccounts.verifyPassword.mockResolvedValue(false);
    await expect(service.login({ email: 'carer@example.com', password: 'wrong' }, req)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.rows).toHaveLength(0);
  });
});
