import {
  evaluateCarePlanRule,
  submissionAnswersForRules,
  type SubmissionAnswerForRules,
} from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import type { CarePlanRecommendationRuleRow } from '../../initial-assessments/initial-assessment-care-plan-rules.types';
import { composeFallsCarePlan } from './area-care-plans.compose';
import { carePlanInstanceDisplayStatus } from '../care-plan-instance-display-status.util';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import { buildCarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';

function answer(
  partial: Partial<SubmissionAnswerForRules> & Pick<SubmissionAnswerForRules, 'questionId' | 'questionText'>,
): SubmissionAnswerForRules {
  return {
    checked: null,
    booleanValue: null,
    textValue: null,
    selectedOptions: null,
    numberValue: null,
    dateValue: null,
    sectionNumber: 12,
    sectionTitle: 'Mobility, ADL and Practical Support',
    carePlanArea: 'Mobility',
    ...partial,
  };
}

const FALLS_FIELDS: CarePlanFormFieldRef[] = [
  {
    key: 'hist:count',
    sectionId: 'hist',
    fieldId: 'count',
    sectionTitle: 'Falls history',
    label: 'Falls in last 12 months',
    fieldType: 'NUMBER',
    required: false,
  },
  {
    key: 'hist:circ',
    sectionId: 'hist',
    fieldId: 'circ',
    sectionTitle: 'Falls history',
    label: 'Last fall date and circumstances',
    fieldType: 'TEXTAREA',
    required: false,
  },
  {
    key: 'hist:injury',
    sectionId: 'hist',
    fieldId: 'injury',
    sectionTitle: 'Falls history',
    label: 'Injury from previous falls',
    fieldType: 'YES_NO',
    required: false,
  },
  {
    key: 'prev:aids',
    sectionId: 'prev',
    fieldId: 'aids',
    sectionTitle: 'Prevention plan',
    label: 'Mobility aids in use',
    fieldType: 'TEXT',
    required: false,
  },
  {
    key: 'prev:hazards',
    sectionId: 'prev',
    fieldId: 'hazards',
    sectionTitle: 'Prevention plan',
    label: 'Environmental hazards identified',
    fieldType: 'TEXTAREA',
    required: false,
  },
  {
    key: 'prev:transfers',
    sectionId: 'prev',
    fieldId: 'transfers',
    sectionTitle: 'Prevention plan',
    label: 'Transfers – instructions',
    fieldType: 'TEXTAREA',
    required: true,
  },
  {
    key: 'prev:physio',
    sectionId: 'prev',
    fieldId: 'physio',
    sectionTitle: 'Prevention plan',
    label: 'Referral to physiotherapy',
    fieldType: 'YES_NO',
    required: false,
  },
];

const FALLS_RULE: CarePlanRecommendationRuleRow = {
  id: 'falls-rule',
  carePathwayFormId: 'form-falls',
  label: null,
  matchMode: 'ANY',
  conditions: [{ fieldKey: 'fallsLast12Months', when: 'yes' }],
  suppressLegacyArea: 'Mobility',
  sortOrder: 50,
  isActive: true,
  formName: 'Falls',
};

const COMPLETE_ANSWERS: SubmissionAnswerForRules[] = [
  answer({
    questionId: 'q-falls-yn',
    questionText: 'Falls in last 12 months?',
    specRef: '12.7',
    fieldKey: 'fallsLast12Months',
    booleanValue: true,
    checked: true,
  }),
  answer({
    questionId: 'q-count',
    questionText: 'Number of falls (last 12 months)',
    specRef: '12.7',
    numberValue: 2,
  }),
  answer({
    questionId: 'q-date',
    questionText: 'Most recent fall date',
    specRef: '12.7',
    dateValue: '2026-03-12T00:00:00.000Z',
  }),
  answer({
    questionId: 'q-injury',
    questionText: 'Injury caused by fall?',
    specRef: '12.7',
    booleanValue: true,
    checked: true,
  }),
  answer({
    questionId: 'q-hoist',
    questionText: 'Uses hoist or sling?',
    specRef: '12.5a',
    fieldKey: 'usesHoistOrSling',
    booleanValue: true,
    checked: true,
  }),
  answer({
    questionId: 'q-clinical',
    questionText: 'Hoist / profiling bed / air mattress in use?',
    specRef: '12.8',
    fieldKey: 'clinicalEquipmentInUse',
    booleanValue: true,
    checked: true,
  }),
  answer({
    questionId: 'q-equip-details',
    questionText: 'Further equipment details',
    specRef: '12.10',
    textValue: 'Oxford hoist with medium sling',
  }),
  answer({
    questionId: 'q-trip',
    questionText: 'Trip hazards identified?',
    specRef: '3.7',
    sectionNumber: 3,
    sectionTitle: 'Environmental / Home Safety',
    booleanValue: true,
    checked: true,
  }),
  answer({
    questionId: 'q-env-notes',
    questionText: 'Environment / access hazard notes',
    specRef: '3.10',
    sectionNumber: 3,
    sectionTitle: 'Environmental / Home Safety',
    textValue: 'Loose rug in hallway',
  }),
  answer({
    questionId: 'q-transfer-comments',
    questionText: 'Transfer comments',
    specRef: '12.5c',
    textValue: 'Stand with frame, one carer to supervise.',
  }),
  answer({
    questionId: 'q-transfer-support',
    questionText: 'Transfer support required?',
    specRef: '12.5c',
    fieldKey: 'transferSupportRequired',
    booleanValue: true,
    checked: true,
  }),
];

describe('Falls Care Plan new-user pilot workflow', () => {
  it('maps typed IA columns from persisted answer rows including fieldKey', () => {
    const [fallsYn, count] = submissionAnswersForRules([
      {
        questionId: 'q-falls-yn',
        checked: true,
        booleanValue: true,
        textValue: null,
        selectedOptions: null,
        numberValue: null,
        dateValue: null,
        question: {
          questionText: 'Falls in last 12 months?',
          metadata: { specRef: '12.7', fieldKey: 'fallsLast12Months' },
          section: {
            sectionNumber: 12,
            title: 'Mobility, ADL and Practical Support',
            carePlanArea: 'Mobility',
          },
        },
      },
      {
        questionId: 'q-count',
        checked: null,
        booleanValue: null,
        textValue: null,
        selectedOptions: null,
        numberValue: 2,
        dateValue: new Date('2026-03-12T00:00:00.000Z'),
        question: {
          questionText: 'Number of falls (last 12 months)',
          metadata: { specRef: '12.7' },
          section: {
            sectionNumber: 12,
            title: 'Mobility, ADL and Practical Support',
            carePlanArea: 'Mobility',
          },
        },
      },
    ]);
    expect(fallsYn?.fieldKey).toBe('fallsLast12Months');
    expect(fallsYn?.specRef).toBe('12.7');
    expect(count?.numberValue).toBe(2);
    expect(count?.dateValue).toBe('2026-03-12T00:00:00.000Z');
  });

  it('generates a Falls recommendation from the current enterprise identifier, then explicit compose suggestions', () => {
    expect(evaluateCarePlanRule(FALLS_RULE, COMPLETE_ANSWERS).matched).toBe(true);
    expect(
      evaluateCarePlanRule(FALLS_RULE, [
        answer({
          questionId: 'q-falls-yn',
          questionText: 'Falls in last 12 months?',
          specRef: '12.7',
          fieldKey: 'fallsLast12Months',
          booleanValue: false,
          checked: false,
        }),
      ]).matched,
    ).toBe(false);

    const ctx: CarePlanComposeContext = {
      serviceUserId: 'su-new',
      serviceUserName: 'Alex Test',
      personalisation: buildCarePlanPersonalisationContext({
        preferredName: 'Alex',
        firstName: 'Alex',
        lastName: 'Test',
      }),
      ia: {
        submissionId: 'ia-new',
        submittedAt: '2026-08-20T10:00:00.000Z',
        status: 'SUBMITTED',
        answers: COMPLETE_ANSWERS,
        fallsSnapshot: {
          fallsLast12Months: true,
          numberOfFalls: 2,
          mostRecentFallDate: '2026-03-12T00:00:00.000Z',
          injuryCaused: true,
          riskScore: null,
          riskLevel: null,
        },
        fallsScreeningSummary: null,
      },
      previousAssessments: [],
      aboutMe: null,
      emergencyContacts: [],
      allergies: [],
      emar: {
        activeCount: 0,
        scheduledCount: 0,
        prnCount: 0,
        medListText: '',
        prnText: '',
      },
      pack: null,
      gpPharmacyLine: null,
    };

    const compose = composeFallsCarePlan(ctx, FALLS_FIELDS, 'su-new');
    expect(compose.suggestionMode).toBe('explicit');
    expect(compose.values).toEqual({});

    const byKey = Object.fromEntries((compose.suggestions ?? []).map((s) => [s.targetFieldKey, s]));
    expect(byKey['hist:count']?.kind).toBe('value');
    expect(byKey['hist:count']?.suggestedValue).toBe('2');
    expect(byKey['hist:circ']?.displayText).toContain('12 March 2026');
    expect(byKey['hist:injury']?.suggestedValue).toBe(true);
    expect(String(byKey['prev:aids']?.suggestedValue)).toContain('Hoist or sling in use');
    expect(String(byKey['prev:aids']?.suggestedValue)).toContain('Oxford hoist with medium sling');
    expect(String(byKey['prev:hazards']?.suggestedValue)).toContain('Trip hazards identified: Yes');
    expect(String(byKey['prev:hazards']?.suggestedValue)).toContain('Loose rug in hallway');
    expect(byKey['prev:transfers']?.suggestedValue).toBe('Stand with frame, one carer to supervise.');
    expect(byKey['prev:physio']).toBeUndefined();

    const used = byKey['hist:count'];
    const ignored = byKey['hist:injury'];
    expect(used?.sourceType).toBe('INITIAL_ASSESSMENT');
    expect(used?.submissionId).toBe('ia-new');
    expect(used?.sourceQuestions?.length).toBeGreaterThan(0);
    expect(used?.sourceDate).toBe('2026-08-20T10:00:00.000Z');
    expect(ignored?.id).toBeTruthy();

    const publishedValues = { [used!.targetFieldKey]: used!.suggestedValue };
    expect(publishedValues).toEqual({ 'hist:count': '2' });
    expect(publishedValues).not.toHaveProperty('hist:injury');

    expect(
      carePlanInstanceDisplayStatus({ hasDraft: false, hasPublishedVersion: true }),
    ).toBe('PUBLISHED');
    expect(
      carePlanInstanceDisplayStatus({ hasDraft: true, hasPublishedVersion: true }),
    ).not.toBe('PUBLISHED');
  });
});
