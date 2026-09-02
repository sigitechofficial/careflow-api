/**
 * Align Pressure Ulcer Care Plan template (ID-safe: preserve existing section/field UUIDs,
 * stamp pressure_ulcer_* keys, add Care 2020 needs/goals/support/risk block).
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/align-pressure-ulcer-care-plan.ts
 */
import { PrismaClient } from '@prisma/client';
import { alignPressureUlcerCarePlanTemplate } from '../seeds/pressure-ulcer-care-plan-schema.util';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await alignPressureUlcerCarePlanTemplate(prisma);
    console.log('[align-pressure-ulcer-care-plan] Done.', result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
