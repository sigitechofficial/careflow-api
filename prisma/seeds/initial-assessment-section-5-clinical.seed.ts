import type { PrismaClient } from '@prisma/client';
import { SECTION_5_QUESTIONS } from './initial-assessment-enterprise-sections-5-10.seed';

const ENTERPRISE_TEMPLATE_NAME = 'Initial Assessment — Enterprise';

export const SECTION_5_LEGACY_CATALOG_SECTIONS = [
  'sec_breathing_difficulties',
  'sec_distress_pain_physical_state',
  'sec_swallowing',
] as const;

export const SECTION_5_CANONICAL_QUESTION_TEXT = SECTION_5_QUESTIONS.map((q) => q.questionText);

const LEGACY_SECTIONS = new Set<string>(SECTION_5_LEGACY_CATALOG_SECTIONS);
const CANONICAL = new Set<string>(SECTION_5_CANONICAL_QUESTION_TEXT);

export function isSection5ClinicalQuestion(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const meta = metadata as Record<string, unknown>;
  if (typeof meta.legacyCatalogSection === 'string' && LEGACY_SECTIONS.has(meta.legacyCatalogSection)) {
    return true;
  }
  const specRef = meta.specRef;
  if (typeof specRef !== 'string') return false;
  return specRef === '5.0' || specRef === '5.1' || specRef === '5.2' || specRef === '5.3' || specRef === '5.4';
}

export async function pruneSection5ActiveExtras(prisma: PrismaClient): Promise<number> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) return 0;

  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 5, deletedAt: null },
  });
  if (!section) return 0;

  const questions = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: section.id, deletedAt: null, isActive: true },
    select: { id: true, questionText: true, metadata: true },
  });

  const now = new Date();
  let pruned = 0;
  for (const q of questions) {
    if (!isSection5ClinicalQuestion(q.metadata)) continue;
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
