import { FALLS_CARE_PLAN_SEED } from '../../../prisma/seeds/falls-care-plan.seed-data';
import {
  FALLS_FIELD_REGISTRY,
  FALLS_MANUAL_KEYS,
  FALLS_SUGGESTION_KEYS,
  fallsFieldRegistryEntry,
  assertFallsRegistryMatchesTemplate,
} from './falls-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { composeFallsCarePlan } from './area-care-plans.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

const FALLS_FORM_NAME = 'Falls';

/** The five Care 2020 keys that must remain manual — never suggested by the engine. */
const CARE_2020_KEYS = [
  'falls_service_user_needs',
  'falls_needs_person_centred',
  'falls_desired_goals_outcomes',
  'falls_support_required',
  'falls_area_risk',
];

/** Field refs as the loader would build them — crucially carrying sectionTitle,
 *  because the existing Falls engine matches on section title + label + type. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  FALLS_CARE_PLAN_SEED.sections.forEach((section, si) => {
    const sectionId = `sec-${si}`;
    section.fields.forEach((field, fi) => {
      const fieldId = `f-${si}-${fi}`;
      refs.push({
        key: `${sectionId}:${fieldId}`,
        sectionId,
        fieldId,
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

let seq = 0;
function answer(overrides: Partial<SubmissionAnswerForRules>): SubmissionAnswerForRules {
  seq += 1;
  return {
    questionId: `q-${seq}`,
    questionText: 'Question',
    checked: null,
    booleanValue: null,
    textValue: null,
    selectedOptions: null,
    sectionNumber: 12,
    sectionTitle: 'Mobility',
    ...overrides,
  } as SubmissionAnswerForRules;
}

/** Real §12.7 / §3.7 / §12.5c Falls answers plus generic content that must NOT map to Care 2020 fields. */
function fallsAnswers(): SubmissionAnswerForRules[] {
  return [
    answer({ specRef: '12.7', questionText: 'Number of falls (last 12 months)', numberValue: 2 }),
    answer({
      fieldKey: 'fallsLast12Months',
      specRef: '12.7',
      questionText: 'Falls in last 12 months?',
      booleanValue: true,
    }),
    answer({ specRef: '12.7', questionText: 'Injury caused by fall?', booleanValue: true }),
    answer({ specRef: '3.7', questionText: 'Trip hazards identified?', booleanValue: true, sectionNumber: 3, sectionTitle: 'Access' }),
    // Generic content that must not be mapped onto the Care 2020 needs/goals/support/risk fields.
    answer({ questionText: 'What are your desired goals?', textValue: 'Be more independent' }),
    answer({ questionText: 'What support do you need?', textValue: 'Help with shopping' }),
    answer({ questionText: 'Any risk identified?', booleanValue: true }),
  ];
}

function ctxWith(answers: SubmissionAnswerForRules[] | null): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    previousAssessments: [],
    ia: answers
      ? {
          submissionId: 'sub-1',
          status: 'REVIEWED',
          submittedAt: '2026-08-01T00:00:00.000Z',
          answers,
        }
      : null,
  } as unknown as CarePlanComposeContext;
}

function suggestedKeys(result: ReturnType<typeof composeFallsCarePlan>): Set<string> {
  const byKey = new Map(fieldRefsFromSeed().map((f) => [f.key, f.fieldKey]));
  const out = new Set<string>();
  for (const s of result.suggestions ?? []) {
    const fk = byKey.get(s.targetFieldKey);
    if (fk) out.add(fk);
  }
  return out;
}

// --------------------------------------------------------------------------
// The existing engine still resolves suggestions after keys were added
// --------------------------------------------------------------------------

describe('existing Falls suggestion engine survives the key addition', () => {
  it('still produces suggestions for existing fields (label matching intact)', () => {
    const result = composeFallsCarePlan(ctxWith(fallsAnswers()), fieldRefsFromSeed(), 'su-1');
    const keys = suggestedKeys(result);
    // At least the falls-count field is suggested from §12.7.
    expect(keys.has('falls_falls_last_12_months')).toBe(true);
    expect(result.suggestions!.length).toBeGreaterThan(0);
  });

  it('writes nothing into values (suggestions only)', () => {
    const result = composeFallsCarePlan(ctxWith(fallsAnswers()), fieldRefsFromSeed(), 'su-1');
    expect(result.values).toEqual({});
    expect(result.fieldSources ?? {}).toEqual({});
  });

  it('routes through the pre-existing Falls dispatch (falls-suggestions), not a new one', () => {
    const result = runCarePlanCompose(FALLS_FORM_NAME, ctxWith(fallsAnswers()), fieldRefsFromSeed());
    expect(result.composedFrom?.mapping).toBe('falls-suggestions');
  });
});

// --------------------------------------------------------------------------
// The new Care 2020 fields never receive a suggestion
// --------------------------------------------------------------------------

describe('Care 2020 fields stay manual', () => {
  it('never suggests any of the five Care 2020 fields, even with a full assessment', () => {
    const result = composeFallsCarePlan(ctxWith(fallsAnswers()), fieldRefsFromSeed(), 'su-1');
    const keys = suggestedKeys(result);
    for (const c2020 of CARE_2020_KEYS) {
      expect(keys.has(c2020)).toBe(false);
    }
  });

  it('never suggests the physiotherapy referral (no IA source)', () => {
    const result = composeFallsCarePlan(ctxWith(fallsAnswers()), fieldRefsFromSeed(), 'su-1');
    expect(suggestedKeys(result).has('falls_referral_physiotherapy')).toBe(false);
  });

  it('every suggestion targets a registry-approved SUGGESTION field', () => {
    const result = composeFallsCarePlan(ctxWith(fallsAnswers()), fieldRefsFromSeed(), 'su-1');
    for (const key of suggestedKeys(result)) {
      expect(FALLS_SUGGESTION_KEYS).toContain(key);
    }
  });
});

// --------------------------------------------------------------------------
// No assessment
// --------------------------------------------------------------------------

describe('no assessment', () => {
  it('produces no suggestions and no values', () => {
    const result = composeFallsCarePlan(ctxWith(null), fieldRefsFromSeed(), 'su-1');
    expect(result.suggestions ?? []).toHaveLength(0);
    expect(result.values).toEqual({});
  });
});

// --------------------------------------------------------------------------
// Registry ↔ template
// --------------------------------------------------------------------------

describe('Falls registry', () => {
  it('documents six suggestion fields and eight manual fields', () => {
    expect(FALLS_SUGGESTION_KEYS).toEqual([
      'falls_falls_last_12_months',
      'falls_last_fall_details',
      'falls_injury_from_previous',
      'falls_mobility_aids',
      'falls_environmental_hazards',
      'falls_transfers_instructions',
    ]);
    expect(FALLS_MANUAL_KEYS).toHaveLength(6);
    expect(FALLS_FIELD_REGISTRY).toHaveLength(12);
  });

  it('marks every Care 2020 field manual with a recorded reason', () => {
    for (const key of CARE_2020_KEYS) {
      const entry = fallsFieldRegistryEntry(key);
      expect(entry?.mode).toBe('MANUAL');
      expect(entry?.resolvedByEngine).toBe(false);
      expect(entry?.sources[0]?.notes ?? '').not.toHaveLength(0);
    }
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertFallsRegistryMatchesTemplate()).not.toThrow();
  });
});
