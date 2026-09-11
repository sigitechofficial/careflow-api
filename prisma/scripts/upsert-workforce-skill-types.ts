import { PrismaClient } from '@prisma/client';
import { WORKFORCE_CERTIFICATION_NAMES, WORKFORCE_SKILL_NAMES } from '../seed-data/workforce-catalog';

const prisma = new PrismaClient();

async function main() {
  for (const name of WORKFORCE_SKILL_NAMES) {
    await prisma.skillType.upsert({
      where: { name },
      update: { isActive: true, deletedAt: null },
      create: { name, isActive: true },
    });
  }
  for (const name of WORKFORCE_CERTIFICATION_NAMES) {
    await prisma.certificationType.upsert({
      where: { name },
      update: { isActive: true, deletedAt: null },
      create: { name, isActive: true },
    });
  }
  const [skillCount, certCount] = await Promise.all([
    prisma.skillType.count({ where: { deletedAt: null, isActive: true } }),
    prisma.certificationType.count({ where: { deletedAt: null, isActive: true } }),
  ]);
  console.log(`Skill types active: ${skillCount} (catalog ${WORKFORCE_SKILL_NAMES.length})`);
  console.log(`Certification types active: ${certCount} (catalog ${WORKFORCE_CERTIFICATION_NAMES.length})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
