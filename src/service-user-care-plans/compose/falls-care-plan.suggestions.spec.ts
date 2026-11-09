import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import type { CarePlanComposeIaSnapshot, CarePlanFormFieldRef } from './compose-context.types';
import {
  buildFallsFieldSuggestions,
  composeFallsCarePlanSuggestions,
  findEnterpriseIaAnswer,
  resolveCarePlanField,
} from './falls-care-plan.suggestions';
import { composeFallsCarePlan } from './area-care-plans.compose';
import { composeMedicationCarePlan, MEDICATION_CARE_PLAN_FIELD_MAPPINGS } from './medication-care-plan.compose';
import { buildCarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';
import type { CarePlanComposeContext } from './compose-context.types';

function answer(partial: Partial<SubmissionAnswerForRules> & Pick<SubmissionAnswerForRules, 'questionId' | 'questionText'>): SubmissionAnswerForRules {
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

function ia(answers: SubmissionAnswerForRules[], extras?: Partial<CarePlanComposeIaSnapshot>): CarePlanComposeIaSnapshot {
  return {
    submissionId: extras?.submissionId ?? 'ia-current',
    submittedAt: extras?.submittedAt ?? '2026-08-19T07:36:44.000Z',
    status: extras?.status ?? 'SUBMITTED',
    answers,
    fallsSnapshot: extras?.fallsSnapshot ?? {
      fallsLast12Months: true,
      numberOfFalls: 2,
      mostRecentFallDate: '2026-03-12T00:00:00.000Z',
      injuryCaused: true,
      riskScore: 65,
      riskLevel: 'HIGH',
    },
    fallsScreeningSummary: extras?.fallsScreeningSummary ?? null,
  };
}

const ENTERPRISE_ANSWERS: SubmissionAnswerForRules[] = [
  answer({
    questionId: 'q-count',
    questionText: 'Number of falls (last 12 months)',
    specRef: '12.7',
    numberValue: 2,
  }),
  answer({
    questionId: 'q-falls-yn',
    questionText: 'Falls in last 12 months?',
    specRef: '12.7',
    fieldKey: 'fallsLast12Months',
    booleanValue: true,
    checked: true,
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
];

describe('Falls care plan suggestions', () => {
  it('maps number of falls to a NUMBER field, not Yes', () => {
    const suggestions = buildFallsFieldSuggestions(ia(ENTERPRISE_ANSWERS), FALLS_FIELDS);
    const count = suggestions.find((s) => s.targetFieldKey === 'hist:count');
    expect(count?.suggestedValue).toBe('2');
    expect(count?.targetFieldType).toBe('NUMBER');
    expect(count?.suggestedValue).not.toBe('Yes');
  });

  it('suggests 0 when IA explicitly records no falls and no count', () => {
    const suggestions = buildFallsFieldSuggestions(
      ia(
        [
          answer({
            questionId: 'q-falls-yn',
            questionText: 'Falls in last 12 months?',
            specRef: '12.7',
            fieldKey: 'fallsLast12Months',
            booleanValue: false,
            checked: false,
          }),
        ],
        {
          fallsSnapshot: {
            fallsLast12Months: false,
            numberOfFalls: null,
            mostRecentFallDate: null,
            injuryCaused: null,
            riskScore: 35,
            riskLevel: 'LOW',
          },
        },
      ),
      FALLS_FIELDS,
    );
    const count = suggestions.find((s) => s.targetFieldKey === 'hist:count');
    expect(count?.kind).toBe('value');
    expect(count?.suggestedValue).toBe('0');
  });

  it('shows context when falls are confirmed but the count was not recorded', () => {
    const suggestions = buildFallsFieldSuggestions(
      ia(
        [
          answer({
            questionId: 'q-falls-yn',
            questionText: 'Falls in last 12 months?',
            specRef: '12.7',
            fieldKey: 'fallsLast12Months',
            booleanValue: true,
            checked: true,
          }),
        ],
        {
          fallsSnapshot: {
            fallsLast12Months: true,
            numberOfFalls: null,
            mostRecentFallDate: null,
            injuryCaused: null,
            riskScore: 35,
            riskLevel: 'LOW',
          },
        },
      ),
      FALLS_FIELDS,
    );
    const count = suggestions.find((s) => s.targetFieldKey === 'hist:count');
    expect(count?.kind).toBe('context');
    expect(count?.suggestedValue).toBeNull();
    expect(count?.displayText).toMatch(/number of falls was not recorded/i);
    expect(count?.suggestedValue).not.toBe('0');
    expect(count?.suggestedValue).not.toBe('1');
    expect(count?.suggestedValue).not.toBe('Yes');
    expect(count?.displayText).not.toMatch(/\b65\b|\b35\b|HIGH|LOW/);
  });

  it('uses metadata.falls.numberOfFalls when the count answer row is missing', () => {
    const suggestions = buildFallsFieldSuggestions(
      ia([], {
        fallsSnapshot: {
          fallsLast12Months: true,
          numberOfFalls: 3,
          mostRecentFallDate: null,
          injuryCaused: null,
          riskScore: 80,
          riskLevel: 'HIGH',
        },
      }),
      FALLS_FIELDS,
    );
    const count = suggestions.find((s) => s.targetFieldKey === 'hist:count');
    expect(count?.kind).toBe('value');
    expect(count?.suggestedValue).toBe('3');
    expect(count?.suggestedValue).not.toBe('80');
  });

  it('prefers the count answer row over metadata.falls.numberOfFalls', () => {
    const suggestions = buildFallsFieldSuggestions(
      ia(
        [
          answer({
            questionId: 'q-count',
            questionText: 'Number of falls (last 12 months)',
            specRef: '12.7',
            numberValue: 2,
          }),
        ],
        {
          fallsSnapshot: {
            fallsLast12Months: true,
            numberOfFalls: 9,
            mostRecentFallDate: null,
            injuryCaused: null,
            riskScore: 80,
            riskLevel: 'HIGH',
          },
        },
      ),
      FALLS_FIELDS,
    );
    expect(suggestions.find((s) => s.targetFieldKey === 'hist:count')?.suggestedValue).toBe('2');
  });

  it('does not populate clinical fields from riskScore or riskLevel', () => {
    const suggestions = buildFallsFieldSuggestions(
      ia([], {
        fallsSnapshot: {
          fallsLast12Months: null,
          numberOfFalls: null,
          mostRecentFallDate: null,
          injuryCaused: null,
          riskScore: 65,
          riskLevel: 'HIGH',
        },
      }),
      FALLS_FIELDS,
    );
    expect(suggestions).toEqual([]);
  });

  it('uses metadata.falls.injuryCaused when the injury answer row is missing', () => {
    const suggestions = buildFallsFieldSuggestions(
      ia([], {
        fallsSnapshot: {
          fallsLast12Months: true,
          numberOfFalls: null,
          mostRecentFallDate: null,
          injuryCaused: true,
          riskScore: 65,
          riskLevel: 'HIGH',
        },
      }),
      FALLS_FIELDS,
    );
    const injury = suggestions.find((s) => s.targetFieldKey === 'hist:injury');
    expect(injury?.kind).toBe('value');
    expect(injury?.suggestedValue).toBe(true);
    expect(injury?.suggestedValue).not.toBe(65);
  });

  it('does not invent injury No when the injury answer is missing', () => {
    const suggestions = buildFallsFieldSuggestions(
      ia(
        [
          answer({
            questionId: 'q-falls-yn',
            questionText: 'Falls in last 12 months?',
            specRef: '12.7',
            fieldKey: 'fallsLast12Months',
            booleanValue: true,
            checked: true,
          }),
        ],
        {
          fallsSnapshot: {
            fallsLast12Months: true,
            numberOfFalls: null,
            mostRecentFallDate: null,
            injuryCaused: null,
            riskScore: 35,
            riskLevel: 'LOW',
          },
        },
      ),
      FALLS_FIELDS,
    );
    expect(suggestions.find((s) => s.targetFieldKey === 'hist:injury')).toBeUndefined();
  });

  it('maps injury YES_NO to boolean true', () => {
    const injury = buildFallsFieldSuggestions(ia(ENTERPRISE_ANSWERS), FALLS_FIELDS).find(
      (s) => s.targetFieldKey === 'hist:injury',
    );
    expect(injury?.suggestedValue).toBe(true);
    expect(injury?.displayText).toBe('Yes');
  });

  it('includes the fall date in a narrative and does not invent circumstances', () => {
    const circ = buildFallsFieldSuggestions(ia(ENTERPRISE_ANSWERS), FALLS_FIELDS).find(
      (s) => s.targetFieldKey === 'hist:circ',
    );
    expect(circ?.displayText).toContain('12 March 2026');
    expect(circ?.displayText).toContain('Injury reported: Yes');
    expect(circ?.displayText).not.toMatch(/slipped|tripped over/i);
  });

  it('copies transfer comments and does not manufacture instructions from Yes/No', () => {
    const transfers = buildFallsFieldSuggestions(ia(ENTERPRISE_ANSWERS), FALLS_FIELDS).find(
      (s) => s.targetFieldKey === 'prev:transfers',
    );
    expect(transfers?.kind).toBe('value');
    expect(transfers?.suggestedValue).toBe('Stand with frame, one carer to supervise.');
  });

  it('exposes transfer support as context only when no instruction text exists', () => {
    const suggestions = buildFallsFieldSuggestions(
      ia([
        answer({
          questionId: 'q-support',
          questionText: 'Transfer support required?',
          specRef: '12.5c',
          fieldKey: 'transferSupportRequired',
          booleanValue: true,
          checked: true,
        }),
      ]),
      FALLS_FIELDS,
    );
    const transfers = suggestions.find((s) => s.targetFieldKey === 'prev:transfers');
    expect(transfers?.kind).toBe('context');
    expect(transfers?.suggestedValue).toBeNull();
    expect(transfers?.displayText).toContain('Transfer support required: Yes');
  });

  it('does not treat mobilising aids in working order as the aid in use', () => {
    const suggestions = buildFallsFieldSuggestions(
      ia([
        answer({
          questionId: 'q-working',
          questionText: 'All mobilising aids in good working order?',
          specRef: '12.8',
          booleanValue: true,
          checked: true,
        }),
      ]),
      FALLS_FIELDS,
    );
    const aids = suggestions.find((s) => s.targetFieldKey === 'prev:aids');
    expect(aids?.kind).toBe('context');
    expect(aids?.suggestedValue).toBeNull();
  });

  it('does not invent a physiotherapy suggestion', () => {
    const suggestions = buildFallsFieldSuggestions(ia(ENTERPRISE_ANSWERS), FALLS_FIELDS);
    expect(suggestions.some((s) => s.targetFieldKey === 'prev:physio')).toBe(false);
  });

  it('prefers enterprise trip-hazard questions over legacy catalogue checkboxes', () => {
    const suggestions = buildFallsFieldSuggestions(
      ia([
        answer({
          questionId: 'legacy',
          questionText: 'Trip hazards?',
          sectionNumber: 9,
          sectionTitle: 'Environment',
          checked: true,
          booleanValue: true,
        }),
        answer({
          questionId: 'enterprise',
          questionText: 'Trip hazards identified?',
          specRef: '3.7',
          sectionNumber: 3,
          sectionTitle: 'Environmental / Home Safety',
          booleanValue: false,
          checked: false,
        }),
      ]),
      FALLS_FIELDS,
    );
    const hazards = suggestions.find((s) => s.targetFieldKey === 'prev:hazards');
    expect(hazards?.displayText).toContain('Trip hazards identified: No');
    expect(findEnterpriseIaAnswer(
      [
        answer({ questionId: 'legacy', questionText: 'Trip hazards?', checked: true, booleanValue: true }),
        answer({
          questionId: 'enterprise',
          questionText: 'Trip hazards identified?',
          specRef: '3.7',
          booleanValue: false,
          checked: false,
        }),
      ],
      { specRef: '3.7', questionTextContains: 'trip hazards identified' },
    )?.questionId).toBe('enterprise');
  });

  it('returns explicit suggestion mode with empty values for Falls', () => {
    const result = composeFallsCarePlanSuggestions(ia(ENTERPRISE_ANSWERS), [], FALLS_FIELDS, 'su-1');
    expect(result.suggestionMode).toBe('explicit');
    expect(result.values).toEqual({});
    expect(result.suggestions?.some((s) => s.kind === 'value')).toBe(true);
    expect(result.iaStatus).toBe('SUBMITTED');
    expect(result.evidence.some((e) => e.label.includes('Awaiting manager review'))).toBe(true);
    // A stored falls score is shown as history only (NICE NG249: no risk-prediction scores).
    expect(result.evidence.some((e) => e.label === 'Falls risk (legacy score)')).toBe(true);
  });

  it('allows REVIEWED IA suggestions and keeps previous assessments separate', () => {
    const current = ia(ENTERPRISE_ANSWERS, { status: 'REVIEWED', submissionId: 'ia-new' });
    const previous = ia(
      [
        answer({
          questionId: 'q-old-count',
          questionText: 'Number of falls (last 12 months)',
          specRef: '12.7',
          numberValue: 1,
        }),
      ],
      { submissionId: 'ia-old', submittedAt: '2026-05-11T09:00:00.000Z', status: 'REVIEWED' },
    );
    const result = composeFallsCarePlanSuggestions(current, [previous], FALLS_FIELDS, 'su-1');
    expect(result.iaStatus).toBe('REVIEWED');
    expect(result.suggestions?.find((s) => s.targetFieldKey === 'hist:count')?.suggestedValue).toBe('2');
    expect(result.previousAssessments?.[0]?.suggestions.find((s) => s.targetFieldKey === 'hist:count')?.suggestedValue).toBe(
      '1',
    );
    expect(result.previousAssessments?.[0]?.suggestions.find((s) => s.targetFieldKey === 'hist:count')?.submissionId).toBe(
      'ia-old',
    );
  });

  it('uses a new suggestion id when the IA value changes so Ignore can expire', () => {
    const first = buildFallsFieldSuggestions(ia(ENTERPRISE_ANSWERS, { submissionId: 'ia-1' }), FALLS_FIELDS).find(
      (s) => s.targetFieldKey === 'hist:count',
    );
    const secondAnswers = ENTERPRISE_ANSWERS.map((row) =>
      row.questionId === 'q-count' ? { ...row, numberValue: 4 } : row,
    );
    const second = buildFallsFieldSuggestions(
      ia(secondAnswers, { submissionId: 'ia-2' }),
      FALLS_FIELDS,
    ).find((s) => s.targetFieldKey === 'hist:count');
    expect(first?.id).not.toBe(second?.id);
  });

  it('skips a mapping when the target field cannot be resolved', () => {
    const suggestions = buildFallsFieldSuggestions(ia(ENTERPRISE_ANSWERS), [
      {
        key: 'other:x',
        sectionId: 'other',
        fieldId: 'x',
        sectionTitle: 'Other',
        label: 'Unrelated',
        fieldType: 'TEXT',
        required: false,
      },
    ]);
    expect(suggestions).toEqual([]);
    expect(resolveCarePlanField(FALLS_FIELDS, 'Missing section', 'Falls in last 12 months', 'NUMBER')).toBeUndefined();
  });

  it('does not change Medication compose prefill behaviour', () => {
    const ctx: CarePlanComposeContext = {
      serviceUserId: 'su-1',
      serviceUserName: 'Margaret Hughes',
      personalisation: buildCarePlanPersonalisationContext({
        firstName: 'Margaret',
        lastName: 'Hughes',
      }),
      ia: {
        submissionId: 'ia-1',
        submittedAt: '2026-06-01T10:00:00.000Z',
        answers: [
          answer({
            questionId: 'q1',
            questionText: 'Recommended medication support level',
            fieldKey: 'medicationSupportLevel',
            specRef: '9.2',
            selectedOptions: ['prompting'],
            sectionNumber: 9,
            sectionTitle: 'Medication',
            carePlanArea: 'Medication',
          }),
        ],
      },
      aboutMe: null,
      emergencyContacts: [],
      allergies: ['Penicillin'],
      emar: {
        activeCount: 1,
        scheduledCount: 1,
        prnCount: 0,
        medListText: 'Aspirin',
        prnText: '',
      },
      pack: null,
      gpPharmacyLine: null,
    };
    const result = composeMedicationCarePlan(
      ctx,
      [
        {
          key: 'sec:1',
          sectionId: 'sec',
          fieldId: '1',
          label: 'Medication support level',
          fieldType: 'SELECT',
          required: true,
        },
        {
          key: 'sec:2',
          sectionId: 'sec',
          fieldId: '2',
          label: 'Known allergies',
          fieldType: 'TEXTAREA',
          required: true,
        },
      ],
      MEDICATION_CARE_PLAN_FIELD_MAPPINGS,
      'su-1',
    );
    // Medication fills what it can (allergies) and offers the support level as a suggestion for the manager to
    // accept (hybrid); Falls only suggests.
    expect(result.suggestionMode).toBe('hybrid');
    expect(result.values['sec:1']).toBeUndefined();
    expect(result.suggestions?.find((s) => s.targetFieldKey === 'sec:1')?.suggestedValue).toBe('Prompted');
    expect(Object.keys(result.values).length).toBeGreaterThan(0);
  });

  it('composeFallsCarePlan returns empty values', () => {
    const ctx: CarePlanComposeContext = {
      serviceUserId: 'su-1',
      serviceUserName: 'Test',
      personalisation: buildCarePlanPersonalisationContext({ firstName: 'Test', lastName: 'User' }),
      ia: ia(ENTERPRISE_ANSWERS),
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
    const result = composeFallsCarePlan(ctx, FALLS_FIELDS, 'su-1');
    expect(result.values).toEqual({});
    expect(result.suggestionMode).toBe('explicit');
  });
});
