/**
 * Seed visit status reasons (idempotent).
 * Usage: npx ts-node --transpile-only prisma/scripts/seed-visit-status-reasons.ts
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_VISIT_STATUS_REASONS } from '../seed-data/visit-status-reasons.defaults';

const prisma = new PrismaClient();

async function main() {
  for (const name of DEFAULT_VISIT_STATUS_REASONS) {
    await prisma.visitStatusReason.upsert({
      where: { name },
      update: { isActive: true, deletedAt: null },
      create: { name, isActive: true },
    });
  }
  const count = await prisma.visitStatusReason.count({
    where: { deletedAt: null, isActive: true },
  });
  console.log(
    `[seed-visit-status-reasons] upserted=${DEFAULT_VISIT_STATUS_REASONS.length} active=${count}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
