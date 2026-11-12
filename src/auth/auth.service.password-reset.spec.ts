import { BadRequestException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  AuthService,
  PASSWORD_RESET_COMPLETED_MESSAGE,
  PASSWORD_RESET_INVALID_MESSAGE,
  PASSWORD_RESET_REQUESTED_MESSAGE,
  hashPasswordResetToken,
} from './auth.service';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SecurityEventType } from '../audit-logs/enums/security-event.enum';
import type { UsersService } from '../users/users.service';
import type {
  AuditLogsService,
  LogSecurityEventParams,
} from '../audit-logs/audit-logs.service';
import type { TemporaryInspectorsService } from '../temporary-inspectors/temporary-inspectors.service';
import type { ServiceUserPortalAccountsService } from '../service-user-portal/service-user-portal-accounts.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MailService, SendMailInput } from '../mail/mail.service';

type FakeUser = {
  id: string;
  email: string;
  firstName: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  passwordHash: string;
  refreshTokenHash: string | null;
};
type FakeToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  requestedIp: string | null;
};
type Where = Record<string, unknown>;

/** Minimal in-memory stand-in for the Prisma calls the password reset flow makes. */
function createFakePrisma() {
  const state = { users: [] as FakeUser[], tokens: [] as FakeToken[] };
  let seq = 0;

  const matches = (row: Record<string, unknown>, where: Where) =>
    Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (
        cond !== null &&
        typeof cond === 'object' &&
        !(cond instanceof Date)
      ) {
        const c = cond as { equals?: string; mode?: string; gt?: Date };
        if (c.equals !== undefined) {
          return c.mode === 'insensitive'
            ? String(value).toLowerCase() === c.equals.toLowerCase()
            : value === c.equals;
        }
        if (c.gt !== undefined)
          return (value as Date).getTime() > c.gt.getTime();
        return false;
      }
      return value === cond;
    });

  const client = {
    state,
    user: {
      findMany: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(
          state.users
            .filter((u) => matches(u, where))
            .map((u) => ({ id: u.id, email: u.email, firstName: u.firstName })),
        ),
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Where; data: Partial<FakeUser> }) => {
          const rows = state.users.filter((u) => matches(u, where));
          rows.forEach((u) => Object.assign(u, data));
          return Promise.resolve({ count: rows.length });
        },
      ),
    },
    authSession: {
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    passwordResetToken: {
      count: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(state.tokens.filter((t) => matches(t, where)).length),
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: Omit<FakeToken, 'id' | 'createdAt' | 'usedAt'>;
        }) => {
          const row: FakeToken = {
            id: `tok-${++seq}`,
            createdAt: new Date(),
            usedAt: null,
            ...data,
          };
          state.tokens.push(row);
          return Promise.resolve(row);
        },
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Where; data: Partial<FakeToken> }) => {
          const rows = state.tokens.filter((t) => matches(t, where));
          rows.forEach((t) => Object.assign(t, data));
          return Promise.resolve({ count: rows.length });
        },
      ),
      findUnique: jest.fn(({ where }: { where: { tokenHash: string } }) => {
        const t = state.tokens.find((row) => row.tokenHash === where.tokenHash);
        if (!t) return Promise.resolve(null);
        const u = state.users.find((row) => row.id === t.userId);
        if (!u) throw new Error('orphan token');
        return Promise.resolve({
          ...t,
          user: { isActive: u.isActive, deletedAt: u.deletedAt },
        });
      }),
    },
  };
  const $transaction = jest.fn(async (arg: unknown): Promise<unknown> => {
    if (Array.isArray(arg)) return Promise.all(arg);
    const snapshot = structuredClone(state);
    try {
      return await (arg as (tx: typeof client) => Promise<unknown>)(client);
    } catch (err) {
      state.users = snapshot.users;
      state.tokens = snapshot.tokens;
      throw err;
    }
  });
  return Object.assign(client, { $transaction });
}

const req = { headers: {} } as unknown as Request;

function setup(
  env: Record<string, string | undefined> = {
    PASSWORD_RESET_URL_BASE: 'https://admin.example.test/',
  },
) {
  const prisma = createFakePrisma();
  const mail = {
    send: jest.fn((input: SendMailInput) =>
      Promise.resolve({ messageId: `m-${String(input.to)}`, mode: 'log' }),
    ),
  };
  const auditLogs = {
    getRequestMeta: jest
      .fn()
      .mockReturnValue({ ipAddress: '203.0.113.7', userAgent: 'jest' }),
    logSecurityEvent: jest.fn((params: LogSecurityEventParams) =>
      Promise.resolve(params),
    ),
    logAudit: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn((key: string) => env[key]) };
  const service = new AuthService(
    {} as UsersService,
    {} as JwtService,
    config as unknown as ConfigService,
    auditLogs as unknown as AuditLogsService,
    {} as TemporaryInspectorsService,
    {} as ServiceUserPortalAccountsService,
    prisma as unknown as PrismaService,
    mail as unknown as MailService,
    {} as never,
  );
  return { service, prisma, mail, auditLogs };
}

function addUser(
  prisma: ReturnType<typeof createFakePrisma>,
  overrides: Partial<FakeUser> = {},
): FakeUser {
  const user: FakeUser = {
    id: `user-${prisma.state.users.length + 1}`,
    email: 'Jane.Doe@Example.com',
    firstName: 'Jane',
    isActive: true,
    deletedAt: null,
    passwordHash: bcrypt.hashSync('OldPassword1!', 4),
    refreshTokenHash: 'existing-refresh-hash',
    ...overrides,
  };
  prisma.state.users.push(user);
  return user;
}

function tokenFromMail(
  mail: ReturnType<typeof setup>['mail'],
  call = 0,
): string {
  const { text } = mail.send.mock.calls[call][0] as { text: string };
  const match = text.match(/\/auth\/reset-password\?token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('no reset link in email');
  return match[1];
}

describe('AuthService password reset', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('forgotPassword', () => {
    it('returns the generic message and sends nothing for an unknown email', async () => {
      const { service, prisma, mail, auditLogs } = setup();
      addUser(prisma);
      const res = await service.forgotPassword(
        { email: 'nobody@example.com' },
        req,
      );
      expect(res).toEqual({
        message: PASSWORD_RESET_REQUESTED_MESSAGE,
        data: {},
      });
      expect(mail.send).not.toHaveBeenCalled();
      expect(prisma.state.tokens).toHaveLength(0);
      expect(auditLogs.logSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: SecurityEventType.PASSWORD_RESET_REQUESTED,
          userId: undefined,
        }),
      );
    });

    it('stores only the token hash and emails a single-use link (case-insensitive email)', async () => {
      const { service, prisma, mail } = setup();
      const user = addUser(prisma);
      const before = Date.now();
      const res = await service.forgotPassword(
        { email: 'jane.doe@example.com' },
        req,
      );
      expect(res).toEqual({
        message: PASSWORD_RESET_REQUESTED_MESSAGE,
        data: {},
      });

      expect(mail.send).toHaveBeenCalledTimes(1);
      const msg = mail.send.mock.calls[0][0] as {
        to: string;
        subject: string;
        text: string;
        html: string;
      };
      expect(msg.to).toBe(user.email);
      expect(msg.subject).toBe('Reset your Careflow password');
      const raw = tokenFromMail(mail);
      expect(Buffer.from(raw, 'base64url')).toHaveLength(32);
      expect(msg.text).toContain(
        `https://admin.example.test/auth/reset-password?token=${raw}`,
      );
      expect(msg.text).toContain('Hi Jane,');
      expect(msg.text).toContain(
        'This link expires in 60 minutes and can be used once.',
      );
      expect(msg.text).toContain(
        "If you didn't request this, you can ignore this email — your password won't change.",
      );
      expect(msg.html).toContain(
        `href="https://admin.example.test/auth/reset-password?token=${raw}"`,
      );

      expect(prisma.state.tokens).toHaveLength(1);
      const row = prisma.state.tokens[0];
      expect(row.userId).toBe(user.id);
      expect(row.tokenHash).toBe(hashPasswordResetToken(raw));
      expect(JSON.stringify(row)).not.toContain(raw);
      expect(row.usedAt).toBeNull();
      expect(row.requestedIp).toBe('203.0.113.7');
      const ttl = row.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
      expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
    });

    it('does not send for inactive or deleted users', async () => {
      const { service, prisma, mail } = setup();
      addUser(prisma, { email: 'inactive@example.com', isActive: false });
      addUser(prisma, { email: 'deleted@example.com', deletedAt: new Date() });
      await service.forgotPassword({ email: 'inactive@example.com' }, req);
      const res = await service.forgotPassword(
        { email: 'deleted@example.com' },
        req,
      );
      expect(res.message).toBe(PASSWORD_RESET_REQUESTED_MESSAGE);
      expect(mail.send).not.toHaveBeenCalled();
      expect(prisma.state.tokens).toHaveLength(0);
    });

    it('invalidates earlier unused tokens when a new one is issued', async () => {
      const { service, prisma } = setup();
      addUser(prisma);
      await service.forgotPassword({ email: 'jane.doe@example.com' }, req);
      await service.forgotPassword({ email: 'jane.doe@example.com' }, req);
      expect(prisma.state.tokens).toHaveLength(2);
      expect(prisma.state.tokens[0].usedAt).not.toBeNull();
      expect(prisma.state.tokens[1].usedAt).toBeNull();
    });

    it('caps tokens per user per hour but still returns the generic message', async () => {
      const { service, prisma, mail } = setup();
      addUser(prisma);
      for (let i = 0; i < 5; i++) {
        const res = await service.forgotPassword(
          { email: 'jane.doe@example.com' },
          req,
        );
        expect(res).toEqual({
          message: PASSWORD_RESET_REQUESTED_MESSAGE,
          data: {},
        });
      }
      expect(mail.send).toHaveBeenCalledTimes(3);
      expect(prisma.state.tokens).toHaveLength(3);
    });

    it('does not send in production when PASSWORD_RESET_URL_BASE is missing', async () => {
      const { service, prisma, mail } = setup({ NODE_ENV: 'production' });
      addUser(prisma);
      const res = await service.forgotPassword(
        { email: 'jane.doe@example.com' },
        req,
      );
      expect(res.message).toBe(PASSWORD_RESET_REQUESTED_MESSAGE);
      expect(mail.send).not.toHaveBeenCalled();
      expect(prisma.state.tokens).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('falls back to http://localhost:5173 outside production', async () => {
      const { service, prisma, mail } = setup({ NODE_ENV: 'development' });
      addUser(prisma);
      await service.forgotPassword({ email: 'jane.doe@example.com' }, req);
      expect((mail.send.mock.calls[0][0] as { text: string }).text).toContain(
        'http://localhost:5173/auth/reset-password?token=',
      );
    });

    it('does not leak email send failures to the caller', async () => {
      const { service, prisma, mail } = setup();
      addUser(prisma);
      mail.send.mockRejectedValueOnce(new Error('ACS down'));
      const res = await service.forgotPassword(
        { email: 'jane.doe@example.com' },
        req,
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(res).toEqual({
        message: PASSWORD_RESET_REQUESTED_MESSAGE,
        data: {},
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ACS down'));
    });
  });

  describe('resetPassword', () => {
    async function issueToken() {
      const ctx = setup();
      const user = addUser(ctx.prisma);
      await ctx.service.forgotPassword({ email: user.email }, req);
      return { ...ctx, user, raw: tokenFromMail(ctx.mail) };
    }

    it('changes the password, marks the token used and revokes refresh tokens', async () => {
      const { service, prisma, auditLogs, user, raw } = await issueToken();
      const older = {
        ...prisma.state.tokens[0],
        id: 'older',
        tokenHash: 'x',
        usedAt: null,
      };
      prisma.state.tokens.push(older);

      const res = await service.resetPassword(
        { token: raw, newPassword: 'BrandNewPass9' },
        req,
      );
      expect(res).toEqual({
        message: PASSWORD_RESET_COMPLETED_MESSAGE,
        data: {},
      });

      expect(await bcrypt.compare('BrandNewPass9', user.passwordHash)).toBe(
        true,
      );
      expect(await bcrypt.compare('OldPassword1!', user.passwordHash)).toBe(
        false,
      );
      expect(user.refreshTokenHash).toBeNull();
      // Every signed-in device of this person is signed out.
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: { kind: 'USER', accountId: user.id, revokedAt: null },
        data: { revokedAt: expect.any(Date), revokedReason: 'PASSWORD_CHANGED' },
      });
      expect(prisma.state.tokens.every((t) => t.usedAt !== null)).toBe(true);

      const completed = auditLogs.logSecurityEvent.mock.calls
        .map((c) => c[0] as Record<string, unknown>)
        .find(
          (p) => p.eventType === SecurityEventType.PASSWORD_RESET_COMPLETED,
        );
      expect(completed).toMatchObject({ userId: user.id });
      const serialized = JSON.stringify({ ...completed, tx: undefined });
      expect(serialized).not.toContain(raw);
      expect(serialized).not.toContain('BrandNewPass9');
    });

    it('rejects a token that was already used', async () => {
      const { service, raw } = await issueToken();
      await service.resetPassword(
        { token: raw, newPassword: 'BrandNewPass9' },
        req,
      );
      await expect(
        service.resetPassword({ token: raw, newPassword: 'AnotherPass9' }, req),
      ).rejects.toThrow(
        new BadRequestException(PASSWORD_RESET_INVALID_MESSAGE),
      );
    });

    it('rejects an expired token', async () => {
      const { service, prisma, user, raw } = await issueToken();
      prisma.state.tokens[0].expiresAt = new Date(Date.now() - 1000);
      await expect(
        service.resetPassword(
          { token: raw, newPassword: 'BrandNewPass9' },
          req,
        ),
      ).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
      expect(await bcrypt.compare('OldPassword1!', user.passwordHash)).toBe(
        true,
      );
    });

    it('rejects an unknown token', async () => {
      const { service } = setup();
      await expect(
        service.resetPassword(
          { token: 'not-a-real-token', newPassword: 'BrandNewPass9' },
          req,
        ),
      ).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
    });

    it('rejects a token superseded by a newer request', async () => {
      const { service, mail, user, raw } = await issueToken();
      await service.forgotPassword({ email: user.email }, req);
      expect(tokenFromMail(mail, 1)).not.toBe(raw);
      await expect(
        service.resetPassword(
          { token: raw, newPassword: 'BrandNewPass9' },
          req,
        ),
      ).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
    });

    it('rejects when the user has since been deactivated or deleted', async () => {
      const inactive = await issueToken();
      inactive.user.isActive = false;
      await expect(
        inactive.service.resetPassword(
          { token: inactive.raw, newPassword: 'BrandNewPass9' },
          req,
        ),
      ).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
      expect(inactive.prisma.state.tokens[0].usedAt).toBeNull();

      const deleted = await issueToken();
      deleted.user.deletedAt = new Date();
      await expect(
        deleted.service.resetPassword(
          { token: deleted.raw, newPassword: 'BrandNewPass9' },
          req,
        ),
      ).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
    });
  });

  it('validates newPassword with the same rules as change-password', () => {
    for (const newPassword of ['short', 'long-enough-1', '', 12345678]) {
      const reset = validateSync(
        plainToInstance(ResetPasswordDto, { token: 't', newPassword }),
      );
      const change = validateSync(
        plainToInstance(ChangePasswordDto, {
          currentPassword: 'c',
          newPassword,
        }),
      );
      expect(reset.some((e) => e.property === 'newPassword')).toBe(
        change.some((e) => e.property === 'newPassword'),
      );
    }
    expect(
      validateSync(
        plainToInstance(ResetPasswordDto, {
          token: '',
          newPassword: 'long-enough-1',
        }),
      ),
    ).not.toHaveLength(0);
  });
});
