import type { PrismaClient } from '@prisma/client';
import { SECTION_310_CANONICAL_QUESTION_TEXT } from './initial-assessment-enterprise-metadata';

const ENTERPRISE_TEMPLATE_NAME = 'Initial Assessment — Enterprise';

export function isSection310EnvironmentQuestion(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const meta = metadata as Record<string, unknown>;
  return meta.legacyCatalogSection === 'sec_environment' || meta.specRef === '3.10';
}

/** §3.7 clutter field superseded by §3.10 hoarding question. */
export const SECTION_3_SUPERSEDED_QUESTION_TEXT = ['Clutter or hoarding?'] as const;

/** Soft-delete any active §3.10 / sec_environment row that is not a canonical enterprise field. */
export async function pruneSection310ActiveExtras(prisma: PrismaClient): Promise<number> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) return 0;

  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 3, deletedAt: null },
  });
  if (!section) return 0;

  const canonical = new Set<string>(SECTION_310_CANONICAL_QUESTION_TEXT);
  const questions = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: section.id, deletedAt: null, isActive: true },
    select: { id: true, questionText: true, metadata: true },
  });

  const now = new Date();
  let pruned = 0;
  for (const q of questions) {
    if (!isSection310EnvironmentQuestion(q.metadata)) continue;
    if (canonical.has(q.questionText.trim())) continue;

    await prisma.initialAssessmentAnswer.deleteMany({ where: { questionId: q.id } });
    await prisma.initialAssessmentQuestion.update({
      where: { id: q.id },
      data: { deletedAt: now, isActive: false },
    });
    pruned += 1;
  }

  const superseded = new Set<string>(SECTION_3_SUPERSEDED_QUESTION_TEXT);
  for (const q of questions) {
    if (!superseded.has(q.questionText.trim())) continue;

    await prisma.initialAssessmentAnswer.deleteMany({ where: { questionId: q.id } });
    await prisma.initialAssessmentQuestion.update({
      where: { id: q.id },
      data: { deletedAt: now, isActive: false },
    });
    pruned += 1;
  }

  return pruned;
}
