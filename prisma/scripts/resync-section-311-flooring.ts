/**
 * Purges all §3.11 / sec_flooring template questions + answers, then re-runs enterprise seed.
 * Usage: npm run seed:section-311-flooring
 */
import { PrismaClient } from '@prisma/client';
import { seedInitialAssessmentEnterprise } from '../seeds/initial-assessment-enterprise.seed';
import { purgeSection311FlooringQuestions } from '../seeds/initial-assessment-section-311.seed';

async function main() {
  const prisma = new PrismaClient();
  try {
    const purged = await purgeSection311FlooringQuestions(prisma);
    console.log(
      `[resync-311] Purged ${purged.questions} flooring question(s) and ${purged.answers} answer(s).`,
    );
    await seedInitialAssessmentEnterprise(prisma);
    console.log('[resync-311] Enterprise initial assessment template re-seeded.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
