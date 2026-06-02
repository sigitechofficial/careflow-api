import type { PrismaClient } from '@prisma/client';
import { ENTERPRISE_TEMPLATE_NAME } from './initial-assessment-enterprise.seed';

export const LEGACY_METADATA_KEYS = [
  'legacyCatalogSection',
  'legacyCatalogSectionTitle',
  'legacyCatalogId',
  'legacyCatalog',
  'source',
] as const;

export function stripLegacyMetadata(metadata: unknown): Record<string, unknown> | null {
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

export function hasLegacyCatalogSection(metadata: unknown, sections: ReadonlySet<string>): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const meta = metadata as Record<string, unknown>;
  const section = meta.legacyCatalogSection ?? meta.legacyCatalog;
  return typeof section === 'string' && sections.has(section);
}

export async function pruneSectionCanonicalExtras(
  prisma: PrismaClient,
  sectionNumber: number,
  canonicalTexts: readonly string[],
  isSectionQuestion: (metadata: unknown) => boolean,
  legacyCatalogSections: ReadonlySet<string> = new Set(),
): Promise<number> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) return 0;

  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber, deletedAt: null },
  });
  if (!section) return 0;

  const questions = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: section.id, deletedAt: null, isActive: true },
    select: { id: true, questionText: true, metadata: true },
  });

  const canonical = new Set<string>(canonicalTexts);
  const now = new Date();
  let pruned = 0;

  for (const q of questions) {
    if (canonical.has(q.questionText.trim())) {
      const cleaned = stripLegacyMetadata(q.metadata);
      if (cleaned) {
        await prisma.initialAssessmentQuestion.update({
          where: { id: q.id },
          data: { metadata: cleaned as object },
        });
      }
      continue;
    }

    const legacyImport =
      hasLegacyCatalogSection(q.metadata, legacyCatalogSections) ||
      (typeof q.metadata === 'object' &&
        q.metadata !== null &&
        !Array.isArray(q.metadata) &&
        (q.metadata as Record<string, unknown>).legacyCatalogId != null);

    if (!isSectionQuestion(q.metadata) && !legacyImport) continue;

    await prisma.initialAssessmentAnswer.deleteMany({ where: { questionId: q.id } });
    await prisma.initialAssessmentQuestion.update({
      where: { id: q.id },
      data: { deletedAt: now, isActive: false },
    });
    pruned += 1;
  }

  return pruned;
}
