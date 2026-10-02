/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- in-memory Prisma mocks */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { LocationManagementService } from './location-management.service';

type Row = Record<string, any>;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUNSLOW_ID = '22222222-2222-4222-8222-222222222222';
const HARROW_ID = '33333333-3333-4333-8333-333333333333';

function branch(overrides: Row): Row {
  return {
    name: 'Branch',
    code: 'CODE',
    visitRefCode: 'HOU',
    address: null,
    parentZoneName: 'London',
    deletedAt: null,
    cqcLocationId: null,
    officialCqcName: null,
    addressLine1: null,
    addressLine2: null,
    town: null,
    county: null,
    postcode: null,
    country: null,
    countryCode: 'GB',
    localAuthority: null,
    phone: null,
    email: null,
    website: null,
    serviceTypes: [],
    regulatedActivities: [],
    registeredManagers: [],
    nominatedIndividual: null,
    cqcRegistrationDate: null,
    cqcRating: null,
    cqcRatingStatus: null,
    status: 'ACTIVE',
    timezone: 'Europe/London',
    currency: 'GBP',
    locale: 'en-GB',
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

function setup() {
  const locations: Row[] = [
    { id: 'loc-hou', name: 'Allfor Care Hounslow' },
    { id: 'loc-har', name: 'Allfor Care Harrow' },
  ];
  const areas: Row[] = [
    branch({
      id: HOUNSLOW_ID,
      name: 'Allfor Care Hounslow',
      locationId: 'loc-hou',
      cqcLocationId: '1-115898258',
      registeredManagers: ['Mrs Suzette Thomas'],
    }),
    branch({
      id: HARROW_ID,
      name: 'Allfor Care Harrow',
      visitRefCode: 'HAR',
      locationId: 'loc-har',
      cqcLocationId: '1-2754362586',
    }),
  ];
  const withRelations = (a: Row) => ({
    ...a,
    location: locations.find((l) => l.id === a.locationId) ?? null,
    zone: { id: 'zone-london', name: 'London' },
  });
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'not' in v
        ? row[k] !== v.not
        : (row[k] ?? null) === v,
    );
  const prisma: Row = {
    scheduleArea: {
      findFirst: jest.fn(async ({ where }: Row) => {
        const hit = areas.find((a) => matches(a, where));
        return hit ? withRelations(hit) : null;
      }),
      update: jest.fn(async ({ where, data }: Row) => {
        const row = areas.find((a) => a.id === where.id)!;
        for (const [k, v] of Object.entries(data))
          if (v !== undefined) row[k] = v;
        return withRelations(row);
      }),
    },
    location: {
      findFirst: jest.fn(
        async ({ where }: Row) =>
          locations.find((l) => matches(l, where)) ?? null,
      ),
      update: jest.fn(async ({ where, data }: Row) =>
        Object.assign(locations.find((l) => l.id === where.id)!, data),
      ),
    },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: Row) => unknown) => fn(prisma));
  const audit = { logAudit: jest.fn(async () => undefined) };
  const service = new LocationManagementService(prisma as any, audit as any);
  return { service, prisma, areas, locations, audit };
}

describe('LocationManagementService.updateBranch', () => {
  it('adds a registered manager and returns the branch details', async () => {
    const { service, areas, audit } = setup();
    const res = await service.updateBranch(USER_ID, HOUNSLOW_ID, {
      registeredManagers: ['Mrs Suzette Thomas', 'Mr New Manager'],
      cqcRating: 'GOOD',
    });
    expect(res.data.registeredManagers).toEqual([
      'Mrs Suzette Thomas',
      'Mr New Manager',
    ]);
    expect(res.data.cqcRating).toBe('GOOD');
    expect(res.data.cqcRatingStatus).toBe('RATED');
    expect(res.data.visitRefCode).toBe('HOU');
    expect(areas[0].registeredManagers).toEqual([
      'Mrs Suzette Thomas',
      'Mr New Manager',
    ]);
    expect(areas[0].updatedById).toBe(USER_ID);
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'location.branch.updated',
        recordId: HOUNSLOW_ID,
      }),
    );
  });

  it('409s when the CQC location id belongs to another branch', async () => {
    const { service, prisma } = setup();
    await expect(
      service.updateBranch(USER_ID, HOUNSLOW_ID, {
        cqcLocationId: '1-2754362586',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.scheduleArea.update).not.toHaveBeenCalled();
  });

  it('keeps its own CQC location id without a clash', async () => {
    const { service } = setup();
    const res = await service.updateBranch(USER_ID, HOUNSLOW_ID, {
      cqcLocationId: '1-115898258',
    });
    expect(res.data.cqcLocationId).toBe('1-115898258');
  });

  it('renames the linked Location when it follows the branch name', async () => {
    const { service, locations } = setup();
    const res = await service.updateBranch(USER_ID, HOUNSLOW_ID, {
      name: 'Allfor Care Hounslow HQ',
    });
    expect(res.data.name).toBe('Allfor Care Hounslow HQ');
    expect(locations[0].name).toBe('Allfor Care Hounslow HQ');
  });

  it('409s when the renamed Location would clash', async () => {
    const { service, prisma } = setup();
    await expect(
      service.updateBranch(USER_ID, HOUNSLOW_ID, {
        name: 'Allfor Care Harrow',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.scheduleArea.update).not.toHaveBeenCalled();
  });

  it('never changes visitRefCode or code', async () => {
    const { service, prisma } = setup();
    await service.updateBranch(USER_ID, HOUNSLOW_ID, {
      visitRefCode: 'ZZZ',
      code: 'NEW',
    } as any);
    const data = prisma.scheduleArea.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('visitRefCode');
    expect(data).not.toHaveProperty('code');
  });

  it('404s for an unknown branch', async () => {
    const { service } = setup();
    await expect(
      service.updateBranch(USER_ID, '44444444-4444-4444-8444-444444444444', {
        phone: '1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
