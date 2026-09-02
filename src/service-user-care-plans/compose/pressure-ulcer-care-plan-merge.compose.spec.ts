import { PRESSURE_ULCER_CARE_PLAN_SEED } from '../../../prisma/seeds/pressure-ulcer-care-plan.seed-data';
import { SKIN_INTEGRITY_CARE_PLAN_SEED } from '../../../prisma/seeds/skin-integrity-care-plan.seed-data';
import { COMMUNICATION_CARE_PLAN_SEED } from '../../../prisma/seeds/communication-care-plan.seed-data';
import {
  PRESSURE_ULCER_FIELD_REGISTRY,
  PRESSURE_ULCER_AUTO_PREFILL_KEYS,
  PRESSURE_ULCER_MANUAL_KEYS,
  PRESSURE_ULCER_SUGGESTION_KEYS,
  pressureUlcerFieldRegistryEntry,
  assertPressureUlcerRegistryMatchesTemplate,
} from './pressure-ulcer-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { PRESSURE_ULCER_CARE_PLAN_FIELD_MAPPINGS } from './pressure-ulcer-care-plan.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

const PRESSURE_ULCER_FORM_NAME = 'Pressure Ulcer';

const CARE_2020_KEYS = [
  'pressure_ulcer_service_user_needs',
  'pressure_ulcer_needs_person_centred',
  'pressure_ulcer_desired_goals_outcomes',
  'pressure_ulcer_support_required',
  'pressure_ulcer_area_risk',
  'pressure_ulcer_risk_identify',
  'pressure_ulcer_risk_who_might_be_harmed',
  'pressure_ulcer_risk_level',
  'pressure_ulcer_risk_likelihood',
  'pressure_ulcer_risk_triggers',
  'pressure_ulcer_risk_management',
];

const MANUAL_LOCAL_KEYS = [
  'pressure_ulcer_skin_inspection_frequency',
  'pressure_ulcer_repositioning_schedule',
  'pressure_ulcer_nutrition_skin_healing',
];

function fieldRefsFromSeed(
  seed: { sections: Array<{ title: string; fields: Array<{ fieldKey?: string; label: string; fieldType: string; required?: boolean }> }> },
): CarePlanFormFieldRef[] {
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

function puFields(): CarePlanFormFieldRef[] {
  return fieldRefsFromSeed(PRESSURE_ULCER_CARE_PLAN_SEED);
}

function keyOf(fieldKey: string): string {
  return puFields().find((f) => f.fieldKey === fieldKey)!.key;
}

function iaAnswer(partial: Partial<SubmissionAnswerForRules> & { questionText: string }): SubmissionAnswerForRules {
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
    sectionNumber: partial.sectionNumber ?? 11,
    sectionTitle: partial.sectionTitle ?? 'Skin Integrity',
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

function ctxWithIa(partial: {
  answers?: SubmissionAnswerForRules[];
  waterlowMetadata?: { score: number | null } | null;
  skinIntegritySnapshot?: CarePlanComposeContext['ia'] extends infer T
    ? T extends { skinIntegritySnapshot?: infer S }
      ? S
      : never
    : never;
}): CarePlanComposeContext {
  return emptyCtx({
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers: partial.answers ?? [],
      waterlowMetadata: partial.waterlowMetadata,
      skinIntegritySnapshot: partial.skinIntegritySnapshot ?? null,
    },
  });
}

describe('Pressure Ulcer Phase 1 — AUTO-PREFILL disabled', () => {
  it('does not auto-write Waterlow band, wound narrative, or equipment onto the plan', () => {
    const result = runCarePlanCompose(
      PRESSURE_ULCER_FORM_NAME,
      ctxWithIa({
        waterlowMetadata: { score: 17 },
        answers: [
          iaAnswer({
            specRef: '11.1',
            questionText: 'Ulcers or wounds comment',
            textValue: 'Sacral grade 2, dressing in situ',
          }),
          iaAnswer({
            fieldKey: 'hasWounds',
            specRef: '11.1',
            questionText: 'Currently has ulcers or wounds?',
            booleanValue: true,
          }),
          iaAnswer({
            specRef: '11.1',
            questionText: 'Further pressure equipment comment',
            textValue: 'Hybrid mattress and heel protectors',
          }),
        ],
      }),
      puFields(),
    );
    expect(result.values[keyOf('pressure_ulcer_waterlow_risk_score')]).toBeUndefined();
    expect(result.values[keyOf('pressure_ulcer_existing_areas_wounds')]).toBeUndefined();
    expect(result.values[keyOf('pressure_ulcer_relieving_equipment')]).toBeUndefined();
    expect((result.composedFrom as Record<string, unknown>).formName).toBe('Pressure Ulcer');
    expect((result.composedFrom as Record<string, unknown>).mapping).not.toBe('generic');
  });

  it('does not auto-prefill from a Skin Integrity snapshot', () => {
    const result = runCarePlanCompose(
      PRESSURE_ULCER_FORM_NAME,
      ctxWithIa({
        skinIntegritySnapshot: {
          skinTypeIssues: 'Dry',
          emollientsCreams: 'Diprobase',
          previousPressureDamage: true,
          creamApplication: 'Apply to arms',
          signsToReport: 'Redness',
        },
      }),
      puFields(),
    );
    expect(result.values[keyOf('pressure_ulcer_existing_areas_wounds')]).toBeUndefined();
    expect(result.values[keyOf('pressure_ulcer_relieving_equipment')]).toBeUndefined();
  });
});

describe('Pressure Ulcer MANUAL fields', () => {
  it('never populates inspection, repositioning, nutrition or the Care 2020 block', () => {
    const result = runCarePlanCompose(
      PRESSURE_ULCER_FORM_NAME,
      ctxWithIa({
        waterlowMetadata: { score: 22 },
        answers: [
          iaAnswer({
            specRef: '11.1',
            questionText: 'Ulcers or wounds comment',
            textValue: 'Heel blister',
          }),
          iaAnswer({
            specRef: '11.1',
            questionText: 'Further pressure equipment comment',
            textValue: 'Air mattress',
          }),
          iaAnswer({
            specRef: '11.1',
            questionText: 'Pressure ulcer risk assessment completed (including photography)?',
            booleanValue: true,
          }),
          iaAnswer({
            specRef: '8.1',
            questionText: 'MUST score',
            numberValue: 4,
            textValue: 'High malnutrition risk',
          }),
          iaAnswer({
            questionText: 'What are the service user needs?',
            textValue: 'Should not map',
          }),
        ],
      }),
      puFields(),
    );

    for (const key of [...MANUAL_LOCAL_KEYS, ...CARE_2020_KEYS]) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });

  it('does not drive area risk from Waterlow or from risk-assessment-completed', () => {
    const result = runCarePlanCompose(
      PRESSURE_ULCER_FORM_NAME,
      ctxWithIa({
        waterlowMetadata: { score: 22 },
        answers: [
          iaAnswer({
            specRef: '11.1',
            questionText: 'Pressure ulcer risk assessment completed (including photography)?',
            booleanValue: true,
          }),
        ],
      }),
      puFields(),
    );
    expect(result.values[keyOf('pressure_ulcer_waterlow_risk_score')]).toBeUndefined();
    expect(result.values[keyOf('pressure_ulcer_area_risk')]).toBeUndefined();
    expect(pressureUlcerFieldRegistryEntry('pressure_ulcer_area_risk')?.mode).toBe('MANUAL');
  });

  it('does not map MUST / nutrition scores onto nutrition linked to skin healing', () => {
    const result = runCarePlanCompose(
      PRESSURE_ULCER_FORM_NAME,
      ctxWithIa({
        answers: [
          iaAnswer({
            specRef: '8.1',
            questionText: 'MUST score',
            numberValue: 3,
            textValue: 'MUST 3 — high risk',
          }),
          iaAnswer({
            questionText: 'Nutrition risk',
            textValue: 'High',
          }),
        ],
      }),
      puFields(),
    );
    expect(result.values[keyOf('pressure_ulcer_nutrition_skin_healing')]).toBeUndefined();
  });
});

describe('Pressure Ulcer compose dispatch', () => {
  it('no longer uses the generic compose mapping', () => {
    const result = runCarePlanCompose(PRESSURE_ULCER_FORM_NAME, emptyCtx(), puFields());
    expect((result.composedFrom as Record<string, unknown>).mapping).not.toBe('generic');
    expect((result.composedFrom as Record<string, unknown>).formName).toBe('Pressure Ulcer');
  });

  it('leaves other named Care Plans on their existing engines', () => {
    const communication = runCarePlanCompose(
      'Communication',
      emptyCtx({
        ia: {
          submissionId: 'sub-1',
          status: 'REVIEWED',
          submittedAt: '2026-08-01T00:00:00.000Z',
          answers: [],
          waterlowMetadata: { score: 22 },
        },
      }),
      fieldRefsFromSeed(COMMUNICATION_CARE_PLAN_SEED),
    );
    expect((communication.composedFrom as Record<string, unknown>).formName).toBe('Communication');
    expect((communication.composedFrom as Record<string, unknown>).mapping).not.toBe('generic');

    const skin = runCarePlanCompose(
      'Skin Integrity',
      ctxWithIa({
        waterlowMetadata: { score: 22 },
        skinIntegritySnapshot: {
          skinTypeIssues: 'Dry, eczema-prone skin',
          emollientsCreams: 'Diprobase BD',
          previousPressureDamage: true,
          creamApplication: 'Apply to arms and legs each morning',
          signsToReport: 'Redness, broken skin, new wounds',
        },
      }),
      fieldRefsFromSeed(SKIN_INTEGRITY_CARE_PLAN_SEED),
    );
    expect((skin.composedFrom as Record<string, unknown>).formName).toBe('Skin Integrity');
    const skinAreaRisk = fieldRefsFromSeed(SKIN_INTEGRITY_CARE_PLAN_SEED).find(
      (f) => f.fieldKey === 'skin_integrity_area_risk',
    )!;
    expect(skin.values[skinAreaRisk.key]).toBeUndefined();
    expect(
      skin.values[
        fieldRefsFromSeed(SKIN_INTEGRITY_CARE_PLAN_SEED).find(
          (f) => f.fieldKey === 'skin_integrity_skin_type_issues',
        )!.key
      ],
    ).toBeUndefined();
  });

  it('still routes unrelated forms through generic compose', () => {
    const result = runCarePlanCompose('Social Activities', emptyCtx(), []);
    expect((result.composedFrom as Record<string, unknown>).mapping).toBe('generic');
  });

  it('maps the three clinical labels (AUTO disabled in Phase 1)', () => {
    expect(PRESSURE_ULCER_CARE_PLAN_FIELD_MAPPINGS.map((m) => m.fieldLabel)).toEqual([
      'Waterlow or risk score',
      'Existing pressure areas or wounds',
      'Pressure relieving equipment',
    ]);
  });
});

describe('Pressure Ulcer documentation registry', () => {
  it('documents zero auto-prefill fields, seven suggestions, and ten manual fields', () => {
    expect(PRESSURE_ULCER_FIELD_REGISTRY).toHaveLength(17);
    expect(PRESSURE_ULCER_AUTO_PREFILL_KEYS).toEqual([]);
    expect(PRESSURE_ULCER_SUGGESTION_KEYS).toEqual([
      'pressure_ulcer_waterlow_risk_score',
      'pressure_ulcer_existing_areas_wounds',
      'pressure_ulcer_relieving_equipment',
      'pressure_ulcer_service_user_needs',
      'pressure_ulcer_needs_person_centred',
      'pressure_ulcer_desired_goals_outcomes',
      'pressure_ulcer_support_required',
    ]);
    expect(PRESSURE_ULCER_MANUAL_KEYS).toEqual([
      ...MANUAL_LOCAL_KEYS,
      'pressure_ulcer_area_risk',
      'pressure_ulcer_risk_identify',
      'pressure_ulcer_risk_who_might_be_harmed',
      'pressure_ulcer_risk_level',
      'pressure_ulcer_risk_likelihood',
      'pressure_ulcer_risk_triggers',
      'pressure_ulcer_risk_management',
    ]);
  });

  it('records the area-risk gate as manual (not driven by Waterlow)', () => {
    const entry = pressureUlcerFieldRegistryEntry('pressure_ulcer_area_risk');
    expect(entry?.mode).toBe('MANUAL');
    expect(entry?.sources[0]?.notes ?? '').toMatch(/Waterlow|Pressure ulcer risk/i);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertPressureUlcerRegistryMatchesTemplate()).not.toThrow();
  });
});
