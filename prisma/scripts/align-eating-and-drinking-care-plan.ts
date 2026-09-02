/**
 * Align Eating and Drinking Care Plan template (ID-safe: preserve existing section/field UUIDs,
 * add Care 2020 area-risk follow-up fields and stamp conditionalLogicJson).
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/align-eating-and-drinking-care-plan.ts
 */
import { PrismaClient } from '@prisma/client';
import { alignEatingAndDrinkingCarePlanTemplate } from '../seeds/eating-and-drinking-care-plan-schema.util';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await alignEatingAndDrinkingCarePlanTemplate(prisma);
    console.log('[align-eating-and-drinking-care-plan] Done.', result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
