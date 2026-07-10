/**
 * Seed industry-style charge cards (Birdie / Nourish / LA & private-pay benchmarks).
 *
 * Usage: npm run seed:charge-cards
 */
import { PrismaClient } from '@prisma/client';
import { seedChargeCards } from '../seeds/charge-cards.seed';

const prisma = new PrismaClient();

async function main() {
  const result = await seedChargeCards(prisma);
  console.log(`Charge cards seeded: ${result.upserted}`);
  for (const code of result.codes) {
    console.log(`  • ${code}`);
  }
  if (result.funderLinked.length) {
    console.log(`  Funder-linked: ${result.funderLinked.join(', ')}`);
  } else {
    console.log('  Note: no funders matched — run main seed first for funder targets.');
  }
  if (result.branchLinked) {
    console.log(`  London branch linked: ${result.branchLinked}`);
  } else {
    console.log('  Note: no branch matching "London" found — CHG-LON-BRN-2026 saved without branch target.');
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
