/**
 * Test fixtures mirroring the live "Initial Assessment — Enterprise" template (v8) and the
 * live IA → care plan rule configuration captured on 2026-11-03 (Phase 1 baseline).
 * Question texts, field keys, spec refs, types and section areas match the dev database.
 */
import type { Prisma } from '@prisma/client';
import type { CarePlanRecommendationRuleRow } from './initial-assessment-care-plan-rules.types';
import type { SubmissionAnswerForRules } from './initial-assessment-care-plan-rules.util';
import type { CarePlanCatalogueRow } from './initial-assessment-care-plan-area-map.util';

export type FixtureQuestion = {
  id: string;
  questionText: string;
  questionType: string;
  carePlanTrigger: boolean;
  metadata: Prisma.JsonValue;
  section: {
    sectionNumber: number;
    title: string;
    carePlanArea: string | null;
  };
};

const S = {
  1: {
    sectionNumber: 1,
    title: 'Personal Details & Preferences',
    carePlanArea: 'Person Centred',
  },
  3: {
    sectionNumber: 3,
    title: 'Environmental / Home Safety',
    carePlanArea: 'Environment',
  },
  4: {
    sectionNumber: 4,
    title: 'Physical Assessment / Vital Signs',
    carePlanArea: 'Physical Health',
  },
  5: {
    sectionNumber: 5,
    title: 'Breathing, Distress/Pain & Swallowing',
    carePlanArea: 'Respiratory',
  },
  6: {
    sectionNumber: 6,
    title: 'Eating, Drinking, Nutrition and Hydration',
    carePlanArea: 'Nutrition',
  },
  7: {
    sectionNumber: 7,
    title: 'Oral Health and Continence',
    carePlanArea: 'Continence',
  },
  8: {
    sectionNumber: 8,
    title: 'Communication and Sensory Needs',
    carePlanArea: 'Communication',
  },
  9: {
    sectionNumber: 9,
    title: 'Medication Support and Medication Safety',
    carePlanArea: 'Medication',
  },
  10: {
    sectionNumber: 10,
    title: 'Emotional Health, Mental Health and Cognition',
    carePlanArea: 'Mental Health',
  },
  11: {
    sectionNumber: 11,
    title: 'Skin Integrity',
    carePlanArea: 'Skin Integrity',
  },
  12: {
    sectionNumber: 12,
    title: 'Mobility, ADL and Practical Support',
    carePlanArea: 'Mobility',
  },
  13: {
    sectionNumber: 13,
    title: 'Safeguarding, Emergency and Risk Management',
    carePlanArea: 'Safeguarding',
  },
  18: { sectionNumber: 18, title: 'Fire Safety', carePlanArea: 'Environment' },
} as const;

const q = (
  id: string,
  section: keyof typeof S,
  questionText: string,
  questionType: string,
  meta: Record<string, unknown>,
  carePlanTrigger = false,
): FixtureQuestion => ({
  id,
  questionText,
  questionType,
  carePlanTrigger,
  metadata: meta as Prisma.JsonValue,
  section: S[section],
});

export const Q = {
  whatMatters: q(
    'q-what-matters',
    1,
    'What matters most to the Service User?',
    'TEXTAREA',
    { specRef: '1.3', fieldKey: 'whatMattersMost' },
    true,
  ),
  supportGoals: q(
    'q-support-goals',
    1,
    'What do they want support to achieve?',
    'TEXTAREA',
    { specRef: '1.3', fieldKey: 'supportGoals' },
    true,
  ),
  knownTriggers: q(
    'q-known-triggers',
    1,
    'Known triggers (anxiety, distress, confusion)',
    'TEXTAREA',
    { specRef: '1.4' },
    true,
  ),
  parking: q(
    'q-parking',
    3,
    'Control measures and actions to reduce car parking harm',
    'TEXTAREA',
    { specRef: '3.12', fieldKey: 'carParkingControlMeasures' },
    true,
  ),
  gpPhysical: q(
    'q-gp-physical',
    4,
    'GP review requested for physical wellbeing?',
    'YES_NO',
    { specRef: '4.6' },
    true,
  ),
  pain: q(
    'q-pain',
    5,
    'Pain or distress identified?',
    'YES_NO',
    { specRef: '5.3' },
    true,
  ),
  swallow: q(
    'q-swallow',
    5,
    'Swallowing or choking concerns?',
    'YES_NO',
    { specRef: '5.4' },
    true,
  ),
  saltSwallow: q(
    'q-salt-swallow',
    5,
    'SALT referral required?',
    'YES_NO',
    { specRef: '5.4' },
    true,
  ),
  appetite: q(
    'q-appetite',
    6,
    'Appetite concern (poor appetite)?',
    'YES_NO',
    { specRef: '6.2' },
    true,
  ),
  malnourished: q(
    'q-malnourished',
    6,
    'Malnourished or at nutrition risk?',
    'YES_NO',
    { specRef: '6.4' },
    true,
  ),
  oral: q(
    'q-oral',
    7,
    'Oral health concern?',
    'YES_NO',
    { specRef: '7.1', fieldKey: 'oralHealthConcern' },
    true,
  ),
  bladder: q(
    'q-bladder',
    7,
    'Bladder continence concern?',
    'YES_NO',
    { specRef: '7.3' },
    true,
  ),
  stoma: q(
    'q-stoma',
    7,
    'Urostomy or stoma present?',
    'YES_NO',
    { specRef: '7.4' },
    true,
  ),
  catheter: q(
    'q-catheter',
    7,
    'Catheter in situ?',
    'YES_NO',
    { specRef: '7.4' },
    true,
  ),
  continenceReferral: q(
    'q-continence-referral',
    7,
    'Continence service referral required?',
    'YES_NO',
    { specRef: '7.3' },
    true,
  ),
  speechOptions: q(
    'q-speech-options',
    8,
    'Speech impairment options',
    'MULTI_SELECT',
    { specRef: '8.1', fieldKey: 'speechOptions' },
  ),
  speechYn: q(
    'q-speech-yn',
    8,
    'Speech impairment or concern?',
    'YES_NO',
    { specRef: '8.1' },
    true,
  ),
  saltComm: q(
    'q-salt-comm',
    8,
    'SALT communication referral required?',
    'YES_NO',
    { specRef: '8.2' },
    true,
  ),
  hearingLevel: q(
    'q-hearing-level',
    8,
    'Hearing impairment level',
    'SINGLE_SELECT',
    { specRef: '8.3', fieldKey: 'hearingLevel' },
  ),
  hearingYn: q(
    'q-hearing-yn',
    8,
    'Hearing impairment (moderate or worse)?',
    'YES_NO',
    { specRef: '8.3' },
    true,
  ),
  takingMeds: q('q-taking-meds', 9, 'Taking prescribed medication?', 'YES_NO', {
    specRef: '9.1',
    fieldKey: 'takingPrescribedMedication',
  }),
  medLevel: q(
    'q-med-level',
    9,
    'Recommended medication support level',
    'SINGLE_SELECT',
    {
      specRef: '9.2',
      fieldKey: 'medicationSupportLevel',
      showWhen: { gateTextIncludes: 'taking prescribed medication', yes: true },
    },
  ),
  emar: q('q-emar', 9, 'MAR / eMAR required?', 'YES_NO', {
    specRef: '9.5',
    fieldKey: 'emarRequired',
    showWhen: { gateTextIncludes: 'taking prescribed medication', yes: true },
  }),
  insulin: q('q-insulin', 9, 'Insulin administration required?', 'YES_NO', {
    specRef: '9.3',
    fieldKey: 'insulinAdministrationRequired',
    showWhen: { gateTextIncludes: 'taking prescribed medication', yes: true },
  }),
  packaging: q(
    'q-packaging',
    9,
    'Help removing medicines from packaging required?',
    'YES_NO',
    {
      specRef: '9.5',
      fieldKey: 'packagingHelpRequired',
      showWhen: { gateTextIncludes: 'taking prescribed medication', yes: true },
    },
  ),
  bowel: q(
    'q-bowel',
    7,
    'Bowel continence concern?',
    'YES_NO',
    { specRef: '7.5' },
    true,
  ),
  sightLevel: q('q-sight-level', 8, 'Sight impairment level', 'SINGLE_SELECT', {
    specRef: '8.4',
    fieldKey: 'sightLevel',
  }),
  sightYn: q(
    'q-sight-yn',
    8,
    'Sight impairment (moderate or worse)?',
    'YES_NO',
    { specRef: '8.4' },
    true,
  ),
  mhCurrent: q(
    'q-mh-current',
    10,
    'Current mental health issues reported?',
    'YES_NO',
    { specRef: '10.1' },
    true,
  ),
  mhPrevious: q(
    'q-mh-previous',
    10,
    'Previous mental health issues reported?',
    'YES_NO',
    { specRef: '10.1' },
  ),
  lowMood: q(
    'q-low-mood',
    10,
    'Low mood or depression concern?',
    'YES_NO',
    { specRef: '10.2' },
    true,
  ),
  sleep: q(
    'q-sleep',
    10,
    'Sleeping pattern concern?',
    'YES_NO',
    { specRef: '10.4' },
    true,
  ),
  dementia: q(
    'q-dementia',
    10,
    'Diagnosed dementia?',
    'YES_NO',
    { specRef: '10.6a', fieldKey: 'diagnosedDementia' },
    true,
  ),
  wounds: q(
    'q-wounds',
    11,
    'Currently has ulcers or wounds?',
    'YES_NO',
    { specRef: '11.1', fieldKey: 'hasWounds' },
    true,
  ),
  hoist: q(
    'q-hoist',
    12,
    'Uses hoist or sling?',
    'YES_NO',
    { specRef: '12.5a', fieldKey: 'usesHoistOrSling' },
    true,
  ),
  amputation: q(
    'q-amputation',
    12,
    'Any amputation?',
    'YES_NO',
    { specRef: '12.5b' },
    true,
  ),
  transfer: q(
    'q-transfer',
    12,
    'Transfer support required?',
    'YES_NO',
    { specRef: '12.5c', fieldKey: 'transferSupportRequired' },
    true,
  ),
  falls: q(
    'q-falls',
    12,
    'Falls in last 12 months?',
    'YES_NO',
    { specRef: '12.7', fieldKey: 'fallsLast12Months' },
    true,
  ),
  safeguarding: q(
    'q-safeguarding',
    13,
    'Any safeguarding concerns identified?',
    'YES_NO',
    { specRef: '13.1', fieldKey: 'safeguardingConcern' },
  ),
  smoke: q(
    'q-smoke',
    18,
    'Referral required for smoke, CO or fire alarm?',
    'YES_NO',
    { specRef: '18.3', fieldKey: 'smokeCoFireAlarmReferral' },
    true,
  ),
} as const;

export const ALL_QUESTIONS: FixtureQuestion[] = Object.values(Q);

export type AnswerValue = {
  checked?: boolean | null;
  booleanValue?: boolean | null;
  textValue?: string | null;
  selectedOptions?: Prisma.JsonValue;
  numberValue?: number | null;
};

export const YES: AnswerValue = { checked: true, booleanValue: true };
export const NO: AnswerValue = { checked: false, booleanValue: false };
export const select = (...values: string[]): AnswerValue => ({
  selectedOptions: values,
});
export const text = (value: string): AnswerValue => ({ textValue: value });

/** Shape answers exactly like `submissionAnswersForRules` does for saved rows. */
export function answersFor(
  entries: Array<[FixtureQuestion, AnswerValue]>,
): SubmissionAnswerForRules[] {
  return entries.map(([question, value]) => {
    const meta = question.metadata as Record<string, unknown>;
    return {
      questionId: question.id,
      questionText: question.questionText,
      questionType: question.questionType,
      carePlanTrigger: question.carePlanTrigger,
      checked: value.checked ?? null,
      booleanValue: value.booleanValue ?? null,
      textValue: value.textValue ?? null,
      selectedOptions: value.selectedOptions ?? null,
      numberValue: value.numberValue ?? null,
      dateValue: null,
      specRef: typeof meta.specRef === 'string' ? meta.specRef : undefined,
      fieldKey: typeof meta.fieldKey === 'string' ? meta.fieldKey : undefined,
      sectionNumber: question.section.sectionNumber,
      sectionTitle: question.section.title,
      carePlanArea: question.section.carePlanArea,
    };
  });
}

export const FORM = {
  personCentred: {
    id: 'form-person-centred',
    name: 'Person Centred care plan',
  },
  personalSafety: { id: 'form-personal-safety', name: 'Personal Safety' },
  physicalHealth: { id: 'form-physical-health', name: 'Physical Health' },
  eatingDrinking: { id: 'form-eating-drinking', name: 'Eating and Drinking' },
  continence: { id: 'form-continence', name: 'Continence' },
  communication: { id: 'form-communication', name: 'Communication' },
  medication: { id: 'form-medication', name: 'Medication' },
  psychological: { id: 'form-psychological', name: 'Psychological' },
  skinIntegrity: { id: 'form-skin-integrity', name: 'Skin Integrity' },
  falls: { id: 'form-falls', name: 'Falls' },
  mobility: { id: 'form-mobility', name: 'Mobility' },
  advance: { id: 'form-advance', name: 'Advance' },
  dementia: { id: 'form-dementia', name: 'Dementia Care plan' },
  washingDressing: {
    id: 'form-washing-dressing',
    name: 'Washing and dressing',
  },
  painManagement: { id: 'form-pain-management', name: 'Pain Management' },
  sleepingNight: { id: 'form-sleeping-night', name: 'Sleeping and Night' },
  careReview: { id: 'form-care-review', name: 'Care Plan review form' },
  culture: { id: 'form-culture', name: 'Culture/Religion/Spirituality' },
  finalDays: { id: 'form-final-days', name: 'Final Days' },
} as const;

/** Available (not deleted, active) care plan forms. "Testing Form" is deliberately absent (soft-deleted). */
export const CATALOGUE: CarePlanCatalogueRow[] = Object.values(FORM).map(
  (f) => ({ ...f }),
);

export const DELETED_TESTING_FORM_ID = 'form-testing-deleted';

const rule = (
  id: string,
  form: { id: string; name: string } | { id: string; name: undefined },
  conditions: CarePlanRecommendationRuleRow['conditions'],
  suppressLegacyArea: string | null,
  sortOrder = 0,
): CarePlanRecommendationRuleRow => ({
  id,
  carePathwayFormId: form.id,
  label: null,
  matchMode: 'ANY',
  conditions,
  suppressLegacyArea,
  sortOrder,
  isActive: true,
  formName: form.name,
});

/** The seven active rules found in the dev database on 2026-11-03 (R1–R7 in the audit). */
export const LIVE_RULES: CarePlanRecommendationRuleRow[] = [
  rule(
    'r1-testing-form',
    { id: DELETED_TESTING_FORM_ID, name: undefined },
    [{ when: 'answered', specRef: '1.3', fieldKey: 'whatMattersMost' }],
    null,
  ),
  rule(
    'r2-advance',
    FORM.advance,
    [
      {
        when: 'answered',
        specRef: '1.4',
        questionTextContains: 'Known triggers (anxiety, distress, confusion)',
      },
    ],
    null,
  ),
  rule(
    'r3-medication',
    FORM.medication,
    [
      { when: 'yes', fieldKey: 'emarRequired' },
      { when: 'yes', fieldKey: 'insulinAdministrationRequired' },
      { when: 'yes', fieldKey: 'packagingHelpRequired' },
    ],
    'Medication',
    10,
  ),
  rule(
    'r4-continence',
    FORM.continence,
    [
      {
        when: 'yes',
        specRef: '7.3',
        questionTextContains: 'Bladder continence concern',
      },
      { when: 'yes', specRef: '7.4', questionTextContains: 'Catheter in situ' },
      {
        when: 'yes',
        specRef: '7.5',
        questionTextContains: 'Bowel continence concern',
      },
    ],
    'Continence',
    20,
  ),
  rule(
    'r5-communication',
    FORM.communication,
    [
      {
        when: 'yes',
        specRef: '8.1',
        questionTextContains: 'Speech impairment',
      },
      {
        when: 'yes',
        specRef: '8.3',
        questionTextContains: 'Hearing impairment',
      },
      { when: 'yes', specRef: '8.4', questionTextContains: 'Sight impairment' },
    ],
    'Communication',
    30,
  ),
  rule(
    'r6-psychological',
    FORM.psychological,
    [
      {
        when: 'yes',
        specRef: '10.1',
        questionTextContains: 'mental health issues',
      },
      { when: 'yes', specRef: '10.2', questionTextContains: 'Low mood' },
      {
        when: 'yes',
        specRef: '10.6a',
        questionTextContains: 'Diagnosed dementia',
      },
    ],
    'Mental Health',
    40,
  ),
  rule(
    'r7-falls',
    FORM.falls,
    [{ when: 'yes', fieldKey: 'fallsLast12Months' }],
    'Mobility',
    50,
  ),
];

/** LIVE_RULES without the rule that targets the deleted "Testing Form" (what the engine should evaluate). */
export const LIVE_VALID_RULES = LIVE_RULES.filter(
  (r) => r.id !== 'r1-testing-form',
);
