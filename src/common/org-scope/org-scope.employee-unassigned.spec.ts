import { NotFoundException } from '@nestjs/common';
import { OrgScopeService } from './org-scope.service';
import type { OrgScope } from './org-scope.types';

type Emp = {
  createdById: string | null;
  employment: null | {
    locationId: string | null;
    baseLocationId: string | null;
    accessAllZones: boolean;
    floorLocations: { locationId: string }[];
  };
};

function serviceFor(emp: Emp | null, userLocations: { userId: string; locationId: string }[]) {
  const prisma = {
    employee: { findFirst: jest.fn(async () => emp) },
    userLocation: {
      findMany: jest.fn(async ({ where }: { where: { locationId: { in: string[] } } }) =>
        userLocations.filter((ul) => where.locationId.in.includes(ul.locationId)).map((ul) => ({ userId: ul.userId })),
      ),
    },
  };
  return new OrgScopeService(prisma as never);
}

const branchA: OrgScope = {
  platformWide: false,
  companyWide: false,
  locationIds: ['loc-a'],
  scopeType: 'branch',
  roles: ['Manager'],
  permissions: [],
  userId: 'u-manager-a',
};
const office = [
  { userId: 'u-manager-a', locationId: 'loc-a' },
  { userId: 'u-coordinator-a', locationId: 'loc-a' },
  { userId: 'u-manager-b', locationId: 'loc-b' },
];
const noBranch = { locationId: null, baseLocationId: null, accessAllZones: false, floorLocations: [] };

describe('OrgScopeService.assertEmployeeInScope for staff not assigned to a branch yet', () => {
  it('lets a branch manager open a new starter they added (no employment details yet)', async () => {
    const svc = serviceFor({ createdById: 'u-manager-a', employment: null }, office);
    await expect(svc.assertEmployeeInScope(branchA, 'e1')).resolves.toBeUndefined();
  });

  it('lets them open one added by a colleague at the same branch', async () => {
    const svc = serviceFor({ createdById: 'u-coordinator-a', employment: noBranch }, office);
    await expect(svc.assertEmployeeInScope(branchA, 'e1')).resolves.toBeUndefined();
  });

  it('hides one added by another branch (no leak across branches)', async () => {
    const svc = serviceFor({ createdById: 'u-manager-b', employment: null }, office);
    await expect(svc.assertEmployeeInScope(branchA, 'e1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides one added by a company-wide admin with no branch', async () => {
    const svc = serviceFor({ createdById: 'u-admin', employment: null }, office);
    await expect(svc.assertEmployeeInScope(branchA, 'e1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('counts the base branch as a branch', async () => {
    const svc = serviceFor(
      { createdById: 'u-manager-b', employment: { ...noBranch, baseLocationId: 'loc-a' } },
      office,
    );
    await expect(svc.assertEmployeeInScope(branchA, 'e1')).resolves.toBeUndefined();
  });

  it('still hides staff assigned to another branch even if this manager added them', async () => {
    const svc = serviceFor(
      { createdById: 'u-manager-a', employment: { ...noBranch, locationId: 'loc-b' } },
      office,
    );
    await expect(svc.assertEmployeeInScope(branchA, 'e1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('company-wide users are never limited', async () => {
    const svc = serviceFor({ createdById: 'x', employment: null }, office);
    await expect(svc.assertEmployeeInScope({ ...branchA, locationIds: null }, 'e1')).resolves.toBeUndefined();
  });
});
