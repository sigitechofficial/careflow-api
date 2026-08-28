import {
  HOME_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  HOME_CARE_PLAN_SEED,
  HCP_CONTINENCE_NEEDS_OPTIONS,
  HCP_COGNITIVE_IMPAIRMENT_OPTIONS,
  HCP_DESIRED_GOALS_OPTIONS,
  HCP_DIETARY_NEEDS_OPTIONS,
  HCP_HOUSEHOLD_SUPPORT_OPTIONS,
  HCP_MEAL_REQUIREMENTS_OPTIONS,
  HCP_MEDICATION_SUMMARY_OPTIONS,
  HCP_MOBILITY_AIDS_OPTIONS,
  HCP_MOBILITY_SUMMARY_OPTIONS,
  HCP_OTHER_SUPPORT_OPTIONS,
  HCP_PERSONAL_NEEDS_OPTIONS,
  HCP_CONTINENCE_OPTION_CATHETER_CARE,
  HCP_CONTINENCE_OPTION_PAD_CHANGING,
} from '../../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../../prisma/seeds/home-support-plan.seed-data';
import {
  HCP_FIELD_REGISTRY,
  HCP_MANUAL_KEYS,
  HCP_SUGGESTION_KEYS,
  assertHcpRegistryMatchesTemplate,
  hcpFieldRegistryEntry,
} from './home-care-plan-field-registry';
import { composeHomeCarePlanHybrid, HOME_CARE_PLAN_FORM_NAME } from './home-care-plan.compose';
import {
  HCP_CONTINENCE_IA_DERIVABLE_OPTIONS,
  HCP_DIETARY_IA_DERIVABLE_OPTIONS,
  HCP_MEAL_IA_DERIVABLE_OPTIONS,
  HCP_MOBILITY_AIDS_IA_DERIVABLE_OPTIONS,
} from './home-care-plan-field-mappings';
import type {
  CarePlanComposeContext,
  CarePlanFormFieldRef,
} from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

// --------------------------------------------------------------------------
// Real Initial Assessment option values
//
// Copied verbatim from the seeded IA catalogue (`InitialAssessmentQuestion.options`)
// for the questions these mappings read. Fixtures must come from here rather than being
// invented: an invented value ("Stage 2") previously let a broken `unknown` case pass.
// --------------------------------------------------------------------------

const IA_FOOD_TEXTURE_VALUES = {
  normal: 'normal',
  soft: 'soft',
  minced: 'minced',
  pureed: 'pureed',
  unknown: 'unknown',
} as const;

const IA_FLUID_THICKNESS_VALUES = {
  normal: 'normal',
  thickened: 'thickened',
  unknown: 'unknown',
} as const;

const IA_BLADDER_CONTINENCE_VALUES = {
  noConcern: 'no_concern',
  concern: 'concern',
  incontinence: 'incontinence',
  stress: 'stress',
  nocturnal: 'nocturnal',
  products: 'products',
  catheter: 'catheter',
  urostomy: 'urostomy',
  continenceReferral: 'continence_referral',
} as const;

const IA_BOWEL_CONTINENCE_VALUES = {
  noConcern: 'no_concern',
  concern: 'concern',
  incontinence: 'incontinence',
  stress: 'stress',
  nocturnal: 'nocturnal',
  products: 'products',
  stoma: 'stoma',
  continenceReferral: 'continence_referral',
  gpReview: 'gp_review',
} as const;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const SECTION_ID = 'sec-1';

function seedFieldKeys(): string[] {
  return HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of HOME_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

/** Build the CarePlanFormFieldRef[] the compose layer receives, from the seed template. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  return seedFieldKeys().map((fieldKey, index) => ({
    key: `${SECTION_ID}:field-${index}`,
    sectionId: SECTION_ID,
    fieldId: `field-${index}`,
    fieldKey,
    label: seedField(fieldKey)?.label ?? fieldKey,
    fieldType: seedField(fieldKey)?.fieldType ?? 'TEXTAREA',
    required: seedField(fieldKey)?.required ?? false,
  })) as CarePlanFormFieldRef[];
}

let questionSeq = 0;

function answer(overrides: Partial<SubmissionAnswerForRules>): SubmissionAnswerForRules {
  questionSeq += 1;
  return {
    questionId: `q-${questionSeq}`,
    questionText: 'Question',
    checked: null,
    booleanValue: null,
    textValue: null,
    selectedOptions: null,
    sectionNumber: 1,
    sectionTitle: 'Section',
    ...overrides,
  } as SubmissionAnswerForRules;
}

function ctxWithAnswers(answers: SubmissionAnswerForRules[]): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers,
    },
  } as unknown as CarePlanComposeContext;
}

function suggestionFor(result: ReturnType<typeof composeHomeCarePlanHybrid>, fieldKey: string) {
  const fields = fieldRefsFromSeed();
  const ref = fields.find((f) => f.fieldKey === fieldKey);
  return result.suggestions?.find((s) => s.targetFieldKey === ref?.key);
}

// --------------------------------------------------------------------------
// 1 + 3 — template contents
// --------------------------------------------------------------------------

describe('Home Care Plan template', () => {
  it('keeps every original Home Care Plan field', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(HOME_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
  });

  it('preserves the original field types of the pre-expansion fields', () => {
    expect(seedField('hcp_plan_start_date')?.fieldType).toBe('DATE');
    expect(seedField('hcp_needs_summary')?.fieldType).toBe('TEXTAREA');
    expect(seedField('hcp_hours_visits')?.fieldType).toBe('TEXT');
    expect(seedField('hcp_detailed_goals_outcomes')?.fieldType).toBe('TEXTAREA');
    expect(seedField('hcp_risks_if_care_not_provided')?.fieldType).toBe('TEXTAREA');
    expect(seedField('hcp_review_frequency')?.fieldType).toBe('SELECT');
  });

  it('reuses the two original section titles so their UUIDs are preserved', () => {
    const titles = HOME_CARE_PLAN_SEED.sections.map((s) => s.title);
    expect(titles).toContain('Package overview');
    expect(titles).toContain('Outcomes');
  });

  it('covers every Care 2020 question', () => {
    const keys = seedFieldKeys();
    const care2020 = [
      'hcp_about_me', // Q1
      'hcp_desired_goals_outcomes', // Q2
      'hcp_detailed_goals_outcomes', // Q3
      'hcp_cognitive_impairment', // Q4
      'hcp_personal_care_needs', // Q5
      'hcp_personal_care_consent', // Q6
      'hcp_continence_care_needs', // Q7
      'hcp_continence_consent', // Q8
      'hcp_mobility_care_needs', // Q9
      'hcp_mobility_consent', // Q10
      'hcp_meal_requirements', // Q11
      'hcp_meal_consent', // Q12
      'hcp_medication_support_needs', // Q13
      'hcp_medication_consent', // Q14
      'hcp_support_requirements', // Q15
      'hcp_other_support_requirements', // Q16
      'hcp_support_consent', // Q17
      'hcp_personal_needs_summary', // Q18
      'hcp_meal_requirements_summary', // Q19
      'hcp_dietary_needs_summary', // Q20
      'hcp_household_support_summary', // Q21
      'hcp_continence_needs_summary', // Q22
      'hcp_medication_summary', // Q23
      'hcp_mobility_summary', // Q24
      'hcp_mobility_aids_summary', // Q25
      'hcp_other_support_summary', // Q26
      'hcp_advance_support_requirements', // Q27
      'hcp_advance_support_consent', // Q28
      'hcp_final_days_requirements', // Q29
      'hcp_final_days_consent', // Q30
      'hcp_risk_assessment', // Q31
    ];
    for (const key of care2020) {
      expect(keys).toContain(key);
    }
  });

  // 8 — no duplicates
  it('contains no duplicate field keys', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every field an hcp_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('hcp_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// Care 2020 wording, section order and field order
// --------------------------------------------------------------------------

describe('Care 2020 structure', () => {
  it('orders the sections as Care 2020 specifies', () => {
    expect(HOME_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Package overview',
      'About Me',
      'Outcomes',
      'Cognition',
      'Personal Care',
      'Continence',
      'Mobility',
      'Meals and Nutrition',
      'Medication',
      'Wider Support',
      'Advance and End of Life',
      'Risk Assessment',
    ]);
  });

  it('uses the exact Care 2020 question wording', () => {
    const expected: Record<string, string> = {
      hcp_about_me: 'About Me',
      hcp_desired_goals_outcomes: "What are the Client's Desired Goals and Outcomes?",
      hcp_detailed_goals_outcomes: 'Detailed Goals and Outcomes',
      hcp_cognitive_impairment: 'Does the Client have Cognitive Impairment?',
      hcp_personal_care_needs: "What are the Client's Personal Care Needs?",
      hcp_personal_care_consent: 'Has the Client Consented to Personal Care Support?',
      hcp_personal_needs_summary: "Client's Personal Needs Summary",
      hcp_continence_care_needs: 'Does the Client have Continence Care Needs?',
      hcp_continence_consent: 'Has the Client Consented to Continence Care Support?',
      hcp_continence_needs_summary: "Client's Continence Needs Summary",
      hcp_mobility_care_needs: "What are the Client's Mobility Care Needs?",
      hcp_mobility_consent: 'Has the Client Consented to Mobility Support?',
      hcp_mobility_summary: "Client's Mobility Summary",
      hcp_mobility_aids_summary: "Client's use of Aids for Mobility Summary",
      hcp_meal_requirements: "What are the Client's Meal Requirements?",
      hcp_meal_consent: 'Has the Client Consented to Meal Support?',
      hcp_meal_requirements_summary: "Client's Meal Requirements Summary",
      hcp_dietary_needs_summary: "Client's Dietary Needs Summary",
      hcp_medication_support_needs: "What are the Client's Medication Support Requirements?",
      hcp_medication_consent: 'Has the Client Consented to Medication Support?',
      hcp_medication_summary: "Client's Medication Summary",
      hcp_support_requirements: "What are the Client's Support Requirements?",
      hcp_household_support_summary: 'Household Support Summary',
      hcp_other_support_summary: 'Other Support Needs Summary',
      hcp_other_support_requirements: 'Other Support Requirements',
      hcp_support_consent: 'Has the Client Consented to this Support?',
      hcp_advance_support_requirements: 'Client Advance Support Requirements?',
      hcp_advance_support_consent: 'Has the Client Consented to Advance Support?',
      hcp_final_days_requirements: 'Client Final Day Requirements?',
      hcp_final_days_consent: 'Has the Client Consented to the Final Days Plan?',
      hcp_risk_assessment: 'Risk Assessment',
    };

    for (const [key, label] of Object.entries(expected)) {
      expect(seedField(key)?.label).toBe(label);
    }
  });

  it('places the consent question directly after the needs question in each care domain', () => {
    const domains: Array<[string, string[]]> = [
      ['Personal Care', ['hcp_personal_care_needs', 'hcp_personal_care_consent', 'hcp_personal_needs_summary']],
      ['Continence', ['hcp_continence_care_needs', 'hcp_continence_consent', 'hcp_continence_needs_summary']],
      [
        'Mobility',
        ['hcp_mobility_care_needs', 'hcp_mobility_consent', 'hcp_mobility_summary', 'hcp_mobility_aids_summary'],
      ],
      [
        'Meals and Nutrition',
        ['hcp_meal_requirements', 'hcp_meal_consent', 'hcp_meal_requirements_summary', 'hcp_dietary_needs_summary'],
      ],
      ['Medication', ['hcp_medication_support_needs', 'hcp_medication_consent', 'hcp_medication_summary']],
    ];

    for (const [title, keys] of domains) {
      const section = HOME_CARE_PLAN_SEED.sections.find((s) => s.title === title);
      expect(section?.fields.map((f) => f.fieldKey)).toEqual(keys);
    }
  });

  it('keeps Risk Assessment separate from Risks if care not provided', () => {
    expect(seedField('hcp_risk_assessment')).toBeDefined();
    expect(seedField('hcp_risks_if_care_not_provided')).toBeDefined();
    expect(seedField('hcp_risk_assessment')?.fieldKey).not.toBe(
      seedField('hcp_risks_if_care_not_provided')?.fieldKey,
    );
  });
});

// --------------------------------------------------------------------------
// 4 — multi-select options
// --------------------------------------------------------------------------

describe('Home Care Plan option lists', () => {
  it('uses the correct field type for each option list', () => {
    expect(seedField('hcp_desired_goals_outcomes')?.fieldType).toBe('MULTI_SELECT');
    expect(seedField('hcp_cognitive_impairment')?.fieldType).toBe('MULTI_SELECT');
    expect(seedField('hcp_personal_needs_summary')?.fieldType).toBe('MULTI_SELECT');
    expect(seedField('hcp_mobility_summary')?.fieldType).toBe('SELECT');
    expect(seedField('hcp_about_me')?.fieldType).toBe('RICH_TEXT');
    expect(seedField('hcp_personal_care_consent')?.fieldType).toBe('YES_NO');
  });

  it('carries the full Care 2020 option counts', () => {
    expect(HCP_DESIRED_GOALS_OPTIONS).toHaveLength(12);
    expect(HCP_COGNITIVE_IMPAIRMENT_OPTIONS).toHaveLength(11);
    expect(HCP_PERSONAL_NEEDS_OPTIONS).toHaveLength(10);
    expect(HCP_MEAL_REQUIREMENTS_OPTIONS).toHaveLength(5);
    expect(HCP_HOUSEHOLD_SUPPORT_OPTIONS).toHaveLength(15);
    expect(HCP_CONTINENCE_NEEDS_OPTIONS).toHaveLength(8);
    expect(HCP_MEDICATION_SUMMARY_OPTIONS).toHaveLength(9);
    expect(HCP_MOBILITY_SUMMARY_OPTIONS).toHaveLength(6);
    expect(HCP_MOBILITY_AIDS_OPTIONS).toHaveLength(5);
    expect(HCP_OTHER_SUPPORT_OPTIONS).toHaveLength(3);
  });

  it('includes all eight Care 2020 dietary options, food allergies among them', () => {
    expect(HCP_DIETARY_NEEDS_OPTIONS).toHaveLength(8);
    expect(HCP_DIETARY_NEEDS_OPTIONS).toContain('Food allergies');
    expect(HCP_DIETARY_NEEDS_OPTIONS).toContain('Liquidised foods');
  });

  it('matches the Care 2020 option wording exactly', () => {
    expect(HCP_DESIRED_GOALS_OPTIONS).toContain('Promote Independence');
    expect(HCP_DESIRED_GOALS_OPTIONS).toContain('Ensure environment safety/cleanliness');
    expect(HCP_DESIRED_GOALS_OPTIONS).toContain('Reduce risk of infection & contaminates');
    expect(HCP_COGNITIVE_IMPAIRMENT_OPTIONS).toContain('Stroke / TIA');
    expect(HCP_COGNITIVE_IMPAIRMENT_OPTIONS).toContain('Prone to Infections which affect cognition');
    expect(HCP_PERSONAL_NEEDS_OPTIONS).toContain('Toiletting');
    expect(HCP_MOBILITY_SUMMARY_OPTIONS).toContain('unlikely to remember to use aids/equipment');
    expect(HCP_MOBILITY_AIDS_OPTIONS).toContain('No');
    expect(HCP_MEAL_REQUIREMENTS_OPTIONS).toContain('PEG Care');
    expect(HCP_DIETARY_NEEDS_OPTIONS).toContain('Diabetic Diet');
    expect(HCP_HOUSEHOLD_SUPPORT_OPTIONS).toContain('Fold Laundry away');
    expect(HCP_MEDICATION_SUMMARY_OPTIONS).toContain('Family Orders medication');
  });

  it('attaches the option list to the field in the template', () => {
    expect(seedField('hcp_desired_goals_outcomes')?.options).toEqual(HCP_DESIRED_GOALS_OPTIONS);
    expect(seedField('hcp_household_support_summary')?.options).toEqual(
      HCP_HOUSEHOLD_SUPPORT_OPTIONS,
    );
  });
});

// --------------------------------------------------------------------------
// Registry contract
// --------------------------------------------------------------------------

describe('Home Care Plan registry', () => {
  it('matches the seed template exactly', () => {
    expect(() => assertHcpRegistryMatchesTemplate()).not.toThrow();
  });

  it('declares a mode for every field', () => {
    for (const key of seedFieldKeys()) {
      expect(hcpFieldRegistryEntry(key)).toBeDefined();
    }
    expect(HCP_FIELD_REGISTRY).toHaveLength(seedFieldKeys().length);
  });
});

// --------------------------------------------------------------------------
// 2 + 6 — IA suggestions
// --------------------------------------------------------------------------

describe('composeHomeCarePlanHybrid', () => {
  it('exposes the form name the compose dispatcher matches on', () => {
    expect(HOME_CARE_PLAN_FORM_NAME).toBe('Home Care Plan');
  });

  it('returns hybrid mode and no suggestions when there is no initial assessment', () => {
    const result = composeHomeCarePlanHybrid(
      { serviceUserId: 'su-1', ia: null } as unknown as CarePlanComposeContext,
      fieldRefsFromSeed(),
      'su-1',
    );
    expect(result.suggestionMode).toBe('hybrid');
    expect(result.suggestions ?? []).toHaveLength(0);
    expect(result.values).toEqual({});
  });

  it('auto-prefills the administrative fields from IA', () => {
    const ctx = ctxWithAnswers([
      answer({
        fieldKey: 'assessmentDate',
        questionText: 'Assessment date',
        dateValue: '2026-07-15T00:00:00.000Z',
        textValue: '2026-07-15',
      } as Partial<SubmissionAnswerForRules>),
      answer({
        fieldKey: 'reviewFrequency',
        questionText: 'Review frequency',
        selectedOptions: ['Quarterly'],
      }),
    ]);

    const fields = fieldRefsFromSeed();
    const result = composeHomeCarePlanHybrid(ctx, fields, 'su-1');

    const reviewRef = fields.find((f) => f.fieldKey === 'hcp_review_frequency');
    expect(result.values[reviewRef!.key]).toBe('Quarterly');
    expect(result.fieldSources?.[reviewRef!.key]).toBe('ia');
  });

  it('produces a suggestion — not a written value — for clinical narrative fields', () => {
    const ctx = ctxWithAnswers([
      answer({
        fieldKey: 'supportGoals',
        questionText: 'What do they want support to achieve?',
        textValue: 'Stay living at home independently',
      }),
    ]);

    const fields = fieldRefsFromSeed();
    const result = composeHomeCarePlanHybrid(ctx, fields, 'su-1');
    const goalRef = fields.find((f) => f.fieldKey === 'hcp_detailed_goals_outcomes');

    const suggestion = result.suggestions?.find((s) => s.targetFieldKey === goalRef!.key);
    expect(suggestion).toBeDefined();
    expect(suggestion?.suggestedValue).toContain('Stay living at home independently');
    expect(suggestion?.sourceType).toBe('INITIAL_ASSESSMENT');

    // 14 — the value must NOT be written into the draft just because it is displayed.
    expect(result.values[goalRef!.key]).toBeUndefined();
  });

  it('carries provenance back to the source IA question', () => {
    const ctx = ctxWithAnswers([
      answer({
        fieldKey: 'supportGoals',
        questionText: 'What do they want support to achieve?',
        specRef: '1.3',
        sectionNumber: 1,
        sectionTitle: 'Personal Details & Preferences',
        textValue: 'Regain confidence walking',
      }),
    ]);

    const result = composeHomeCarePlanHybrid(ctx, fieldRefsFromSeed(), 'su-1');
    const suggestion = suggestionFor(result, 'hcp_detailed_goals_outcomes');

    expect(suggestion?.sourceQuestions?.[0]?.specRef).toBe('1.3');
    expect(suggestion?.sourceQuestions?.[0]?.sourceLabel).toContain('support to achieve');
    expect(suggestion?.submissionId).toBe('sub-1');
  });

  it('only suggests option values the field actually offers', () => {
    const ctx = ctxWithAnswers([
      answer({
        fieldKey: 'foodTexture',
        questionText: 'Food texture requirement',
        selectedOptions: [IA_FOOD_TEXTURE_VALUES.pureed],
      }),
      answer({
        fieldKey: 'fluidThickness',
        questionText: 'Fluid thickness requirement',
        selectedOptions: [IA_FLUID_THICKNESS_VALUES.thickened],
      }),
    ]);

    const result = composeHomeCarePlanHybrid(ctx, fieldRefsFromSeed(), 'su-1');
    const suggestion = suggestionFor(result, 'hcp_dietary_needs_summary');

    expect(suggestion).toBeDefined();
    for (const option of String(suggestion!.suggestedValue).split(', ')) {
      expect(HCP_DIETARY_NEEDS_OPTIONS).toContain(option);
    }
    expect(String(suggestion!.suggestedValue)).toContain('Pureed food');
    expect(String(suggestion!.suggestedValue)).toContain('Thickened fluids');
  });

  it('derives mobility aids only from directly evidenced IA answers', () => {
    const ctx = ctxWithAnswers([
      answer({ fieldKey: 'usesHoistOrSling', questionText: 'Uses hoist or sling?', booleanValue: true }),
      answer({
        fieldKey: 'transferSupportRequired',
        questionText: 'Transfer support required?',
        booleanValue: false,
      }),
    ]);

    const result = composeHomeCarePlanHybrid(ctx, fieldRefsFromSeed(), 'su-1');
    const suggestion = suggestionFor(result, 'hcp_mobility_aids_summary');

    expect(String(suggestion!.suggestedValue)).toContain('Hoisting');
    expect(String(suggestion!.suggestedValue)).not.toContain('Transfer');
  });

  it('emits nothing for a mapped field when the IA answer is absent', () => {
    const result = composeHomeCarePlanHybrid(ctxWithAnswers([]), fieldRefsFromSeed(), 'su-1');
    expect(suggestionFor(result, 'hcp_dietary_needs_summary')).toBeUndefined();
    expect(suggestionFor(result, 'hcp_detailed_goals_outcomes')).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// Exhaustive coverage of the real IA option values these resolvers read.
// Every value the assessment can store is asserted, so a value that carries no
// clinical meaning can never be turned into a suggestion.
// --------------------------------------------------------------------------

describe('option mappings against the real IA catalogue', () => {
  function dietarySuggestion(fieldKey: string, value: string) {
    const ctx = ctxWithAnswers([
      answer({ fieldKey, questionText: fieldKey, selectedOptions: [value] }),
    ]);
    const result = composeHomeCarePlanHybrid(ctx, fieldRefsFromSeed(), 'su-1');
    return suggestionFor(result, 'hcp_dietary_needs_summary');
  }

  function continenceSuggestion(fieldKey: string, values: string[]) {
    const ctx = ctxWithAnswers([
      answer({ fieldKey, questionText: fieldKey, selectedOptions: values }),
    ]);
    const result = composeHomeCarePlanHybrid(ctx, fieldRefsFromSeed(), 'su-1');
    return suggestionFor(result, 'hcp_continence_needs_summary');
  }

  // Defect 1 — "unknown" must not become a clinical finding.
  describe('fluidThickness', () => {
    it('suggests "Thickened fluids" only for thickened', () => {
      expect(dietarySuggestion('fluidThickness', IA_FLUID_THICKNESS_VALUES.thickened)?.suggestedValue).toBe(
        'Thickened fluids',
      );
    });

    it.each([IA_FLUID_THICKNESS_VALUES.normal, IA_FLUID_THICKNESS_VALUES.unknown])(
      'suggests nothing for %s',
      (value) => {
        expect(dietarySuggestion('fluidThickness', value)).toBeUndefined();
      },
    );
  });

  // Defect 2 — IA has no liquidised option, so it must never be suggested.
  describe('foodTexture', () => {
    it('suggests "Pureed food" for pureed', () => {
      expect(dietarySuggestion('foodTexture', IA_FOOD_TEXTURE_VALUES.pureed)?.suggestedValue).toBe(
        'Pureed food',
      );
    });

    it.each([
      IA_FOOD_TEXTURE_VALUES.normal,
      IA_FOOD_TEXTURE_VALUES.soft,
      IA_FOOD_TEXTURE_VALUES.minced,
      IA_FOOD_TEXTURE_VALUES.unknown,
    ])('suggests nothing for %s', (value) => {
      expect(dietarySuggestion('foodTexture', value)).toBeUndefined();
    });

    it('never suggests "Liquidised foods" for any IA food texture value', () => {
      for (const value of Object.values(IA_FOOD_TEXTURE_VALUES)) {
        const suggested = String(dietarySuggestion('foodTexture', value)?.suggestedValue ?? '');
        expect(suggested).not.toContain('Liquidised');
      }
    });
  });

  // Defect 3 — IA records "Wears continence products", never the word "pad".
  describe('continence options', () => {
    it('maps "Wears continence products" on the bladder question to Pad Changing', () => {
      expect(
        continenceSuggestion('bladderContinenceOptions', [IA_BLADDER_CONTINENCE_VALUES.products])
          ?.suggestedValue,
      ).toBe(HCP_CONTINENCE_OPTION_PAD_CHANGING);
    });

    it('maps "Wears continence products" on the bowel question to Pad Changing', () => {
      expect(
        continenceSuggestion('bowelContinenceOptions', [IA_BOWEL_CONTINENCE_VALUES.products])
          ?.suggestedValue,
      ).toBe(HCP_CONTINENCE_OPTION_PAD_CHANGING);
    });

    it('maps "Has a catheter in situ" to "Catheter care"', () => {
      expect(
        continenceSuggestion('bladderContinenceOptions', [IA_BLADDER_CONTINENCE_VALUES.catheter])
          ?.suggestedValue,
      ).toBe(HCP_CONTINENCE_OPTION_CATHETER_CARE);
    });

    it('reads every selection inside a multi-select answer', () => {
      const value = String(
        continenceSuggestion('bladderContinenceOptions', [
          IA_BLADDER_CONTINENCE_VALUES.incontinence,
          IA_BLADDER_CONTINENCE_VALUES.products,
          IA_BLADDER_CONTINENCE_VALUES.catheter,
        ])?.suggestedValue ?? '',
      );
      expect(value).toContain(HCP_CONTINENCE_OPTION_CATHETER_CARE);
      expect(value).toContain(HCP_CONTINENCE_OPTION_PAD_CHANGING);
    });

    it('does not repeat Pad Changing when both bladder and bowel report products', () => {
      const ctx = ctxWithAnswers([
        answer({
          fieldKey: 'bladderContinenceOptions',
          questionText: 'Bladder continence options',
          selectedOptions: [IA_BLADDER_CONTINENCE_VALUES.products],
        }),
        answer({
          fieldKey: 'bowelContinenceOptions',
          questionText: 'Bowel continence options',
          selectedOptions: [IA_BOWEL_CONTINENCE_VALUES.products],
        }),
      ]);
      const result = composeHomeCarePlanHybrid(ctx, fieldRefsFromSeed(), 'su-1');
      const value = String(
        suggestionFor(result, 'hcp_continence_needs_summary')?.suggestedValue ?? '',
      );
      expect(
        value.split(', ').filter((v) => v === HCP_CONTINENCE_OPTION_PAD_CHANGING),
      ).toHaveLength(1);
    });

    it.each([
      IA_BLADDER_CONTINENCE_VALUES.noConcern,
      IA_BLADDER_CONTINENCE_VALUES.concern,
      IA_BLADDER_CONTINENCE_VALUES.incontinence,
      IA_BLADDER_CONTINENCE_VALUES.stress,
      IA_BLADDER_CONTINENCE_VALUES.nocturnal,
      IA_BLADDER_CONTINENCE_VALUES.urostomy,
      IA_BLADDER_CONTINENCE_VALUES.continenceReferral,
    ])('suggests nothing for bladder value %s', (value) => {
      expect(continenceSuggestion('bladderContinenceOptions', [value])).toBeUndefined();
    });

    it.each([
      IA_BOWEL_CONTINENCE_VALUES.noConcern,
      IA_BOWEL_CONTINENCE_VALUES.incontinence,
      IA_BOWEL_CONTINENCE_VALUES.stoma,
      IA_BOWEL_CONTINENCE_VALUES.gpReview,
    ])('suggests nothing for bowel value %s', (value) => {
      expect(continenceSuggestion('bowelContinenceOptions', [value])).toBeUndefined();
    });
  });
});

// --------------------------------------------------------------------------
// Food allergies must remain manual
// --------------------------------------------------------------------------

describe('Food allergies stays manual', () => {
  it('is offered on the field but is not IA-derivable', () => {
    expect(HCP_DIETARY_NEEDS_OPTIONS).toContain('Food allergies');
    expect(HCP_DIETARY_IA_DERIVABLE_OPTIONS as readonly string[]).not.toContain('Food allergies');
  });

  it('is never suggested for any combination of IA dietary answers', () => {
    for (const texture of Object.values(IA_FOOD_TEXTURE_VALUES)) {
      for (const fluid of Object.values(IA_FLUID_THICKNESS_VALUES)) {
        const ctx = ctxWithAnswers([
          answer({ fieldKey: 'foodTexture', questionText: 'Food texture', selectedOptions: [texture] }),
          answer({ fieldKey: 'fluidThickness', questionText: 'Fluid thickness', selectedOptions: [fluid] }),
        ]);
        const result = composeHomeCarePlanHybrid(ctx, fieldRefsFromSeed(), 'su-1');
        const value = String(
          suggestionFor(result, 'hcp_dietary_needs_summary')?.suggestedValue ?? '',
        );
        expect(value.toLowerCase()).not.toContain('allerg');
      }
    }
  });
});

// --------------------------------------------------------------------------
// Derivable subsets must stay subsets of the real field options
// --------------------------------------------------------------------------

describe('IA-derivable option subsets', () => {
  it.each([
    ['hcp_dietary_needs_summary', HCP_DIETARY_IA_DERIVABLE_OPTIONS],
    ['hcp_continence_needs_summary', HCP_CONTINENCE_IA_DERIVABLE_OPTIONS],
    ['hcp_meal_requirements_summary', HCP_MEAL_IA_DERIVABLE_OPTIONS],
    ['hcp_mobility_aids_summary', HCP_MOBILITY_AIDS_IA_DERIVABLE_OPTIONS],
  ])('%s derivable options all exist on the field', (fieldKey, derivable) => {
    const options = seedField(fieldKey as string)?.options ?? [];
    for (const option of derivable as readonly string[]) {
      expect(options).toContain(option);
    }
  });

  it('never lists an option the brief marks as manual-only', () => {
    const neverDerivable = [
      'Food allergies',
      'Liquidised foods',
      'Vegetarian',
      'Vegan',
      'Diabetic Diet',
      'Religious dietary restrictions',
    ];
    for (const option of neverDerivable) {
      expect(HCP_DIETARY_IA_DERIVABLE_OPTIONS as readonly string[]).not.toContain(option);
    }
  });

  it('shares one constant between the field option list and the derivable list', () => {
    // Guards the class of bug where the two drift apart and a suggestion is silently
    // filtered out because the strings no longer match.
    expect(HCP_CONTINENCE_NEEDS_OPTIONS).toContain(HCP_CONTINENCE_OPTION_PAD_CHANGING);
    expect(HCP_CONTINENCE_NEEDS_OPTIONS).toContain(HCP_CONTINENCE_OPTION_CATHETER_CARE);
    expect(HCP_CONTINENCE_IA_DERIVABLE_OPTIONS as readonly string[]).toEqual([
      HCP_CONTINENCE_OPTION_PAD_CHANGING,
      HCP_CONTINENCE_OPTION_CATHETER_CARE,
    ]);
  });
});

// --------------------------------------------------------------------------
// 7 — fields deliberately left as normal editable Care Plan fields
// --------------------------------------------------------------------------

describe('Home Care Plan fields intentionally not linked to IA', () => {
  const alwaysManual = [
    'hcp_personal_care_consent',
    'hcp_continence_consent',
    'hcp_mobility_consent',
    'hcp_meal_consent',
    'hcp_medication_consent',
    'hcp_support_consent',
    'hcp_advance_support_consent',
    'hcp_final_days_consent',
    'hcp_cognitive_impairment',
    'hcp_medication_support_needs',
    'hcp_medication_summary',
    'hcp_risk_assessment',
  ];

  it.each(alwaysManual)('%s is MANUAL and carries a documented reason', (key) => {
    const entry = hcpFieldRegistryEntry(key);
    expect(entry?.mode).toBe('MANUAL');
    expect(HCP_MANUAL_KEYS).toContain(key);
    expect(entry?.sources[0]?.notes ?? '').not.toHaveLength(0);
  });

  it('never produces a suggestion for a consent field, even with a general IA consent on file', () => {
    const ctx = ctxWithAnswers([
      answer({
        questionText: 'Has the Service User consented to receive care and support?',
        booleanValue: true,
      }),
    ]);

    const result = composeHomeCarePlanHybrid(ctx, fieldRefsFromSeed(), 'su-1');
    for (const key of alwaysManual) {
      expect(suggestionFor(result, key)).toBeUndefined();
    }
  });

  it('never produces a cognitive impairment suggestion from the IA severity band', () => {
    const ctx = ctxWithAnswers([
      answer({
        fieldKey: 'cognitiveImpairment',
        questionText: 'Cognitive impairment level',
        selectedOptions: ['moderate'],
      }),
    ]);

    const result = composeHomeCarePlanHybrid(ctx, fieldRefsFromSeed(), 'su-1');
    expect(suggestionFor(result, 'hcp_cognitive_impairment')).toBeUndefined();
    expect(HCP_SUGGESTION_KEYS).not.toContain('hcp_cognitive_impairment');
  });
});

// --------------------------------------------------------------------------
// 9 — Home Support Plan must be untouched
// --------------------------------------------------------------------------

describe('Home Support Plan is unaffected', () => {
  it('still has its own 45 hsp_ fields', () => {
    const hspKeys = HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) =>
      s.fields.map((f) => f.fieldKey as string),
    );
    expect(hspKeys).toHaveLength(45);
    for (const key of hspKeys) {
      expect(key.startsWith('hsp_')).toBe(true);
    }
  });

  it('shares no field keys with the Home Care Plan', () => {
    const hspKeys = new Set(
      HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
    );
    for (const key of seedFieldKeys()) {
      expect(hspKeys.has(key)).toBe(false);
    }
  });
});
