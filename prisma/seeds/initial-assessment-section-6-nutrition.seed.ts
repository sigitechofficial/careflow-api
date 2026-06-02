import type { PrismaClient } from '@prisma/client';
import { SECTION_6_QUESTIONS } from './initial-assessment-enterprise-sections-5-10.seed';

const ENTERPRISE_TEMPLATE_NAME = 'Initial Assessment — Enterprise';

export const SECTION_6_LEGACY_CATALOG_SECTIONS = [
  'sec_appetite',
  'sec_hydration',
  'sec_nutrition',
] as const;

export const SECTION_6_CANONICAL_QUESTION_TEXT = SECTION_6_QUESTIONS.map((q) => q.questionText);

const LEGACY_SECTIONS = new Set<string>(SECTION_6_LEGACY_CATALOG_SECTIONS);
const CANONICAL = new Set<string>(SECTION_6_CANONICAL_QUESTION_TEXT);

export function isSection6NutritionQuestion(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const meta = metadata as Record<string, unknown>;
  if (typeof meta.legacyCatalogSection === 'string' && LEGACY_SECTIONS.has(meta.legacyCatalogSection)) {
    return true;
  }
  const specRef = meta.specRef;
  return typeof specRef === 'string' && specRef.startsWith('6.');
}

export async function pruneSection6ActiveExtras(prisma: PrismaClient): Promise<number> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) return 0;

  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 6, deletedAt: null },
  });
  if (!section) return 0;

  const questions = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: section.id, deletedAt: null, isActive: true },
    select: { id: true, questionText: true, metadata: true },
  });

  const now = new Date();
  let pruned = 0;
  for (const q of questions) {
    if (!isSection6NutritionQuestion(q.metadata)) continue;
    if (CANONICAL.has(q.questionText.trim())) continue;

    await prisma.initialAssessmentAnswer.deleteMany({ where: { questionId: q.id } });
    await prisma.initialAssessmentQuestion.update({
      where: { id: q.id },
      data: { deletedAt: now, isActive: false },
    });
    pruned += 1;
  }
  return pruned;
}
