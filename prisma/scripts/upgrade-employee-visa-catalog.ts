/**
 * Ensure enterprise immigration status lookups (12 rows) with max weekly hour caps.
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/upgrade-employee-visa-catalog.ts
 */
import { PrismaClient } from '@prisma/client';
import { ensureEnterpriseImmigrationStatusLookups } from '../seeds/employee-immigration-statuses.seed';

const prisma = new PrismaClient();

async function main() {
  const result = await ensureEnterpriseImmigrationStatusLookups(prisma);
  console.log(
    `[visa-catalog] ${result.statusCount} immigration statuses (max hours: 40 standard, 20/10 student). Remapped ${result.remappedEmploymentIds} legacy employment id(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
