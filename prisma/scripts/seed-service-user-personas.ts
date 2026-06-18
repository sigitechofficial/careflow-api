/**
 * Standalone runner for service user persona seed.
 *
 * Usage:
 *   npm run seed:personas
 *   npx ts-node --transpile-only prisma/scripts/seed-service-user-personas.ts
 *   npx ts-node --transpile-only prisma/scripts/seed-service-user-personas.ts --only SU-P01,SU-P02
 */
import { PrismaClient } from '@prisma/client';
import { seedServiceUserPersonas } from '../seeds/service-user-personas.seed';

const prisma = new PrismaClient();

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const onlyCodes = onlyArg
    ? onlyArg
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  await seedServiceUserPersonas(prisma, { onlyCodes });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
