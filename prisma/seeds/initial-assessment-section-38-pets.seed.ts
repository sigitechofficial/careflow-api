import type { PrismaClient } from '@prisma/client';
import { SECTION_38_CANONICAL_QUESTION_TEXT } from './initial-assessment-enterprise-metadata';

const ENTERPRISE_TEMPLATE_NAME = 'Initial Assessment — Enterprise';

export function isSection38PetsQuestion(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const meta = metadata as Record<string, unknown>;
  return meta.legacyCatalogSection === 'sec_pets' || meta.specRef === '3.8';
}

/** Soft-delete any active §3.8 / sec_pets row that is not a canonical enterprise field. */
export async function pruneSection38ActiveExtras(prisma: PrismaClient): Promise<number> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) return 0;

  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 3, deletedAt: null },
  });
  if (!section) return 0;

  const canonical = new Set<string>(SECTION_38_CANONICAL_QUESTION_TEXT);
  const questions = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: section.id, deletedAt: null, isActive: true },
    select: { id: true, questionText: true, metadata: true },
  });

  const now = new Date();
  let pruned = 0;
  for (const q of questions) {
    if (!isSection38PetsQuestion(q.metadata)) continue;
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
