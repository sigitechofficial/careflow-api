/**
 * Align Home Support Plan template (9 sections, 43 hsp_* fields) without destructive schema wipe.
 *
 * Usage: npx ts-node prisma/scripts/align-home-support-plan.ts
 */
import { PrismaClient } from '@prisma/client';
import { alignHomeSupportPlanTemplate } from '../seeds/home-support-plan-schema.util';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await alignHomeSupportPlanTemplate(prisma);
    console.log('[align-home-support-plan] Done.', result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
