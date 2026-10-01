import * as fs from 'fs';
import * as path from 'path';
import { CONTINENCE_CARE_PLAN_SEED } from '../../../prisma/seeds/continence-care-plan.seed-data';
import { WASHING_DRESSING_CARE_PLAN_SEED } from '../../../prisma/seeds/washing-dressing-care-plan.seed-data';
import { COMMUNICATION_CARE_PLAN_SEED } from '../../../prisma/seeds/communication-care-plan.seed-data';
import { PRESSURE_ULCER_CARE_PLAN_SEED } from '../../../prisma/seeds/pressure-ulcer-care-plan.seed-data';
import { SKIN_INTEGRITY_CARE_PLAN_SEED } from '../../../prisma/seeds/skin-integrity-care-plan.seed-data';
import { EATING_AND_DRINKING_CARE_PLAN_SEED } from '../../../prisma/seeds/eating-and-drinking-care-plan.seed-data';
import { SLEEPING_NIGHT_CARE_PLAN_SEED } from '../../../prisma/seeds/sleeping-night-care-plan.seed-data';
import { MOBILITY_CARE_PLAN_SEED } from '../../../prisma/seeds/mobility-care-plan.seed-data';
import { DEMENTIA_CARE_PLAN_SEED } from '../../../prisma/seeds/dementia-care-plan.seed-data';
import { COGNITION_BEHAVIOUR_CARE_PLAN_SEED } from '../../../prisma/seeds/cognition-behaviour-care-plan.seed-data';
import { CULTURE_RELIGION_CARE_PLAN_SEED } from '../../../prisma/seeds/culture-religion-care-plan.seed-data';
import { PERSONAL_SAFETY_CARE_PLAN_SEED } from '../../../prisma/seeds/personal-safety-care-plan.seed-data';
import { FALLS_CARE_PLAN_SEED } from '../../../prisma/seeds/falls-care-plan.seed-data';
import { PAIN_MANAGEMENT_CARE_PLAN_SEED } from '../../../prisma/seeds/pain-management-care-plan.seed-data';
import {
  CARE_PLAN_IA_DEMO_OVERLAYS,
  type IaDemoOverlayAnswer,
  type IaDemoOverlayPersona,
} from '../../../prisma/seeds/care-plan-ia-demo-overlay.data';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import { runCarePlanCompose } from './compose-context.loader';
import {
  attachCare2020NeedsGoalsSuggestions,
  CARE_2020_FORM_PREFIX,
  isCare2020AreaRiskOrFollowUpKey,
  looksFirstPerson,
} from './care-2020-needs-goals.suggestions';
import type {
  CarePlanComposeContext,
  CarePlanFieldSuggestion,
  CarePlanFormFieldRef,
  ComposePlanResult,
} from './compose-context.types';

type Seed = {
  sections: Array<{
    title: string;
    fields: Array<{ fieldKey?: string; label: string; fieldType: string; required?: boolean }>;
  }>;
};

function fieldRefsFromSeed(seed: Seed): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  seed.sections.forEach((section, si) => {
    section.fields.forEach((field, fi) => {
      refs.push({
        key: `sec-${si}:f-${si}-${fi}`,
        sectionId: `sec-${si}`,
        fieldId: `f-${si}-${fi}`,
        fieldKey: field.fieldKey,
        label: field.label,
        fieldType: field.fieldType,
        required: field.required ?? false,
        sectionTitle: section.title,
      } as CarePlanFormFieldRef);
    });
  });
  return refs;
}

function keyOf(fields: CarePlanFormFieldRef[], fieldKey: string): string {
  return fields.find((field) => field.fieldKey === fieldKey)!.key;
}

function iaAnswer(
  partial: Partial<SubmissionAnswerForRules> & { questionText: string },
): SubmissionAnswerForRules {
  return {
    questionId: partial.questionId ?? `q-${partial.questionText}`,
    questionText: partial.questionText,
    checked: partial.checked ?? null,
    booleanValue: partial.booleanValue ?? null,
    textValue: partial.textValue ?? null,
    selectedOptions: partial.selectedOptions ?? null,
    numberValue: partial.numberValue ?? null,
    specRef: partial.specRef,
    fieldKey: partial.fieldKey,
    sectionNumber: partial.sectionNumber ?? 1,
    sectionTitle: partial.sectionTitle ?? 'Initial Assessment',
    carePlanArea: partial.carePlanArea ?? null,
  };
}

function emptyCtx(overrides: Partial<CarePlanComposeContext> = {}): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    serviceUserName: 'Test User',
    personalisation: {},
    ia: null,
    previousAssessments: [],
    aboutMe: null,
    emergencyContacts: [],
    allergies: [],
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
    ...overrides,
  } as unknown as CarePlanComposeContext;
}

function ctxWithAnswers(
  answers: SubmissionAnswerForRules[],
  extras: Partial<CarePlanComposeContext> = {},
): CarePlanComposeContext {
  return emptyCtx({
    ...extras,
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers,
      ...(extras.ia ?? {}),
    } as CarePlanComposeContext['ia'],
  });
}

function overlayToAnswers(rows: IaDemoOverlayAnswer[]): SubmissionAnswerForRules[] {
  return rows.flatMap((row, index) => {
    if (row.kind === 'clear') return [];
    const questionText = row.questionText ?? row.fieldKey ?? `overlay-${index}`;
    const base = {
      questionId: `overlay-${index}`,
      questionText,
      fieldKey: row.fieldKey,
      checked: null as boolean | null,
      booleanValue: null as boolean | null,
      textValue: null as string | null,
      selectedOptions: null as SubmissionAnswerForRules['selectedOptions'],
      numberValue: null as number | null,
      sectionNumber: 1,
      sectionTitle: 'Initial Assessment',
    };
    if (row.kind === 'text') return [{ ...base, textValue: String(row.value ?? '') }];
    if (row.kind === 'yesNo') return [{ ...base, booleanValue: Boolean(row.value) }];
    if (row.kind === 'select') return [{ ...base, selectedOptions: [String(row.value)] }];
    if (row.kind === 'multi') {
      return [{ ...base, selectedOptions: Array.isArray(row.value) ? row.value.map(String) : [] }];
    }
    if (row.kind === 'number') return [{ ...base, numberValue: Number(row.value) }];
    if (row.kind === 'date') return [{ ...base, textValue: String(row.value ?? '') }];
    return [];
  });
}

function persona(number: string): IaDemoOverlayPersona {
  const found = CARE_PLAN_IA_DEMO_OVERLAYS.find((item) => item.serviceUserNumber === number);
  if (!found) throw new Error(`Missing overlay persona ${number}`);
  return found;
}

function composeForm(
  formName: string,
  seed: Seed,
  answers: SubmissionAnswerForRules[],
  extras: Partial<CarePlanComposeContext> = {},
) {
  const fields = fieldRefsFromSeed(seed);
  return { fields, result: runCarePlanCompose(formName, ctxWithAnswers(answers, extras), fields) };
}

function suggestionFor(
  result: ComposePlanResult,
  fields: CarePlanFormFieldRef[],
  fieldKey: string,
): CarePlanFieldSuggestion | undefined {
  const runtimeKey = keyOf(fields, fieldKey);
  return (result.suggestions ?? []).find((item) => item.targetFieldKey === runtimeKey);
}

function narrativeSuggestions(result: ComposePlanResult, fields: CarePlanFormFieldRef[], prefix: string) {
  return {
    needs: suggestionFor(result, fields, `${prefix}_service_user_needs`),
    personCentred: suggestionFor(result, fields, `${prefix}_needs_person_centred`),
    goals: suggestionFor(result, fields, `${prefix}_desired_goals_outcomes`),
    support: suggestionFor(result, fields, `${prefix}_support_required`),
  };
}

function applySuggestionToValues(
  values: Record<string, string | boolean>,
  suggestion: CarePlanFieldSuggestion,
): Record<string, string | boolean> {
  const current = values[suggestion.targetFieldKey];
  if (current != null && String(current).trim() !== '') return values;
  if (suggestion.kind !== 'value' || suggestion.suggestedValue == null) return values;
  return { ...values, [suggestion.targetFieldKey]: suggestion.suggestedValue };
}

describe('Care 2020 needs/goals/support suggestions', () => {
  it('generates continence needs and support from approved product/incontinence codes', () => {
    const { fields, result } = composeForm('Continence', CONTINENCE_CARE_PLAN_SEED, [
      iaAnswer({
        fieldKey: 'bladderContinenceOptions',
        questionText: 'Bladder continence options',
        selectedOptions: ['incontinence', 'products'],
      }),
      iaAnswer({
        questionText: 'Continence product details',
        textValue: 'I use pads. Please change me when you visit and check my skin.',
      }),
    ]);

    const slots = narrativeSuggestions(result, fields, 'continence');
    expect(slots.needs?.suggestedValue).toBe(
      'I need support with managing my continence products and maintaining my comfort and dignity.',
    );
    expect(slots.personCentred?.suggestedValue).toBe(
      'I use pads. Please change me when you visit and check my skin.',
    );
    expect(slots.support?.suggestedValue).toBe(
      'Please support me with changing my continence products and check my skin regularly.',
    );
    expect(slots.goals).toBeUndefined();
    expect(result.values[keyOf(fields, 'continence_service_user_needs')]).toBeUndefined();
    expect(result.values[keyOf(fields, 'continence_needs_person_centred')]).toBeUndefined();
    expect(result.values[keyOf(fields, 'continence_support_required')]).toBeUndefined();
  });

  it('shows no suggestion when there is no relevant IA source', () => {
    const { fields, result } = composeForm('Continence', CONTINENCE_CARE_PLAN_SEED, [
      iaAnswer({
        fieldKey: 'bladderContinenceOptions',
        questionText: 'Bladder continence options',
        selectedOptions: ['no_concern'],
      }),
      iaAnswer({
        fieldKey: 'whatMattersMost',
        questionText: 'What matters most to the Service User?',
        textValue: 'I want to stay independent. I keep spare pads in the cupboard.',
      }),
      iaAnswer({
        questionText: 'Doubly incontinent?',
        booleanValue: true,
      }),
    ]);
    const slots = narrativeSuggestions(result, fields, 'continence');
    expect(slots.needs).toBeUndefined();
    expect(slots.personCentred).toBeUndefined();
    expect(slots.support).toBeUndefined();
    expect(slots.goals).toBeUndefined();
  });

  it('does not automatically write Care 2020 narratives into compose values', () => {
    const { fields, result } = composeForm(
      'Washing and dressing',
      WASHING_DRESSING_CARE_PLAN_SEED,
      [
        iaAnswer({
          fieldKey: 'personalHygiene',
          questionText: 'Personal hygiene',
          textValue: 'I prefer a shower in the morning and I need full help with washing and dressing.',
        }),
      ],
    );
    expect(result.values[keyOf(fields, 'washing_dressing_service_user_needs')]).toBeUndefined();
    expect(suggestionFor(result, fields, 'washing_dressing_service_user_needs')?.suggestedValue).toContain(
      'I prefer a shower',
    );
    expect(result).not.toHaveProperty('published');
    expect((result.composedFrom as Record<string, unknown>).status).toBeUndefined();
  });

  it('Accept writes the suggestion to the field; Dismiss and existing values do not', () => {
    const { fields, result } = composeForm('Continence', CONTINENCE_CARE_PLAN_SEED, [
      iaAnswer({
        fieldKey: 'bladderContinenceOptions',
        questionText: 'Bladder continence options',
        selectedOptions: ['products'],
      }),
    ]);
    const suggestion = suggestionFor(result, fields, 'continence_service_user_needs')!;
    expect(suggestion).toBeDefined();

    const accepted = applySuggestionToValues({}, suggestion);
    expect(accepted[suggestion.targetFieldKey]).toBe(suggestion.suggestedValue);

    const dismissedValues = { ...result.values };
    expect(dismissedValues[suggestion.targetFieldKey]).toBeUndefined();

    const existing = { [suggestion.targetFieldKey]: 'Staff already wrote a needs statement.' };
    expect(applySuggestionToValues(existing, suggestion)).toEqual(existing);
  });

  it('Edit puts the suggestion into the field so staff can amend it before save', () => {
    const { fields, result } = composeForm(
      'Communication',
      COMMUNICATION_CARE_PLAN_SEED,
      [
        iaAnswer({
          fieldKey: 'howICommunicate',
          questionText: 'How I communicate and how to communicate with me',
          textValue: 'I have trouble finding words. Please speak slowly and wait for me to answer.',
        }),
      ],
    );
    const suggestion = suggestionFor(result, fields, 'communication_needs_person_centred')!;
    const editedLocally = applySuggestionToValues({}, suggestion);
    const amended = {
      ...editedLocally,
      [suggestion.targetFieldKey]: `${editedLocally[suggestion.targetFieldKey]} Please do not finish my sentences.`,
    };
    expect(amended[suggestion.targetFieldKey]).toContain('I have trouble finding words');
    expect(amended[suggestion.targetFieldKey]).toContain('Please do not finish my sentences');
    expect(result.values[suggestion.targetFieldKey]).toBeUndefined();
  });

  it('keeps first-person service-user wording and does not convert clinical third-person', () => {
    expect(looksFirstPerson('I prefer a female carer and I like staff to explain what they are doing.')).toBe(true);
    expect(looksFirstPerson('The service user prefers a female carer.')).toBe(false);

    const { fields, result } = composeForm('Skin Integrity', SKIN_INTEGRITY_CARE_PLAN_SEED, [
      iaAnswer({
        fieldKey: 'skinIntegrityComments',
        questionText: 'Skin / wound notes',
        textValue: 'The service user has dry skin on both legs. Apply emollient BD.',
      }),
      iaAnswer({
        questionText: 'Ulcers or wounds comment',
        textValue: 'Sacral grade 2 pressure ulcer. Dressing in situ.',
      }),
    ]);
    const slots = narrativeSuggestions(result, fields, 'skin_integrity');
    expect(slots.needs).toBeUndefined();
    expect(slots.personCentred).toBeUndefined();
    expect(slots.support).toBeUndefined();
  });

  it('never suggests area-risk or the six risk follow-up fields', () => {
    const { fields, result } = composeForm('Continence', CONTINENCE_CARE_PLAN_SEED, [
      iaAnswer({
        fieldKey: 'bladderContinenceOptions',
        questionText: 'Bladder continence options',
        selectedOptions: ['incontinence', 'products'],
      }),
      iaAnswer({ questionText: 'Doubly incontinent?', booleanValue: true }),
      iaAnswer({ questionText: 'Any risk identified?', booleanValue: true }),
    ]);
    const riskKeys = fields
      .map((field) => field.fieldKey)
      .filter((fieldKey): fieldKey is string => Boolean(fieldKey) && isCare2020AreaRiskOrFollowUpKey(fieldKey));
    expect(riskKeys).toHaveLength(7);
    for (const fieldKey of riskKeys) {
      expect(suggestionFor(result, fields, fieldKey)).toBeUndefined();
      expect(result.values[keyOf(fields, fieldKey)]).toBeUndefined();
    }
  });

  it('does not introduce keyword matching on free text', () => {
    const engineSource = fs.readFileSync(
      path.join(__dirname, 'care-2020-needs-goals.suggestions.ts'),
      'utf8',
    );
    expect(engineSource).not.toMatch(/questionTextContains/);
    expect(engineSource).not.toMatch(/questionText\.toLowerCase\(\)\.includes/);
    expect(engineSource).not.toMatch(/questionText\.includes\(/);

    const { fields, result } = composeForm('Eating and Drinking', EATING_AND_DRINKING_CARE_PLAN_SEED, [
      iaAnswer({
        fieldKey: 'whatMattersMost',
        questionText: 'What matters most to the Service User?',
        textValue: 'Please keep salt off my food and leave my pads in the bathroom.',
      }),
      iaAnswer({
        fieldKey: 'supportGoals',
        questionText: 'What do they want support to achieve?',
        textValue: 'I want help with eating and drinking and with continence pads.',
      }),
    ]);
    expect(narrativeSuggestions(result, fields, 'eating_and_drinking').needs).toBeUndefined();
    expect(
      composeForm('Continence', CONTINENCE_CARE_PLAN_SEED, [
        iaAnswer({
          questionText: 'Care package comments',
          textValue: 'Needs pads, incontinence, products, toilet support.',
        }),
      ]).result.suggestions,
    ).toBeUndefined();
  });

  it('leaves existing Eating and Drinking AUTO compose intact and does not publish', () => {
    const fields = fieldRefsFromSeed(EATING_AND_DRINKING_CARE_PLAN_SEED);
    const result = runCarePlanCompose(
      'Eating and Drinking',
      ctxWithAnswers(
        [
          iaAnswer({
            questionText: 'Nutrition / hydration comments',
            textValue: 'I like porridge and tea with one sugar. I cannot eat shellfish.',
          }),
        ],
        {
          ia: {
            submissionId: 'sub-1',
            status: 'REVIEWED',
            submittedAt: '2026-08-01T00:00:00.000Z',
            answers: [
              iaAnswer({
                questionText: 'Nutrition / hydration comments',
                textValue: 'I like porridge and tea with one sugar. I cannot eat shellfish.',
              }),
            ],
            eatingDrinkingSnapshot: {
              dietType: 'Soft',
              fluidTargetMl: '1500',
              foodAllergiesIntolerances: 'Lactose intolerant',
              mealAssistanceLevel: 'supervision',
              chokingSaltGuidance: 'Thickened fluids, SALT reviewed',
              preferredFoodsDislikes: 'Likes fish, dislikes spicy food',
            },
          } as CarePlanComposeContext['ia'],
        },
      ),
      fields,
    );
    expect(result.values[keyOf(fields, 'eating_and_drinking_fluid_target')]).toContain('1500');
    expect(result.values[keyOf(fields, 'eating_and_drinking_food_allergies')]).toContain('Lactose');
    expect(result.values[keyOf(fields, 'eating_and_drinking_service_user_needs')]).toBeUndefined();
    expect(suggestionFor(result, fields, 'eating_and_drinking_service_user_needs')?.suggestedValue).toContain(
      'I like porridge',
    );
  });

  it('does not attach Care 2020 suggestions to Falls or Pain Management', () => {
    const answers = [
      iaAnswer({
        questionText: 'What are they worried about?',
        textValue: 'I worry about falling on the front steps.',
      }),
      iaAnswer({
        questionText: 'Nutrition / hydration comments',
        textValue: 'I like porridge.',
      }),
    ];
    const falls = composeForm('Falls', FALLS_CARE_PLAN_SEED, answers);
    const pain = composeForm('Pain Management', PAIN_MANAGEMENT_CARE_PLAN_SEED, answers);
    expect(CARE_2020_FORM_PREFIX.Falls).toBeUndefined();
    expect(CARE_2020_FORM_PREFIX['Pain Management']).toBeUndefined();
    expect(suggestionFor(falls.result, falls.fields, 'falls_service_user_needs')).toBeUndefined();
    expect(
      suggestionFor(pain.result, pain.fields, 'pain_management_service_user_needs'),
    ).toBeUndefined();
  });

  it('skips a narrative slot when compose.values already has a value', () => {
    const fields = fieldRefsFromSeed(CONTINENCE_CARE_PLAN_SEED);
    const ctx = ctxWithAnswers([
      iaAnswer({
        fieldKey: 'bladderContinenceOptions',
        questionText: 'Bladder continence options',
        selectedOptions: ['products'],
      }),
    ]);
    const alreadyFilled: ComposePlanResult = {
      values: { [keyOf(fields, 'continence_service_user_needs')]: 'Existing needs text' },
      fieldSources: {},
      gaps: [],
      evidence: [],
      composedFrom: { formName: 'Continence' },
    };
    const attached = attachCare2020NeedsGoalsSuggestions('Continence', ctx, fields, alreadyFilled);
    expect(suggestionFor(attached, fields, 'continence_service_user_needs')).toBeUndefined();
    expect(attached.values[keyOf(fields, 'continence_service_user_needs')]).toBe('Existing needs text');
    expect(suggestionFor(attached, fields, 'continence_support_required')?.suggestedValue).toContain(
      'continence products',
    );
  });
});

describe('Care 2020 suggestions for demo personas', () => {
  function composePersona(formName: string, seed: Seed, number: string) {
    const overlay = persona(number);
    return composeForm(formName, seed, overlayToAnswers(overlay.answers), {
      serviceUserName: overlay.displayName,
    });
  }

  it('Margaret: washing, communication, skin/PU, mobility, culture, sleep — no continence', () => {
    const washing = composePersona('Washing and dressing', WASHING_DRESSING_CARE_PLAN_SEED, 'SU-1042');
    expect(
      suggestionFor(washing.result, washing.fields, 'washing_dressing_service_user_needs')?.suggestedValue,
    ).toContain('I prefer a shower in the morning');
    expect(
      suggestionFor(washing.result, washing.fields, 'washing_dressing_needs_person_centred')?.suggestedValue,
    ).toContain('I prefer a female carer');

    const communication = composePersona('Communication', COMMUNICATION_CARE_PLAN_SEED, 'SU-1042');
    expect(
      suggestionFor(communication.result, communication.fields, 'communication_needs_person_centred')
        ?.suggestedValue,
    ).toContain('I speak clearly');

    const continence = composePersona('Continence', CONTINENCE_CARE_PLAN_SEED, 'SU-1042');
    expect(narrativeSuggestions(continence.result, continence.fields, 'continence').needs).toBeUndefined();

    const skin = composePersona('Skin Integrity', SKIN_INTEGRITY_CARE_PLAN_SEED, 'SU-1042');
    expect(suggestionFor(skin.result, skin.fields, 'skin_integrity_service_user_needs')?.suggestedValue).toContain(
      'I have a sore area on my sacrum',
    );

    const mobility = composePersona('Mobility', MOBILITY_CARE_PLAN_SEED, 'SU-1042');
    expect(suggestionFor(mobility.result, mobility.fields, 'mobility_service_user_needs')?.suggestedValue).toContain(
      'I use a walking frame indoors',
    );

    const culture = composePersona(
      'Culture/Religion/Spirituality',
      CULTURE_RELIGION_CARE_PLAN_SEED,
      'SU-1042',
    );
    expect(suggestionFor(culture.result, culture.fields, 'crs_needs_person_centred')?.suggestedValue).toContain(
      'Sunday service',
    );
  });

  it('Doris: prompting/independence washing and communication; no continence products', () => {
    const washing = composePersona('Washing and dressing', WASHING_DRESSING_CARE_PLAN_SEED, 'SU-TEST-P01');
    expect(
      suggestionFor(washing.result, washing.fields, 'washing_dressing_service_user_needs')?.suggestedValue,
    ).toContain('I need some prompting when washing and dressing');
    expect(
      suggestionFor(washing.result, washing.fields, 'washing_dressing_needs_person_centred')?.suggestedValue,
    ).toContain('Please prompt me rather than doing everything for me');

    const continence = composePersona('Continence', CONTINENCE_CARE_PLAN_SEED, 'SU-TEST-P01');
    expect(narrativeSuggestions(continence.result, continence.fields, 'continence').needs).toBeUndefined();
  });

  it('James: communication and mobility first-person; eating support; no continence', () => {
    const communication = composePersona('Communication', COMMUNICATION_CARE_PLAN_SEED, 'SU-TEST-P02');
    expect(
      suggestionFor(communication.result, communication.fields, 'communication_support_required')
        ?.suggestedValue,
    ).toContain('Please speak slowly and wait for me to answer');
    expect(
      suggestionFor(communication.result, communication.fields, 'communication_support_required')
        ?.suggestedValue,
    ).toContain('Please do not finish my sentences');

    const mobility = composePersona('Mobility', MOBILITY_CARE_PLAN_SEED, 'SU-TEST-P02');
    expect(suggestionFor(mobility.result, mobility.fields, 'mobility_support_required')?.suggestedValue).toContain(
      'I need two carers for all transfers',
    );

    const eating = composePersona('Eating and Drinking', EATING_AND_DRINKING_CARE_PLAN_SEED, 'SU-TEST-P02');
    expect(
      suggestionFor(eating.result, eating.fields, 'eating_and_drinking_service_user_needs')?.suggestedValue,
    ).toContain('I need help with my meals');

    const continence = composePersona('Continence', CONTINENCE_CARE_PLAN_SEED, 'SU-TEST-P02');
    expect(narrativeSuggestions(continence.result, continence.fields, 'continence').needs).toBeUndefined();
  });

  it('Fatima: continence products, culture, washing, skin/PU', () => {
    const continence = composePersona('Continence', CONTINENCE_CARE_PLAN_SEED, 'SU-TEST-P04');
    const slots = narrativeSuggestions(continence.result, continence.fields, 'continence');
    expect(slots.needs?.suggestedValue).toBe(
      'I need support with managing my continence products and maintaining my comfort and dignity.',
    );
    expect(slots.personCentred?.suggestedValue).toBe(
      'I use pads. Please change me when you visit and check my skin.',
    );
    expect(slots.support?.suggestedValue).toBe(
      'Please support me with changing my continence products and check my skin regularly.',
    );

    const culture = composePersona(
      'Culture/Religion/Spirituality',
      CULTURE_RELIGION_CARE_PLAN_SEED,
      'SU-TEST-P04',
    );
    expect(suggestionFor(culture.result, culture.fields, 'crs_service_user_needs')?.suggestedValue).toContain(
      'I am Muslim',
    );
    expect(suggestionFor(culture.result, culture.fields, 'crs_service_user_needs')?.suggestedValue).toContain(
      'Halal',
    );

    const washing = composePersona('Washing and dressing', WASHING_DRESSING_CARE_PLAN_SEED, 'SU-TEST-P04');
    expect(
      suggestionFor(washing.result, washing.fields, 'washing_dressing_service_user_needs')?.suggestedValue,
    ).toContain('I need two female carers');
  });

  it('Betty: continence products, dementia person-centred, sleep, communication', () => {
    const continence = composePersona('Continence', CONTINENCE_CARE_PLAN_SEED, 'SU-TEST-P10');
    expect(
      suggestionFor(continence.result, continence.fields, 'continence_needs_person_centred')?.suggestedValue,
    ).toBe('I need help with pads and the toilet.');
    expect(
      suggestionFor(continence.result, continence.fields, 'continence_service_user_needs')?.suggestedValue,
    ).toContain('continence products');

    const dementia = composePersona('Dementia Care plan', DEMENTIA_CARE_PLAN_SEED, 'SU-TEST-P10');
    expect(
      suggestionFor(dementia.result, dementia.fields, 'dementia_needs_person_centred')?.suggestedValue,
    ).toContain('I prefer a female carer');
    expect(suggestionFor(dementia.result, dementia.fields, 'dementia_service_user_needs')).toBeUndefined();
    expect(suggestionFor(dementia.result, dementia.fields, 'dementia_desired_goals_outcomes')).toBeUndefined();
    expect(dementia.result.values[keyOf(dementia.fields, 'dementia_diagnosed')]).toBe(true);

    const cognition = composePersona(
      'Cognition and Behaviour',
      COGNITION_BEHAVIOUR_CARE_PLAN_SEED,
      'SU-TEST-P10',
    );
    expect(suggestionFor(cognition.result, cognition.fields, 'cog_needs_person_centred')?.suggestedValue).toContain(
      'Please put the radio on',
    );

    const sleep = composePersona('Sleeping and Night', SLEEPING_NIGHT_CARE_PLAN_SEED, 'SU-TEST-P10');
    expect(
      suggestionFor(sleep.result, sleep.fields, 'sleeping_night_service_user_needs')?.suggestedValue,
    ).toContain('I get unsettled at night');

    const safety = composePersona('Personal Safety', PERSONAL_SAFETY_CARE_PLAN_SEED, 'SU-TEST-P10');
    expect(
      suggestionFor(safety.result, safety.fields, 'personal_safety_needs_person_centred')?.suggestedValue,
    ).toContain('I get unsettled at night');
    expect(safety.result.values[keyOf(safety.fields, 'personal_safety_area_risk')]).toBeUndefined();
  });
});
