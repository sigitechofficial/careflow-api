import { CONTINENCE_CARE_PLAN_SEED } from '../../../prisma/seeds/continence-care-plan.seed-data';
import {
  CONTINENCE_FIELD_REGISTRY,
  CONTINENCE_AUTO_PREFILL_KEYS,
  CONTINENCE_MANUAL_KEYS,
  CONTINENCE_SUGGESTION_KEYS,
  continenceFieldRegistryEntry,
  assertContinenceRegistryMatchesTemplate,
} from './continence-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { CONTINENCE_CARE_PLAN_FIELD_MAPPINGS } from './remaining-area-care-plans.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

const CONTINENCE_FORM_NAME = 'Continence';

const CARE_2020_KEYS = [
  'continence_service_user_needs',
  'continence_needs_person_centred',
  'continence_desired_goals_outcomes',
  'continence_support_required',
  'continence_area_risk',
  'continence_risk_identify',
  'continence_risk_who_might_be_harmed',
  'continence_risk_level',
  'continence_risk_likelihood',
  'continence_risk_triggers',
  'continence_risk_management',
];

const SUGGESTION_KEYS = [
  'continence_bladder',
  'continence_bowel',
  'continence_products_used',
  'continence_toileting_routine',
  'continence_skin_care',
  'continence_service_user_needs',
  'continence_needs_person_centred',
  'continence_desired_goals_outcomes',
  'continence_support_required',
];

const MANUAL_KEYS = [
  'continence_fluid_intake',
  'continence_area_risk',
  'continence_risk_identify',
  'continence_risk_who_might_be_harmed',
  'continence_risk_level',
  'continence_risk_likelihood',
  'continence_risk_triggers',
  'continence_risk_management',
];

/** Field refs as the loader builds them — carrying sectionTitle, label, and the new stable key. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  CONTINENCE_CARE_PLAN_SEED.sections.forEach((section, si) => {
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

/** Context with a populated continence snapshot (the engine's fallback source). */
function ctxWith(): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    serviceUserName: 'Test User',
    personalisation: {},
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers: [],
      continenceSnapshot: {
        bladderStatus: 'Occasional leakage',
        bowelStatus: 'Continent',
        productsUsed: 'Level 3 pads, day and night',
        toiletingRoutine: 'Prompt every 2 hours during the day',
        fluidGuidance: 'Encourage 1.5L per day',
        skinCareAfterEpisodes: 'Barrier cream after each episode',
      },
    },
    previousAssessments: [],
    aboutMe: null,
    emergencyContacts: [],
    allergies: [],
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
  } as unknown as CarePlanComposeContext;
}

// --------------------------------------------------------------------------
// The existing AUTO-PREFILL engine still resolves after stable keys were added
// --------------------------------------------------------------------------

describe('Continence engine still auto-prefills after stable keys are added', () => {
  it('populates existing fields into values{} (label matching survives the key addition)', () => {
    const result = runCarePlanCompose(CONTINENCE_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(result.values[keyOf('continence_bladder')]).toBeUndefined();
    expect(result.values[keyOf('continence_bowel')]).toBeUndefined();
    expect(result.values[keyOf('continence_products_used')]).toBeUndefined();
    expect(result.values[keyOf('continence_toileting_routine')]).toBeUndefined();
    expect(result.values[keyOf('continence_fluid_intake')]).toBeUndefined();
    expect(result.values[keyOf('continence_skin_care')]).toBeUndefined();
  });

  it('keeps writing into values{} and leaves suggestions[] unused (no conversion to suggestions)', () => {
    const result = runCarePlanCompose(CONTINENCE_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(result.suggestions).toBeUndefined();
  });

  it('routes to the existing Continence engine (composedFrom.formName), not a new one', () => {
    const result = runCarePlanCompose(CONTINENCE_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect((result.composedFrom as Record<string, unknown>).formName).toBe('Continence');
    expect((result.composedFrom as Record<string, unknown>).mapping).toBeUndefined();
  });

  it('preserves the existing mapping set unchanged (no duplicate/second engine)', () => {
    const labels = CONTINENCE_CARE_PLAN_FIELD_MAPPINGS.map((m) => m.fieldLabel);
    expect(labels).toEqual([
      'Bladder continence',
      'Bowel continence',
      'Products used (pads, commode, etc.)',
      'Toileting/prompting routine',
      'Fluid intake guidance',
      'Skin care after episodes',
    ]);
  });
});

// --------------------------------------------------------------------------
// The new Care 2020 fields never receive an auto-prefilled value
// --------------------------------------------------------------------------

describe('Care 2020 fields stay manual', () => {
  it('never populates any of the five Care 2020 fields', () => {
    const result = runCarePlanCompose(CONTINENCE_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    for (const key of CARE_2020_KEYS) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });
});

// --------------------------------------------------------------------------
// Documentation registry
// --------------------------------------------------------------------------

describe('Continence documentation registry', () => {
  it('documents zero auto-prefill fields, nine suggestions, and eight manual fields', () => {
    expect(CONTINENCE_FIELD_REGISTRY).toHaveLength(17);
    expect(CONTINENCE_AUTO_PREFILL_KEYS).toEqual([]);
    expect(CONTINENCE_SUGGESTION_KEYS).toEqual(SUGGESTION_KEYS);
    expect(CONTINENCE_MANUAL_KEYS).toEqual(MANUAL_KEYS);
  });

  it('records the required person-centred details field as a suggestion', () => {
    const entry = continenceFieldRegistryEntry('continence_needs_person_centred');
    expect(entry?.mode).toBe('SUGGESTION');
    expect(entry?.sources[0]?.notes ?? '').toMatch(/person-centred/i);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertContinenceRegistryMatchesTemplate()).not.toThrow();
  });
});
