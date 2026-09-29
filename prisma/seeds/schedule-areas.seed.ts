import type { PrismaClient } from '@prisma/client';

type ScheduleAreaSeed = {
  name: string;
  code: string;
  /** 3-character branch code for visit references (VIS-[BRANCH]-…). */
  visitRefCode: string;
  sortOrder: number;
  locationName?: string;
  /** lookups.Zone.name (city), e.g. London. */
  zoneName?: string;
  parentZoneName?: string;
};

/** Demo branches under London (borough / area labels stay on the branch). */
const SCHEDULE_AREAS: ScheduleAreaSeed[] = [
  {
    name: 'Croydon Transport',
    code: 'CROYDON_TRANSPORT',
    visitRefCode: 'L00',
    sortOrder: 10,
    locationName: 'Transport - Croydon Transport',
    zoneName: 'London',
    parentZoneName: 'London',
  },
  {
    name: 'Croydon 1',
    code: 'CROYDON_1',
    visitRefCode: 'L01',
    sortOrder: 20,
    locationName: 'Croydon - Croydon 1',
    zoneName: 'London',
    parentZoneName: 'London',
  },
  {
    name: 'Croydon 2',
    code: 'CROYDON_2',
    visitRefCode: 'L02',
    sortOrder: 30,
    locationName: 'Croydon - Croydon 2',
    zoneName: 'London',
    parentZoneName: 'London',
  },
  {
    name: 'Croydon 3',
    code: 'CROYDON_3',
    visitRefCode: 'L03',
    sortOrder: 40,
    locationName: 'Croydon - Croydon 3',
    zoneName: 'London',
    parentZoneName: 'London',
  },
  {
    name: 'Croydon 4',
    code: 'CROYDON_4',
    visitRefCode: 'L04',
    sortOrder: 50,
    locationName: 'Croydon - Croydon 4',
    zoneName: 'London',
    parentZoneName: 'London',
  },
  {
    name: 'Croydon 5',
    code: 'CROYDON_5',
    visitRefCode: 'L05',
    sortOrder: 60,
    locationName: 'Croydon - Croydon 5',
    zoneName: 'London',
    parentZoneName: 'London',
  },
  {
    name: 'Merton',
    code: 'MERTON',
    visitRefCode: 'L06',
    sortOrder: 70,
    locationName: 'Merton - Merton',
    zoneName: 'London',
    parentZoneName: 'London',
  },
  {
    name: 'Haringey',
    code: 'HARINGEY',
    visitRefCode: 'L07',
    sortOrder: 80,
    locationName: 'Haringey - Haringey',
    zoneName: 'London',
    parentZoneName: 'London',
  },
  {
    name: 'Bexley',
    code: 'BEXLEY',
    visitRefCode: 'L08',
    sortOrder: 90,
    locationName: 'Bexley ISF - Bexley',
    zoneName: 'London',
    parentZoneName: 'London',
  },
  {
    name: 'Greenwich',
    code: 'GREENWICH',
    visitRefCode: 'L09',
    sortOrder: 100,
    locationName: 'Greenwich council - Greenwich',
    zoneName: 'London',
    parentZoneName: 'London',
  },
];

/** Sample branch Location labels (lookups.Location) — demo data only (see SEED_SAMPLE_BRANCHES). */
export const SAMPLE_LOCATION_NAMES: readonly string[] = [
  'Croydon - Croydon 1',
  'Croydon - Croydon 2',
  'Croydon - Croydon 3',
  'Croydon - Croydon 4',
  'Croydon - Croydon 5',
  'Merton - Merton',
  'Hackney - Harrow 1',
  'Haringey - Haringey',
  'Croydon Private - Croydon 1 Private',
  'Croydon admin - Croydon office',
  'Bexley ISF - Bexley',
  'Cleaners - Cleaning 1',
  'ALF Private - ALF Private',
  'Greenwich council - Greenwich',
  'Transport - Croydon Transport',
];

/** Generic UK city zones (lookups.Zone) — demo data only (see SEED_SAMPLE_BRANCHES). */
export const SAMPLE_CITY_ZONES: ReadonlyArray<{ name: string; country: string; city: string }> = [
  { name: 'London', country: 'United Kingdom', city: 'London' },
  { name: 'Birmingham', country: 'United Kingdom', city: 'Birmingham' },
  { name: 'Manchester', country: 'United Kingdom', city: 'Manchester' },
  { name: 'Leeds', country: 'United Kingdom', city: 'Leeds' },
  { name: 'Glasgow', country: 'United Kingdom', city: 'Glasgow' },
  { name: 'Edinburgh', country: 'United Kingdom', city: 'Edinburgh' },
  { name: 'Liverpool', country: 'United Kingdom', city: 'Liverpool' },
  { name: 'Bristol', country: 'United Kingdom', city: 'Bristol' },
  { name: 'Sheffield', country: 'United Kingdom', city: 'Sheffield' },
  { name: 'Newcastle', country: 'United Kingdom', city: 'Newcastle' },
  { name: 'Cardiff', country: 'United Kingdom', city: 'Cardiff' },
  { name: 'Belfast', country: 'United Kingdom', city: 'Belfast' },
];

/** Legacy zone rows once seeded as location labels / borough names (soft-deactivated by seed.ts). */
export const LEGACY_SAMPLE_ZONE_NAMES: readonly string[] = [
  ...SAMPLE_LOCATION_NAMES,
  'Croydon',
  'Merton',
  'Haringey',
  'Bexley',
  'Greenwich',
  'Transport',
  'Hackney',
  'ALF Private',
  'Cleaners',
  'Croydon Private',
  'Croydon admin',
];

/** ScheduleArea.code of every sample branch above. */
export const SAMPLE_SCHEDULE_AREA_CODES: readonly string[] = SCHEDULE_AREAS.map((a) => a.code);

export async function seedScheduleAreas(prisma: PrismaClient): Promise<void> {
  for (const item of SCHEDULE_AREAS) {
    let locationId: string | null = null;
    let zoneId: string | null = null;

    if (item.locationName) {
      const location = await prisma.location.findFirst({
        where: { name: item.locationName, deletedAt: null },
      });
      locationId = location?.id ?? null;
    }
    if (item.zoneName) {
      const zone = await prisma.zone.findFirst({
        where: { name: item.zoneName, deletedAt: null },
      });
      zoneId = zone?.id ?? null;
    }

    await prisma.scheduleArea.upsert({
      where: { code: item.code },
      update: {
        name: item.name,
        sortOrder: item.sortOrder,
        visitRefCode: item.visitRefCode,
        locationId,
        zoneId,
        parentZoneName: item.parentZoneName ?? item.zoneName ?? null,
        isActive: true,
        deletedAt: null,
      },
      create: {
        name: item.name,
        code: item.code,
        visitRefCode: item.visitRefCode,
        sortOrder: item.sortOrder,
        locationId,
        zoneId,
        parentZoneName: item.parentZoneName ?? item.zoneName ?? null,
        isActive: true,
      },
    });
  }
}
