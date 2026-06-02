import { Prisma, type PrismaClient } from '@prisma/client';

type CatalogSeed = {
  code: string;
  name: string;
  sortOrder: number;
  initialAssessmentWoundType?: boolean;
  children?: CatalogSeed[];
};

/** Unified record-type tree — body map wizard + initial assessment wound type. */
const CATALOG: CatalogSeed[] = [
  {
    code: 'INJURY',
    name: 'Injury or Mark',
    sortOrder: 1,
    children: [
      { code: 'bruise', name: 'Bruise', sortOrder: 1 },
      { code: 'cut', name: 'Cut', sortOrder: 2 },
      { code: 'scratch', name: 'Scratch', sortOrder: 3 },
      { code: 'burn', name: 'Burn', sortOrder: 4 },
      { code: 'bite_mark', name: 'Bite mark', sortOrder: 5 },
      { code: 'unexplained_mark', name: 'Unexplained mark', sortOrder: 6 },
      { code: 'swelling', name: 'Swelling', sortOrder: 7 },
    ],
  },
  {
    code: 'WOUND',
    name: 'Wound',
    sortOrder: 2,
    children: [
      { code: 'skin_tear', name: 'Skin tear', sortOrder: 1, initialAssessmentWoundType: true },
      { code: 'open_wound', name: 'Open wound', sortOrder: 2 },
      { code: 'surgical', name: 'Surgical wound', sortOrder: 3, initialAssessmentWoundType: true },
      { code: 'infected_wound', name: 'Infected wound', sortOrder: 4 },
      { code: 'dressing_required', name: 'Dressing required', sortOrder: 5 },
      { code: 'wound_other', name: 'Other', sortOrder: 99, initialAssessmentWoundType: true },
    ],
  },
  {
    code: 'PRESSURE',
    name: 'Pressure Area',
    sortOrder: 3,
    children: [
      { code: 'pressure_ulcer', name: 'Pressure ulcer', sortOrder: 1, initialAssessmentWoundType: true },
      { code: 'redness', name: 'Redness', sortOrder: 2 },
      { code: 'non_blanching_redness', name: 'Non-blanching redness', sortOrder: 3 },
      { code: 'suspected_pressure_damage', name: 'Suspected pressure damage', sortOrder: 4 },
      { code: 'heel_concern', name: 'Heel concern', sortOrder: 5 },
      { code: 'sacral_concern', name: 'Sacral concern', sortOrder: 6 },
    ],
  },
  {
    code: 'MEDICATION',
    name: 'Medication Site',
    sortOrder: 4,
    children: [
      { code: 'cream_application', name: 'Cream application', sortOrder: 1 },
      { code: 'patch_site', name: 'Patch site', sortOrder: 2 },
      { code: 'injection_site', name: 'Injection site', sortOrder: 3 },
      { code: 'spray_site', name: 'Spray site', sortOrder: 4 },
    ],
  },
  {
    code: 'PAIN',
    name: 'Pain',
    sortOrder: 5,
    children: [
      { code: 'pain_acute', name: 'Acute', sortOrder: 1 },
      { code: 'pain_chronic', name: 'Chronic', sortOrder: 2 },
      { code: 'pain_intermittent', name: 'Intermittent', sortOrder: 3 },
    ],
  },
  {
    code: 'SKIN',
    name: 'Skin Condition',
    sortOrder: 6,
    children: [
      { code: 'rash', name: 'Rash', sortOrder: 1 },
      { code: 'dry_skin', name: 'Dry skin', sortOrder: 2 },
      { code: 'moisture_lesion', name: 'Moisture lesion', sortOrder: 3, initialAssessmentWoundType: true },
      { code: 'infection_concern', name: 'Infection concern', sortOrder: 4 },
    ],
  },
  {
    code: 'DEVICE',
    name: 'Medical Device Mark',
    sortOrder: 7,
    children: [
      { code: 'catheter_mark', name: 'Catheter mark', sortOrder: 1 },
      { code: 'wheelchair_pressure', name: 'Wheelchair pressure', sortOrder: 2 },
      { code: 'hoist_sling_mark', name: 'Hoist sling mark', sortOrder: 3 },
    ],
  },
  {
    code: 'SAFEGUARDING',
    name: 'Safeguarding Concern',
    sortOrder: 8,
    children: [
      { code: 'unexplained_injury', name: 'Unexplained injury', sortOrder: 1 },
      { code: 'pattern_of_marks', name: 'Pattern of marks', sortOrder: 2 },
      { code: 'safeguarding_other', name: 'Other concern', sortOrder: 3 },
    ],
  },
];

async function upsertNode(
  prisma: PrismaClient,
  row: CatalogSeed,
  parentId: string | null,
): Promise<void> {
  const saved = await prisma.bodyMapRecordTypeCatalog.upsert({
    where: { code: row.code },
    update: {
      name: row.name,
      parentId,
      sortOrder: row.sortOrder,
      isActive: true,
      initialAssessmentWoundType: row.initialAssessmentWoundType ?? false,
    },
    create: {
      code: row.code,
      name: row.name,
      parentId,
      sortOrder: row.sortOrder,
      isActive: true,
      initialAssessmentWoundType: row.initialAssessmentWoundType ?? false,
    },
  });
  for (const child of row.children ?? []) {
    await upsertNode(prisma, child, saved.id);
  }
}

export async function seedBodyMapRecordTypeCatalog(prisma: PrismaClient): Promise<void> {
  for (const root of CATALOG) {
    await upsertNode(prisma, root, null);
  }

  const woundQuestions = await prisma.initialAssessmentQuestion.findMany({
    where: { questionText: 'Wound type', deletedAt: null },
    select: { id: true, metadata: true },
  });
  for (const q of woundQuestions) {
    const meta =
      q.metadata && typeof q.metadata === 'object' && !Array.isArray(q.metadata)
        ? (q.metadata as Record<string, unknown>)
        : {};
    await prisma.initialAssessmentQuestion.update({
      where: { id: q.id },
      data: {
        options: Prisma.JsonNull,
        metadata: {
          ...meta,
          fieldKey: 'woundType',
          optionsLookup: 'body_map_wound_types',
        },
      },
    });
  }
}
