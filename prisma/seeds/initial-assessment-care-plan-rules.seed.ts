import { CarePathwayFormType, Prisma, PrismaClient } from '@prisma/client';

type RuleSeed = {
  formName: string;
  label?: string;
  matchMode?: 'ANY' | 'ALL';
  suppressLegacyArea?: string;
  sortOrder?: number;
  conditions: Array<{
    fieldKey?: string;
    specRef?: string;
    questionTextContains?: string;
    when: string;
    value?: string;
  }>;
};

const STARTER_RULES: RuleSeed[] = [
  {
    formName: 'Medication',
    suppressLegacyArea: 'Medication',
    sortOrder: 10,
    conditions: [
      { fieldKey: 'emarRequired', when: 'yes' },
      { fieldKey: 'insulinAdministrationRequired', when: 'yes' },
      { fieldKey: 'medicationSupportLevel', when: 'select_equals', value: 'level_1a' },
      { fieldKey: 'medicationSupportLevel', when: 'select_equals', value: 'level_1b' },
      { fieldKey: 'medicationSupportLevel', when: 'select_equals', value: 'level_2a' },
      { fieldKey: 'medicationSupportLevel', when: 'select_equals', value: 'level_2b' },
    ],
  },
  {
    formName: 'Continence',
    suppressLegacyArea: 'Continence',
    sortOrder: 20,
    conditions: [
      { specRef: '7.3', questionTextContains: 'Bladder continence concern', when: 'yes' },
      { specRef: '7.4', questionTextContains: 'Catheter in situ', when: 'yes' },
      { specRef: '7.5', questionTextContains: 'Bowel continence concern', when: 'yes' },
    ],
  },
  {
    formName: 'Communication',
    suppressLegacyArea: 'Communication',
    sortOrder: 30,
    conditions: [
      { specRef: '8.1', questionTextContains: 'Speech impairment', when: 'yes' },
      { specRef: '8.2', questionTextContains: 'SALT communication referral', when: 'yes' },
      { specRef: '8.3', questionTextContains: 'Hearing impairment', when: 'yes' },
      { specRef: '8.4', questionTextContains: 'Sight impairment', when: 'yes' },
    ],
  },
  {
    formName: 'Psychological',
    suppressLegacyArea: 'Mental Health',
    sortOrder: 40,
    conditions: [
      { specRef: '10.1', questionTextContains: 'mental health issues', when: 'yes' },
      { specRef: '10.2', questionTextContains: 'Low mood', when: 'yes' },
      { specRef: '10.6a', questionTextContains: 'Diagnosed dementia', when: 'yes' },
    ],
  },
  {
    formName: 'Falls',
    suppressLegacyArea: 'Mobility',
    sortOrder: 50,
    conditions: [
      { fieldKey: 'fallsLast12Months', when: 'yes' },
      { fieldKey: 'fallsUnsteadiness', when: 'yes' },
      { fieldKey: 'transferSupportRequired', when: 'yes' },
      { fieldKey: 'usesHoistOrSling', when: 'yes' },
    ],
  },
];

export async function seedInitialAssessmentCarePlanRules(prisma: PrismaClient): Promise<number> {
  let count = 0;
  for (const seed of STARTER_RULES) {
    const form = await prisma.carePathwayForm.findFirst({
      where: { name: seed.formName, formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
    });
    if (!form) continue;

    const existing = await prisma.initialAssessmentCarePlanRecommendationRule.findFirst({
      where: { carePathwayFormId: form.id, deletedAt: null },
    });

    const data = {
      carePathwayFormId: form.id,
      label: seed.label ?? null,
      matchMode: (seed.matchMode ?? 'ANY') as 'ANY' | 'ALL',
      conditions: seed.conditions as unknown as Prisma.InputJsonValue,
      suppressLegacyArea: seed.suppressLegacyArea ?? null,
      sortOrder: seed.sortOrder ?? 0,
      isActive: true,
      deletedAt: null,
    };

    if (existing) {
      await prisma.initialAssessmentCarePlanRecommendationRule.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.initialAssessmentCarePlanRecommendationRule.create({ data });
      count += 1;
    }
  }
  if (count > 0) {
    console.log(`[seed] Created ${count} initial assessment care plan recommendation rule(s).`);
  }
  return count;
}
