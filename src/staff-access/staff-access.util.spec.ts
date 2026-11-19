import { careAppLinks } from './care-app-links';
import {
  endStaffSignIns,
  leavingDateHasPassed,
  rbacLevelKind,
  signInState,
  suggestedAccess,
  welcomeVariant,
} from './staff-access.util';

describe('staff access rules', () => {
  it('suggests an office login for office levels and the Care app for field levels', () => {
    for (const level of ['Group Administrator', 'Administrator', 'Privacy Officer', 'Operation Management', 'Branch Administrator', 'Staff Allocation', 'Master Staff Allocation']) {
      expect(rbacLevelKind(level)).toBe('office');
      expect(suggestedAccess(level)).toEqual({ website: true, app: false });
    }
    for (const level of ['Senior Carer/Nurse', 'Carer/Domestic']) {
      expect(rbacLevelKind(level)).toBe('field');
      expect(suggestedAccess(level)).toEqual({ website: false, app: true });
    }
    expect(suggestedAccess(null)).toEqual({ website: false, app: false });
  });

  it('chooses the welcome email from what was just given', () => {
    expect(welcomeVariant({ website: true, app: true })).toBe('both');
    expect(welcomeVariant({ website: true, app: false })).toBe('website');
    expect(welcomeVariant({ website: false, app: true })).toBe('app');
    expect(welcomeVariant({ website: false, app: false })).toBeNull();
  });

  it('describes each sign-in', () => {
    expect(signInState(null)).toBe('none');
    expect(signInState({ enabled: false, passwordSetAt: new Date() })).toBe('off');
    expect(signInState({ enabled: true, passwordSetAt: null })).toBe('invited');
    expect(signInState({ enabled: true, passwordSetAt: new Date() })).toBe('active');
  });

  it('access lasts through the last working day (UK time)', () => {
    const now = new Date('2026-11-18T10:00:00Z');
    expect(leavingDateHasPassed(null, now)).toBe(false);
    expect(leavingDateHasPassed(new Date('2026-11-18T00:00:00Z'), now)).toBe(false);
    expect(leavingDateHasPassed(new Date('2026-11-17T00:00:00Z'), now)).toBe(true);
    expect(leavingDateHasPassed(new Date('2026-11-25T00:00:00Z'), now)).toBe(false);
  });
});

describe('endStaffSignIns', () => {
  function fakeTx(over: { portal?: object | null; user?: object | null; email?: string | null } = {}) {
    const portal = over.portal === undefined ? { id: 'p1', isEnabled: true, deletedAt: null, userId: 'u1' } : over.portal;
    const user = over.user === undefined ? { id: 'u1', isActive: true, userRoles: [{ role: { name: 'Branch Admin' } }] } : over.user;
    return {
      employee: { findFirst: jest.fn().mockResolvedValue({ personalDetail: { email: over.email ?? 'grace@example.test' }, portalAccount: portal }) },
      employeePortalAccount: { update: jest.fn().mockResolvedValue({}) },
      user: { findFirst: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue({}) },
      authSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  }

  it('switches off both and signs them out on every device', async () => {
    const tx = fakeTx();
    const r = await endStaffSignIns(tx as never, 'e1', 'INACTIVE', 'actor');
    expect(r).toEqual({ app: true, website: true, description: 'Switched off office login and Care app access because they were made inactive' });
    expect(tx.employeePortalAccount.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1' }, data: expect.objectContaining({ isEnabled: false, refreshTokenHash: null }) }));
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' }, data: expect.objectContaining({ isActive: false }) }));
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({ where: { kind: 'EMPLOYEE_APP', accountId: 'p1', revokedAt: null }, data: expect.objectContaining({ revokedReason: 'ACCOUNT_DISABLED' }) });
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({ where: { kind: 'USER', accountId: 'u1', revokedAt: null }, data: expect.objectContaining({ revokedReason: 'ACCOUNT_DISABLED' }) });
  });

  it('never switches off a Super Admin, or the person making the change', async () => {
    const superTx = fakeTx({ user: { id: 'u1', isActive: true, userRoles: [{ role: { name: 'Super Admin' } }] } });
    expect((await endStaffSignIns(superTx as never, 'e1', 'LEFT', null)).website).toBe(false);
    expect(superTx.user.update).not.toHaveBeenCalled();
    const selfTx = fakeTx();
    expect((await endStaffSignIns(selfTx as never, 'e1', 'INACTIVE', 'u1')).website).toBe(false);
  });

  it('finds the office login by their staff email when the accounts are not linked', async () => {
    const tx = fakeTx({ portal: null });
    const r = await endStaffSignIns(tx as never, 'e1', 'LEFT', null);
    expect(tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { email: { equals: 'grace@example.test', mode: 'insensitive' }, deletedAt: null } }));
    expect(r).toMatchObject({ app: false, website: true });
  });

  it('nothing to do: no description', async () => {
    const tx = fakeTx({ portal: { id: 'p1', isEnabled: false, deletedAt: null, userId: null }, user: null });
    expect(await endStaffSignIns(tx as never, 'e1', 'LEFT', null)).toEqual({ app: false, website: false, description: null });
  });
});

describe('care app links', () => {
  it('builds store links from configuration, and says when it is not set up', () => {
    expect(careAppLinks({})).toMatchObject({ configured: false, appStoreUrl: null, playStoreUrl: null, openAppUrl: null });
    expect(careAppLinks({ CARE_APP_IOS_APP_ID: 'id1234567890', CARE_APP_ANDROID_PACKAGE: 'uk.co.allforcare.careapp', CARE_APP_URL_SCHEME: 'careflow://' })).toEqual({
      iosAppId: '1234567890',
      androidPackage: 'uk.co.allforcare.careapp',
      urlScheme: 'careflow',
      appStoreUrl: 'https://apps.apple.com/gb/app/id1234567890',
      playStoreUrl: 'https://play.google.com/store/apps/details?id=uk.co.allforcare.careapp',
      openAppUrl: 'careflow://',
      configured: true,
    });
  });

  it('ignores malformed values (never a web or script scheme)', () => {
    expect(careAppLinks({ CARE_APP_IOS_APP_ID: 'abc', CARE_APP_ANDROID_PACKAGE: 'not a package', CARE_APP_URL_SCHEME: 'javascript' })).toMatchObject({
      iosAppId: null,
      androidPackage: null,
      urlScheme: null,
      configured: false,
    });
  });
});
