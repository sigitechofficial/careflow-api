import { evaluateCarePlanRule, mergeCarePlanRecommendations } from './initial-assessment-care-plan-rules.util';
import { buildCarePlanRecommendations } from './initial-assessment-care-plan.util';
import type { CarePlanRecommendationRuleRow } from './initial-assessment-care-plan-rules.types';
import type { SubmissionAnswerForRules } from './initial-assessment-care-plan-rules.util';

const baseAnswer = (overrides: Partial<SubmissionAnswerForRules>): SubmissionAnswerForRules => ({
  questionId: 'q1',
  questionText: 'MAR / eMAR required?',
  checked: null,
  booleanValue: true,
  textValue: null,
  selectedOptions: null,
  fieldKey: 'emarRequired',
  specRef: '9.6',
  sectionNumber: 9,
  sectionTitle: 'Medication',
  carePlanArea: 'Medication',
  ...overrides,
});

const fallsRule: CarePlanRecommendationRuleRow = {
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

const enterpriseFallsYes: SubmissionAnswerForRules = {
  questionId: 'q-falls-yn',
  questionText: 'Falls in last 12 months?',
  checked: true,
  booleanValue: true,
  textValue: null,
  selectedOptions: null,
  numberValue: null,
  dateValue: null,
  fieldKey: 'fallsLast12Months',
  specRef: '12.7',
  sectionNumber: 12,
  sectionTitle: 'Mobility, ADL and Practical Support',
  carePlanArea: 'Mobility',
};

describe('evaluateCarePlanRule', () => {
  const rule: CarePlanRecommendationRuleRow = {
    id: 'r1',
    carePathwayFormId: 'form-1',
    label: null,
    matchMode: 'ANY',
    conditions: [{ fieldKey: 'emarRequired', when: 'yes' }],
    suppressLegacyArea: 'Medication',
    sortOrder: 0,
    isActive: true,
    formName: 'Medication',
  };

  it('matches when fieldKey answer is yes', () => {
    const result = evaluateCarePlanRule(rule, [baseAnswer({})]);
    expect(result.matched).toBe(true);
    expect(result.triggers).toHaveLength(1);
  });

  it('does not match when answer is no', () => {
    const result = evaluateCarePlanRule(rule, [
      baseAnswer({ booleanValue: false, checked: false }),
    ]);
    expect(result.matched).toBe(false);
  });
});

describe('Falls recommendation rule (fieldKey fallsLast12Months)', () => {
  it('recommends Falls when the enterprise IA field is Yes', () => {
    const result = evaluateCarePlanRule(fallsRule, [enterpriseFallsYes]);
    expect(result.matched).toBe(true);
    expect(result.triggers[0]?.fieldKey).toBe('fallsLast12Months');
    expect(result.triggers[0]?.specRef).toBe('12.7');
  });

  it('does not recommend Falls when fallsLast12Months is No', () => {
    const result = evaluateCarePlanRule(fallsRule, [
      { ...enterpriseFallsYes, booleanValue: false, checked: false },
    ]);
    expect(result.matched).toBe(false);
  });

  it('does not recommend Falls from number-of-falls or other Falls-worded questions alone', () => {
    const result = evaluateCarePlanRule(fallsRule, [
      {
        ...enterpriseFallsYes,
        questionId: 'q-count',
        questionText: 'Number of falls (last 12 months)',
        fieldKey: undefined,
        booleanValue: null,
        checked: null,
        numberValue: 2,
      },
      {
        ...enterpriseFallsYes,
        questionId: 'q-injury',
        questionText: 'Injury caused by fall?',
        fieldKey: undefined,
        specRef: '12.7',
      },
    ]);
    expect(result.matched).toBe(false);
  });
});

describe('mergeCarePlanRecommendations', () => {
  it('suppresses legacy area when rule matched', () => {
    const ruleBased = [
      {
        id: 'rule-1',
        carePlanArea: 'Medication',
        sectionNumber: 9,
        sectionTitle: 'Medication',
        title: 'Medication — recommended',
        triggerCount: 1,
        triggers: [{ questionId: 'q1', questionText: 'eMAR' }],
        status: 'pending' as const,
        carePathwayFormId: 'f1',
        carePathwayFormName: 'Medication',
        source: 'rule' as const,
      },
    ];
    const legacy = buildCarePlanRecommendations([
      {
        answerId: 'a1',
        questionId: 'q1',
        questionText: 'eMAR',
        notes: null,
        textValue: null,
        section: { id: 's1', title: 'Medication', sectionNumber: 9, carePlanArea: 'Medication' },
        carePlanArea: 'Medication',
      },
    ]);
    const merged = mergeCarePlanRecommendations(ruleBased, legacy, ['Medication']);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('rule-1');
  });
});
