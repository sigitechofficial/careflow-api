/**
 * Apply ONLY the care-plan form templates (sections + fields) to the database that
 * DATABASE_URL points at — no personas, no lookups, no demo data.
 *
 * This runs `seedCarePlanForms`, which dispatches every Care 2020 form to its dedicated,
 * ID-SAFE applier (`apply*Schema`): existing section/field UUIDs are preserved, new fields
 * are added, and unrecognised fields are only deactivated (never hard-deleted). Because
 * saved answers in `ServiceUserCarePlanInstance.valuesJson` are keyed by
 * `${sectionId}:${fieldId}`, preserving those UUIDs means existing answers are NOT orphaned.
 *
 * Use this to bring a target DB's care-plan forms up to date (e.g. apply Care 2020 fields to
 * production) WITHOUT running the full `prisma db seed` (which also seeds lookups, permissions,
 * and demo personas, and crashes on some hosts due to a src/ import — see seed.ts).
 *
 * Usage (run from a FULL repo checkout, where prisma/seeds/* resolve normally):
 *   DATABASE_URL="postgresql://<connection>" npx ts-node prisma/scripts/apply-care-plan-forms.ts
 *
 * Idempotent — safe to run repeatedly. Take a DB backup before running against production.
 */
import { PrismaClient } from '@prisma/client';
import { seedCarePlanForms } from '../seeds/care-plan-forms.seed';

async function main() {
  const target = process.env.DATABASE_URL ?? '(unset)';
  // Print only the host/db, never the credentials.
  const safeTarget = target.replace(/\/\/[^@]*@/, '//****@');
  console.log(`[apply-care-plan-forms] Target DATABASE_URL: ${safeTarget}`);

  const prisma = new PrismaClient();
  try {
    await seedCarePlanForms(prisma);
    console.log('[apply-care-plan-forms] Done — care-plan form templates applied (ID-safe).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[apply-care-plan-forms] Failed:', err);
  process.exit(1);
});
