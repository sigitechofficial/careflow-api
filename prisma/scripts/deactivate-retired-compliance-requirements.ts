/** One-off: deactivate requirements tied to retired compliance types. */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const retiredAt = new Date();
  const result = await prisma.complianceRequirement.updateMany({
    where: {
      deletedAt: null,
      isActive: true,
      complianceType: { OR: [{ isActive: false }, { deletedAt: { not: null } }] },
    },
    data: { isActive: false, deletedAt: retiredAt },
  });
  console.log(`Deactivated ${result.count} orphaned compliance requirement(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
