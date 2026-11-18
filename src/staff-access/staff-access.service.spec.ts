import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { StaffAccessService } from './staff-access.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { SendMailInput } from '../mail/mail.service';
import { MessageHeldError } from '../message-delivery/message-held.error';

type User = { id: string; email: string; firstName: string | null; isActive: boolean; passwordSetAt: Date | null; roles: string[] };
type Portal = { id: string; email: string; isEnabled: boolean; deletedAt: Date | null; passwordSetAt: Date | null; userId: string | null; lastLoginAt: Date | null };

function setup(opts: { level?: string | null; email?: string | null; users?: User[]; portal?: Portal | null; isActive?: boolean; endDate?: Date | null } = {}) {
  const s = {
    users: opts.users ?? ([] as User[]),
    portal: opts.portal ?? null,
    ended: [] as Array<{ kind: string; accountId: string; reason: string }>,
  };
  let seq = 0;
  const employee = () => ({
    id: 'e1',
    isActive: opts.isActive ?? true,
    deletedAt: null,
    personalDetail: { firstName: 'Priya', lastName: 'Shah', email: opts.email === undefined ? 'Priya.Shah@example.test' : opts.email, status: { name: 'Active' } },
    employment: {
      endDate: opts.endDate ?? null,
      locationId: 'loc-1',
      rbacLevel: opts.level === null ? null : { name: opts.level ?? 'Branch Administrator' },
      role: { name: 'Coordinator' },
      jobTitle: { name: 'Care Coordinator' },
      workArea: { name: 'Administration' },
    },
    portalAccount: s.portal,
  });
  const userView = (u: User) => ({ ...u, userRoles: u.roles.map((name) => ({ role: { name } })) });
  const prisma = {
    employee: { findFirst: jest.fn(() => Promise.resolve(employee())) },
    user: {
      findFirst: jest.fn(({ where }: { where: { id?: string; email?: { equals: string } } }) => {
        const u = s.users.find((x) => (where.id ? x.id === where.id : x.email.toLowerCase() === where.email!.equals.toLowerCase()));
        return Promise.resolve(u ? userView(u) : null);
      }),
      create: jest.fn(({ data }: { data: { email: string; firstName: string; passwordSetAt: Date | null } }) => {
        const u: User = { id: `u${++seq}`, email: data.email, firstName: data.firstName, isActive: true, passwordSetAt: data.passwordSetAt, roles: [] };
        s.users.push(u);
        return Promise.resolve({ id: u.id });
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<User> }) => {
        Object.assign(s.users.find((u) => u.id === where.id)!, data);
        return Promise.resolve({});
      }),
    },
    employeePortalAccount: {
      findUnique: jest.fn(({ where }: { where: { id?: string; employeeId?: string } }) => Promise.resolve(where.id ? (s.portal && s.portal.id === where.id ? s.portal : null) : s.portal)),
      findFirst: jest.fn(() => Promise.resolve(null)),
      create: jest.fn(({ data }: { data: Partial<Portal> }) => {
        s.portal = { ...(data as object), id: 'p1', email: data.email!, isEnabled: true, deletedAt: null, passwordSetAt: data.passwordSetAt ?? null, userId: null, lastLoginAt: null };
        return Promise.resolve({ id: 'p1' });
      }),
      update: jest.fn(({ data }: { data: Partial<Portal> }) => {
        Object.assign(s.portal!, data);
        return Promise.resolve({ id: s.portal!.id });
      }),
    },
    authSession: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(({ where, data }: { where: { kind: string; accountId: string }; data: { revokedReason: string } }) => {
        s.ended.push({ kind: where.kind, accountId: where.accountId, reason: data.revokedReason });
        return Promise.resolve({ count: 1 });
      }),
    },
    passwordResetToken: { findFirst: jest.fn().mockResolvedValue(null) },
    location: { findFirst: jest.fn().mockResolvedValue({ name: 'Allfor Care Hounslow' }) },
    scheduleArea: { findFirst: jest.fn().mockResolvedValue({ phone: '020 8898 2867' }) },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const auth = {
    issueSetPasswordToken: jest.fn((t: { userId: string | null; portalAccountId: string | null }) =>
      Promise.resolve({ rawToken: 'RAW', urlBase: 'https://s.test', link: '', userId: t.userId, portalAccountId: t.portalAccountId, coversWebsite: Boolean(t.userId), coversApp: Boolean(t.portalAccountId), expiresInHours: 72 }),
    ),
    accountEmailBranding: jest.fn().mockResolvedValue({
      organisation: 'Allfor Care',
      logoUrl: null,
      legalLine: null,
      addressLine: null,
      website: null,
      companyPhone: null,
      siteUrl: 'https://s.test',
      setPasswordUrlBase: 'https://s.test',
      appStoreBadgeUrl: 'https://s.test/email/app-store-badge.png',
      googlePlayBadgeUrl: 'https://s.test/email/google-play-badge.png',
    }),
  };
  const mail = { send: jest.fn((m: SendMailInput) => Promise.resolve({ messageId: String(m.to), mode: 'log' })) };
  const audit = { logAudit: jest.fn().mockResolvedValue(undefined) };
  const rbac = { syncUserRolesForEmployee: jest.fn().mockResolvedValue(undefined) };
  const service = new StaffAccessService(prisma as never, auth as never, mail as never, audit as never, rbac as never);
  return { service, s, prisma, auth, mail, audit, rbac };
}

const admin: RequestUser = { id: 'actor', email: 'a@example.test', roles: ['Admin'], permissions: ['employees.update', 'employees.read', 'users.create'] } as RequestUser;
const coordinator: RequestUser = { ...admin, permissions: ['employees.update', 'employees.read'] } as RequestUser;

describe('StaffAccessService', () => {
  it('suggests from the RBAC level and shows nothing given yet', async () => {
    const { service } = setup({ level: 'Carer/Domestic' });
    const st = await service.getStatus(admin, 'e1');
    expect(st).toMatchObject({ suggested: { website: false, app: true }, rbacLevelKind: 'field', canHaveAccess: true, onePassword: false });
    expect(st.website.state).toBe('none');
    expect(st.app.state).toBe('none');
  });

  it('office login on: creates the login with no usable password, syncs the role, emails A', async () => {
    const { service, s, mail, rbac, auth } = setup();
    const r = await service.setAccess(admin, 'e1', { website: true });
    expect(s.users).toHaveLength(1);
    expect(s.users[0]).toMatchObject({ email: 'priya.shah@example.test', passwordSetAt: null });
    expect(rbac.syncUserRolesForEmployee).toHaveBeenCalledWith(expect.anything(), 'e1');
    expect(auth.issueSetPasswordToken).toHaveBeenCalledWith({ userId: 'u1', portalAccountId: null }, expect.objectContaining({ invite: true }));
    expect(mail.send).toHaveBeenCalledTimes(1);
    const m = mail.send.mock.calls[0][0];
    expect(m).toMatchObject({ kind: 'staff-welcome-website', to: 'priya.shah@example.test', subject: 'Your CareFlow account is ready', skipBcc: true });
    expect(m.text).toContain('https://s.test/auth/reset-password?token=RAW');
    expect(m.text).toContain('Access level: Branch Administrator');
    expect(r.emailed).toBe('website');
    expect(r.message).toBe('We’ve emailed Priya a link to choose a password. It works for 72 hours.');
    expect(r.status.website.state).toBe('invited');
  });

  it('Care app on: emails B with the app page link', async () => {
    const { service, mail } = setup({ level: 'Carer/Domestic' });
    const r = await service.setAccess(admin, 'e1', { app: true });
    const m = mail.send.mock.calls[0][0];
    expect(m).toMatchObject({ kind: 'staff-welcome-app', subject: 'Set up your Allfor Care app' });
    expect(m.text).toContain('https://s.test/app/set-password?token=RAW');
    expect(r.status.app.state).toBe('invited');
  });

  it('both at once: one email (C), one link for both accounts, accounts linked', async () => {
    const { service, s, mail, auth } = setup();
    const r = await service.setAccess(admin, 'e1', { website: true, app: true });
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send.mock.calls[0][0]).toMatchObject({ kind: 'staff-welcome-both', subject: 'Your CareFlow account and Care app are ready' });
    expect(auth.issueSetPasswordToken).toHaveBeenCalledWith({ userId: 'u1', portalAccountId: 'p1' }, expect.anything());
    expect(s.portal!.userId).toBe('u1');
    expect(r.emailed).toBe('both');
    expect(r.status.onePassword).toBe(true);
  });

  it('second one later: only what is new, and the same link sets the existing account too', async () => {
    const { service, mail, auth } = setup({
      level: 'Senior Carer/Nurse',
      portal: { id: 'p1', email: 'priya.shah@example.test', isEnabled: true, deletedAt: null, passwordSetAt: new Date(), userId: null, lastLoginAt: null },
    });
    await service.setAccess(admin, 'e1', { website: true });
    const m = mail.send.mock.calls[0][0];
    expect(m.subject).toBe('Your CareFlow account is ready');
    expect(m.text).toContain('works in the Care app too');
    expect(auth.issueSetPasswordToken).toHaveBeenCalledWith({ userId: 'u1', portalAccountId: 'p1' }, expect.anything());
  });

  it('switching back on an account that already has a password sends no email', async () => {
    const { service, mail } = setup({
      portal: { id: 'p1', email: 'priya.shah@example.test', isEnabled: false, deletedAt: null, passwordSetAt: new Date(), userId: null, lastLoginAt: null },
    });
    const r = await service.setAccess(admin, 'e1', { app: true });
    expect(mail.send).not.toHaveBeenCalled();
    expect(r.message).toContain('Priya can sign in with the password they already have.');
  });

  it('switching off signs them out everywhere', async () => {
    const { service, s } = setup({
      users: [{ id: 'u9', email: 'priya.shah@example.test', firstName: 'Priya', isActive: true, passwordSetAt: new Date(), roles: ['Branch Admin'] }],
      portal: { id: 'p1', email: 'priya.shah@example.test', isEnabled: true, deletedAt: null, passwordSetAt: new Date(), userId: 'u9', lastLoginAt: null },
    });
    const r = await service.setAccess(admin, 'e1', { website: false, app: false });
    expect(s.users[0].isActive).toBe(false);
    expect(s.portal!.isEnabled).toBe(false);
    expect(s.ended).toEqual(
      expect.arrayContaining([
        { kind: 'USER', accountId: 'u9', reason: 'ACCOUNT_DISABLED' },
        { kind: 'EMPLOYEE_APP', accountId: 'p1', reason: 'ACCOUNT_DISABLED' },
      ]),
    );
    expect(r.message).toContain('Office login switched off.');
    expect(r.message).toContain('Care app switched off.');
  });

  it('refuses: no email, no RBAC level, no users.create, above own level, inactive or left', async () => {
    await expect(setup({ email: null }).service.setAccess(admin, 'e1', { app: true })).rejects.toThrow(/email address on the Personal tab/);
    await expect(setup({ level: null }).service.setAccess(admin, 'e1', { website: true })).rejects.toThrow(/Choose an RBAC level/);
    await expect(setup().service.setAccess(coordinator, 'e1', { website: true })).rejects.toThrow(ForbiddenException);
    const branchAdmin = { ...admin, roles: ['Branch Admin'] } as RequestUser;
    await expect(setup({ level: 'Administrator' }).service.setAccess(branchAdmin, 'e1', { website: true })).rejects.toThrow(/above your own access/);
    await expect(setup({ isActive: false }).service.setAccess(admin, 'e1', { app: true })).rejects.toThrow(/Priya is inactive/);
    await expect(setup({ endDate: new Date('2020-01-01') }).service.setAccess(admin, 'e1', { app: true })).rejects.toThrow(/Priya has left/);
  });

  it('a coordinator without users.create can still manage the Care app', async () => {
    const { service, mail } = setup({ level: 'Carer/Domestic' });
    await service.setAccess(coordinator, 'e1', { app: true });
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('when the email is switched off in Message delivery, access is on and the office is told', async () => {
    const { service, mail } = setup();
    mail.send.mockRejectedValueOnce(new MessageHeldError('TYPE_OFF'));
    const r = await service.setAccess(admin, 'e1', { app: true });
    expect(r.emailed).toBeNull();
    expect(r.message).toContain('switched off in Administration › Message delivery');
    expect(r.status.app.state).toBe('invited');
  });

  it('send the link again: the welcome while waiting, a reset link once they have a password', async () => {
    const waiting = setup({ portal: { id: 'p1', email: 'p@example.test', isEnabled: true, deletedAt: null, passwordSetAt: null, userId: null, lastLoginAt: null } });
    expect((await waiting.service.resendLink(admin, 'e1')).emailed).toBe('app');
    expect(waiting.mail.send.mock.calls[0][0].kind).toBe('staff-welcome-app');

    const active = setup({ portal: { id: 'p1', email: 'p@example.test', isEnabled: true, deletedAt: null, passwordSetAt: new Date(), userId: null, lastLoginAt: null } });
    const r = await active.service.resendLink(admin, 'e1');
    expect(r.emailed).toBe('reset');
    expect(active.mail.send.mock.calls[0][0]).toMatchObject({ kind: 'app-password-reset', subject: 'Reset your Care app password' });
    expect(active.auth.issueSetPasswordToken).toHaveBeenCalledWith({ userId: null, portalAccountId: 'p1' }, expect.objectContaining({ invite: false }));

    await expect(setup().service.resendLink(admin, 'e1')).rejects.toThrow(BadRequestException);
  });

  it('office types a password when giving access: only a hash is stored, both sign-ins get it, no link is emailed', async () => {
    const { service, s, mail, auth, audit, prisma } = setup();
    const r = await service.setAccess(admin, 'e1', { website: true, app: true, password: 'Typed-Pass-123' });
    expect(auth.issueSetPasswordToken).not.toHaveBeenCalled();
    const created = prisma.user.create.mock.calls[0][0].data as { passwordHash: string; passwordSetAt: Date | null };
    expect(created.passwordHash).not.toContain('Typed-Pass-123');
    expect(await bcrypt.compare('Typed-Pass-123', created.passwordHash)).toBe(true);
    expect(created.passwordSetAt).toBeInstanceOf(Date);
    const portalHash = (s.portal as unknown as { passwordHash: string }).passwordHash;
    expect(await bcrypt.compare('Typed-Pass-123', portalHash)).toBe(true);
    const m = mail.send.mock.calls[0][0];
    expect(m.kind).toBe('staff-welcome-both');
    expect(m.text).not.toContain('Typed-Pass-123');
    expect(m.html).not.toContain('Typed-Pass-123');
    expect(m.text).not.toContain('token=');
    expect(m.text).toContain('Your manager will give you your password.');
    expect(JSON.stringify(audit.logAudit.mock.calls)).not.toContain('Typed-Pass-123');
    expect(r.message).toContain('The password isn’t in the email');
    expect(r.status.website.state).toBe('active');
  });

  it('a typed password is refused when nothing is being switched on', async () => {
    const { service } = setup({ portal: { id: 'p1', email: 'p@example.test', isEnabled: true, deletedAt: null, passwordSetAt: new Date(), userId: null, lastLoginAt: null } });
    await expect(service.setAccess(admin, 'e1', { app: true, password: 'Typed-Pass-123' })).rejects.toThrow(/only be given when switching access on/);
  });

  it('set a password: one password for both, signed out everywhere, nothing emailed', async () => {
    const { service, s, mail, prisma } = setup({
      users: [{ id: 'u9', email: 'priya.shah@example.test', firstName: 'Priya', isActive: true, passwordSetAt: null, roles: ['Branch Admin'] }],
      portal: { id: 'p1', email: 'priya.shah@example.test', isEnabled: true, deletedAt: null, passwordSetAt: null, userId: 'u9', lastLoginAt: null },
    });
    const r = await service.setPasswordByOffice(admin, 'e1', 'Office-Set-456');
    const userHash = (prisma.user.update.mock.calls.find((c: unknown[]) => (c[0] as { data: { passwordHash?: string } }).data.passwordHash)![0] as { data: { passwordHash: string } }).data.passwordHash;
    expect(await bcrypt.compare('Office-Set-456', userHash)).toBe(true);
    expect(await bcrypt.compare('Office-Set-456', (s.portal as unknown as { passwordHash: string }).passwordHash)).toBe(true);
    expect(s.ended).toEqual(
      expect.arrayContaining([
        { kind: 'USER', accountId: 'u9', reason: 'PASSWORD_CHANGED' },
        { kind: 'EMPLOYEE_APP', accountId: 'p1', reason: 'PASSWORD_CHANGED' },
      ]),
    );
    expect(mail.send).not.toHaveBeenCalled();
    expect(r.message).toContain('Give it to Priya yourself');
    await expect(service.setPasswordByOffice(coordinator, 'e1', 'Office-Set-456')).rejects.toThrow(ForbiddenException);
  });

  it('office user added with a password: the welcome says their manager gives it, no link', async () => {
    const { service, prisma, mail, auth } = setup();
    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'u5', email: 'o@example.test', firstName: 'Olu', isActive: true, passwordSetAt: new Date(), userRoles: [{ role: { name: 'Manager' } }], userLocations: [],
    });
    (prisma as unknown as { employeePersonalDetail: unknown }).employeePersonalDetail = { findFirst: jest.fn().mockResolvedValue(null) };
    const r = await service.inviteOfficeUser(admin, 'u5', undefined, true);
    expect(auth.issueSetPasswordToken).not.toHaveBeenCalled();
    expect(mail.send.mock.calls[0][0].text).toContain('Your manager will give you your password.');
    expect(r.message).toContain('The password isn’t in the email');
  });
});
