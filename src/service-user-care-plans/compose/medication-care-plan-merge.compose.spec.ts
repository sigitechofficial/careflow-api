import { MEDICATION_CARE_PLAN_SEED } from '../../../prisma/seeds/medication-care-plan.seed-data';
import {
  MEDICATION_FIELD_REGISTRY,
  MEDICATION_AUTO_PREFILL_KEYS,
  MEDICATION_MANUAL_KEYS,
  MEDICATION_SUGGESTION_KEYS,
  medicationFieldRegistryEntry,
  assertMedicationRegistryMatchesTemplate,
} from './medication-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { MEDICATION_CARE_PLAN_FIELD_MAPPINGS } from './medication-care-plan.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

const MEDICATION_FORM_NAME = 'Medication';

const CARE_2020_KEYS = [
  'medication_service_user_needs',
  'medication_needs_person_centred',
  'medication_desired_goals_outcomes',
  'medication_support_required',
  'medication_area_risk',
  'medication_risk_identify',
  'medication_risk_who_might_be_harmed',
  'medication_risk_level',
  'medication_risk_likelihood',
  'medication_risk_triggers',
  'medication_risk_management',
];

/** Field refs as the loader builds them — carrying sectionTitle, label, and the new stable key. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  MEDICATION_CARE_PLAN_SEED.sections.forEach((section, si) => {
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

/** Minimal context: structured allergies + a medication snapshot support level. */
function ctxWith(): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers: [],
      medicationSnapshot: { supportLevel: 'prompting' },
    },
    allergies: ['Penicillin — rash'],
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
  } as unknown as CarePlanComposeContext;
}

// --------------------------------------------------------------------------
// The existing AUTO-PREFILL engine still resolves after stable keys were added
// --------------------------------------------------------------------------

describe('Medication engine still auto-prefills after stable keys are added', () => {
  it('populates existing fields into values{} (label matching survives the key addition)', () => {
    const result = runCarePlanCompose(MEDICATION_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    // Support level auto-prefilled from the medication snapshot ("prompting" -> "Prompted").
    expect(result.values[keyOf('medication_support_level')]).toBe('Prompted');
    // Known allergies auto-prefilled from the structured ServiceUserAllergy source (ctx.allergies).
    expect(result.values[keyOf('medication_known_allergies')]).toContain('Penicillin');
    expect(result.fieldSources?.[keyOf('medication_known_allergies')]).toBe('allergies');
  });

  it('keeps writing into values{} and leaves suggestions[] unused (no conversion to suggestions)', () => {
    const result = runCarePlanCompose(MEDICATION_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(Object.keys(result.values).length).toBeGreaterThan(0);
    expect(result.suggestions).toBeUndefined();
  });

  it('routes to the existing Medication engine (auto-prefill composedFrom), not a new suggestion engine', () => {
    const result = runCarePlanCompose(MEDICATION_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    // Signature of the existing engine's composedFrom (see medication-care-plan.compose.ts).
    expect(result.composedFrom).toHaveProperty('emarActiveCount');
    expect(result.composedFrom).toHaveProperty('iaSubmissionId');
    expect((result.composedFrom as Record<string, unknown>).mapping).toBeUndefined();
  });

  it('preserves the existing mapping set unchanged (no duplicate/second engine)', () => {
    const labels = MEDICATION_CARE_PLAN_FIELD_MAPPINGS.map((m) => m.fieldLabel);
    // The six merged local fields are still mapped by their labels.
    expect(labels).toEqual(expect.arrayContaining([
      'Medication support level',
      'Known allergies',
      'PRN medicines and when used',
      'Storage and blister packs',
      'Refusal or missed dose – action',
      'Pharmacy and GP contact',
    ]));
  });
});

// --------------------------------------------------------------------------
// The new Care 2020 fields never receive an auto-prefilled value
// --------------------------------------------------------------------------

describe('Care 2020 fields stay manual', () => {
  it('never populates any of the five Care 2020 fields', () => {
    const result = runCarePlanCompose(MEDICATION_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    for (const key of CARE_2020_KEYS) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });
});

// --------------------------------------------------------------------------
// Documentation registry
// --------------------------------------------------------------------------

describe('Medication documentation registry', () => {
  it('documents six auto-prefill fields, zero suggestions, and seven manual fields', () => {
    expect(MEDICATION_FIELD_REGISTRY).toHaveLength(17);
    expect(MEDICATION_AUTO_PREFILL_KEYS).toEqual([
      'medication_support_level',
      'medication_known_allergies',
      'medication_prn_medicines',
      'medication_storage_blister_packs',
      'medication_refusal_missed_dose',
      'medication_pharmacy_gp_contact',
    ]);
    expect(MEDICATION_SUGGESTION_KEYS).toHaveLength(0);
    expect(MEDICATION_MANUAL_KEYS).toEqual(CARE_2020_KEYS);
  });

  it('records Known allergies as a structured ServiceUserAllergy auto-prefill', () => {
    const entry = medicationFieldRegistryEntry('medication_known_allergies');
    expect(entry?.mode).toBe('AUTO_PREFILL');
    expect(entry?.resolvedByEngine).toBe(true);
    expect(entry?.sources.some((s) => s.kind === 'STRUCTURED_ALLERGY')).toBe(true);
  });

  it('records MedicationSupportProfile as an identified, out-of-scope future improvement', () => {
    // Documented in the registry file header; the support-level entry must NOT claim a
    // MedicationSupportProfile source (it is not wired into the compose context).
    const entry = medicationFieldRegistryEntry('medication_support_level');
    expect(entry?.sources.some((s) => (s.kind as string) === 'MEDICATION_SUPPORT_PROFILE')).toBe(false);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertMedicationRegistryMatchesTemplate()).not.toThrow();
  });
});
