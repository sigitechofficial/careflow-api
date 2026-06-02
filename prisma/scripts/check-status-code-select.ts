import { PrismaClient } from '@prisma/client';
import { resolveEventMarStatusCode } from '../../src/medication-charts/medication-chart-display.util';

const p = new PrismaClient();

async function main() {
  const e = await p.medicationAdministrationEvent.findFirst({
    where: { statusCode: 'U', deletedAt: null },
    select: { status: true, statusCode: true },
  });
  console.log('Raw from prisma:', JSON.stringify(e));
  if (e) console.log('Resolved:', resolveEventMarStatusCode(e));
}

main().finally(() => p.$disconnect());
