import { PrismaClient } from '@prisma/client';
import { seedAssessmentForms } from '../seeds/assessment-forms.seed';

const prisma = new PrismaClient();

async function main() {
  await seedAssessmentForms(prisma);
  const form = await prisma.carePathwayForm.findFirst({
    where: {
      name: 'Assessing For Medication in home care',
      formType: 'ASSESSMENT',
      deletedAt: null,
    },
    include: {
      currentVersion: {
        include: {
          sections: { include: { fields: true } },
        },
      },
    },
  });
  const fieldCount =
    form?.currentVersion?.sections.reduce((sum, section) => sum + section.fields.length, 0) ?? 0;
  console.log(
    `[resync-medication-home-care-assessment] Form id=${form?.id ?? 'missing'} fields=${fieldCount}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
