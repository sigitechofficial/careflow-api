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
