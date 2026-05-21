import type { PrismaClient } from '@prisma/client';

type ScheduleAreaSeed = {
  name: string;
  code: string;
  sortOrder: number;
  locationName?: string;
  zoneName?: string;
};

const SCHEDULE_AREAS: (ScheduleAreaSeed & { parentZoneName?: string })[] = [
  { name: 'Croydon Transport', code: 'CROYDON_TRANSPORT', sortOrder: 10, locationName: 'Transport - Croydon Transport', parentZoneName: 'Transport' },
  { name: 'Croydon 1', code: 'CROYDON_1', sortOrder: 20, locationName: 'Croydon - Croydon 1', parentZoneName: 'Croydon' },
  { name: 'Croydon 2', code: 'CROYDON_2', sortOrder: 30, locationName: 'Croydon - Croydon 2', parentZoneName: 'Croydon' },
  { name: 'Croydon 3', code: 'CROYDON_3', sortOrder: 40, locationName: 'Croydon - Croydon 3', parentZoneName: 'Croydon' },
  { name: 'Croydon 4', code: 'CROYDON_4', sortOrder: 50, locationName: 'Croydon - Croydon 4', parentZoneName: 'Croydon' },
  { name: 'Croydon 5', code: 'CROYDON_5', sortOrder: 60, locationName: 'Croydon - Croydon 5', parentZoneName: 'Croydon' },
  { name: 'Merton', code: 'MERTON', sortOrder: 70, locationName: 'Merton - Merton' },
  { name: 'Haringey', code: 'HARINGEY', sortOrder: 80, locationName: 'Haringey - Haringey' },
  { name: 'Bexley', code: 'BEXLEY', sortOrder: 90, locationName: 'Bexley ISF - Bexley' },
  { name: 'Greenwich', code: 'GREENWICH', sortOrder: 100, locationName: 'Greenwich council - Greenwich' },
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
    } else if (item.locationName) {
      const zone = await prisma.zone.findFirst({
        where: { name: item.locationName, deletedAt: null },
      });
      zoneId = zone?.id ?? null;
    }

    await prisma.scheduleArea.upsert({
      where: { code: item.code },
      update: {
        name: item.name,
        sortOrder: item.sortOrder,
        locationId,
        zoneId,
        parentZoneName: item.parentZoneName ?? null,
        isActive: true,
        deletedAt: null,
      },
      create: {
        name: item.name,
        code: item.code,
        sortOrder: item.sortOrder,
        locationId,
        zoneId,
        parentZoneName: item.parentZoneName ?? null,
        isActive: true,
      },
    });
  }
}
