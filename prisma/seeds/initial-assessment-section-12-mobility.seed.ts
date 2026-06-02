import type { PrismaClient } from '@prisma/client';
import { SECTION_12_QUESTIONS } from './initial-assessment-enterprise-sections-11-14.seed';

const ENTERPRISE_TEMPLATE_NAME = 'Initial Assessment — Enterprise';

export const SECTION_12_CANONICAL_QUESTION_TEXT = SECTION_12_QUESTIONS.map((q) => q.questionText);

const CANONICAL = new Set<string>(SECTION_12_CANONICAL_QUESTION_TEXT);

const LEGACY_METADATA_KEYS = [
  'legacyCatalogSection',
  'legacyCatalogSectionTitle',
  'legacyCatalogId',
  'source',
] as const;

export function isSection12Question(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const specRef = (metadata as Record<string, unknown>).specRef;
  return typeof specRef === 'string' && specRef.startsWith('12.');
}

function stripLegacyMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const meta = { ...(metadata as Record<string, unknown>) };
  let changed = false;
  for (const key of LEGACY_METADATA_KEYS) {
    if (key in meta) {
      delete meta[key];
      changed = true;
    }
  }
  return changed ? meta : null;
}

export async function pruneSection12ActiveExtras(prisma: PrismaClient): Promise<number> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) return 0;

  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 12, deletedAt: null },
  });
  if (!section) return 0;

  const questions = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: section.id, deletedAt: null, isActive: true },
    select: { id: true, questionText: true, metadata: true },
  });

  const now = new Date();
  let pruned = 0;
  for (const q of questions) {
    if (CANONICAL.has(q.questionText.trim())) {
      const cleaned = stripLegacyMetadata(q.metadata);
      if (cleaned) {
        await prisma.initialAssessmentQuestion.update({
          where: { id: q.id },
          data: { metadata: cleaned as object },
        });
      }
      continue;
    }

    if (!isSection12Question(q.metadata)) continue;

    await prisma.initialAssessmentAnswer.deleteMany({ where: { questionId: q.id } });
    await prisma.initialAssessmentQuestion.update({
      where: { id: q.id },
      data: { deletedAt: now, isActive: false },
    });
    pruned += 1;
  }
  return pruned;
}
