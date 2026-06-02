/**
 * Delete all body map data and seed realistic demo records.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/reset-and-seed-body-map-demo.ts
 *   npx ts-node --transpile-only prisma/scripts/reset-and-seed-body-map-demo.ts <serviceUserId>
 */
import { PrismaClient } from '@prisma/client';
import { resetAndSeedBodyMapDemo } from '../seeds/body-map-demo.seed';

const serviceUserId = process.argv[2];

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('══ Body map reset + realistic demo seed ══\n');
    const result = await resetAndSeedBodyMapDemo(prisma, {
      serviceUserId,
      includeSecondServiceUser: true,
    });
    if (result) {
      console.log('\n✅ Done');
      console.log('Service user:', result.serviceUserId);
      console.log('Records:', result.recordCount);
      console.log('Open: /service-users/' + result.serviceUserId + '/body-map');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
