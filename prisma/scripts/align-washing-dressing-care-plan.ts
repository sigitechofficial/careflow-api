/**
 * Align Washing and dressing Care Plan template (ID-safe: preserve existing section/field UUIDs,
 * stamp washing_dressing_* keys, add Care 2020 needs/goals/support/risk block).
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/align-washing-dressing-care-plan.ts
 */
import { PrismaClient } from '@prisma/client';
import { alignWashingDressingCarePlanTemplate } from '../seeds/washing-dressing-care-plan-schema.util';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await alignWashingDressingCarePlanTemplate(prisma);
    console.log('[align-washing-dressing-care-plan] Done.', result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
