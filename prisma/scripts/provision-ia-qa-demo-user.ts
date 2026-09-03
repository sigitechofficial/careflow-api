/**
 * Provision the designated IA QA Demo Service User (SU-1042) only.
 *
 * Reuses `seedInitialAssessmentDemoServiceUser`. Does not run `prisma db seed`,
 * does not require SEED_DEMO_DATA, and does not create personas, persona schedules,
 * Care Plan IA overlay answers, or body-map demo data.
 *
 * Usage (from careflow-api):
 *   npm run provision:ia-qa-demo-user
 */
import { PrismaClient } from '@prisma/client';
import { seedInitialAssessmentDemoServiceUser } from '../seeds/initial-assessment-demo-service-user.seed';

const prisma = new PrismaClient();

async function main() {
  const id = await seedInitialAssessmentDemoServiceUser(prisma);
  if (!id) {
    throw new Error('IA QA Demo Service User SU-1042 was not provisioned');
  }
  console.log(`[ia-qa-demo] Provision complete for SU-1042 id=${id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
