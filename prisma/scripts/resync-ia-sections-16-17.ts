/**
 * Idempotent upsert of missing IA §16 PEEP and §17 Bed Rails onto the existing
 * enterprise default template. Does not recreate the template, prune other
 * sections, or change sections 1–15 / 18.
 *
 * Usage: npm run seed:ia-sections-16-17
 */
import { PrismaClient } from '@prisma/client';
import {
  ENTERPRISE_TEMPLATE_NAME,
  upsertEnterpriseTemplateSections,
} from '../seeds/initial-assessment-enterprise.seed';

const TARGET_SECTIONS = [16, 17] as const;
const UNCHANGED_SECTIONS = [15, 18] as const;

async function snapshotUnchanged(prisma: PrismaClient, templateId: string) {
  const rows = await prisma.initialAssessmentSection.findMany({
    where: { templateId, sectionNumber: { in: [...UNCHANGED_SECTIONS] }, deletedAt: null },
    select: {
      sectionNumber: true,
      title: true,
      questions: {
        where: { deletedAt: null },
        select: { id: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  return Object.fromEntries(
    rows.map((row) => [
      row.sectionNumber,
      { title: row.title, questionIds: row.questions.map((q) => q.id) },
    ]),
  );
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const template = await prisma.initialAssessmentTemplate.findFirst({
      where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
      select: { id: true, name: true, version: true },
    });
    if (!template) {
      throw new Error(`Enterprise template "${ENTERPRISE_TEMPLATE_NAME}" not found`);
    }

    const existingIncludingDeleted = await prisma.initialAssessmentSection.findMany({
      where: { templateId: template.id, sectionNumber: { in: [...TARGET_SECTIONS] } },
      select: {
        sectionNumber: true,
        id: true,
        deletedAt: true,
        isActive: true,
        _count: { select: { questions: true } },
      },
    });

    console.log('[resync-16-17] template', {
      id: template.id,
      name: template.name,
      version: template.version,
    });
    console.log('[resync-16-17] before', existingIncludingDeleted);

    const beforeUnchanged = await snapshotUnchanged(prisma, template.id);
    const result = await upsertEnterpriseTemplateSections(prisma, [...TARGET_SECTIONS]);
    const afterUnchanged = await snapshotUnchanged(prisma, template.id);

    for (const n of UNCHANGED_SECTIONS) {
      const before = beforeUnchanged[n];
      const after = afterUnchanged[n];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error(`Refusing to continue: section ${n} changed during §16/§17 upsert`);
      }
    }

    console.log('[resync-16-17] result', JSON.stringify(result, null, 2));
    console.log('[resync-16-17] unchanged §15/§18 question IDs preserved');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
