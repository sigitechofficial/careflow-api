import { EATING_AND_DRINKING_CARE_PLAN_SEED } from '../../../prisma/seeds/eating-and-drinking-care-plan.seed-data';
import {
  EATING_AND_DRINKING_FIELD_REGISTRY,
  EATING_AND_DRINKING_AUTO_PREFILL_KEYS,
  EATING_AND_DRINKING_MANUAL_KEYS,
  EATING_AND_DRINKING_SUGGESTION_KEYS,
  eatingAndDrinkingFieldRegistryEntry,
  assertEatingAndDrinkingRegistryMatchesTemplate,
} from './eating-and-drinking-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { EATING_DRINKING_CARE_PLAN_FIELD_MAPPINGS } from './remaining-area-care-plans.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

const EATING_DRINKING_FORM_NAME = 'Eating and Drinking';

const CARE_2020_KEYS = [
  'eating_and_drinking_service_user_needs',
  'eating_and_drinking_needs_person_centred',
  'eating_and_drinking_desired_goals_outcomes',
  'eating_and_drinking_support_required',
  'eating_and_drinking_area_risk',
];

const EXISTING_KEYS = [
  'eating_and_drinking_diet_type',
  'eating_and_drinking_fluid_target',
  'eating_and_drinking_food_allergies',
  'eating_and_drinking_level_of_assistance',
  'eating_and_drinking_choking_salt',
  'eating_and_drinking_preferred_foods',
];

/** Field refs as the loader builds them — carrying sectionTitle, label, and the new stable key. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  EATING_AND_DRINKING_CARE_PLAN_SEED.sections.forEach((section, si) => {
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

function keyOf(fieldKey: string): string {
  return fieldRefsFromSeed().find((f) => f.fieldKey === fieldKey)!.key;
}

/** Context with a populated eating-drinking snapshot (the engine's fallback source). */
function ctxWith(): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    serviceUserName: 'Test User',
    personalisation: {},
    allergies: [],
    aboutMe: null,
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers: [],
      eatingDrinkingSnapshot: {
        dietType: 'Soft',
        fluidTargetMl: '1500',
        foodAllergiesIntolerances: 'Lactose intolerant',
        mealAssistanceLevel: 'supervision',
        chokingSaltGuidance: 'Thickened fluids, SALT reviewed',
        preferredFoodsDislikes: 'Likes fish, dislikes spicy food',
      },
    },
    previousAssessments: [],
    emergencyContacts: [],
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
  } as unknown as CarePlanComposeContext;
}

// --------------------------------------------------------------------------
// The existing AUTO-PREFILL engine still resolves after stable keys were added
// --------------------------------------------------------------------------

describe('Eating and Drinking engine still auto-prefills after stable keys are added', () => {
  it('populates existing fields into values{} (label matching survives the key addition)', () => {
    const result = runCarePlanCompose(EATING_DRINKING_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(result.values[keyOf('eating_and_drinking_diet_type')]).toBe('Soft');
    expect(result.values[keyOf('eating_and_drinking_fluid_target')]).toContain('1500');
    expect(result.values[keyOf('eating_and_drinking_food_allergies')]).toContain('Lactose');
    expect(result.values[keyOf('eating_and_drinking_level_of_assistance')]).toBe('Supervision');
    expect(result.values[keyOf('eating_and_drinking_choking_salt')]).toContain('Thickened');
    expect(result.values[keyOf('eating_and_drinking_preferred_foods')]).toContain('fish');
  });

  it('keeps writing into values{} and leaves suggestions[] unused (no conversion to suggestions)', () => {
    const result = runCarePlanCompose(EATING_DRINKING_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(Object.keys(result.values).length).toBeGreaterThan(0);
    expect(result.suggestions).toBeUndefined();
  });

  it('routes to the existing Eating and Drinking engine (composedFrom.formName), not a new one', () => {
    const result = runCarePlanCompose(EATING_DRINKING_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect((result.composedFrom as Record<string, unknown>).formName).toBe('Eating and Drinking');
    expect((result.composedFrom as Record<string, unknown>).mapping).toBeUndefined();
  });

  it('preserves the existing mapping set unchanged (no duplicate/second engine)', () => {
    const labels = EATING_DRINKING_CARE_PLAN_FIELD_MAPPINGS.map((m) => m.fieldLabel);
    expect(labels).toEqual([
      'Diet type',
      'Fluid target per day (ml)',
      'Food allergies or intolerances',
      'Level of assistance',
      'Choking risk / SALT recommendations',
      'Preferred foods and dislikes',
    ]);
  });
});

// --------------------------------------------------------------------------
// The new Care 2020 fields never receive an auto-prefilled value
// --------------------------------------------------------------------------

describe('Care 2020 fields stay manual', () => {
  it('never populates any of the five Care 2020 fields', () => {
    const result = runCarePlanCompose(EATING_DRINKING_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    for (const key of CARE_2020_KEYS) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });
});

// --------------------------------------------------------------------------
// Documentation registry
// --------------------------------------------------------------------------

describe('Eating and Drinking documentation registry', () => {
  it('documents six auto-prefill fields, zero suggestions, and five manual fields', () => {
    expect(EATING_AND_DRINKING_FIELD_REGISTRY).toHaveLength(11);
    expect(EATING_AND_DRINKING_AUTO_PREFILL_KEYS).toEqual(EXISTING_KEYS);
    expect(EATING_AND_DRINKING_SUGGESTION_KEYS).toHaveLength(0);
    expect(EATING_AND_DRINKING_MANUAL_KEYS).toEqual(CARE_2020_KEYS);
  });

  it('records the required person-centred details field as manual', () => {
    const entry = eatingAndDrinkingFieldRegistryEntry('eating_and_drinking_needs_person_centred');
    expect(entry?.mode).toBe('MANUAL');
    expect(entry?.sources[0]?.notes ?? '').toMatch(/person-centred/i);
  });

  it('records the risk gate as manual (not driven by choking/SALT text)', () => {
    const entry = eatingAndDrinkingFieldRegistryEntry('eating_and_drinking_area_risk');
    expect(entry?.mode).toBe('MANUAL');
    expect(entry?.sources[0]?.notes ?? '').toMatch(/choking|assessor/i);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertEatingAndDrinkingRegistryMatchesTemplate()).not.toThrow();
  });
});
