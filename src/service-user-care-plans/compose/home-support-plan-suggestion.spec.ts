import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import { composeHomeSupportPlanHybrid } from './home-support-plan.compose';
import {
  HSP_PILOT_SUGGESTION_KEYS,
  HSP_SUGGESTION_KEYS,
  HSP_SUGGESTION_MAPPINGS,
} from './home-support-plan-field-mappings';

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
    sectionNumber: 1,
    sectionTitle: 'Holistic assessment',
    carePlanArea: 'About me',
    ...partial,
  };
}

function hspFields(keys: readonly string[], sectionId = 'suggest'): CarePlanFormFieldRef[] {
  return keys.map((businessKey) => ({
    key: `${sectionId}:${businessKey.replace(/^hsp_/, '')}`,
    sectionId,
    fieldId: businessKey.replace(/^hsp_/, ''),
    fieldKey: businessKey,
    label: businessKey,
    fieldType: 'TEXTAREA',
    required: false,
  }));
}

const PRIORITY_SUGGESTION_KEYS = [
  'hsp_support_needs_summary',
  'hsp_personal_care_tasks',
  'hsp_meal_preparation_support',
  'hsp_goal_1',
  'hsp_goal_1_carer_support',
  'hsp_escalation_instructions',
] as const;

function buildRichContext(): CarePlanComposeContext {
  return {
    serviceUserId: 'su-2d2',
    serviceUserName: 'Alex Example',
    personalisation: { firstName: 'Alex', lastName: 'Example', preferredName: null, serviceUserNumber: 'SU2' },
    ia: {
      submissionId: 'ia-2d2',
      submittedAt: '2026-08-20T10:00:00.000Z',
      status: 'SUBMITTED',
      answers: [
        answer({
          questionId: 'q-what-matters',
          questionText: 'What matters most to the client',
          fieldKey: 'whatMattersMost',
          textValue: 'Staying independent at home.',
        }),
        answer({
          questionId: 'q-support-goals',
          questionText: 'Support goals',
          fieldKey: 'supportGoals',
          textValue: 'Maintain personal hygiene with morning support.',
        }),
        answer({
          questionId: 'q-staff-risks',
          questionText: 'Staff visit risks',
          fieldKey: 'staffVisitRisks',
          textValue: 'Call 111 if breathing worsens.',
        }),
        answer({
          questionId: 'q-breathing',
          questionText: 'Breathing action plan',
          fieldKey: 'breathingActionPlan',
          textValue: 'Use inhaler as prescribed.',
        }),
      ],
      adlMetadata: {
        rows: [
          { id: 'bathing', activity: 'Bathing', score: 2, notes: 'AM only' },
          { id: 'grooming', activity: 'Grooming', score: 1 },
          { id: 'dressing_undressing', activity: 'Dressing / undressing', score: 2 },
          { id: 'toileting', activity: 'Toileting', score: 0 },
          { id: 'preparing_food', activity: 'Preparing food', score: 2 },
        ],
        mobilityAidsRequired: null,
        mobilityAidsList: null,
      },
    },
    previousAssessments: [],
    aboutMe: {
      whatMattersMost: null,
      peopleImportant: null,
      howToSupport: null,
      communication: null,
      personalCare: 'Shower preferred in morning.',
      domesticSupport: 'Carers prepare hot meals.',
      foodPreferences: null,
      routineSummary: null,
      triggersCalm: null,
      lifeHistoryInterests: null,
      meaningfulActivities: null,
      goodDay: null,
      nightSupport: null,
    },
    emergencyContacts: [],
    allergies: [],
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
  };
}

describe('Home Support Plan SUGGESTION resolvers (phase 2D-2)', () => {
  it('defines a resolver for every registry SUGGESTION field', () => {
    expect(HSP_SUGGESTION_MAPPINGS.map((entry) => entry.businessKey).sort()).toEqual(
      [...HSP_SUGGESTION_KEYS].sort(),
    );
  });

  it('generates priority suggestions with sourceQuestions when source data exists', () => {
    const fields = hspFields(PRIORITY_SUGGESTION_KEYS);
    const result = composeHomeSupportPlanHybrid(buildRichContext(), fields, 'su-2d2');

    expect(result.suggestions).toHaveLength(PRIORITY_SUGGESTION_KEYS.length);

    const byTarget = new Map(result.suggestions?.map((s) => [s.targetFieldKey, s]));
    const supportSummary = byTarget.get('suggest:support_needs_summary');
    expect(supportSummary?.displayText).toContain('Staying independent at home');
    expect(supportSummary?.displayText).toContain('Maintain personal hygiene');
    expect(supportSummary?.sourceQuestions.length).toBeGreaterThan(0);
    expect(supportSummary?.sourceQuestions[0]).toMatchObject({
      questionFieldKey: expect.any(String),
      sourceSection: expect.any(String),
      sourceLabel: expect.any(String),
      sourceValue: expect.any(String),
    });
    expect(supportSummary?.submissionId).toBe('ia-2d2');

    const personalCare = byTarget.get('suggest:personal_care_tasks');
    expect(personalCare?.displayText).toContain('Bathing');
    expect(personalCare?.displayText).toContain('Shower preferred in morning');
    expect(personalCare?.sourceQuestions.some((s) => s.questionId.startsWith('adl-metadata:'))).toBe(true);

    const mealPrep = byTarget.get('suggest:meal_preparation_support');
    expect(mealPrep?.displayText).toContain('Preparing food');
    expect(mealPrep?.displayText).toContain('Carers prepare hot meals');

    const goal1 = byTarget.get('suggest:goal_1');
    expect(goal1?.displayText).toContain('Staying independent at home');
    expect(goal1?.displayText).toContain('Maintain personal hygiene');

    const goal1Carer = byTarget.get('suggest:goal_1_carer_support');
    expect(goal1Carer?.displayText).toContain('Maintain personal hygiene');

    const escalation = byTarget.get('suggest:escalation_instructions');
    expect(escalation?.displayText).toContain('Call 111 if breathing worsens');
    expect(escalation?.displayText).toContain('Use inhaler as prescribed');
  });

  it('does not generate suggestions when source data is missing', () => {
    const fields = hspFields(PRIORITY_SUGGESTION_KEYS);
    const emptyContext: CarePlanComposeContext = {
      ...buildRichContext(),
      ia: {
        submissionId: 'ia-empty',
        submittedAt: '2026-08-20T10:00:00.000Z',
        status: 'SUBMITTED',
        answers: [],
        adlMetadata: { rows: [], mobilityAidsRequired: null, mobilityAidsList: null },
      },
      aboutMe: null,
    };

    const result = composeHomeSupportPlanHybrid(emptyContext, fields, 'su-2d2');

    expect(result.suggestions).toEqual([]);
  });

  it('never writes suggestion fields into compose.values', () => {
    const fields = hspFields(HSP_PILOT_SUGGESTION_KEYS);
    const result = composeHomeSupportPlanHybrid(buildRichContext(), fields, 'su-2d2');

    expect((result.suggestions ?? []).length).toBeGreaterThan(0);

    for (const field of fields) {
      expect(result.values[field.key]).toBeUndefined();
      expect(result.provenance?.[field.key]).toBeUndefined();
    }
  });
});
