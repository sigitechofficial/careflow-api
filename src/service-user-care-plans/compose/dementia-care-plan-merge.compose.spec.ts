import { DEMENTIA_CARE_PLAN_SEED } from '../../../prisma/seeds/dementia-care-plan.seed-data';
import {
  DEMENTIA_FIELD_REGISTRY,
  DEMENTIA_AUTO_PREFILL_KEYS,
  DEMENTIA_MANUAL_KEYS,
  DEMENTIA_SUGGESTION_KEYS,
  dementiaFieldRegistryEntry,
  assertDementiaRegistryMatchesTemplate,
} from './dementia-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { DEMENTIA_CARE_PLAN_FIELD_MAPPINGS } from './dementia-care-plan.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

const DEMENTIA_FORM_NAME = 'Dementia Care plan';

const CARE_2020_KEYS = [
  'dementia_service_user_needs',
  'dementia_needs_person_centred',
  'dementia_desired_goals_outcomes',
  'dementia_support_required',
  'dementia_area_risk',
  'dementia_risk_identify',
  'dementia_risk_who_might_be_harmed',
  'dementia_risk_level',
  'dementia_risk_likelihood',
  'dementia_risk_triggers',
  'dementia_risk_management',
];

const MANUAL_EXISTING = [
  'dementia_stage',
  'dementia_best_time',
  'dementia_orientation_cues',
  'dementia_wandering_risk',
];

/** Field refs as the loader builds them — carrying sectionTitle, label, and the new stable key. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  DEMENTIA_CARE_PLAN_SEED.sections.forEach((section, si) => {
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

function ctxWith(): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    serviceUserName: 'Margaret Hughes',
    personalisation: {},
    emergencyContacts: ['Son — 07000 000000'],
    allergies: [],
    aboutMe: {
      lifeHistoryInterests: 'Retired teacher, loves gardening',
      whatMattersMost: 'Independence',
      goodDay: 'A walk in the park and a cup of tea',
      meaningfulActivities: 'Gardening, crosswords',
      communication: 'Speaks clearly, prefers short sentences',
      howToSupport: 'Reassure calmly, avoid rushing',
      triggersCalm: 'Loud noise upsets her; music calms her',
      routineSummary: 'Breakfast at 8, nap after lunch',
      nightSupport: 'Nightlight on; checks at 10pm',
      peopleImportant: 'Son visits weekly',
    },
    ia: {
      submissionId: 'ia-1',
      submittedAt: '2026-06-01T10:00:00.000Z',
      answers: [
        {
          questionId: 'q1',
          questionText: 'Cognitive impairment level',
          checked: null,
          booleanValue: null,
          textValue: null,
          selectedOptions: ['moderate'],
          fieldKey: 'cognitiveImpairment',
          specRef: '10.6',
          sectionNumber: 10,
          sectionTitle: 'Cognition',
        },
        {
          questionId: 'q2',
          questionText: 'Diagnosed dementia?',
          checked: null,
          booleanValue: true,
          textValue: null,
          selectedOptions: null,
          specRef: '10.6a',
          sectionNumber: 10,
          sectionTitle: 'Cognition',
        },
      ],
    } as unknown as CarePlanComposeContext['ia'],
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
    reviewFrequencyMonths: 6,
  } as unknown as CarePlanComposeContext;
}

// --------------------------------------------------------------------------
// The existing engine auto-prefills the merged schema (no new engine)
// --------------------------------------------------------------------------

describe('Dementia engine auto-prefills the merged schema (activated dead mappings)', () => {
  it('populates existing + newly-activated assessment fields into values{} by label', () => {
    const result = runCarePlanCompose(DEMENTIA_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    // Existing engine-mapped
    expect(result.values[keyOf('dementia_life_history')]).toContain('gardening');
    expect(result.values[keyOf('dementia_supervision_level')]).toBe('Intermittent supervision');
    // Newly-activated assessment fields
    expect(result.values[keyOf('dementia_good_day')]).toContain('park');
    expect(result.values[keyOf('dementia_communication')]).toContain('short sentences');
    expect(result.values[keyOf('dementia_cognitive_impairment')]).toBe('Moderate cognitive impairment');
    expect(result.values[keyOf('dementia_diagnosed')]).toBe(true);
    expect(result.values[keyOf('dementia_daily_routines')]).toContain('Breakfast');
    expect(result.values[keyOf('dementia_meaningful_activities')]).toContain('Gardening');
    expect(result.values[keyOf('dementia_family_involvement')]).toContain('Son');
    expect(result.values[keyOf('dementia_next_review')]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('leaves the manual existing fields and the Care 2020 block empty', () => {
    const result = runCarePlanCompose(DEMENTIA_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    for (const key of [...MANUAL_EXISTING, ...CARE_2020_KEYS]) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });

  it('routes to the existing Dementia engine mapping (dementia-care-plan), not a new one', () => {
    const result = runCarePlanCompose(DEMENTIA_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect((result.composedFrom as Record<string, unknown>).mapping).toBe('dementia-care-plan');
  });

  it('every Dementia assessment field label is present in the untouched engine mapping set', () => {
    const labels = DEMENTIA_CARE_PLAN_FIELD_MAPPINGS.map((m) => m.fieldLabel);
    for (const f of DEMENTIA_CARE_PLAN_SEED.sections[2].fields) {
      expect(labels).toContain(f.label);
    }
  });
});

// --------------------------------------------------------------------------
// Documentation registry
// --------------------------------------------------------------------------

describe('Dementia documentation registry', () => {
  it('documents sixteen auto-prefill fields, two suggestions, and thirteen manual fields', () => {
    expect(DEMENTIA_FIELD_REGISTRY).toHaveLength(31);
    expect(DEMENTIA_AUTO_PREFILL_KEYS).toHaveLength(16);
    expect(DEMENTIA_SUGGESTION_KEYS).toHaveLength(2);
    expect(DEMENTIA_MANUAL_KEYS).toHaveLength(13);
  });

  it('records the Care 2020 risk gate as manual and person-centred needs as suggestion', () => {
    expect(dementiaFieldRegistryEntry('dementia_area_risk')?.mode).toBe('MANUAL');
    expect(dementiaFieldRegistryEntry('dementia_needs_person_centred')?.mode).toBe('SUGGESTION');
    expect(dementiaFieldRegistryEntry('dementia_area_risk')?.sources[0]?.notes ?? '').toMatch(/assessor|cognition|wandering/i);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertDementiaRegistryMatchesTemplate()).not.toThrow();
  });
});
