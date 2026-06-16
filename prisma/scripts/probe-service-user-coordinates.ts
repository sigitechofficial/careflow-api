import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.serviceUser.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      address: {
        select: { id: true, latitude: true, longitude: true },
      },
    },
  });

  const missing = users.filter(
    (u) => u.address?.latitude == null || u.address?.longitude == null,
  );

  console.log(`Total service users: ${users.length}`);
  console.log(`Missing coordinates: ${missing.length}`);
  for (const u of users) {
    const lat = u.address?.latitude?.toString() ?? '—';
    const lng = u.address?.longitude?.toString() ?? '—';
    console.log(`- ${u.firstName} ${u.lastName}: ${lat}, ${lng}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
