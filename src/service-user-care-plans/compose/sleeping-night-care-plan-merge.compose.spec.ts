import { SLEEPING_NIGHT_CARE_PLAN_SEED } from '../../../prisma/seeds/sleeping-night-care-plan.seed-data';
import { PERSON_CENTRED_CARE_PLAN_SEED } from '../../../prisma/seeds/person-centred-care-plan.seed-data';
import { PRESSURE_ULCER_CARE_PLAN_SEED } from '../../../prisma/seeds/pressure-ulcer-care-plan.seed-data';
import { CARE_PLAN_FORM_SEEDS } from '../../../prisma/seeds/care-plan-forms.seed-data';
import {
  SLEEPING_NIGHT_FIELD_REGISTRY,
  SLEEPING_NIGHT_AUTO_PREFILL_KEYS,
  SLEEPING_NIGHT_MANUAL_KEYS,
  SLEEPING_NIGHT_SUGGESTION_KEYS,
  sleepingNightFieldRegistryEntry,
  assertSleepingNightRegistryMatchesTemplate,
} from './sleeping-night-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import { SLEEPING_NIGHT_CARE_PLAN_FIELD_MAPPINGS } from './sleeping-night-care-plan.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

const SLEEPING_NIGHT_FORM_NAME = 'Sleeping and Night';

const ALL_KEYS = SLEEPING_NIGHT_CARE_PLAN_SEED.sections.flatMap((s) =>
  s.fields.map((f) => f.fieldKey as string),
);

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

function snFields(): CarePlanFormFieldRef[] {
  return fieldRefsFromSeed(SLEEPING_NIGHT_CARE_PLAN_SEED);
}

function keyOf(fieldKey: string): string {
  return snFields().find((f) => f.fieldKey === fieldKey)!.key;
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
    sectionNumber: partial.sectionNumber ?? 10,
    sectionTitle: partial.sectionTitle ?? 'Mental Health',
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

function ctxWithSleepSources(): CarePlanComposeContext {
  return emptyCtx({
    aboutMe: {
      nightSupport: 'Nightlight and a warm drink',
      routineSummary: 'Mon bedtime: 21:00 — personal care then bed',
    },
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers: [
        iaAnswer({
          fieldKey: 'sleepingPattern',
          specRef: '10.4',
          questionText: 'Sleeping pattern',
          selectedOptions: ['Sleeps 4 to 6 hours a night'],
        }),
        iaAnswer({
          specRef: '10.4',
          questionText: 'Sleeping pattern concern?',
          booleanValue: true,
        }),
        iaAnswer({
          specRef: '10.10',
          questionText: 'Sleep medication prescribed or OTC?',
          booleanValue: true,
        }),
        iaAnswer({
          specRef: '1.4',
          questionText: 'Morning, meal, evening and bedtime routine',
          textValue: 'Up at 7, tea at 21:00, bed at 22:00',
        }),
      ],
    },
  });
}

describe('Sleeping and Night compose is fully MANUAL', () => {
  it('never auto-prefills any field from IA sleep sources, About Me, or similar-sounding answers', () => {
    const result = runCarePlanCompose(SLEEPING_NIGHT_FORM_NAME, ctxWithSleepSources(), snFields());
    expect(Object.keys(result.values)).toHaveLength(0);
    for (const key of ALL_KEYS) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });

  it('does not drive area risk from sleeping-pattern-concern', () => {
    const result = runCarePlanCompose(SLEEPING_NIGHT_FORM_NAME, ctxWithSleepSources(), snFields());
    expect(result.values[keyOf('sleeping_night_area_risk')]).toBeUndefined();
    expect(sleepingNightFieldRegistryEntry('sleeping_night_area_risk')?.mode).toBe('MANUAL');
  });

  it('does not duplicate Person Centred evening/bedtime from §1.4 or nightSupport', () => {
    const sleeping = runCarePlanCompose(SLEEPING_NIGHT_FORM_NAME, ctxWithSleepSources(), snFields());
    expect(sleeping.values[keyOf('sleeping_night_evening_routine')]).toBeUndefined();

    const personCentred = runCarePlanCompose(
      'Person Centred care plan',
      ctxWithSleepSources(),
      fieldRefsFromSeed(PERSON_CENTRED_CARE_PLAN_SEED),
    );
    const evening = fieldRefsFromSeed(PERSON_CENTRED_CARE_PLAN_SEED).find(
      (f) => f.fieldKey === 'person_centred_evening_routine',
    );
    expect(evening).toBeDefined();
    expect(personCentred.values[evening!.key]).toBeTruthy();
  });
});

describe('Sleeping and Night compose dispatch', () => {
  it('no longer uses the generic compose mapping', () => {
    const result = runCarePlanCompose(SLEEPING_NIGHT_FORM_NAME, emptyCtx(), snFields());
    expect((result.composedFrom as Record<string, unknown>).mapping).not.toBe('generic');
    expect((result.composedFrom as Record<string, unknown>).formName).toBe('Sleeping and Night');
  });

  it('does not create a second Sleeping and Night form in the seed catalogue', () => {
    const names = Object.keys(CARE_PLAN_FORM_SEEDS).filter((n) => n.toLowerCase().includes('sleeping'));
    expect(names).toEqual(['Sleeping and Night']);
  });

  it('leaves Pressure Ulcer on its dedicated engine', () => {
    const result = runCarePlanCompose(
      'Pressure Ulcer',
      emptyCtx(),
      fieldRefsFromSeed(PRESSURE_ULCER_CARE_PLAN_SEED),
    );
    expect((result.composedFrom as Record<string, unknown>).formName).toBe('Pressure Ulcer');
  });

  it('still routes unrelated forms through generic compose', () => {
    const result = runCarePlanCompose('Social Activities', emptyCtx(), []);
    expect((result.composedFrom as Record<string, unknown>).mapping).toBe('generic');
  });

  it('has an empty AUTO-PREFILL mapping set', () => {
    expect(SLEEPING_NIGHT_CARE_PLAN_FIELD_MAPPINGS).toEqual([]);
  });
});

describe('Sleeping and Night documentation registry', () => {
  it('documents zero auto-prefill, four suggestions, and thirteen manual fields', () => {
    expect(SLEEPING_NIGHT_FIELD_REGISTRY).toHaveLength(17);
    expect(SLEEPING_NIGHT_AUTO_PREFILL_KEYS).toEqual([]);
    expect(SLEEPING_NIGHT_SUGGESTION_KEYS).toHaveLength(4);
    expect(SLEEPING_NIGHT_MANUAL_KEYS).toHaveLength(13);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertSleepingNightRegistryMatchesTemplate()).not.toThrow();
  });
});
