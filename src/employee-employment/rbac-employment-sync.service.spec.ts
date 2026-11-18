import { RbacEmploymentSyncService } from './rbac-employment-sync.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

type Role = { id: string; name: string };
type User = { id: string; createdById: string | null };

const ROLES: Role[] = [
  { id: 'r-admin', name: 'Admin' },
  { id: 'r-branch-admin', name: 'Branch Admin' },
  { id: 'r-manager', name: 'Manager' },
  { id: 'r-carer', name: 'Carer/Domestic' },
  { id: 'r-senior', name: 'Senior Carer/Nurse' },
  { id: 'r-super', name: 'Super Admin' },
  { id: 'r-reviewer', name: 'Independent reviewer' },
];

/** Minimal in-memory Prisma transaction covering what the sync uses. */
function fakeTx(opts: { user: User | null; userRoleNames?: string[]; rbacLevel: string | null }) {
  const userRoles: { userId: string; roleId: string }[] = (opts.userRoleNames ?? []).map((n) => ({
    userId: opts.user!.id,
    roleId: ROLES.find((r) => r.name === n)!.id,
  }));
  const roleById = (id: string) => ROLES.find((r) => r.id === id)!;
  const tx = {
    employee: {
      findFirst: jest.fn(async () => ({
        id: 'emp-1',
        personalDetail: { email: 'manager@care.test' },
        employment: { rbacLevel: opts.rbacLevel ? { name: opts.rbacLevel } : null },
      })),
    },
    user: {
      findFirst: jest.fn(async () =>
        opts.user
          ? {
              id: opts.user.id,
              createdById: opts.user.createdById,
              userRoles: userRoles
                .filter((ur) => ur.userId === opts.user!.id)
                .map((ur) => ({ role: roleById(ur.roleId) })),
            }
          : null,
      ),
    },
    role: {
      findMany: jest.fn(async ({ where }: { where: { name: { in: string[] } } }) =>
        ROLES.filter((r) => where.name.in.includes(r.name)).map((r) => ({ id: r.id })),
      ),
      findFirst: jest.fn(async ({ where }: { where: { name: string } }) => {
        const r = ROLES.find((x) => x.name === where.name);
        return r ? { id: r.id } : null;
      }),
    },
    userRole: {
      deleteMany: jest.fn(async ({ where }: { where: { userId: string; roleId: { in: string[] } } }) => {
        for (let i = userRoles.length - 1; i >= 0; i--) {
          if (userRoles[i].userId === where.userId && where.roleId.in.includes(userRoles[i].roleId)) {
            userRoles.splice(i, 1);
          }
        }
        return { count: 0 };
      }),
      upsert: jest.fn(async ({ create }: { create: { userId: string; roleId: string } }) => {
        if (!userRoles.some((ur) => ur.userId === create.userId && ur.roleId === create.roleId)) {
          userRoles.push(create);
        }
        return create;
      }),
      findMany: jest.fn(async ({ where }: { where: { userId: string } }) =>
        userRoles
          .filter((ur) => ur.userId === where.userId)
          .map((ur) => ({ role: { name: roleById(ur.roleId).name } })),
      ),
    },
  };
  const roleNames = () => userRoles.map((ur) => roleById(ur.roleId).name).sort();
  return { tx, roleNames };
}

describe('RbacEmploymentSyncService (security)', () => {
  let audit: { logAudit: jest.Mock };
  let service: RbacEmploymentSyncService;
  beforeEach(() => {
    audit = { logAudit: jest.fn() };
    service = new RbacEmploymentSyncService(audit as never);
  });

  const stranger: User = { id: 'u-stranger', createdById: null };
  const adminMade: User = { id: 'u-made', createdById: 'u-admin' };

  it('never gives roles to a login nobody in the office made or approved (the self-registration attack)', async () => {
    const { tx, roleNames } = fakeTx({ user: stranger, rbacLevel: 'Administrator' });
    const out = await service.syncUserRolesForEmployee(tx as never, 'emp-1', 'u-admin');
    expect(out).toMatchObject({ kind: 'skipped', reason: 'login_not_admin_approved' });
    expect(roleNames()).toEqual([]);
    expect(tx.userRole.upsert).not.toHaveBeenCalled();
    expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.USER_ROLE_SYNC_SKIPPED, recordId: 'u-stranger' }),
    );
  });

  it('does not give an unapproved login even a carer role', async () => {
    const { tx, roleNames } = fakeTx({ user: stranger, rbacLevel: 'Carer/Domestic' });
    await service.syncUserRolesForEmployee(tx as never, 'emp-1', 'u-admin');
    expect(roleNames()).toEqual([]);
  });

  it('never silently upgrades an approved login to an admin-level role', async () => {
    const { tx, roleNames } = fakeTx({ user: adminMade, userRoleNames: ['Manager'], rbacLevel: 'Administrator' });
    const out = await service.syncUserRolesForEmployee(tx as never, 'emp-1', 'u-admin');
    expect(out).toMatchObject({ kind: 'skipped', reason: 'admin_level_role_needs_manual_grant' });
    expect(roleNames()).toEqual(['Manager']);
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.USER_ROLE_SYNC_SKIPPED }),
    );
  });

  it('does not grant Branch Admin automatically either', async () => {
    const { tx, roleNames } = fakeTx({ user: adminMade, rbacLevel: 'Branch Administrator' });
    await service.syncUserRolesForEmployee(tx as never, 'emp-1', 'u-admin');
    expect(roleNames()).toEqual([]);
  });

  it('keeps an admin-level role an administrator already gave (no churn)', async () => {
    const { tx, roleNames } = fakeTx({ user: adminMade, userRoleNames: ['Admin'], rbacLevel: 'Administrator' });
    const out = await service.syncUserRolesForEmployee(tx as never, 'emp-1', 'u-admin');
    expect(out).toMatchObject({ kind: 'assigned', roleName: 'Admin' });
    expect(roleNames()).toEqual(['Admin']);
  });

  it('applies a non-admin level to an admin-made login and audits the change', async () => {
    const { tx, roleNames } = fakeTx({ user: adminMade, rbacLevel: 'Senior Carer/Nurse' });
    const out = await service.syncUserRolesForEmployee(tx as never, 'emp-1', 'u-admin');
    expect(out).toMatchObject({ kind: 'assigned', roleName: 'Senior Carer/Nurse' });
    expect(roleNames()).toEqual(['Senior Carer/Nurse']);
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.USER_ROLE_SYNCED_FROM_EMPLOYMENT,
        userId: 'u-admin',
        recordId: 'u-made',
        oldValues: { roles: [] },
        newValues: { roles: ['Senior Carer/Nurse'] },
      }),
    );
  });

  it('treats a login with an admin-given role as approved (older logins without createdById)', async () => {
    const legacy: User = { id: 'u-legacy', createdById: null };
    const { tx, roleNames } = fakeTx({ user: legacy, userRoleNames: ['Carer/Domestic'], rbacLevel: 'Manager' });
    await service.syncUserRolesForEmployee(tx as never, 'emp-1', 'u-admin');
    expect(roleNames()).toEqual(['Manager']);
  });

  it('lowers access when the level is lowered', async () => {
    const { tx, roleNames } = fakeTx({ user: adminMade, userRoleNames: ['Manager'], rbacLevel: 'Carer/Domestic' });
    await service.syncUserRolesForEmployee(tx as never, 'emp-1', 'u-admin');
    expect(roleNames()).toEqual(['Carer/Domestic']);
  });

  it('never touches Super Admin or independent-reviewer logins', async () => {
    for (const held of ['Super Admin', 'Independent reviewer']) {
      const { tx, roleNames } = fakeTx({ user: adminMade, userRoleNames: [held], rbacLevel: 'Carer/Domestic' });
      const out = await service.syncUserRolesForEmployee(tx as never, 'emp-1', 'u-admin');
      expect(out.kind).toBe('skipped');
      expect(roleNames()).toEqual([held]);
    }
  });

  it('does nothing when no login has the email', async () => {
    const { tx } = fakeTx({ user: null, rbacLevel: 'Manager' });
    const out = await service.syncUserRolesForEmployee(tx as never, 'emp-1', 'u-admin');
    expect(out).toEqual({ kind: 'skipped', reason: 'no_matching_login' });
    expect(audit.logAudit).not.toHaveBeenCalled();
  });
});
