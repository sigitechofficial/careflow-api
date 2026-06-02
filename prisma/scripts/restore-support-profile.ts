import { PrismaClient } from '@prisma/client';

const SU = process.argv[2] ?? 'ea274b6c-9a8a-4bc1-b6c5-27e7c4bd5fdd';
const prisma = new PrismaClient();

async function main() {
  const archived = await prisma.medicationSupportProfile.findFirst({
    where: { serviceUserId: SU, deletedAt: { not: null } },
    orderBy: { updatedAt: 'desc' },
  });
  if (archived) {
    await prisma.medicationSupportProfile.update({
      where: { id: archived.id },
      data: { deletedAt: null, deletedById: null, isActive: true },
    });
    console.log('Restored support profile', archived.id);
    return;
  }
  const active = await prisma.medicationSupportProfile.findFirst({
    where: { serviceUserId: SU, deletedAt: null },
  });
  console.log(active ? 'Support profile already active' : 'No profile found');
}

main()
  .finally(() => prisma.$disconnect());
