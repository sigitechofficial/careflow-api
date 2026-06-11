/**
 * Upsert the default allergy catalogue (100+ entries per category).
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/seed-allergy-catalog.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedAllergyCatalog } from '../seeds/allergy-catalog.seed';

const prisma = new PrismaClient();

seedAllergyCatalog(prisma)
  .then(count => {
    console.log(`Allergy catalogue seeded: ${count} entries.`);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
