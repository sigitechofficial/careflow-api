/**
 * Upsert default service user funding type lookup.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/seed-funding-types.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedServiceUserFundingTypes } from '../seeds/service-user-funding-types.seed';

const prisma = new PrismaClient();

seedServiceUserFundingTypes(prisma)
  .then(count => {
    console.log(`Funding type lookup seeded: ${count} entries.`);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
