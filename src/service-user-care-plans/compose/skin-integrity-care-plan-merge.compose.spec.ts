import { SKIN_INTEGRITY_CARE_PLAN_SEED } from '../../../prisma/seeds/skin-integrity-care-plan.seed-data';
import {
  SKIN_INTEGRITY_FIELD_REGISTRY,
  SKIN_AUTO_PREFILL_KEYS,
  SKIN_MANUAL_KEYS,
  SKIN_SUGGESTION_KEYS,
  skinFieldRegistryEntry,
  assertSkinRegistryMatchesTemplate,
} from './skin-integrity-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { SKIN_INTEGRITY_CARE_PLAN_FIELD_MAPPINGS } from './area-care-plans.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

const SKIN_FORM_NAME = 'Skin Integrity';

const CARE_2020_KEYS = [
  'skin_integrity_service_user_needs',
  'skin_integrity_needs_person_centred',
  'skin_integrity_desired_goals_outcomes',
  'skin_integrity_support_required',
  'skin_integrity_area_risk',
];

/** Field refs as the loader builds them — carrying sectionTitle, label, and the new stable key. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  SKIN_INTEGRITY_CARE_PLAN_SEED.sections.forEach((section, si) => {
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

/** Context with a populated skin-integrity snapshot (the engine's fallback source). */
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
      skinIntegritySnapshot: {
        skinTypeIssues: 'Dry, eczema-prone skin',
        emollientsCreams: 'Diprobase BD',
        previousPressureDamage: true,
        creamApplication: 'Apply to arms and legs each morning',
        signsToReport: 'Redness, broken skin, new wounds',
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

describe('Skin Integrity engine still auto-prefills after stable keys are added', () => {
  it('populates existing fields into values{} (label matching survives the key addition)', () => {
    const result = runCarePlanCompose(SKIN_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(result.values[keyOf('skin_integrity_skin_type_issues')]).toContain('eczema');
    expect(result.values[keyOf('skin_integrity_emollients_creams')]).toContain('Diprobase');
    expect(result.values[keyOf('skin_integrity_previous_pressure_damage')]).toBe(true);
    expect(result.values[keyOf('skin_integrity_cream_application')]).toContain('each morning');
    expect(result.values[keyOf('skin_integrity_signs_to_report')]).toContain('Redness');
  });

  it('keeps writing into values{} and leaves suggestions[] unused (no conversion to suggestions)', () => {
    const result = runCarePlanCompose(SKIN_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(Object.keys(result.values).length).toBeGreaterThan(0);
    expect(result.suggestions).toBeUndefined();
  });

  it('routes to the existing Skin Integrity engine (composedFrom.formName), not a new one', () => {
    const result = runCarePlanCompose(SKIN_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect((result.composedFrom as Record<string, unknown>).formName).toBe('Skin Integrity');
    expect((result.composedFrom as Record<string, unknown>).mapping).toBeUndefined();
  });

  it('preserves the existing mapping set unchanged (no duplicate/second engine)', () => {
    const labels = SKIN_INTEGRITY_CARE_PLAN_FIELD_MAPPINGS.map((m) => m.fieldLabel);
    expect(labels).toEqual([
      'Skin type / common issues',
      'Emollients or creams prescribed',
      'Previous pressure damage',
      'Application of creams – when and where',
      'Signs to report immediately',
    ]);
  });
});

// --------------------------------------------------------------------------
// The new Care 2020 fields never receive an auto-prefilled value
// --------------------------------------------------------------------------

describe('Care 2020 fields stay manual', () => {
  it('never populates any of the five Care 2020 fields', () => {
    const result = runCarePlanCompose(SKIN_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    for (const key of CARE_2020_KEYS) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });
});

// --------------------------------------------------------------------------
// Documentation registry
// --------------------------------------------------------------------------

describe('Skin Integrity documentation registry', () => {
  it('documents five auto-prefill fields, zero suggestions, and five manual fields', () => {
    expect(SKIN_INTEGRITY_FIELD_REGISTRY).toHaveLength(10);
    expect(SKIN_AUTO_PREFILL_KEYS).toEqual([
      'skin_integrity_skin_type_issues',
      'skin_integrity_emollients_creams',
      'skin_integrity_previous_pressure_damage',
      'skin_integrity_cream_application',
      'skin_integrity_signs_to_report',
    ]);
    expect(SKIN_SUGGESTION_KEYS).toHaveLength(0);
    expect(SKIN_MANUAL_KEYS).toEqual(CARE_2020_KEYS);
  });

  it('records the area-risk gate as manual (not driven by pressure-ulcer-risk flags)', () => {
    const entry = skinFieldRegistryEntry('skin_integrity_area_risk');
    expect(entry?.mode).toBe('MANUAL');
    expect(entry?.sources[0]?.notes ?? '').toMatch(/Waterlow|Pressure ulcer risk/i);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertSkinRegistryMatchesTemplate()).not.toThrow();
  });
});
