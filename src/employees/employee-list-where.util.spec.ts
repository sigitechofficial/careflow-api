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
