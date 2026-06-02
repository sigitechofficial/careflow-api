/** Set cycleEndDate = runsOutDate where missing (demo data patch). */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.medicationSupplyDelivery.findMany({
    where: { deletedAt: null, cycleEndDate: null, runsOutDate: { not: null } },
    select: { id: true, runsOutDate: true },
  });
  let n = 0;
  for (const row of rows) {
    if (!row.runsOutDate) continue;
    await prisma.medicationSupplyDelivery.update({
      where: { id: row.id },
      data: { cycleEndDate: row.runsOutDate },
    });
    n++;
  }
  console.log(`Patched cycleEndDate on ${n} delivery row(s).`);
}

main()
  .finally(() => prisma.$disconnect());
