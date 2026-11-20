/**
 * Idempotent ready-made mock CQC inspections seed (Governance → Mock CQC inspection → Ready-made
 * inspections): templates, their statements' guidance and linked policies. Also runs in prisma db seed.
 *
 * Usage: npm run seed:mock-inspection-library
 */
import { PrismaClient } from '@prisma/client';
import { seedMockInspectionLibrary } from '../seeds/mock-inspection-library.seed';

const prisma = new PrismaClient();

async function main() {
  const result = await seedMockInspectionLibrary(prisma);
  console.log('[mock-inspection-library] Ready-made mock inspections seeded:', result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
