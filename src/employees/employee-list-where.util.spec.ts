import type { PrismaService } from '../prisma/prisma.service';
import { buildEmployeeListWhere } from './employee-list-where.util';

// Search-only queries never touch prisma (it is only used for branch-scope / compliance filters).
const prisma = {} as PrismaService;

const fieldsMatching = (s: string) => ({
  OR: [
    { firstName: { contains: s, mode: 'insensitive' } },
    { lastName: { contains: s, mode: 'insensitive' } },
    { email: { contains: s, mode: 'insensitive' } },
    { username: { contains: s, mode: 'insensitive' } },
  ],
});

describe('buildEmployeeListWhere search', () => {
  it('matches a single word against any name / login field', async () => {
    const { wherePersonal } = await buildEmployeeListWhere(prisma, { search: 'Wendy' });
    expect(wherePersonal.AND).toEqual([fieldsMatching('Wendy')]);
  });

  it('requires every word of a full name to match (first + last name)', async () => {
    const { wherePersonal } = await buildEmployeeListWhere(prisma, { search: '  Wendy   Clark ' });
    expect(wherePersonal.AND).toEqual([fieldsMatching('Wendy'), fieldsMatching('Clark')]);
  });

  it('ignores a blank search', async () => {
    const { wherePersonal } = await buildEmployeeListWhere(prisma, { search: '   ' });
    expect(wherePersonal.AND).toBeUndefined();
    expect(wherePersonal.OR).toBeUndefined();
  });
});

describe('buildEmployeeListWhere branch scope and staff not assigned to a branch yet', () => {
  it('without a branch limit lists everyone, including staff with no employment details', async () => {
    const { listWhere } = await buildEmployeeListWhere(prisma, {});
    expect(listWhere.OR).toEqual([{ employment: null }, { employment: { is: { deletedAt: null } } }]);
  });

  it('a branch-limited list without creator ids only lists staff at those branches', async () => {
    const { listWhere } = await buildEmployeeListWhere(prisma, { locationIds: ['loc-a'] });
    expect(listWhere.OR).toBeUndefined();
    expect(listWhere.employment).toEqual({ is: expect.objectContaining({ deletedAt: null }) });
  });

  it('a branch-limited list also includes unassigned staff added by the given office users only', async () => {
    const { listWhere } = await buildEmployeeListWhere(
      prisma,
      { locationIds: ['loc-a'] },
      { unassignedStaffCreatorIds: ['u-manager-a'] },
    );
    const or = listWhere.OR as Array<Record<string, unknown>>;
    expect(or).toHaveLength(2);
    expect(or[0]).toEqual({ employment: { is: expect.objectContaining({ deletedAt: null }) } });
    const unassigned = or[1].AND as Array<Record<string, unknown>>;
    expect(unassigned).toContainEqual({ createdById: { in: ['u-manager-a'] } });
    expect(JSON.stringify(unassigned[0])).toContain('"employment":null');
    expect(JSON.stringify(unassigned[0])).toContain('"baseLocationId":null');
  });

  it('applies role / job filters to unassigned staff too (no unfiltered leak)', async () => {
    const { listWhere } = await buildEmployeeListWhere(
      prisma,
      { locationIds: ['loc-a'], roleIds: ['role-carer'] },
      { unassignedStaffCreatorIds: ['u-manager-a'] },
    );
    const unassigned = (listWhere.OR as Array<{ AND?: unknown[] }>)[1].AND!;
    expect(unassigned).toContainEqual({
      employment: { is: { deletedAt: null, roleId: { in: ['role-carer'] } } },
    });
  });
});
