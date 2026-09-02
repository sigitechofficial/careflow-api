import { PERSONAL_SAFETY_CARE_PLAN_SEED } from '../../../prisma/seeds/personal-safety-care-plan.seed-data';
import {
  PERSONAL_SAFETY_FIELD_REGISTRY,
  PERSONAL_SAFETY_AUTO_PREFILL_KEYS,
  PERSONAL_SAFETY_MANUAL_KEYS,
  PERSONAL_SAFETY_SUGGESTION_KEYS,
  personalSafetyFieldRegistryEntry,
  assertPersonalSafetyRegistryMatchesTemplate,
} from './personal-safety-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { PERSONAL_SAFETY_CARE_PLAN_FIELD_MAPPINGS } from './remaining-area-care-plans.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

const PERSONAL_SAFETY_FORM_NAME = 'Personal Safety';

const CARE_2020_KEYS = [
  'personal_safety_service_user_needs',
  'personal_safety_needs_person_centred',
  'personal_safety_desired_goals_outcomes',
  'personal_safety_support_required',
  'personal_safety_area_risk',
  'personal_safety_risk_identify',
  'personal_safety_risk_who_might_be_harmed',
  'personal_safety_risk_level',
  'personal_safety_risk_likelihood',
  'personal_safety_risk_triggers',
  'personal_safety_risk_management',
];

const EXISTING_KEYS = [
  'personal_safety_home_hazards',
  'personal_safety_smoking_fire_safety',
  'personal_safety_lone_worker_risk',
  'personal_safety_safeguarding_concern',
  'personal_safety_actions_in_place',
  'personal_safety_emergency_contacts',
];

/** Field refs as the loader builds them — carrying sectionTitle, label, and the new stable key. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  PERSONAL_SAFETY_CARE_PLAN_SEED.sections.forEach((section, si) => {
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

/** Context with a populated personal-safety snapshot + emergency contacts (engine sources). */
function ctxWith(): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    serviceUserName: 'Test User',
    personalisation: {},
    emergencyContacts: ['Jane Doe (daughter) — 0161 123 4567'],
    aboutMe: null,
    allergies: [],
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers: [],
      personalSafetySnapshot: {
        homeHazards: 'Loose stair rug in the hallway',
        fireSafety: 'Smoke alarms tested; smokes near oxygen — caution',
        loneWorkerRisk: 'medium',
        safeguardingOnFile: true,
        actionsInPlace: 'Referral to social services made',
        emergencyContacts: 'Next of kin on file',
      },
    },
    previousAssessments: [],
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
  } as unknown as CarePlanComposeContext;
}

// --------------------------------------------------------------------------
// The existing AUTO-PREFILL engine still resolves after stable keys were added
// --------------------------------------------------------------------------

describe('Personal Safety engine still auto-prefills after stable keys are added', () => {
  it('populates existing fields into values{} (label matching survives the key addition)', () => {
    const result = runCarePlanCompose(PERSONAL_SAFETY_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(result.values[keyOf('personal_safety_home_hazards')]).toContain('stair rug');
    expect(result.values[keyOf('personal_safety_smoking_fire_safety')]).toContain('Smoke alarms');
    expect(result.values[keyOf('personal_safety_lone_worker_risk')]).toBe('Medium');
    expect(result.values[keyOf('personal_safety_safeguarding_concern')]).toBe(true);
    expect(result.values[keyOf('personal_safety_actions_in_place')]).toContain('social services');
    expect(result.values[keyOf('personal_safety_emergency_contacts')]).toContain('Jane Doe');
  });

  it('keeps writing into values{} and leaves suggestions[] unused (no conversion to suggestions)', () => {
    const result = runCarePlanCompose(PERSONAL_SAFETY_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(Object.keys(result.values).length).toBeGreaterThan(0);
    expect(result.suggestions).toBeUndefined();
  });

  it('routes to the existing Personal Safety engine (composedFrom.formName), not a new one', () => {
    const result = runCarePlanCompose(PERSONAL_SAFETY_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect((result.composedFrom as Record<string, unknown>).formName).toBe('Personal Safety');
    expect((result.composedFrom as Record<string, unknown>).mapping).toBeUndefined();
  });

  it('preserves the existing mapping set unchanged (no duplicate/second engine)', () => {
    const labels = PERSONAL_SAFETY_CARE_PLAN_FIELD_MAPPINGS.map((m) => m.fieldLabel);
    expect(labels).toEqual([
      'Home hazards identified',
      'Smoking / fire safety',
      'Lone worker risk level',
      'Safeguarding concern on file',
      'Actions in place',
      'Emergency contacts',
    ]);
  });
});

// --------------------------------------------------------------------------
// The new Care 2020 fields never receive an auto-prefilled value
// --------------------------------------------------------------------------

describe('Care 2020 fields stay manual', () => {
  it('never populates any of the five Care 2020 fields', () => {
    const result = runCarePlanCompose(PERSONAL_SAFETY_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    for (const key of CARE_2020_KEYS) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });
});

// --------------------------------------------------------------------------
// Documentation registry
// --------------------------------------------------------------------------

describe('Personal Safety documentation registry', () => {
  it('documents six auto-prefill fields, four suggestions, and seven manual fields', () => {
    expect(PERSONAL_SAFETY_FIELD_REGISTRY).toHaveLength(17);
    expect(PERSONAL_SAFETY_AUTO_PREFILL_KEYS).toEqual(EXISTING_KEYS);
    expect(PERSONAL_SAFETY_SUGGESTION_KEYS).toEqual([
      'personal_safety_service_user_needs',
      'personal_safety_needs_person_centred',
      'personal_safety_desired_goals_outcomes',
      'personal_safety_support_required',
    ]);
    expect(PERSONAL_SAFETY_MANUAL_KEYS).toEqual(CARE_2020_KEYS.slice(4));
  });

  it('records the risk gate as manual (not driven by safeguarding-concern flag)', () => {
    const entry = personalSafetyFieldRegistryEntry('personal_safety_area_risk');
    expect(entry?.mode).toBe('MANUAL');
    expect(entry?.sources[0]?.notes ?? '').toMatch(/safeguarding|lone-worker|assessor/i);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertPersonalSafetyRegistryMatchesTemplate()).not.toThrow();
  });
});
