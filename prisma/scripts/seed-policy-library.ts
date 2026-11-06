/**
 * Idempotent policy library seed (Policies → Ready-made policies). Also runs in prisma db seed.
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/seed-policy-library.ts [--partial]
 * --partial allows related policies that are not written yet (local previews only).
 */
import { PrismaClient } from '@prisma/client';
import { seedPolicyLibrary } from '../seeds/policy-library.seed';
import { loadPolicyLibrary } from '../seed-lib/policy-library';

const prisma = new PrismaClient();

async function main() {
  const result = await seedPolicyLibrary(prisma, loadPolicyLibrary(undefined, { partial: process.argv.includes('--partial') }));
  console.log('[policy-library] Policy library seeded:', result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
