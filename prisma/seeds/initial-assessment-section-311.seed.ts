import type { PrismaClient } from '@prisma/client';
import {
  SECTION_311_CANONICAL_QUESTION_TEXT,
  SECTION_311_FLOORING_QUESTION_TEXT,
} from './initial-assessment-enterprise-metadata';

const ENTERPRISE_TEMPLATE_NAME = 'Initial Assessment — Enterprise';

export function isSection311FlooringQuestion(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const meta = metadata as Record<string, unknown>;
  return meta.legacyCatalogSection === 'sec_flooring' || meta.specRef === '3.11';
}

/**
 * Soft-delete all §3.11 / sec_flooring template questions and remove stored answers.
 * Run before enterprise seed so the three canonical YES/NO fields are recreated cleanly.
 */
export async function purgeSection311FlooringQuestions(
  prisma: PrismaClient,
): Promise<{ questions: number; answers: number }> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) return { questions: 0, answers: 0 };

  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 3, deletedAt: null },
  });
  if (!section) return { questions: 0, answers: 0 };

  const questions = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: section.id, deletedAt: null },
    select: { id: true, metadata: true },
  });

  const flooringIds = questions
    .filter((q) => isSection311FlooringQuestion(q.metadata))
    .map((q) => q.id);

  if (flooringIds.length === 0) return { questions: 0, answers: 0 };

  const { count: answerCount } = await prisma.initialAssessmentAnswer.deleteMany({
    where: { questionId: { in: flooringIds } },
  });

  await prisma.initialAssessmentAction.updateMany({
    where: { sourceQuestionId: { in: flooringIds } },
    data: { sourceQuestionId: null },
  });

  await prisma.initialAssessmentRiskRecord.updateMany({
    where: { sourceQuestionId: { in: flooringIds } },
    data: { sourceQuestionId: null },
  });

  const now = new Date();
  await prisma.initialAssessmentQuestion.updateMany({
    where: { id: { in: flooringIds } },
    data: { deletedAt: now, isActive: false },
  });

  return { questions: flooringIds.length, answers: answerCount };
}

/** Soft-delete any active §3.11 / sec_flooring row that is not one of the two canonical fields. */
export async function pruneSection311ActiveExtras(prisma: PrismaClient): Promise<number> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) return 0;

  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 3, deletedAt: null },
  });
  if (!section) return 0;

  const canonical = new Set<string>(SECTION_311_CANONICAL_QUESTION_TEXT);
  const questions = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: section.id, deletedAt: null, isActive: true },
    select: { id: true, questionText: true, metadata: true },
  });

  const now = new Date();
  let pruned = 0;
  for (const q of questions) {
    if (!isSection311FlooringQuestion(q.metadata)) continue;
    if (canonical.has(q.questionText.trim())) continue;

    await prisma.initialAssessmentAnswer.deleteMany({ where: { questionId: q.id } });
    await prisma.initialAssessmentQuestion.update({
      where: { id: q.id },
      data: { deletedAt: now, isActive: false },
    });
    pruned += 1;
  }
  return pruned;
}
