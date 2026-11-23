/**
 * Idempotent ready-made audits seed (Governance → Audits → Audit library). Also runs in prisma db seed.
 *
 * Usage: npm run seed:audit-library
 */
import { PrismaClient } from '@prisma/client';
import { seedAuditLibrary } from '../seeds/audit-library.seed';

const prisma = new PrismaClient();

async function main() {
  const result = await seedAuditLibrary(prisma);
  console.log('[audit-library] Ready-made audits seeded:', result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
