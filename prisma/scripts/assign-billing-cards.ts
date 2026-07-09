/**
 * Assign default pay cards to employees and charge cards to service users
 * that do not already have one.
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/assign-billing-cards.ts
 */
import { PrismaClient } from '@prisma/client';
import { assignMissingBillingCards } from '../seeds/assign-billing-cards.seed';

const prisma = new PrismaClient();

async function main() {
  const result = await assignMissingBillingCards(prisma);

  console.log('Billing card assignment complete:');
  console.log(`  Pay cards assigned:     ${result.payAssigned}`);
  console.log(`  Pay cards skipped:      ${result.paySkipped} (no matching card)`);
  console.log(`  Charge cards assigned:  ${result.chargeAssigned}`);
  console.log(`  Charge cards skipped:   ${result.chargeSkipped} (no matching card)`);
  if (result.employeesWithoutEmployment > 0) {
    console.log(
      `  Note: ${result.employeesWithoutEmployment} active employee(s) have no employment record and were not updated.`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
