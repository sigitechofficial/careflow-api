import { UsersService } from './users.service';
import { RolesService } from '../roles/roles.service';
import { INDEPENDENT_REVIEWER_ROLE } from '../common/auth/independent-reviewer';

/** Independent reviewer accounts (SUR-CQC-001/002) stay separate from staff accounts. */
describe('independent reviewer accounts and roles', () => {
  const admin = { id: 'admin', roles: ['Super Admin'], assignedLocationIds: null };

  function users(currentRoles: string[]) {
    const prisma: any = {
      user: {
        findFirst: jest.fn(async () => ({ id: 'u1', email: 'r@example.org', userRoles: currentRoles.map((name) => ({ role: { name } })), userLocations: [] })),
      },
      role: { findMany: jest.fn(async ({ where }: any) => where.name.in.map((name: string) => ({ id: `role-${name}`, name }))) },
      userRole: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const svc = new UsersService(prisma, { logAudit: jest.fn() } as any);
    return { svc, prisma };
  }

  it('a reviewer account is never given staff roles', async () => {
    const { svc, prisma } = users([INDEPENDENT_REVIEWER_ROLE]);
    await expect(svc.setUserRoles(admin, 'u1', ['Care Coordinator'])).rejects.toThrow(/cannot be given staff roles/);
    await expect(svc.setUserRoles(admin, 'u1', [INDEPENDENT_REVIEWER_ROLE, 'Care Coordinator'])).rejects.toThrow(/never combined/);
    expect(prisma.userRole.createMany).not.toHaveBeenCalled();
  });

  it('a staff account is never made a reviewer', async () => {
    const { svc, prisma } = users(['Care Coordinator']);
    await expect(svc.setUserRoles(admin, 'u1', [INDEPENDENT_REVIEWER_ROLE])).rejects.toThrow(/staff account cannot be made/);
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it('the reviewer role cannot be renamed or given permissions', async () => {
    const prisma: any = {
      role: {
        findFirst: jest.fn(async () => ({ id: 'r1', name: INDEPENDENT_REVIEWER_ROLE })),
        update: jest.fn(async () => ({})),
      },
    };
    const roles = new RolesService(prisma);
    await expect(roles.update('r1', { name: 'Reviewer' })).rejects.toThrow(/cannot be renamed/);
    await expect(roles.setPermissions({ id: 'a', roles: ['Super Admin'] }, 'r1', ['users.create'])).rejects.toThrow(/no permissions/);
    await roles.update('r1', { description: 'Records survey answers' });
    expect(prisma.role.update).toHaveBeenCalledTimes(1);
  });
});
