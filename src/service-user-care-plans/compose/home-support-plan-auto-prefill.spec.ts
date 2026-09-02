import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import { composeHomeSupportPlanHybrid } from './home-support-plan.compose';
import {
  HSP_AUTO_PREFILL_KEYS,
  HSP_AUTO_PREFILL_MAPPINGS,
  mapEatingAssistanceLevelToHsp,
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
    sectionNumber: 14,
    sectionTitle: 'Sign-off',
    carePlanArea: 'Administration',
    ...partial,
  };
}

function hspFields(keys: readonly string[]): CarePlanFormFieldRef[] {
  return keys.map((businessKey) => ({
    key: `sec:${businessKey.replace(/^hsp_/, '')}`,
    sectionId: 'sec',
    fieldId: businessKey.replace(/^hsp_/, ''),
    fieldKey: businessKey,
    label: businessKey,
    fieldType: 'TEXT',
    required: false,
  }));
}

function buildIaContext(answers: SubmissionAnswerForRules[]): CarePlanComposeContext {
  return {
    serviceUserId: 'su-2d1',
    serviceUserName: 'Alex Example',
    personalisation: { firstName: 'Alex', lastName: 'Example', preferredName: null, serviceUserNumber: 'SU2' },
    ia: {
      submissionId: 'ia-2d1',
      submittedAt: '2026-08-20T10:00:00.000Z',
      status: 'SUBMITTED',
      answers,
      adlMetadata: {
        rows: [],
        mobilityAidsRequired: true,
        mobilityAidsList: 'Rollator',
      },
    },
    previousAssessments: [],
    aboutMe: null,
    emergencyContacts: [],
    allergies: [],
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
  };
}

describe('Home Support Plan AUTO_PREFILL resolvers (phase 2D-1)', () => {
  it('defines a resolver for every registry AUTO_PREFILL field', () => {
    expect(HSP_AUTO_PREFILL_MAPPINGS.map((entry) => entry.businessKey).sort()).toEqual(
      [...HSP_AUTO_PREFILL_KEYS].sort(),
    );
  });

  it('maps priority eating assistance IA value to the HSP select label', () => {
    expect(mapEatingAssistanceLevelToHsp('prompting')).toBe('Prompting');
    expect(mapEatingAssistanceLevelToHsp('full_support')).toBe('Full assistance');
  });

  it('resolves values onto runtime field keys with autoPrefilled provenance', () => {
    const answers: SubmissionAnswerForRules[] = [
      answer({
        questionId: 'q-assessment-date',
        questionText: 'Assessment date',
        fieldKey: 'assessmentDate',
        dateValue: '2026-08-01',
      }),
      answer({
        questionId: 'q-review-frequency',
        questionText: 'Review frequency',
        fieldKey: 'reviewFrequency',
        selectedOptions: 'Annually',
      }),
      answer({
        questionId: 'q-next-review',
        questionText: 'Next review date',
        fieldKey: 'nextReviewDate',
        dateValue: '2027-08-01',
      }),
      answer({
        questionId: 'q-eating',
        questionText: 'Assistance level for eating and drinking',
        fieldKey: 'eatingAssistanceLevel',
        selectedOptions: 'prompting',
      }),
      answer({
        questionId: 'q-shopping',
        questionText: 'Shopping arrangements',
        fieldKey: 'shoppingArrangements',
        textValue: 'Carer collects groceries weekly.',
      }),
      answer({
        questionId: 'q-finance',
        questionText: 'Finance support required?',
        fieldKey: 'financeSupportRequired',
        booleanValue: true,
        checked: true,
      }),
      answer({
        questionId: 'q-access',
        questionText: 'Instructions for gaining access',
        fieldKey: 'homeAccessInstructions',
        textValue: 'Use side entrance.',
      }),
      answer({
        questionId: 'q-lives-alone',
        questionText: 'Does the client live alone?',
        fieldKey: 'livesAlone',
        booleanValue: true,
        checked: true,
      }),
      answer({
        questionId: 'q-informal',
        questionText: 'Informal carer support?',
        fieldKey: 'informalCarerSupport',
        booleanValue: true,
        checked: true,
      }),
      answer({
        questionId: 'q-informal-name',
        questionText: 'Informal carer name',
        fieldKey: 'informalCarerName',
        textValue: 'Sarah Example',
      }),
      answer({
        questionId: 'q-informal-contact',
        questionText: 'Informal carer contact',
        fieldKey: 'informalCarerContact',
        textValue: '07700 900123',
      }),
    ];

    const fields = hspFields([
      'hsp_plan_start_date',
      'hsp_review_frequency',
      'hsp_next_review_due_date',
      'hsp_eating_drinking_assistance_level',
      'hsp_shopping_errands',
      'hsp_finance_support_required',
      'hsp_home_access_instructions',
      'hsp_lives_alone',
      'hsp_informal_carer_involved',
      'hsp_informal_carer_contact',
      'hsp_mobility_aids_in_use',
    ]);

    const result = composeHomeSupportPlanHybrid(buildIaContext(answers), fields, 'su-2d1');

    expect(result.values['sec:plan_start_date']).toBe('2026-08-01');
    expect(result.values['sec:review_frequency']).toBe('Annually');
    expect(result.values['sec:next_review_due_date']).toBe('2027-08-01');
    expect(result.values['sec:eating_drinking_assistance_level']).toBe('Prompting');
    expect(result.values['sec:shopping_errands']).toBe('Carer collects groceries weekly.');
    expect(result.values['sec:finance_support_required']).toBe(true);
    expect(result.values['sec:home_access_instructions']).toBe('Use side entrance.');
    expect(result.values['sec:lives_alone']).toBe(true);
    expect(result.values['sec:informal_carer_involved']).toBe(true);
    expect(result.values['sec:informal_carer_contact']).toContain('Sarah Example');
    expect(result.values['sec:mobility_aids_in_use']).toContain('Rollator');

    for (const field of fields) {
      expect(result.provenance?.[field.key]).toMatchObject({
        sourceType: 'INITIAL_ASSESSMENT',
        submissionId: 'ia-2d1',
        autoPrefilled: true,
        userEdited: false,
      });
    }
  });

  it('does not write empty values when IA data is missing', () => {
    const fields = hspFields([
      'hsp_review_frequency',
      'hsp_shopping_errands',
      'hsp_home_access_instructions',
      'hsp_informal_carer_contact',
      'hsp_eating_drinking_assistance_level',
    ]);

    const result = composeHomeSupportPlanHybrid(buildIaContext([]), fields, 'su-2d1');

    for (const field of fields) {
      expect(result.values[field.key]).toBeUndefined();
    }
    expect(Object.keys(result.provenance ?? {})).toHaveLength(0);
  });

  it('does not default plan start date to today when assessmentDate is absent', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = composeHomeSupportPlanHybrid(
      buildIaContext([]),
      hspFields(['hsp_plan_start_date']),
      'su-2d1',
    );
    expect(result.values['sec:plan_start_date']).toBeUndefined();
    expect(result.values['sec:plan_start_date']).not.toBe(today);
  });

  it('does not map IA assistance onto HSP Supervision', () => {
    expect(mapEatingAssistanceLevelToHsp('assistance')).toBeNull();
    expect(mapEatingAssistanceLevelToHsp('prompting')).toBe('Prompting');
  });

  it('does not emit suggestions for AUTO_PREFILL fields', () => {
    const result = composeHomeSupportPlanHybrid(
      buildIaContext([
        answer({
          questionId: 'q-lives-alone',
          questionText: 'Does the client live alone?',
          fieldKey: 'livesAlone',
          booleanValue: true,
          checked: true,
        }),
      ]),
      hspFields(['hsp_lives_alone', 'hsp_personal_care_tasks']),
      'su-2d1',
    );

    expect(result.values['sec:lives_alone']).toBe(true);
    expect(result.suggestions?.some((s) => s.targetFieldKey === 'sec:lives_alone')).toBe(false);
  });
});
