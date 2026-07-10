/**
 * Seed industry-style pay cards (Birdie / Nourish / HCA benchmarks).
 *
 * Usage: npm run seed:pay-cards
 */
import { PrismaClient } from '@prisma/client';
import { seedPayCards } from '../seeds/pay-cards.seed';

const prisma = new PrismaClient();

async function main() {
  const result = await seedPayCards(prisma);
  console.log(`Pay cards seeded: ${result.upserted}`);
  for (const code of result.codes) {
    console.log(`  • ${code}`);
  }
  if (result.branchLinked) {
    console.log(`  London branch linked: ${result.branchLinked}`);
  } else {
    console.log('  Note: no branch matching "London" found — PAY-LON-2026 saved without branch target.');
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
