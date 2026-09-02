/**
 * ID-safe: move existing holistic Keysafe fields from spec 1.1 into the Home/Access
 * cluster (spec 1.2) and reorder. Does not create questions or change fieldKeys.
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/align-ia-home-access-order.ts
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { ENTERPRISE_TEMPLATE_NAME } from '../seeds/initial-assessment-enterprise.seed';

const UPDATES: Array<{
  fieldKey: string;
  sortOrder: number;
  metadata: Record<string, unknown>;
}> = [
  { fieldKey: 'livesAlone', sortOrder: 121, metadata: { specRef: '1.2', fieldKey: 'livesAlone' } },
  { fieldKey: 'canAnswerFrontDoor', sortOrder: 122, metadata: { specRef: '1.2', fieldKey: 'canAnswerFrontDoor' } },
  {
    fieldKey: 'keySafePresentHolistic',
    sortOrder: 123,
    metadata: { specRef: '1.2', fieldKey: 'keySafePresentHolistic' },
  },
  {
    fieldKey: 'keySafeCodeHolistic',
    sortOrder: 124,
    metadata: { specRef: '1.2', fieldKey: 'keySafeCodeHolistic', secureField: true },
  },
  {
    fieldKey: 'homeAccessInstructions',
    sortOrder: 125,
    metadata: { specRef: '1.2', fieldKey: 'homeAccessInstructions', prefillKey: 'accessInstruction' },
  },
  { fieldKey: 'staffVisitRisks', sortOrder: 126, metadata: { specRef: '1.2', fieldKey: 'staffVisitRisks' } },
  {
    fieldKey: 'lifestyleRoleChoices',
    sortOrder: 127,
    metadata: { specRef: '1.2', fieldKey: 'lifestyleRoleChoices' },
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const template = await prisma.initialAssessmentTemplate.findFirst({
      where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
    });
    if (!template) throw new Error(`${ENTERPRISE_TEMPLATE_NAME} not found`);

    const section = await prisma.initialAssessmentSection.findFirst({
      where: { templateId: template.id, sectionNumber: 1, deletedAt: null },
    });
    if (!section) throw new Error('Enterprise IA section 1 not found');

    const results: Array<{ fieldKey: string; id: string; created: false }> = [];
    for (const update of UPDATES) {
      const matches = await prisma.initialAssessmentQuestion.findMany({
        where: {
          sectionId: section.id,
          deletedAt: null,
          metadata: { path: ['fieldKey'], equals: update.fieldKey },
        },
      });
      if (matches.length !== 1) {
        throw new Error(
          `Expected exactly 1 question for ${update.fieldKey} in section 1, found ${matches.length}`,
        );
      }
      const existing = matches[0]!;
      const currentMeta =
        existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
          ? (existing.metadata as Record<string, unknown>)
          : {};
      await prisma.initialAssessmentQuestion.update({
        where: { id: existing.id },
        data: {
          sortOrder: update.sortOrder,
          metadata: { ...currentMeta, ...update.metadata } as Prisma.InputJsonValue,
        },
      });
      results.push({ fieldKey: update.fieldKey, id: existing.id, created: false });
    }

    console.log('[align-ia-home-access-order] Updated existing questions:', results);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
