import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TARGETS = [
  'Type of living accommodation',
  'Other accommodation (please state)',
  'Is client able to answer front door?',
  'Does the client live alone?',
  "Instructions for gaining access to client's home",
  'Instructions for gaining access to client\u2019s home',
  'Does the client receive support from an informal carer?',
  'Is the client receiving a care package?',
];

async function main() {
  const enterprise = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: 'Initial Assessment — Enterprise', deletedAt: null },
    select: { id: true, name: true, isDefault: true },
  });
  console.log('Enterprise template:', enterprise);

  const section = await prisma.initialAssessmentSection.findFirst({
    where: {
      sectionNumber: 1,
      templateId: enterprise?.id,
    },
    include: {
      questions: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!section) {
    console.log('No section 1 found');
    return;
  }

  const active = section.questions.filter((q) => !q.deletedAt);
  const deleted = section.questions.filter((q) => q.deletedAt);
  const spec12 = active.filter((q) => {
    const meta = q.metadata as { specRef?: string } | null;
    return meta?.specRef === '1.2';
  });

  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { id: section.templateId },
    select: { id: true, name: true, isDefault: true },
  });
  console.log('Template:', template);
  console.log('Active §1 questions:', active.length);
  console.log('--- all active §1 texts ---');
  for (const q of active) {
    const meta = q.metadata as { specRef?: string } | null;
    console.log(`  [${q.sortOrder}] ${meta?.specRef ?? '?'} ${JSON.stringify(q.questionText)}`);
  }
  console.log('Deleted §1 questions:', deleted.length);
  console.log('Active specRef 1.2:', spec12.length);
  console.log('--- specRef 1.2 texts ---');
  for (const q of spec12) {
    console.log(`  [${q.sortOrder}] ${JSON.stringify(q.questionText)}`);
  }

  console.log('--- target lookup ---');
  for (const t of TARGETS) {
    const hit = active.find((q) => q.questionText.trim() === t);
    console.log(`${hit ? 'OK' : 'MISSING'}: ${JSON.stringify(t)}`);
  }

  const deleted12 = deleted.filter((q) => {
    const meta = q.metadata as { specRef?: string } | null;
    return meta?.specRef === '1.2';
  });
  if (deleted12.length) {
    console.log('--- deleted specRef 1.2 ---');
    for (const q of deleted12) {
      console.log(`  ${JSON.stringify(q.questionText)}`);
    }
  }

  const accommodation = active.find((q) => q.questionText === 'Type of living accommodation');
  if (accommodation) {
    console.log('Accommodation questionType:', accommodation.questionType);
  }

  const submissions = await prisma.initialAssessmentSubmission.findMany({
    where: { deletedAt: null },
    take: 3,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      templateId: true,
      template: { select: { name: true } },
      serviceUser: { select: { firstName: true, lastName: true } },
    },
  });
  console.log('Recent submissions:', submissions);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
