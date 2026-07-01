/**
 * Idempotent task catalogue seed for tasks planner (visit task assignments).
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/seed-task-catalogue.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedTaskCatalogue } from '../seeds/task-catalogue.seed';

const prisma = new PrismaClient();

async function main() {
  await seedTaskCatalogue(prisma);
  console.log('[task-catalogue] Task catalogue seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
