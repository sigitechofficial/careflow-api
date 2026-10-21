import { randomUUID } from 'crypto';
import { seedAllforCareOrganisation } from '../../prisma/seeds/allforcare-branches.seed';
import { ALLFOR_CARE_BRANCHES } from '../../prisma/seed-data/allforcare-organisation';

type Row = Record<string, any>;

/** Minimal in-memory stand-in for the Prisma delegates the seed uses. */
function fakeDb(opts: { timezone?: string } = {}) {
  const company: Row = {
    id: '00000000-0000-4000-8000-000000000001',
    companyName: 'All For Care Services Ltd',
    displayName: 'All For Care Services Ltd',
    companyWebsite: 'suzettethomas@allforcare.co.uk',
    companyNumber: null,
    legalName: null,
    cqcProviderId: null,
    sicCodes: [],
    countryCode: 'GB',
    currency: 'GBP',
    locale: 'en-GB',
  };
  const settings: Row = {
    id: '00000000-0000-4000-8000-000000000002',
    timezone: opts.timezone ?? 'Asia/Karachi',
  };
  const zones: Row[] = [];
  const locations: Row[] = [];
  const areas: Row[] = [];
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'not' in v
        ? row[k] !== v.not
        : (row[k] ?? null) === v,
    );
  const db = {
    companyProfile: {
      findUnique: async () => company,
      update: async ({ data }: Row) => Object.assign(company, data),
    },
    organisationGeneralSettings: {
      findUnique: async () => settings,
      update: async ({ data }: Row) => Object.assign(settings, data),
    },
    zone: {
      findUnique: async ({ where }: Row) =>
        zones.find((z) => z.name === where.name) ?? null,
      create: async ({ data }: Row) => {
        const row = { id: randomUUID(), deletedAt: null, ...data };
        zones.push(row);
        return row;
      },
    },
    location: {
      findUnique: async ({ where }: Row) =>
        locations.find((l) => l.name === where.name) ?? null,
      create: async ({ data }: Row) => {
        const row = { id: randomUUID(), deletedAt: null, ...data };
        locations.push(row);
        return row;
      },
      update: async ({ where, data }: Row) =>
        Object.assign(locations.find((l) => l.id === where.id)!, data),
    },
    scheduleArea: {
      findUnique: async ({ where }: Row) =>
        areas.find((a) => matches(a, where)) ?? null,
      findFirst: async ({ where }: Row) =>
        areas.find((a) => matches(a, where)) ?? null,
      create: async ({ data }: Row) => {
        const row = { id: randomUUID(), deletedAt: null, ...data };
        areas.push(row);
        return row;
      },
      update: async ({ where, data }: Row) =>
        Object.assign(areas.find((a) => a.id === where.id)!, data),
    },
  };
  return { db: db as any, company, settings, zones, locations, areas };
}

describe('seedAllforCareOrganisation', () => {
  it('spec data: 5 branches with unique keys, no invented emails/coordinates', () => {
    expect(ALLFOR_CARE_BRANCHES).toHaveLength(5);
    for (const key of [
      'cqcLocationId',
      'code',
      'visitRefCode',
      'name',
    ] as const) {
      expect(new Set(ALLFOR_CARE_BRANCHES.map((b) => b[key])).size).toBe(5);
    }
    expect(ALLFOR_CARE_BRANCHES.every((b) => b.email === null)).toBe(true);
    expect(
      ALLFOR_CARE_BRANCHES.every((b) => /^[A-Z0-9]{3}$/.test(b.visitRefCode)),
    ).toBe(true);
  });

  it('creates the organisation fields and 5 branches with the spec values', async () => {
    const f = fakeDb();
    await seedAllforCareOrganisation(f.db, { alignTimezone: true });

    expect(f.areas).toHaveLength(5);
    expect(f.locations.map((l) => l.name).sort()).toEqual(
      ALLFOR_CARE_BRANCHES.map((b) => b.name).sort(),
    );
    expect(f.zones.map((z) => z.name).sort()).toEqual(['Doncaster', 'London']);
    expect(f.company).toMatchObject({
      cqcProviderId: '1-101656545',
      companyNumber: '05142064',
      legalName: 'ALLFOR CARE SERVICES LIMITED',
    });
    expect(f.settings.timezone).toBe('Europe/London');

    const byId = (id: string) => f.areas.find((a) => a.cqcLocationId === id)!;
    expect(byId('1-2754362586').registeredManagers).toEqual([
      'Miss Veron Minott',
      'Mrs Suzette Lisa Ann Marie Thomas',
    ]);
    expect(byId('1-22151677367')).toMatchObject({
      cqcRating: null,
      cqcRatingStatus: 'NOT_YET_RATED',
    });
    expect(
      byId('1-22151677367').cqcRegistrationDate.toISOString().slice(0, 10),
    ).toBe('2025-03-25');
    expect(byId('1-9322505965').cqcRating).toBe('GOOD');
    expect(byId('1-4551889312')).toMatchObject({
      address: '239 Kensington High Street, London, Greater London, W8 6SN',
      localAuthority: 'Kensington and Chelsea',
    });
    expect(
      f.areas.every(
        (a) =>
          a.email === null && a.latitude === undefined && a.status === 'ACTIVE',
      ),
    ).toBe(true);
  });

  it('is idempotent and never reverts admin edits unless overwriting', async () => {
    const f = fakeDb();
    await seedAllforCareOrganisation(f.db);
    const hounslow = f.areas.find((a) => a.cqcLocationId === '1-115898258')!;
    hounslow.name = 'Hounslow (renamed in admin)';
    hounslow.email = 'hounslow@example.test';

    const second = await seedAllforCareOrganisation(f.db);
    expect(
      second
        .filter((c) => c.action !== 'unchanged')
        .map((c) => `${c.entity}:${c.action}`),
    ).toEqual([]);
    expect(hounslow.name).toBe('Hounslow (renamed in admin)');
    expect(f.company.companyName).toBe('All For Care Services Ltd'); // placeholder kept without overwrite
    expect(f.settings.timezone).toBe('Asia/Karachi'); // alignTimezone off (dev)

    await seedAllforCareOrganisation(f.db, { overwrite: true });
    expect(hounslow.name).toBe('Allfor Care Hounslow');
    expect(hounslow.email).toBe('hounslow@example.test'); // null in spec = unknown, never cleared
    expect(f.company).toMatchObject({
      companyName: 'Allfor Care Services Limited',
      companyWebsite: 'https://www.allforcare.co.uk',
    });
    expect(f.settings.timezone).toBe('Europe/London');
    expect(f.areas).toHaveLength(5);
  });

  it('dry run writes nothing; soft-deleted branches are not resurrected by deploy seeds', async () => {
    const f = fakeDb();
    const plan = await seedAllforCareOrganisation(f.db, {
      dryRun: true,
      overwrite: true,
    });
    expect(
      plan.filter((c) => c.entity === 'ScheduleArea' && c.action === 'create'),
    ).toHaveLength(5);
    expect(f.areas).toHaveLength(0);

    await seedAllforCareOrganisation(f.db);
    const croydon = f.areas.find((a) => a.cqcLocationId === '1-9322505965')!;
    croydon.deletedAt = new Date();
    croydon.isActive = false;
    await seedAllforCareOrganisation(f.db);
    expect(croydon.isActive).toBe(false);
    expect(f.areas).toHaveLength(5);
  });

  it('leaves visitRefCode unset instead of failing when another branch already uses it', async () => {
    const f = fakeDb();
    f.areas.push({
      id: randomUUID(),
      code: 'ADMIN_MADE',
      visitRefCode: 'CRO',
      cqcLocationId: null,
      deletedAt: null,
    });
    const changes = await seedAllforCareOrganisation(f.db);
    expect(
      f.areas.find((a) => a.cqcLocationId === '1-9322505965')!.visitRefCode,
    ).toBeNull();
    expect(changes.find((c) => c.key === '1-9322505965')!.note).toContain(
      'already used by ADMIN_MADE',
    );
  });
});
