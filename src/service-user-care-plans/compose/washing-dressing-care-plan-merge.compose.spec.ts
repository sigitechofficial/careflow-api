import { WASHING_DRESSING_CARE_PLAN_SEED } from '../../../prisma/seeds/washing-dressing-care-plan.seed-data';
import { areaRiskFollowUpFieldKeys } from '../../../prisma/seeds/area-risk-follow-up.seed';
import { PERSON_CENTRED_CARE_PLAN_SEED } from '../../../prisma/seeds/person-centred-care-plan.seed-data';
import { CULTURE_RELIGION_CARE_PLAN_SEED } from '../../../prisma/seeds/culture-religion-care-plan.seed-data';
import { HOME_CARE_PLAN_SEED } from '../../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../../prisma/seeds/home-support-plan.seed-data';
import { PRESSURE_ULCER_CARE_PLAN_SEED } from '../../../prisma/seeds/pressure-ulcer-care-plan.seed-data';
import { SLEEPING_NIGHT_CARE_PLAN_SEED } from '../../../prisma/seeds/sleeping-night-care-plan.seed-data';
import { CARE_PLAN_FORM_SEEDS } from '../../../prisma/seeds/care-plan-forms.seed-data';
import {
  WASHING_DRESSING_FIELD_REGISTRY,
  WASHING_DRESSING_AUTO_PREFILL_KEYS,
  WASHING_DRESSING_MANUAL_KEYS,
  WASHING_DRESSING_SUGGESTION_KEYS,
  washingDressingFieldRegistryEntry,
  assertWashingDressingRegistryMatchesTemplate,
} from './washing-dressing-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { WASHING_DRESSING_CARE_PLAN_FIELD_MAPPINGS } from './washing-dressing-care-plan.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

const WASHING_DRESSING_FORM_NAME = 'Washing and dressing';

const ALL_KEYS = WASHING_DRESSING_CARE_PLAN_SEED.sections.flatMap((s) =>
  s.fields.map((f) => f.fieldKey as string),
);

const MANUAL_KEYS = ALL_KEYS.filter((key) => key !== 'washing_dressing_gender_of_carer');

function fieldRefsFromSeed(
  seed: {
    sections: Array<{
      title: string;
      fields: Array<{ fieldKey?: string; label: string; fieldType: string; required?: boolean }>;
    }>;
  },
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

function wdFields(): CarePlanFormFieldRef[] {
  return fieldRefsFromSeed(WASHING_DRESSING_CARE_PLAN_SEED);
}

function keyOf(fieldKey: string): string {
  return wdFields().find((f) => f.fieldKey === fieldKey)!.key;
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
    sectionNumber: partial.sectionNumber ?? 1,
    sectionTitle: partial.sectionTitle ?? 'About me',
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

function distractorAnswers(): SubmissionAnswerForRules[] {
  return [
    iaAnswer({
      specRef: '1.6',
      questionText: 'Staff gender preference for personal care',
      selectedOptions: ['female'],
    }),
    iaAnswer({
      specRef: '1.6',
      questionText: 'Unhappy being supported by a carer of the opposite sex?',
      booleanValue: true,
    }),
    iaAnswer({
      specRef: '1.4',
      questionText: 'Morning, meal, evening and bedtime routine',
      textValue: 'Prefers a shower after breakfast then help with clothes and dentures',
    }),
    iaAnswer({
      fieldKey: 'preferredVisitTimes',
      questionText: 'Preferred visit times',
      textValue: 'Morning visits 08:00–10:00',
    }),
    iaAnswer({
      specRef: '8.1',
      questionText: 'MUST score',
      numberValue: 3,
      textValue: 'MUST 3 — high risk',
    }),
    iaAnswer({
      questionText: 'Oral health concern?',
      booleanValue: true,
    }),
    iaAnswer({
      questionText: 'Dental referral required?',
      booleanValue: true,
    }),
    iaAnswer({
      questionText: 'Continence / oral care notes',
      textValue: 'Needs help with dentures each morning; pads overnight',
    }),
    iaAnswer({
      specRef: '11.1',
      questionText: 'Ulcers or wounds comment',
      textValue: 'Sacral grade 2',
    }),
  ];
}

function ctxWithDistractors(): CarePlanComposeContext {
  return emptyCtx({
    aboutMe: {
      personalCare: 'Needs help washing and dressing; prefers female carers',
      nightSupport: 'Nightlight',
    },
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers: distractorAnswers(),
      waterlowMetadata: { score: 17 },
      adlMetadata: {
        rows: [
          { id: 'bathing', activity: 'Bathing', score: 3, notes: 'Needs full assistance to shower' },
          { id: 'dressing_undressing', activity: 'Dressing', score: 2, notes: 'Supervision with clothes' },
        ],
      },
      skinIntegritySnapshot: {
        skinTypeIssues: 'Dry',
        emollientsCreams: 'Diprobase',
        previousPressureDamage: true,
        creamApplication: 'Apply to arms',
        signsToReport: 'Redness',
      },
    },
  });
}

describe('Washing and dressing AUTO-PREFILL', () => {
  it('maps IA §1.6 staff gender preference SELECT code to its label', () => {
    const result = runCarePlanCompose(WASHING_DRESSING_FORM_NAME, ctxWithDistractors(), wdFields());
    expect(result.values[keyOf('washing_dressing_gender_of_carer')]).toBe('Female');
    expect(washingDressingFieldRegistryEntry('washing_dressing_gender_of_carer')?.mode).toBe('AUTO_PREFILL');
  });

  it('uses the current DOM Care preference over the older assessment answer', () => {
    const base = ctxWithDistractors();
    const ctx = { ...base, profile: { ...(base.profile ?? {}), staffGenderPreference: 'male' } } as CarePlanComposeContext;
    const result = runCarePlanCompose(WASHING_DRESSING_FORM_NAME, ctx, wdFields());
    expect(result.values[keyOf('washing_dressing_gender_of_carer')]).toBe('Male');
  });

  it('maps already-labelled SELECT values through unchanged', () => {
    const result = runCarePlanCompose(
      WASHING_DRESSING_FORM_NAME,
      emptyCtx({
        ia: {
          submissionId: 'sub-1',
          status: 'REVIEWED',
          submittedAt: '2026-08-01T00:00:00.000Z',
          answers: [
            iaAnswer({
              specRef: '1.6',
              questionText: 'Staff gender preference for personal care',
              selectedOptions: ['No preference'],
            }),
          ],
        },
      }),
      wdFields(),
    );
    expect(result.values[keyOf('washing_dressing_gender_of_carer')]).toBe('No preference');
  });

  it('does not fill gender of carer from the opposite-sex YES_NO', () => {
    const result = runCarePlanCompose(
      WASHING_DRESSING_FORM_NAME,
      emptyCtx({
        ia: {
          submissionId: 'sub-1',
          status: 'REVIEWED',
          submittedAt: '2026-08-01T00:00:00.000Z',
          answers: [
            iaAnswer({
              specRef: '1.6',
              questionText: 'Unhappy being supported by a carer of the opposite sex?',
              booleanValue: true,
            }),
          ],
        },
      }),
      wdFields(),
    );
    expect(result.values[keyOf('washing_dressing_gender_of_carer')]).toBeUndefined();
  });
});

describe('Washing and dressing MANUAL fields', () => {
  it('leaves every other field empty despite bathing narrative, ADL, oral options, visit times, MUST, Waterlow, Skin Integrity and Person Centred personalCare', () => {
    const result = runCarePlanCompose(WASHING_DRESSING_FORM_NAME, ctxWithDistractors(), wdFields());
    for (const key of MANUAL_KEYS) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });

  it('does not drive area risk or the six follow-up fields from IA', () => {
    const result = runCarePlanCompose(WASHING_DRESSING_FORM_NAME, ctxWithDistractors(), wdFields());
    expect(result.values[keyOf('washing_dressing_area_risk')]).toBeUndefined();
    expect(washingDressingFieldRegistryEntry('washing_dressing_area_risk')?.mode).toBe('MANUAL');
    for (const key of areaRiskFollowUpFieldKeys('washing_dressing')) {
      expect(result.values[keyOf(key)]).toBeUndefined();
      expect(washingDressingFieldRegistryEntry(key)?.mode).toBe('MANUAL');
    }
  });

  it('does not dump continence / oral care notes into dental / denture care', () => {
    const result = runCarePlanCompose(WASHING_DRESSING_FORM_NAME, ctxWithDistractors(), wdFields());
    expect(result.values[keyOf('washing_dressing_dental_denture_care')]).toBeUndefined();
  });
});

describe('Washing and dressing compose dispatch', () => {
  it('no longer uses the generic compose mapping', () => {
    const result = runCarePlanCompose(WASHING_DRESSING_FORM_NAME, emptyCtx(), wdFields());
    expect((result.composedFrom as Record<string, unknown>).mapping).not.toBe('generic');
    expect((result.composedFrom as Record<string, unknown>).formName).toBe('Washing and dressing');
  });

  it('does not create a second Washing and dressing form in the seed catalogue', () => {
    const names = Object.keys(CARE_PLAN_FORM_SEEDS).filter((n) => n.toLowerCase().includes('washing'));
    expect(names).toEqual(['Washing and dressing']);
  });

  it('maps only the gender field', () => {
    expect(WASHING_DRESSING_CARE_PLAN_FIELD_MAPPINGS.map((m) => m.fieldLabel)).toEqual([
      'Gender of carer preferred',
    ]);
  });

  it('leaves Person Centred, HSP, HCP, Culture/Religion, Pressure Ulcer and Sleeping and Night on their engines', () => {
    const ctx = ctxWithDistractors();
    expect(
      (runCarePlanCompose('Person Centred care plan', ctx, fieldRefsFromSeed(PERSON_CENTRED_CARE_PLAN_SEED))
        .composedFrom as Record<string, unknown>).formName,
    ).toBe('Person Centred care plan');
    expect(
      (runCarePlanCompose('Home Support Plan', ctx, fieldRefsFromSeed(HOME_SUPPORT_PLAN_SEED)).composedFrom as Record<
        string,
        unknown
      >).formName,
    ).toBe('Home Support Plan');
    expect(
      (runCarePlanCompose('Home Care Plan', ctx, fieldRefsFromSeed(HOME_CARE_PLAN_SEED)).composedFrom as Record<
        string,
        unknown
      >).formName,
    ).toBe('Home Care Plan');
    expect(
      (
        runCarePlanCompose(
          'Culture/Religion/Spirituality',
          ctx,
          fieldRefsFromSeed(CULTURE_RELIGION_CARE_PLAN_SEED),
        ).composedFrom as Record<string, unknown>
      ).formName,
    ).toBe('Culture/Religion/Spirituality');
    expect(
      (runCarePlanCompose('Pressure Ulcer', ctx, fieldRefsFromSeed(PRESSURE_ULCER_CARE_PLAN_SEED)).composedFrom as Record<
        string,
        unknown
      >).formName,
    ).toBe('Pressure Ulcer');
    expect(
      (runCarePlanCompose('Sleeping and Night', ctx, fieldRefsFromSeed(SLEEPING_NIGHT_CARE_PLAN_SEED))
        .composedFrom as Record<string, unknown>).formName,
    ).toBe('Sleeping and Night');
  });

  it('does not copy Culture/Religion gender; CRS still suggests the same IA fact', () => {
    const ctx = ctxWithDistractors();
    const washing = runCarePlanCompose(WASHING_DRESSING_FORM_NAME, ctx, wdFields());
    expect(washing.values[keyOf('washing_dressing_gender_of_carer')]).toBe('Female');

    const crsFields = fieldRefsFromSeed(CULTURE_RELIGION_CARE_PLAN_SEED);
    const crs = runCarePlanCompose('Culture/Religion/Spirituality', ctx, crsFields);
    const genderRef = crsFields.find((f) => f.fieldKey === 'crs_gender_preference');
    expect(genderRef).toBeDefined();
    expect(crs.values[genderRef!.key]).toBeUndefined();
    expect(crs.suggestions?.some((s) => s.targetFieldKey === genderRef!.key && s.suggestedValue === 'Female')).toBe(
      true,
    );
  });

  it('still prefills Person Centred personal care from About Me', () => {
    const personCentred = runCarePlanCompose(
      'Person Centred care plan',
      ctxWithDistractors(),
      fieldRefsFromSeed(PERSON_CENTRED_CARE_PLAN_SEED),
    );
    const personalCare = fieldRefsFromSeed(PERSON_CENTRED_CARE_PLAN_SEED).find(
      (f) => f.fieldKey === 'person_centred_personal_care',
    );
    expect(personalCare).toBeDefined();
    expect(personCentred.values[personalCare!.key]).toContain('washing');
  });

  it('still routes unrelated forms through generic compose', () => {
    const result = runCarePlanCompose('Social Activities', emptyCtx(), []);
    expect((result.composedFrom as Record<string, unknown>).mapping).toBe('generic');
  });
});

describe('Washing and dressing documentation registry', () => {
  it('documents one auto-prefill, four suggestions, and twelve manual fields', () => {
    expect(WASHING_DRESSING_FIELD_REGISTRY).toHaveLength(17);
    expect(WASHING_DRESSING_AUTO_PREFILL_KEYS).toEqual(['washing_dressing_gender_of_carer']);
    expect(WASHING_DRESSING_SUGGESTION_KEYS).toEqual([
      'washing_dressing_service_user_needs',
      'washing_dressing_needs_person_centred',
      'washing_dressing_desired_goals_outcomes',
      'washing_dressing_support_required',
    ]);
    expect(WASHING_DRESSING_MANUAL_KEYS).toHaveLength(12);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertWashingDressingRegistryMatchesTemplate()).not.toThrow();
  });
});
