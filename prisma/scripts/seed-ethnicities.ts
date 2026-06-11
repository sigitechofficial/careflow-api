/**
 * Upsert default service user ethnicity lookup (~100 entries).
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/seed-ethnicities.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedServiceUserEthnicities } from '../seeds/service-user-ethnicities.seed';

const prisma = new PrismaClient();

seedServiceUserEthnicities(prisma)
  .then(count => {
    console.log(`Ethnicity lookup seeded: ${count} entries.`);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
