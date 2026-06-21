import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const areas = await prisma.scheduleArea.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true, locationId: true, parentZoneName: true },
    orderBy: { name: 'asc' },
  });
  console.log('Schedule areas:', areas);

  const locs = await prisma.location.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  console.log('Locations:', locs);

  const sus = await prisma.serviceUser.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      locationId: true,
      careType: { select: { name: true, code: true } },
    },
  });
  console.log('Service users:', sus);

  const assignments = await prisma.serviceUserAssignment.findMany({
    where: { deletedAt: null },
    select: { serviceUserId: true, locationId: true },
  });
  console.log('Assignments:', assignments);

  const addresses = await prisma.serviceUser.findMany({
    where: { deletedAt: null },
    select: {
      firstName: true,
      lastName: true,
      address: { select: { town: true, postcode: true, county: true } },
    },
  });
  console.log('Addresses:', addresses);

  const jobs = await prisma.scheduledJob.groupBy({
    by: ['serviceUserId', 'scheduleAreaId'],
    where: { deletedAt: null, scheduleAreaId: { not: null } },
    _count: true,
  });
  console.log('Scheduled job areas:', jobs);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
