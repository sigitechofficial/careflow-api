import { BadRequestException } from '@nestjs/common';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import {
  TemporaryInspectorsService,
  residentScopeLabel,
  serviceUserOptionName,
} from './temporary-inspectors.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const people = [
  { id: A, firstName: 'Ada', lastName: 'Brown', serviceUserNumber: 'SU001' },
  { id: B, firstName: 'Ben', lastName: 'Cole', serviceUserNumber: null },
];

function setup(actor: Partial<RequestUser> = {}) {
  const prisma: any = {
    serviceUser: { findMany: jest.fn(async () => people) },
    temporaryInspector: {
      create: jest.fn(async () => ({ id: 'ti-1' })),
      findMany: jest.fn(async () => []),
    },
  };
  const orgScope = new OrgScopeService(prisma);
  const service = new TemporaryInspectorsService(prisma, orgScope);
  const user = { id: 'u-1', roles: ['Admin'], permissions: [], assignedLocationIds: null, ...actor } as RequestUser;
  return { prisma, service, user };
}

const dto = (keys: string[]) =>
  ({
    firstName: 'Test',
    lastName: 'Inspector',
    username: 'test.inspector',
    password: 'Passw0rd!',
    reason: 'CQC visit',
    validFrom: '2026-11-20T09:00:00.000Z',
    validTo: '2026-11-20T17:00:00.000Z',
    serviceUserKeys: keys,
  }) as any;

describe('Temporary inspector residents', () => {
  it('lists real, active service users with their ids', async () => {
    const { prisma, service, user } = setup();
    expect(await service.serviceUserOptions(user)).toEqual([
      { id: A, name: 'Ada Brown (SU001)' },
      { id: B, name: 'Ben Cole' },
    ]);
    expect(prisma.serviceUser.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null, isActive: true });
  });

  it('only lists service users in a branch-scoped user’s branches', async () => {
    const { prisma, service, user } = setup({ roles: ['Manager'], assignedLocationIds: ['loc-1'] });
    await service.serviceUserOptions(user);
    expect(prisma.serviceUser.findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ locationId: { in: ['loc-1'] } }, { assignments: { some: { deletedAt: null, locationId: { in: ['loc-1'] } } } }] },
    ]);
  });

  it('saves chosen service users by id', async () => {
    const { prisma, service, user } = setup();
    await service.create(user, dto([A, B, A]));
    expect(prisma.temporaryInspector.create.mock.calls[0][0].data.serviceUserKeys).toEqual([A, B]);
  });

  it('refuses old sample keys and service users the office user cannot see', async () => {
    const { service, user } = setup();
    await expect(service.create(user, dto(['1']))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(user, dto([C]))).rejects.toThrow(/not in your branches/);
  });

  it('keeps every letter of a name and tidies extra spaces', () => {
    expect(serviceUserOptionName({ firstName: 'Betty ', lastName: 'Henderson', serviceUserNumber: 'SU-TEST-P10' })).toBe('Betty Henderson (SU-TEST-P10)');
    expect(serviceUserOptionName({ firstName: 'Aisha', lastName: '  Mohammed  Davies', serviceUserNumber: null })).toBe('Aisha Mohammed Davies');
  });

  it('names the scope, and says when it is the old sample list', () => {
    const names = new Map([[A, serviceUserOptionName(people[0]!)]]);
    expect(residentScopeLabel([], names)).toBe('All service users');
    expect(residentScopeLabel([A], names)).toBe('Ada Brown (SU001)');
    expect(residentScopeLabel(['1', '4'], names)).toBe('Old sample list (no real service users)');
    expect(residentScopeLabel([A, C], names)).toBe('Ada Brown (SU001) (+1 no longer found)');
  });
});
