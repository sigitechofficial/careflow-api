import { CARE_PLAN_REVIEW_FORM_SEED } from '../../../prisma/seeds/care-plan-review-form.seed-data';
import {
  CARE_PLAN_REVIEW_FIELD_REGISTRY,
  CARE_PLAN_REVIEW_AUTO_PREFILL_KEYS,
  CARE_PLAN_REVIEW_MANUAL_KEYS,
  CARE_PLAN_REVIEW_SUGGESTION_KEYS,
  carePlanReviewFieldRegistryEntry,
  assertCarePlanReviewRegistryMatchesTemplate,
} from './care-plan-review-form-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { CARE_PLAN_REVIEW_FIELD_MAPPINGS } from './care-plan-review.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

const REVIEW_FORM_NAME = 'Care Plan review form';

const MANUAL_KEYS = [
  'care_plan_review_review_type',
  'care_plan_review_reviewer',
  'care_plan_review_meeting_needs',
  'care_plan_review_changes_required',
  'care_plan_review_actions',
];

/** Field refs as the loader builds them — carrying sectionTitle, label, and the new stable key. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  CARE_PLAN_REVIEW_FORM_SEED.sections.forEach((section, si) => {
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
    aboutMe: null,
    emergencyContacts: [],
    allergies: [],
    ia: {
      submissionId: 'ia-1',
      submittedAt: '2026-06-01T10:00:00.000Z',
      answers: [
        {
          questionId: 'q1',
          questionText: 'Recommended medication support level',
          checked: null,
          booleanValue: null,
          textValue: null,
          selectedOptions: ['prompting'],
          fieldKey: 'medicationSupportLevel',
          specRef: '9.2',
          sectionNumber: 9,
          sectionTitle: 'Medication',
          carePlanArea: 'Medication',
        },
        {
          questionId: 'q2',
          questionText: 'General physical wellbeing',
          checked: null,
          booleanValue: null,
          textValue: 'Generally well, mobile with a frame',
          selectedOptions: null,
          fieldKey: 'generalPhysicalWellbeing',
          specRef: '4.6',
          sectionNumber: 4,
          sectionTitle: 'Physical health',
        },
      ],
    } as unknown as CarePlanComposeContext['ia'],
    emar: {
      activeCount: 1,
      scheduledCount: 1,
      prnCount: 0,
      medListText: 'Metformin 500mg',
      prnText: '',
    },
    pack: null,
    gpPharmacyLine: null,
  } as unknown as CarePlanComposeContext;
}

// --------------------------------------------------------------------------
// The existing engine still resolves against the merged schema's field refs
// --------------------------------------------------------------------------

describe('Care Plan review engine auto-prefills the merged schema (no new engine)', () => {
  it('populates review-assessment + static fields into values{} by label', () => {
    const result = runCarePlanCompose(REVIEW_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    // Static / schedule fields
    expect(result.values[keyOf('care_plan_review_review_date')]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.values[keyOf('care_plan_review_next_review_date')]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // eMAR + IA sourced assessment fields
    expect(result.values[keyOf('care_plan_review_active_medications')]).toContain('Metformin');
    expect(result.values[keyOf('care_plan_review_medication_support')]).toBe('Prompted');
    expect(result.values[keyOf('care_plan_review_physical_wellbeing')]).toContain('Generally well');
  });

  it('leaves the manual review inputs empty (engine does not own them)', () => {
    const result = runCarePlanCompose(REVIEW_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    for (const key of MANUAL_KEYS) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });

  it('routes to the existing Review engine mapping (care-plan-review), not a new one', () => {
    const result = runCarePlanCompose(REVIEW_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect((result.composedFrom as Record<string, unknown>).mapping).toBe('care-plan-review');
  });

  it('preserves the existing engine mapping set unchanged (no duplicate/second engine)', () => {
    const labels = CARE_PLAN_REVIEW_FIELD_MAPPINGS.map((m) => m.fieldLabel);
    // Every assessment field label in the seed must be present in the untouched engine mapping.
    for (const f of CARE_PLAN_REVIEW_FORM_SEED.sections[1].fields) {
      expect(labels).toContain(f.label);
    }
  });
});

// --------------------------------------------------------------------------
// Documentation registry
// --------------------------------------------------------------------------

describe('Care Plan review documentation registry', () => {
  it('documents twelve auto-prefill fields, zero suggestions, and five manual fields', () => {
    expect(CARE_PLAN_REVIEW_FIELD_REGISTRY).toHaveLength(17);
    expect(CARE_PLAN_REVIEW_AUTO_PREFILL_KEYS).toHaveLength(12);
    expect(CARE_PLAN_REVIEW_SUGGESTION_KEYS).toHaveLength(0);
    expect(CARE_PLAN_REVIEW_MANUAL_KEYS.slice().sort()).toEqual(MANUAL_KEYS.slice().sort());
  });

  it('records the reviewer inputs and outcome judgement as manual', () => {
    expect(carePlanReviewFieldRegistryEntry('care_plan_review_reviewer')?.mode).toBe('MANUAL');
    expect(carePlanReviewFieldRegistryEntry('care_plan_review_meeting_needs')?.mode).toBe('MANUAL');
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertCarePlanReviewRegistryMatchesTemplate()).not.toThrow();
  });
});
