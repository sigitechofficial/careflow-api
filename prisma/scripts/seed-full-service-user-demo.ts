/**
 * Full demo profile for one service user (matches local dev workflow):
 *   1) Prisma demo data — observations, allergies, inventory, flash, assessment, legal, DOLS
 *   2) HTTP API — realistic medications, supply, MAR, PRN, admin corrections
 *   3) Restore archived medication support profile if present
 *
 * Usage (on server or locally):
 *   API_BASE_URL=https://careflowbackend.sigisolutions.net \
 *   PROBE_EMAIL=admin@careadmin.local \
 *   PROBE_PASSWORD='Admin@12345' \
 *   npx ts-node --transpile-only prisma/scripts/seed-full-service-user-demo.ts <serviceUserId>
 *
 *   npx ts-node --transpile-only prisma/scripts/seed-full-service-user-demo.ts --dry-run <serviceUserId>
 */
import { execSync } from 'child_process';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { seedDemoServiceUserData } from '../seeds/demo-service-user-data.seed';

const cliArgs = process.argv.slice(2);
const DRY_RUN = cliArgs.includes('--dry-run');
const SERVICE_USER_ID = cliArgs.find((a) => !a.startsWith('--'));

async function main() {
  if (!SERVICE_USER_ID) {
    console.error(
      'Usage: npx ts-node --transpile-only prisma/scripts/seed-full-service-user-demo.ts [--dry-run] <serviceUserId>',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const serviceUser = await prisma.serviceUser.findFirst({
    where: { id: SERVICE_USER_ID, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!serviceUser) {
    console.error(`Service user not found or deleted: ${SERVICE_USER_ID}`);
    process.exit(1);
  }

  console.log('══ Full service user demo seed ══');
  console.log('Service user:', `${serviceUser.firstName} ${serviceUser.lastName}`, serviceUser.id);
  if (DRY_RUN) console.log('DRY RUN (Prisma demo only; API seed skipped)\n');

  console.log('\n── Phase 1: Prisma demo (non-MAR clinical context) ──');
  await seedDemoServiceUserData(prisma, {
    serviceUserId: SERVICE_USER_ID,
    skipMedications: true,
    skipObservationsIfAny: true,
  });

  await prisma.$disconnect();

  if (DRY_RUN) {
    console.log('\nDry run complete. Re-run without --dry-run to seed medications via API.');
    return;
  }

  const root = process.cwd();
  const apiScript = join(root, 'prisma/scripts/reset-and-seed-realistic-medication-via-api.ts');
  const profileScript = join(root, 'prisma/scripts/restore-support-profile.ts');

  console.log('\n── Phase 2: Realistic medication + MAR via HTTP API ──');
  execSync(`npx ts-node --transpile-only "${apiScript}" "${SERVICE_USER_ID}"`, {
    stdio: 'inherit',
    env: process.env,
    cwd: root,
  });

  console.log('\n── Phase 3: Medication support profile ──');
  execSync(`npx ts-node --transpile-only "${profileScript}" "${SERVICE_USER_ID}"`, {
    stdio: 'inherit',
    env: process.env,
    cwd: root,
  });

  console.log('\n✅ Full demo seed finished for', SERVICE_USER_ID);
  console.log(
    'Admin UI: Medication → Records / MAR calendar / Supply / History / Activity log',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
