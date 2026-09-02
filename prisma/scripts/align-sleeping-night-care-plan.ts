/**
 * Align Sleeping and Night Care Plan template (ID-safe: preserve existing section/field UUIDs,
 * stamp sleeping_night_* keys, add Care 2020 needs/goals/support/risk block).
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/align-sleeping-night-care-plan.ts
 */
import { PrismaClient } from '@prisma/client';
import { alignSleepingNightCarePlanTemplate } from '../seeds/sleeping-night-care-plan-schema.util';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await alignSleepingNightCarePlanTemplate(prisma);
    console.log('[align-sleeping-night-care-plan] Done.', result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
