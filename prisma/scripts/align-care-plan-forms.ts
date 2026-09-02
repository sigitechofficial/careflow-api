/**
 * ID-safe refresh of all Care Plan templates (preserve section/field UUIDs).
 * Applies Care 2020 area-risk follow-up fields and stamps conditionalLogicJson.
 * Does not run the full `prisma db seed`.
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/align-care-plan-forms.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedCarePlanForms } from '../seeds/care-plan-forms.seed';

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedCarePlanForms(prisma);
    console.log('[align-care-plan-forms] Done.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
