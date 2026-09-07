/**
 * Standalone: seed service user areas for all schedule-area branches.
 * Usage: npx ts-node --transpile-only prisma/scripts/seed-service-user-areas.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedServiceUserAreas } from '../seeds/service-user-areas.seed';

const prisma = new PrismaClient();

async function main() {
  const result = await seedServiceUserAreas(prisma);
  console.log(
    `[seed-service-user-areas] branches=${result.branches} areas=${result.areas} postcodes=${result.postcodes}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
