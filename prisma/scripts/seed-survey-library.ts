/**
 * Idempotent survey library seed (Surveys → Ready-made surveys). Also runs in prisma db seed.
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/seed-survey-library.ts [--partial]
 * --partial skips survey files that do not pass the checks yet, with a warning (local previews only).
 */
import { PrismaClient } from '@prisma/client';
import { seedSurveyLibrary } from '../seeds/survey-library.seed';
import { loadSurveyLibrary, readReleasedLibraryIds } from '../seed-lib/survey-library';

const prisma = new PrismaClient();

async function main() {
  // A skipped (unfinished) file is still in the library: its catalogue survey is kept, not retired.
  const skipped: string[] = [];
  const files = loadSurveyLibrary(undefined, { partial: process.argv.includes('--partial'), skipped });
  if (skipped.length) console.warn(`[survey-library] kept as they were (skipped): ${skipped.join(', ')}`);
  const result = await seedSurveyLibrary(prisma, files, readReleasedLibraryIds(), { keep: skipped });
  console.log('[survey-library] Survey library seeded:', result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
