import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import * as bcrypt from 'bcrypt';
import { AuthService, PASSWORD_RESET_INVALID_MESSAGE, PASSWORD_RESET_REQUESTED_MESSAGE } from './auth.service';
import type { SendMailInput } from '../mail/mail.service';

/**
 * One password for both: a person's office login (User) and Care app account (EmployeePortalAccount) are linked,
 * one link sets both, and the Care app has its own "Forgot password" that never reveals whether an account exists.
 */
type User = { id: string; email: string; firstName: string; isActive: boolean; deletedAt: Date | null; passwordHash: string; refreshTokenHash: string | null; passwordSetAt: Date | null };
type Portal = { id: string; email: string; isEnabled: boolean; deletedAt: Date | null; userId: string | null; passwordHash: string; refreshTokenHash: string | null; passwordSetAt: Date | null; employeeActive: boolean; firstName: string };
type Token = { id: string; userId: string | null; employeePortalAccountId: string | null; tokenHash: string; expiresAt: Date; usedAt: Date | null; createdAt: Date; requestedIp: string | null };

function fakeDb() {
  const s = { users: [] as User[], portals: [] as Portal[], tokens: [] as Token[], sessionsEnded: [] as Array<{ kind: string; accountId: string; reason: string }> };
  let seq = 0;
  const since = (d: Date, c?: { gt?: Date }) => !c?.gt || d > c.gt;
  const tokenMatch = (t: Token, w: Record<string, unknown>) =>
    (w.id === undefined || t.id === w.id) &&
    (w.userId === undefined || t.userId === w.userId) &&
    (w.employeePortalAccountId === undefined || t.employeePortalAccountId === w.employeePortalAccountId) &&
    (w.usedAt === undefined || t.usedAt === w.usedAt) &&
    since(t.createdAt, w.createdAt as { gt?: Date }) &&
    (!(w.expiresAt as { gt?: Date })?.gt || t.expiresAt > (w.expiresAt as { gt: Date }).gt);
  const portalView = (p: Portal) => ({
    ...p,
    employee: { isActive: p.employeeActive, deletedAt: null, personalDetail: { firstName: p.firstName } },
    user: s.users.find((u) => u.id === p.userId) ?? null,
  });
  const client = {
    state: s,
    companyProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    user: {
      findMany: jest.fn(({ where }: { where: { email: { equals: string } } }) =>
        Promise.resolve(s.users.filter((u) => u.email.toLowerCase() === where.email.equals.toLowerCase() && u.isActive && !u.deletedAt)),
      ),
      updateMany: jest.fn(({ where, data }: { where: { id: string }; data: Partial<User> }) => {
        const rows = s.users.filter((u) => u.id === where.id && u.isActive && !u.deletedAt);
        rows.forEach((u) => Object.assign(u, data));
        return Promise.resolve({ count: rows.length });
      }),
    },
    employeePortalAccount: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const p = s.portals.find((row) => {
          if (where.id !== undefined && row.id !== where.id) return false;
          if (where.userId !== undefined && row.userId !== where.userId) return false;
          if (where.email !== undefined && row.email.toLowerCase() !== (where.email as { equals: string }).equals.toLowerCase()) return false;
          if (where.isEnabled === true && !row.isEnabled) return false;
          if (where.deletedAt === null && row.deletedAt) return false;
          if (where.employee && !row.employeeActive) return false;
          return true;
        });
        return Promise.resolve(p ? portalView(p) : null);
      }),
      updateMany: jest.fn(({ where, data }: { where: { id: string }; data: Partial<Portal> }) => {
        const rows = s.portals.filter((p) => p.id === where.id && p.isEnabled && !p.deletedAt);
        rows.forEach((p) => Object.assign(p, data));
        return Promise.resolve({ count: rows.length });
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<Portal> }) => {
        const p = s.portals.find((row) => row.id === where.id)!;
        Object.assign(p, data);
        return Promise.resolve(p);
      }),
    },
    authSession: {
      updateMany: jest.fn(({ where, data }: { where: { kind: string; accountId: string }; data: { revokedReason: string } }) => {
        s.sessionsEnded.push({ kind: where.kind, accountId: where.accountId, reason: data.revokedReason });
        return Promise.resolve({ count: 1 });
      }),
    },
    passwordResetToken: {
      count: jest.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(s.tokens.filter((t) => tokenMatch(t, where)).length)),
      updateMany: jest.fn(({ where, data }: { where: Record<string, unknown>; data: Partial<Token> }) => {
        const rows = s.tokens.filter((t) => tokenMatch(t, where));
        rows.forEach((t) => Object.assign(t, data));
        return Promise.resolve({ count: rows.length });
      }),
      create: jest.fn(({ data }: { data: Partial<Token> }) => {
        const row: Token = { id: `t${++seq}`, createdAt: new Date(), usedAt: null, userId: null, employeePortalAccountId: null, requestedIp: null, tokenHash: '', expiresAt: new Date(), ...data } as Token;
        s.tokens.push(row);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn(({ where }: { where: { tokenHash: string } }) => {
        const t = s.tokens.find((row) => row.tokenHash === where.tokenHash);
        if (!t) return Promise.resolve(null);
        const u = s.users.find((row) => row.id === t.userId);
        const p = s.portals.find((row) => row.id === t.employeePortalAccountId);
        return Promise.resolve({
          ...t,
          user: u ? { isActive: u.isActive, deletedAt: u.deletedAt } : null,
          employeePortalAccount: p ? { isEnabled: p.isEnabled, deletedAt: p.deletedAt, employee: { isActive: p.employeeActive, deletedAt: null } } : null,
        });
      }),
    },
  };
  const $transaction = jest.fn(async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof client) => Promise<unknown>)(client)));
  return Object.assign(client, { $transaction });
}

const req = { headers: {} } as unknown as Request;
const hash = (p: string) => bcrypt.hashSync(p, 4);

function setup() {
  const db = fakeDb();
  const mail = { send: jest.fn((m: SendMailInput) => Promise.resolve({ messageId: String(m.to), mode: 'log' })) };
  const audit = {
    getRequestMeta: jest.fn().mockReturnValue({ ipAddress: '203.0.113.9', userAgent: 'jest' }),
    logSecurityEvent: jest.fn().mockResolvedValue(undefined),
    logAudit: jest.fn().mockResolvedValue(undefined),
  };
  const env: Record<string, string> = { PASSWORD_RESET_URL_BASE: 'https://careflow.example.test', ADMIN_APP_URL: 'https://careflow.example.test' };
  const config = { get: jest.fn((k: string) => env[k]) };
  const users = { findById: jest.fn((id: string) => Promise.resolve(db.state.users.find((u) => u.id === id))), updatePassword: jest.fn() };
  const service = new AuthService(users as never, {} as never, config as never, audit as never, {} as never, {} as never, db as never, mail as never, {} as never);
  db.state.users.push({ id: 'u1', email: 'grace@example.test', firstName: 'Grace', isActive: true, deletedAt: null, passwordHash: hash('OfficeOld1'), refreshTokenHash: 'r', passwordSetAt: new Date() });
  db.state.portals.push({ id: 'p1', email: 'grace@example.test', isEnabled: true, deletedAt: null, userId: 'u1', passwordHash: hash('AppOld111'), refreshTokenHash: 'r', passwordSetAt: new Date(), employeeActive: true, firstName: 'Grace' });
  db.state.portals.push({ id: 'p2', email: 'amir@example.test', isEnabled: true, deletedAt: null, userId: null, passwordHash: hash('AppOld222'), refreshTokenHash: null, passwordSetAt: null, employeeActive: true, firstName: 'Amir' });
  return { service, db, mail, audit, users };
}

const tokenFrom = (m: SendMailInput) => (m.text.match(/token=([A-Za-z0-9_-]+)/) ?? [])[1];

describe('AuthService: one password for the website and the Care app', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('a link for an office login also covers their linked Care app account', async () => {
    const { service, db } = setup();
    const issued = await service.issueSetPasswordToken({ userId: 'u1' }, { invite: true });
    expect(issued).toMatchObject({ userId: 'u1', portalAccountId: 'p1', coversWebsite: true, coversApp: true, expiresInHours: 72 });
    expect(issued!.link).toMatch(/^https:\/\/careflow\.example\.test\/auth\/reset-password\?token=/);
    expect(db.state.tokens[0]).toMatchObject({ userId: 'u1', employeePortalAccountId: 'p1' });
  });

  it('setting the password from that link sets both, and signs both out everywhere', async () => {
    const { service, db } = setup();
    const issued = await service.issueSetPasswordToken({ userId: 'u1' }, { invite: true });
    const res = await service.resetPassword({ token: issued!.rawToken, newPassword: 'OneForBoth9' }, req);
    expect(res.data).toEqual({ accounts: ['website', 'app'] });
    const [u] = db.state.users;
    const p = db.state.portals[0];
    expect(await bcrypt.compare('OneForBoth9', u.passwordHash)).toBe(true);
    expect(await bcrypt.compare('OneForBoth9', p.passwordHash)).toBe(true);
    expect(u.passwordSetAt).toBeInstanceOf(Date);
    expect(p.refreshTokenHash).toBeNull();
    expect(db.state.sessionsEnded).toEqual(
      expect.arrayContaining([
        { kind: 'USER', accountId: 'u1', reason: 'PASSWORD_CHANGED' },
        { kind: 'EMPLOYEE_APP', accountId: 'p1', reason: 'PASSWORD_CHANGED' },
      ]),
    );
    await expect(service.resetPassword({ token: issued!.rawToken, newPassword: 'Again12345' }, req)).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
  });

  it('a Care app-only link opens the app page and sets only the app password', async () => {
    const { service, db } = setup();
    const issued = await service.issueSetPasswordToken({ portalAccountId: 'p2' }, { invite: true });
    expect(issued).toMatchObject({ userId: null, portalAccountId: 'p2', coversWebsite: false });
    expect(issued!.link).toContain('/app/set-password?token=');
    const res = await service.resetPassword({ token: issued!.rawToken, newPassword: 'CarerPass9' }, req);
    expect(res.data).toEqual({ accounts: ['app'] });
    expect(await bcrypt.compare('CarerPass9', db.state.portals[1].passwordHash)).toBe(true);
    expect(db.state.portals[1].passwordSetAt).toBeInstanceOf(Date);
  });

  it('a link stops working once the Care app is switched off (and there is no office login)', async () => {
    const { service, db } = setup();
    const issued = await service.issueSetPasswordToken({ portalAccountId: 'p2' }, { invite: true });
    db.state.portals[1].isEnabled = false;
    await expect(service.resetPassword({ token: issued!.rawToken, newPassword: 'CarerPass9' }, req)).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
  });

  it('Care app forgot password: emails a 60-minute link, and covers the office login too when linked', async () => {
    const { service, db, mail } = setup();
    const res = await service.forgotAppPassword({ email: 'GRACE@example.test' }, req);
    expect(res).toEqual({ message: PASSWORD_RESET_REQUESTED_MESSAGE, data: {} });
    expect(mail.send).toHaveBeenCalledTimes(1);
    const sent = mail.send.mock.calls[0][0];
    expect(sent).toMatchObject({ kind: 'app-password-reset', to: 'grace@example.test', subject: 'Reset your CareFlow password', skipBcc: true });
    expect(sent.text).toContain('Your new password works for both.');
    const t = db.state.tokens[0];
    expect(t).toMatchObject({ userId: 'u1', employeePortalAccountId: 'p1' });
    const ttl = t.expiresAt.getTime() - t.createdAt.getTime();
    expect(Math.round(ttl / 60000)).toBe(60);
    expect(tokenFrom(sent)).toBeTruthy();
  });

  it('Care app forgot password: app-only carers get the app page', async () => {
    const { service, mail } = setup();
    await service.forgotAppPassword({ email: 'amir@example.test' }, req);
    const sent = mail.send.mock.calls[0][0];
    expect(sent.subject).toBe('Reset your Care app password');
    expect(sent.text).toContain('https://careflow.example.test/app/set-password?token=');
  });

  it('Care app forgot password never reveals whether the account exists', async () => {
    const { service, db, mail } = setup();
    db.state.portals[1].isEnabled = false;
    const unknown = await service.forgotAppPassword({ email: 'nobody@example.test' }, req);
    const disabled = await service.forgotAppPassword({ email: 'amir@example.test' }, req);
    expect(unknown).toEqual(disabled);
    expect(unknown).toEqual({ message: PASSWORD_RESET_REQUESTED_MESSAGE, data: {} });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('caps links per account per hour across both routes', async () => {
    const { service, mail } = setup();
    for (let i = 0; i < 5; i++) await service.forgotAppPassword({ email: 'amir@example.test' }, req);
    expect(mail.send).toHaveBeenCalledTimes(3);
  });

  it('website forgot password includes the linked app account', async () => {
    const { service, db } = setup();
    await service.forgotPassword({ email: 'grace@example.test' }, req);
    expect(db.state.tokens[0]).toMatchObject({ userId: 'u1', employeePortalAccountId: 'p1' });
  });

  it('changing the office password keeps the Care app password in step', async () => {
    const { service, db, users } = setup();
    await service.changePassword('u1', { currentPassword: 'OfficeOld1', newPassword: 'Changed123' }, req);
    expect(users.updatePassword).toHaveBeenCalledWith('u1', expect.any(String));
    const newHash = users.updatePassword.mock.calls[0][1] as string;
    expect(db.state.portals[0].passwordHash).toBe(newHash);
    expect(db.state.sessionsEnded).toContainEqual({ kind: 'EMPLOYEE_APP', accountId: 'p1', reason: 'PASSWORD_CHANGED' });
  });
});
