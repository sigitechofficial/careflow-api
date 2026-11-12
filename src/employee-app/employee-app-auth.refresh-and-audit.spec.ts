import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { EmployeeAppAuthService } from './employee-app-auth.service';
import { hashRefreshToken } from '../common/utils/refresh-token-hash.util';
import { SignInSessionsService } from '../auth/sign-in-sessions/sign-in-sessions.service';
import { fakeSignInPrisma } from '../auth/sign-in-sessions/sign-in-sessions.testing';

const PASSWORD = 'Correct#Horse9';

describe('EmployeeAppAuthService — refresh-token revocation and failed-login audit', () => {
  const account = {
    id: 'acct-1',
    employeeId: 'emp-1',
    email: 'carer@example.com',
    passwordHash: 'unused',
    isEnabled: true,
    deletedAt: null,
    refreshTokenHash: null as string | null,
    lastLoginAt: null,
    lastSeenAt: null,
    employee: {
      id: 'emp-1',
      deletedAt: null,
      isActive: true,
      personalDetail: { firstName: 'Amir', lastName: 'Khan', photoUrl: null },
    },
  };
  const settings: Record<string, string> = {
    JWT_REFRESH_TOKEN_SECRET: 'test-refresh-secret',
    JWT_REFRESH_TOKEN_EXPIRES_IN: '7d',
  };
  const config = {
    get: (key: string, def?: unknown) => settings[key] ?? def,
  } as unknown as ConfigService;
  const auditLogs = {
    getRequestMeta: jest
      .fn()
      .mockReturnValue({ ipAddress: '2.2.2.2', userAgent: 'Dart' }),
    logSecurityEvent: jest.fn(),
    logLogin: jest.fn(),
    logAudit: jest.fn(),
    logFailedLogin: jest.fn(),
  };
  const portalAccounts = {
    findByEmailForLogin: jest.fn((email: string) =>
      email.trim().toLowerCase() === account.email ? account : null,
    ),
    assertLoginable: jest.fn(),
    verifyPassword: jest.fn(
      (_row: unknown, plain: string) => plain === PASSWORD,
    ),
    setRefreshTokenHash: jest.fn((_id: string, h: string) => {
      account.refreshTokenHash = h;
    }),
    activateSession: jest.fn(),
    touchLastSeen: jest.fn(),
    clearRefreshToken: jest.fn(() => {
      account.refreshTokenHash = null;
    }),
    findForRefresh: jest.fn((id: string) =>
      id === account.id ? account : null,
    ),
  };
  const fcm = {
    areEmployeePushTokensDead: jest.fn().mockResolvedValue(true),
    deleteToken: jest.fn(),
  };
  const orgSettings = {
    isSingleDeviceLoginCareApp: jest.fn().mockResolvedValue(false),
  };
  const req = {} as never;
  let service: EmployeeAppAuthService;
  let db: ReturnType<typeof fakeSignInPrisma>;
  const sessionOf = (token: string) => (new JwtService({}).decode(token) as { sid: string }).sid;

  beforeEach(() => {
    jest.clearAllMocks();
    account.refreshTokenHash = null;
    db = fakeSignInPrisma();
    service = new EmployeeAppAuthService(
      new JwtService({
        secret: 'test-access-secret',
        signOptions: { expiresIn: '15m' },
      }),
      config,
      auditLogs as never,
      portalAccounts as never,
      fcm as never,
      orgSettings as never,
      {} as never,
      new SignInSessionsService(db as never),
    );
  });

  async function login() {
    const res = await service.login(
      { email: account.email, password: PASSWORD },
      req,
    );
    return res.data.refreshToken;
  }

  it('each phone keeps its own token; renewal rotates it; logout signs out that phone only', async () => {
    const r1 = await login();
    const r2 = await login();
    expect(db.rows.find((r) => r.id === sessionOf(r2))?.refreshTokenHash).toBe(hashRefreshToken(r2));

    const refreshed = await service.refresh({ refreshToken: r2 }, req);
    const r3 = refreshed.data.refreshToken;
    // Rotation: the token just used is no longer valid.
    await expect(service.refresh({ refreshToken: r2 }, req)).rejects.toBeInstanceOf(UnauthorizedException);

    await service.logout(
      { id: account.id, email: account.email, employeeId: 'emp-1', sessionId: sessionOf(r3) } as never,
      req,
    );
    await expect(
      service.refresh({ refreshToken: r3 }, req),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // The other phone is still signed in.
    await expect(service.refresh({ refreshToken: r1 }, req)).resolves.toMatchObject({ message: 'Token refreshed' });
  });

  it('bad password → Invalid credentials and a failed-login event without the password', async () => {
    await expect(
      service.login({ email: account.email, password: 'Wrong#Battery7' }, req),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    expect(auditLogs.logFailedLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'employee_app',
        reason: 'bad_password',
        identifier: account.email,
        recordId: account.id,
      }),
    );
    expect(JSON.stringify(auditLogs.logFailedLogin.mock.calls)).not.toContain(
      'Wrong#Battery7',
    );
  });

  it('unknown and inactive accounts give the same response with their own reason', async () => {
    await expect(
      service.login(
        { email: 'ghost@example.com', password: 'Wrong#Battery7' },
        req,
      ),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    expect(auditLogs.logFailedLogin).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reason: 'unknown_user',
        identifier: 'ghost@example.com',
      }),
    );

    portalAccounts.assertLoginable.mockImplementationOnce(() => {
      throw new UnauthorizedException('disabled');
    });
    await expect(
      service.login({ email: account.email, password: PASSWORD }, req),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    expect(auditLogs.logFailedLogin).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'inactive' }),
    );
    expect(JSON.stringify(auditLogs.logFailedLogin.mock.calls)).not.toContain(
      PASSWORD,
    );
  });
});
