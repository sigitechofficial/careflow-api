/**
 * Idempotent CQC framework seed (Quality & compliance → CQC evidence). Also runs in prisma db seed.
 * Re-maps evidence to the active framework version after a framework change.
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/seed-cqc-framework.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedCqcFramework } from '../seeds/cqc-framework.seed';

const prisma = new PrismaClient();

async function main() {
  const result = await seedCqcFramework(prisma);
  console.log('[cqc-framework] CQC framework seeded:', result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
