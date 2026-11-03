import { CarePathwayFormType, Prisma, PrismaClient } from '@prisma/client';

/**
 * Same shape as CarePlanRuleCondition in src/initial-assessments/initial-assessment-care-plan-rules.types.ts
 * (keep in sync). The seed path must not import from src/: src/ is not in the deploy artifact.
 */
type CarePlanRuleCondition = {
  fieldKey?: string;
  specRef?: string;
  questionTextContains?: string;
  adlActivity?: string;
  when: 'yes' | 'no' | 'answered' | 'not_answered' | 'select_equals' | 'text_contains' | 'adl_score_gte';
  value?: string;
};

export type IaCarePlanStarterRule = {
  formName: string;
  label?: string;
  matchMode?: 'ANY' | 'ALL';
  suppressLegacyArea?: string;
  sortOrder?: number;
  conditions: CarePlanRuleCondition[];
};

const CARER_MEDICATION_LEVELS = ['level_1a', 'level_1b', 'level_2a', 'level_2b'];

/**
 * Starter IA → care plan rules for a fresh environment. Existing rules are never changed by the
 * seed (administrators own them); use GET /initial-assessments/care-plan-recommendation-rules/diagnostics
 * to review differences between these defaults and the live configuration.
 *
 * Phase 1 (2026-11): Falls covers falls history only (hoist / transfers are not a falls history and
 * reach a plan through the legacy Mobility area pending clinical sign-off); Medication covers the
 * carer medication support levels (same set as the IA §9.6 `CARER_MEDICATION_LEVELS` gate);
 * Washing and dressing, Personal Safety, Pain Management, Dementia Care plan and Eating and
 * Drinking rules were added where the target plan's compose already reads that IA evidence or an
 * approved medical-condition mapping routes the same need to it.
 */
export const IA_CARE_PLAN_STARTER_RULES: IaCarePlanStarterRule[] = [
  {
    formName: 'Medication',
    suppressLegacyArea: 'Medication',
    sortOrder: 10,
    conditions: [
      { fieldKey: 'emarRequired', when: 'yes' },
      { fieldKey: 'insulinAdministrationRequired', when: 'yes' },
      { fieldKey: 'packagingHelpRequired', when: 'yes' },
      ...CARER_MEDICATION_LEVELS.map((value) => ({
        fieldKey: 'medicationSupportLevel',
        when: 'select_equals' as const,
        value,
      })),
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
    conditions: [{ fieldKey: 'fallsLast12Months', when: 'yes' }],
  },
  {
    formName: 'Washing and dressing',
    label: 'Washing and dressing — personal care support identified (ADL worksheet)',
    sortOrder: 55,
    conditions: [
      { adlActivity: 'bathing', when: 'adl_score_gte', value: '1' },
      { adlActivity: 'dressing_undressing', when: 'adl_score_gte', value: '1' },
      { adlActivity: 'grooming', when: 'adl_score_gte', value: '1' },
    ],
  },
  {
    formName: 'Personal Safety',
    label: 'Personal Safety — safeguarding concern recorded (escalation follows the safeguarding process)',
    sortOrder: 60,
    conditions: [{ fieldKey: 'safeguardingConcern', when: 'yes' }],
  },
  {
    formName: 'Pain Management',
    sortOrder: 70,
    conditions: [{ specRef: '5.3', questionTextContains: 'Pain or distress identified', when: 'yes' }],
  },
  {
    formName: 'Dementia Care plan',
    sortOrder: 80,
    conditions: [{ fieldKey: 'diagnosedDementia', when: 'yes' }],
  },
  {
    formName: 'Eating and Drinking',
    sortOrder: 90,
    conditions: [
      { specRef: '5.4', questionTextContains: 'Swallowing or choking concerns', when: 'yes' },
      { specRef: '5.4', questionTextContains: 'SALT referral required', when: 'yes' },
    ],
  },
];

/** Creates starter rules for forms that have never had one. Never updates or re-creates an existing rule. */
export async function seedInitialAssessmentCarePlanRules(prisma: PrismaClient): Promise<number> {
  let count = 0;
  for (const seed of IA_CARE_PLAN_STARTER_RULES) {
    const form = await prisma.carePathwayForm.findFirst({
      where: { name: seed.formName, formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
    });
    if (!form) continue;

    // Includes rules an administrator deleted: the seed must not bring them back.
    const existing = await prisma.initialAssessmentCarePlanRecommendationRule.findFirst({
      where: { carePathwayFormId: form.id },
    });
    if (existing) continue;

    await prisma.initialAssessmentCarePlanRecommendationRule.create({
      data: {
        carePathwayFormId: form.id,
        label: seed.label ?? null,
        matchMode: seed.matchMode ?? 'ANY',
        conditions: seed.conditions as unknown as Prisma.InputJsonValue,
        suppressLegacyArea: seed.suppressLegacyArea ?? null,
        sortOrder: seed.sortOrder ?? 0,
        isActive: true,
      },
    });
    count += 1;
  }
  if (count > 0) {
    console.log(`[seed] Created ${count} initial assessment care plan recommendation rule(s).`);
  }
  return count;
}
