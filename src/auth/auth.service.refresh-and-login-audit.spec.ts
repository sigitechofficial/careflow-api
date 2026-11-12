import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { hashRefreshToken } from '../common/utils/refresh-token-hash.util';
import { SignInSessionsService, endAllSignInSessions } from './sign-in-sessions/sign-in-sessions.service';
import { fakeSignInPrisma } from './sign-in-sessions/sign-in-sessions.testing';

const PASSWORD = 'Correct#Horse9';
const WRONG_PASSWORD = 'Wrong#Battery7';

describe('AuthService (staff) — refresh-token revocation and failed-login audit', () => {
  let user: {
    id: string;
    email: string;
    passwordHash: string;
    refreshTokenHash: string | null;
    isActive: boolean;
  };
  let service: AuthService;
  let db: ReturnType<typeof fakeSignInPrisma>;
  const req = {} as never;
  /** The signed-in device a token belongs to (as the JWT strategy puts it on the request). */
  const sessionOf = (token: string) => (new JwtService({}).decode(token) as { sid: string }).sid;

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
      .mockReturnValue({ ipAddress: '2.2.2.2', userAgent: 'jest' }),
    logLogin: jest.fn(),
    logAudit: jest.fn(),
    logSecurityEvent: jest.fn(),
    logFailedLogin: jest.fn(),
  };

  const usersService = {
    findActiveByEmail: jest.fn((email: string) =>
      Promise.resolve(email === user.email && user.isActive ? user : null),
    ),
    findByEmail: jest.fn((email: string) =>
      Promise.resolve(email === user.email ? user : null),
    ),
    findById: jest.fn((id: string) =>
      Promise.resolve(id === user.id ? user : null),
    ),
    setRefreshTokenHash: jest.fn((_id: string, h: string) => {
      user.refreshTokenHash = h;
    }),
    clearRefreshToken: jest.fn(() => {
      user.refreshTokenHash = null;
    }),
    updatePassword: jest.fn(async (_id: string, passwordHash: string) => {
      user.passwordHash = passwordHash;
      user.refreshTokenHash = null;
      await endAllSignInSessions(db, 'USER', user.id, 'PASSWORD_CHANGED');
    }),
  };

  beforeAll(async () => {
    user = {
      id: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
      email: 'nurse@example.com',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      refreshTokenHash: null,
      isActive: true,
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    user.refreshTokenHash = null;
    user.isActive = true;
    db = fakeSignInPrisma();
    service = new AuthService(
      usersService as never,
      new JwtService({
        secret: 'test-access-secret',
        signOptions: { expiresIn: '15m' },
      }),
      config,
      auditLogs as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new SignInSessionsService(db as never),
    );
  });

  async function login() {
    const res = await service.login(
      { email: user.email, password: PASSWORD },
      req,
    );
    return res.data.refreshToken;
  }

  describe('refresh token revocation', () => {
    it("stores a SHA-256 digest of the full refresh token, on this device's own sign-in", async () => {
      const r = await login();
      const row = db.rows.find((x) => x.id === sessionOf(r))!;
      expect(row).toMatchObject({ kind: 'USER', accountId: user.id, refreshTokenHash: hashRefreshToken(r), ipAddress: '2.2.2.2', userAgent: 'jest' });
      expect(row.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('signing in on a second device does not sign out the first; each device rotates its own token', async () => {
      const r1 = await login();
      const r2 = await login();
      expect(sessionOf(r1)).not.toBe(sessionOf(r2));

      const a = await service.refresh({ refreshToken: r1 }, req);
      const b = await service.refresh({ refreshToken: r2 }, req);
      expect([a.message, b.message]).toEqual(['Token refreshed', 'Token refreshed']);
      // Rotation: the token just used is no longer valid, on either device.
      await expect(service.refresh({ refreshToken: r1 }, req)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.refresh({ refreshToken: r2 }, req)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.refresh({ refreshToken: a.data.refreshToken }, req)).resolves.toMatchObject({ message: 'Token refreshed' });
    });

    it('two renewals racing with the same token: only one wins', async () => {
      const r = await login();
      const results = await Promise.allSettled([service.refresh({ refreshToken: r }, req), service.refresh({ refreshToken: r }, req)]);
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    });

    it('office device limit: signing in over it signs the oldest device out, with the reason', async () => {
      db.settings.officeMaxDevices = 2;
      const r1 = await login();
      const r2 = await login();
      const r3 = await login();
      await expect(service.refresh({ refreshToken: r1 }, req)).rejects.toThrow(/signed in on another device/);
      await expect(service.refresh({ refreshToken: r2 }, req)).resolves.toMatchObject({ message: 'Token refreshed' });
      await expect(service.refresh({ refreshToken: r3 }, req)).resolves.toMatchObject({ message: 'Token refreshed' });
    });

    it('one device only: the second sign-in signs the first out', async () => {
      db.settings.officeMultipleDeviceLogin = false;
      const r1 = await login();
      const r2 = await login();
      await expect(service.refresh({ refreshToken: r1 }, req)).rejects.toThrow(/signed in on another device/);
      await expect(service.refresh({ refreshToken: r2 }, req)).resolves.toMatchObject({ message: 'Token refreshed' });
    });

    it('logout signs out this device only', async () => {
      const r = await login();
      const other = await login();
      await service.logout({ id: user.id, accountKind: 'staff', sessionId: sessionOf(r) } as never, req);
      await expect(service.refresh({ refreshToken: r }, req)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.refresh({ refreshToken: other }, req)).resolves.toMatchObject({ message: 'Token refreshed' });
    });

    it('a token from before per-device sign-ins still renews once, onto a sign-in of its own', async () => {
      const legacy = await new JwtService({}).signAsync({ sub: user.id }, { secret: 'test-refresh-secret', expiresIn: '7d', jwtid: 'legacy-1' });
      user.refreshTokenHash = hashRefreshToken(legacy);
      const res = await service.refresh({ refreshToken: legacy }, req);
      expect(sessionOf(res.data.refreshToken)).toBeTruthy();
      expect(user.refreshTokenHash).toBeNull();
      await expect(service.refresh({ refreshToken: legacy }, req)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects the refresh token after change-password', async () => {
      const r = await login();
      await service.changePassword(
        user.id,
        { currentPassword: PASSWORD, newPassword: PASSWORD },
        req,
      );
      await expect(
        service.refresh({ refreshToken: r }, req),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a legacy bcrypt-stored hash (forces one re-login)', async () => {
      const legacy = await new JwtService({}).signAsync({ sub: user.id }, { secret: 'test-refresh-secret', expiresIn: '7d', jwtid: 'legacy-2' });
      user.refreshTokenHash = await bcrypt.hash(legacy, 4);
      await expect(
        service.refresh({ refreshToken: legacy }, req),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('failed-login audit', () => {
    function allAuditPayloads() {
      return JSON.stringify([
        auditLogs.logFailedLogin.mock.calls,
        auditLogs.logLogin.mock.calls,
        auditLogs.logAudit.mock.calls,
        auditLogs.logSecurityEvent.mock.calls,
      ]);
    }

    async function expectInvalidCredentials(email: string, password: string) {
      const err = await service.login({ email, password }, req).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getStatus()).toBe(401);
      expect((err as UnauthorizedException).message).toBe(
        'Invalid credentials',
      );
    }

    it.each([
      ['unknown_user', 'nobody@example.com', PASSWORD, false],
      ['bad_password', 'nurse@example.com', WRONG_PASSWORD, false],
      ['inactive', 'nurse@example.com', PASSWORD, true],
    ])(
      '%s → same 401 response and a LOGIN_FAILED event without the password',
      async (reason, email, password, inactive) => {
        user.isActive = !inactive;
        await expectInvalidCredentials(email, password);

        expect(auditLogs.logFailedLogin).toHaveBeenCalledTimes(1);
        const [arg] = auditLogs.logFailedLogin.mock.calls[0] as [unknown];
        expect(arg).toMatchObject({
          channel: 'staff',
          reason,
          identifier: email,
          recordType: 'User',
          ipAddress: '2.2.2.2',
          userAgent: 'jest',
        });
        expect(allAuditPayloads()).not.toContain(password);
        expect(auditLogs.logAudit).not.toHaveBeenCalled();
        expect(db.rows).toHaveLength(0);
      },
    );

    it('success path is unchanged (login_success history + LOGIN_SUCCESS audit, no failure event)', async () => {
      await login();
      expect(auditLogs.logFailedLogin).not.toHaveBeenCalled();
      expect(auditLogs.logLogin).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, event: 'login_success' }),
      );
      expect(auditLogs.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LOGIN_SUCCESS,
          recordId: user.id,
        }),
      );
      expect(allAuditPayloads()).not.toContain(PASSWORD);
    });
  });
});
