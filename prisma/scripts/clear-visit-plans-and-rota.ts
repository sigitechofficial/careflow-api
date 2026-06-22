/**
 * Delete all visit plans and scheduling rota data for every service user.
 * Keeps service users, employees, schedule areas (catalog), and all other records.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/clear-visit-plans-and-rota.ts --dry-run
 *   npx ts-node --transpile-only prisma/scripts/clear-visit-plans-and-rota.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  clearVisitPlansAndRota,
  countVisitPlansAndRotaRows,
} from '../../src/service-user-visit-plans/clear-visit-plans-and-rota.util';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(DRY_RUN ? 'Dry run — counts only.\n' : 'Clearing visit plans and rota…\n');

  const counts = await countVisitPlansAndRotaRows(prisma);
  for (const [label, n] of Object.entries(counts)) {
    console.log(`  ${label}: ${n}`);
  }

  if (DRY_RUN) {
    console.log('\nRe-run without --dry-run to delete.');
    return;
  }

  const result = await clearVisitPlansAndRota(prisma, { dryRun: false });
  if (result.deleted) {
    console.log('\nDeleted:');
    for (const [label, n] of Object.entries(result.deleted)) {
      console.log(`  ${label}: ${n}`);
    }
  }

  console.log('\nDone — service users and schedule area catalog were kept.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
