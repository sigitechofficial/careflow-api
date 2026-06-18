import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.serviceUser.findMany({
    where: { serviceUserNumber: { startsWith: 'SU-TEST-' }, deletedAt: null },
    select: {
      serviceUserNumber: true,
      firstName: true,
      lastName: true,
      medications: {
        where: { deletedAt: null },
        select: { medicationName: true, strength: true, medicationKind: true, status: true },
        orderBy: { medicationName: 'asc' },
      },
      medicationSupportProfiles: { where: { deletedAt: null }, take: 1 },
    },
    orderBy: { serviceUserNumber: 'asc' },
  });

  console.log('Persona medications in database\n');
  for (const u of users) {
    const meds = u.medications;
    console.log(`${u.serviceUserNumber} ${u.firstName} ${u.lastName} — ${meds.length} medication(s)`);
    for (const m of meds) {
      console.log(`    • ${m.medicationName} ${m.strength} [${m.medicationKind}] ${m.status}`);
    }
    if (!meds.length) console.log('    (none)');
  }
}

main().finally(() => prisma.$disconnect());
