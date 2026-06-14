import { PrismaClient } from '@prisma/client';
import { seedDefaultAssessmentFormSelections } from '../seeds/default-assessment-form-selection.seed';

const prisma = new PrismaClient();

async function main() {
  await seedDefaultAssessmentFormSelections(prisma);
  const count = await prisma.defaultFormSelection.count({
    where: { formType: 'ASSESSMENT', deletedAt: null, isActive: true },
  });
  console.log(`[seed-assessment-form-selections] Active ASSESSMENT form selections: ${count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
