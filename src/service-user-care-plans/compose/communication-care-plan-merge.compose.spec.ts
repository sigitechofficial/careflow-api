import { COMMUNICATION_CARE_PLAN_SEED } from '../../../prisma/seeds/communication-care-plan.seed-data';
import {
  COMMUNICATION_FIELD_REGISTRY,
  COMMUNICATION_AUTO_PREFILL_KEYS,
  COMMUNICATION_MANUAL_KEYS,
  COMMUNICATION_SUGGESTION_KEYS,
  communicationFieldRegistryEntry,
  assertCommunicationRegistryMatchesTemplate,
} from './communication-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { COMMUNICATION_CARE_PLAN_FIELD_MAPPINGS } from './remaining-area-care-plans.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

const COMMUNICATION_FORM_NAME = 'Communication';

const CARE_2020_KEYS = [
  'communication_service_user_needs',
  'communication_needs_person_centred',
  'communication_desired_goals_outcomes',
  'communication_support_required',
  'communication_area_risk',
  'communication_risk_identify',
  'communication_risk_who_might_be_harmed',
  'communication_risk_level',
  'communication_risk_likelihood',
  'communication_risk_triggers',
  'communication_risk_management',
];

const AUTO_KEYS = [
  'communication_preferred_language',
  'communication_primary_method',
  'communication_approach',
];

const SUGGESTION_KEYS = [
  'communication_hearing_impairment',
  'communication_vision_impairment',
  'communication_glasses_hearing_aids',
  'communication_service_user_needs',
  'communication_needs_person_centred',
  'communication_desired_goals_outcomes',
  'communication_support_required',
];

const MANUAL_KEYS = [
  'communication_consent_share',
  'communication_area_risk',
  'communication_risk_identify',
  'communication_risk_who_might_be_harmed',
  'communication_risk_level',
  'communication_risk_likelihood',
  'communication_risk_triggers',
  'communication_risk_management',
];

/** Field refs as the loader builds them — carrying sectionTitle, label, and the new stable key. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  COMMUNICATION_CARE_PLAN_SEED.sections.forEach((section, si) => {
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

/** Context with a populated communication snapshot (the engine's fallback source). */
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
      communicationSnapshot: {
        preferredLanguage: 'Polish',
        hearingImpairment: true,
        visionImpairment: false,
        communicationMethod: 'Verbal',
        staffGuidance: 'Speak slowly and face the person',
        aids: 'Wears glasses and a hearing aid',
        consentSharing: true,
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

describe('Communication engine still auto-prefills after stable keys are added', () => {
  it('populates existing fields into values{} (label matching survives the key addition)', () => {
    const result = runCarePlanCompose(COMMUNICATION_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(result.values[keyOf('communication_preferred_language')]).toContain('Polish');
    expect(result.values[keyOf('communication_hearing_impairment')]).toBeUndefined();
    expect(result.values[keyOf('communication_vision_impairment')]).toBeUndefined();
    expect(result.values[keyOf('communication_primary_method')]).toBeDefined();
    expect(result.values[keyOf('communication_approach')]).toContain('slowly');
    expect(result.values[keyOf('communication_glasses_hearing_aids')]).toBeUndefined();
    expect(result.values[keyOf('communication_consent_share')]).toBeUndefined();
  });

  it('keeps writing into values{} and leaves suggestions[] unused (no conversion to suggestions)', () => {
    const result = runCarePlanCompose(COMMUNICATION_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(Object.keys(result.values).length).toBeGreaterThan(0);
    expect(result.suggestions).toBeUndefined();
  });

  it('routes to the existing Communication engine (composedFrom.formName), not a new one', () => {
    const result = runCarePlanCompose(COMMUNICATION_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect((result.composedFrom as Record<string, unknown>).formName).toBe('Communication');
    expect((result.composedFrom as Record<string, unknown>).mapping).toBeUndefined();
  });

  it('preserves the existing mapping set unchanged (no duplicate/second engine)', () => {
    const labels = COMMUNICATION_CARE_PLAN_FIELD_MAPPINGS.map((m) => m.fieldLabel);
    expect(labels).toEqual([
      'Preferred language',
      'Hearing impairment',
      'Vision impairment',
      'Primary communication method',
      'How to approach conversations',
      'Uses glasses/hearing aids',
      'Consent to share information with family',
    ]);
  });
});

// --------------------------------------------------------------------------
// The new Care 2020 fields never receive an auto-prefilled value
// --------------------------------------------------------------------------

describe('Care 2020 fields stay manual', () => {
  it('never populates any of the five Care 2020 fields', () => {
    const result = runCarePlanCompose(COMMUNICATION_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    for (const key of CARE_2020_KEYS) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });
});

// --------------------------------------------------------------------------
// Documentation registry
// --------------------------------------------------------------------------

describe('Communication documentation registry', () => {
  it('documents three auto-prefill fields, seven suggestions, and eight manual fields', () => {
    expect(COMMUNICATION_FIELD_REGISTRY).toHaveLength(18);
    expect(COMMUNICATION_AUTO_PREFILL_KEYS).toEqual(AUTO_KEYS);
    expect(COMMUNICATION_SUGGESTION_KEYS).toEqual(SUGGESTION_KEYS);
    expect(COMMUNICATION_MANUAL_KEYS).toEqual(MANUAL_KEYS);
  });

  it('records the required person-centred details field as a suggestion', () => {
    const entry = communicationFieldRegistryEntry('communication_needs_person_centred');
    expect(entry?.mode).toBe('SUGGESTION');
    expect(entry?.sources[0]?.notes ?? '').toMatch(/person-centred/i);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertCommunicationRegistryMatchesTemplate()).not.toThrow();
  });
});
