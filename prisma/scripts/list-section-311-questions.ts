import { PrismaClient } from '@prisma/client';
import { isSection311FlooringQuestion } from '../seeds/initial-assessment-section-311.seed';

const prisma = new PrismaClient();

async function main() {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: 'Initial Assessment — Enterprise', deletedAt: null },
  });
  if (!template) {
    console.log('No enterprise template');
    return;
  }
  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 3, deletedAt: null },
  });
  if (!section) {
    console.log('No section 3');
    return;
  }
  const questions = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: section.id, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, questionText: true, isActive: true, metadata: true },
  });
  const flooring = questions.filter((q) => isSection311FlooringQuestion(q.metadata));
  console.log('--- Active §3.11 / sec_flooring ---');
  for (const q of flooring.filter((x) => x.isActive)) {
    const m = q.metadata as Record<string, unknown>;
    console.log(`  [${m.specRef ?? '?'}] ${q.questionText}`);
  }
  console.log('--- Inactive (still deletedAt null) ---');
  for (const q of flooring.filter((x) => !x.isActive)) {
    console.log(`  ${q.questionText}`);
  }
  const byRef = questions.filter(
    (q) =>
      q.isActive &&
      q.metadata &&
      typeof q.metadata === 'object' &&
      (q.metadata as Record<string, unknown>).specRef === '3.11',
  );
  console.log(`\nActive specRef=3.11 count: ${byRef.length}`);
}

main()
  .finally(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
