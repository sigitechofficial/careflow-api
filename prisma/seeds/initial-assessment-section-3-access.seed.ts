import type { PrismaClient } from '@prisma/client';

const ENTERPRISE_TEMPLATE_NAME = 'Initial Assessment — Enterprise';

/** Retired wording / mojibake duplicates superseded by canonical §3.5 / §3.6 / §1.2 fields. */
export const SECTION_35_SUPERSEDED_QUESTION_TEXT = [
  'Door entry code (secure â€” from DOM Care)',
  'Key safe location / reference (code stored securely)',
  // Exact duplicates of Social history (§1.2) key-safe fields — keep location only on §3.
  'Key safe present?',
  'Key safe code',
] as const;

export async function pruneSection35AccessDuplicates(prisma: PrismaClient): Promise<number> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) return 0;

  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 3, deletedAt: null },
  });
  if (!section) return 0;

  const questions = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: section.id, deletedAt: null, isActive: true },
    select: { id: true, questionText: true, metadata: true },
  });

  const superseded = new Set<string>(SECTION_35_SUPERSEDED_QUESTION_TEXT);
  const now = new Date();
  let pruned = 0;

  for (const q of questions) {
    if (!superseded.has(q.questionText.trim())) continue;

    await prisma.initialAssessmentAnswer.deleteMany({ where: { questionId: q.id } });
    await prisma.initialAssessmentQuestion.update({
      where: { id: q.id },
      data: { deletedAt: now, isActive: false },
    });
    pruned += 1;
  }

  // Collapse duplicate rows that share the same specRef + fieldKey (keep lowest id).
  const byFieldKey = new Map<string, { id: string; questionText: string }[]>();
  for (const q of questions) {
    const meta = q.metadata;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
    const rowMeta = meta as Record<string, unknown>;
    const specRef = rowMeta.specRef;
    const fieldKey = rowMeta.fieldKey;
    if (typeof specRef !== 'string' || typeof fieldKey !== 'string') continue;
    if (specRef !== '3.5' && specRef !== '3.6') continue;
    const key = `${specRef}:${fieldKey}`;
    const list = byFieldKey.get(key) ?? [];
    list.push({ id: q.id, questionText: q.questionText });
    byFieldKey.set(key, list);
  }

  for (const [, rows] of byFieldKey) {
    if (rows.length <= 1) continue;
    rows.sort((a, b) => a.id.localeCompare(b.id));
    for (const duplicate of rows.slice(1)) {
      if (superseded.has(duplicate.questionText.trim())) continue;
      await prisma.initialAssessmentAnswer.deleteMany({ where: { questionId: duplicate.id } });
      await prisma.initialAssessmentQuestion.update({
        where: { id: duplicate.id },
        data: { deletedAt: now, isActive: false },
      });
      pruned += 1;
    }
  }

  return pruned;
}
