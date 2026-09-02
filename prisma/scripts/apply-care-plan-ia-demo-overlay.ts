/**
 * Upsert Care Plan–relevant enterprise IA answers + About Me patches for the five demo people.
 * Does not change Care Plan schemas, compose, or the generic IA autofill generator.
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/apply-care-plan-ia-demo-overlay.ts
 */
import { PrismaClient } from '@prisma/client';
import { applyCarePlanIaDemoOverlay } from '../seeds/care-plan-ia-demo-overlay.seed';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await applyCarePlanIaDemoOverlay(prisma);
    console.log(`[apply-care-plan-ia-demo-overlay] template ${result.templateId}`);
    for (const person of result.people) {
      if (person.skipped) {
        console.warn(
          `  SKIP ${person.displayName} (${person.serviceUserNumber}): ${person.skipped}`,
        );
        continue;
      }
      console.log(
        `  ${person.displayName} (${person.serviceUserNumber}) submission=${person.submissionId} upserted=${person.upserted} hiddenCleared=${person.hiddenCleared} aboutMe=${person.aboutMeUpdated}`,
      );
      if (person.unmatched.length > 0) {
        console.warn(`    unmatched: ${person.unmatched.join(', ')}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
