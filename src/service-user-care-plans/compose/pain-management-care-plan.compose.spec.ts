import {
  PAIN_MANAGEMENT_CARE_PLAN_SEED,
  PAIN_MANAGEMENT_CARE_PLAN_LEGACY_LABEL_TO_KEY,
} from '../../../prisma/seeds/pain-management-care-plan.seed-data';
import {
  PAIN_FIELD_REGISTRY,
  PAIN_AUTO_PREFILL_KEYS,
  PAIN_MANUAL_KEYS,
  PAIN_SUGGESTION_KEYS,
  painFieldRegistryEntry,
  assertPainRegistryMatchesTemplate,
} from './pain-management-care-plan-field-registry';
import {
  composePainManagementCarePlan,
  PAIN_MANAGEMENT_CARE_PLAN_FORM_NAME,
} from './pain-management-care-plan.compose';
import { runCarePlanCompose } from './compose-context.loader';
import { MOBILITY_CARE_PLAN_SEED } from '../../../prisma/seeds/mobility-care-plan.seed-data';
import { MEDICATION_CARE_PLAN_SEED } from '../../../prisma/seeds/medication-care-plan.seed-data';
import { FALLS_CARE_PLAN_SEED } from '../../../prisma/seeds/falls-care-plan.seed-data';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

// Real IA §5.3 pain questions, verbatim from the seeded catalogue.
const IA_Q_PAIN_SCORE = 'Pain score (0-10)';
const IA_Q_PAIN_LOCATION = 'Pain location';
const IA_Q_PAIN_TRIGGER = 'Pain trigger / aggravating factors';
const IA_Q_CURRENT_RELIEF = 'Current pain relief';

const SECTION_ID = 'pain-sec';

function seedFieldKeys(): string[] {
  return PAIN_MANAGEMENT_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of PAIN_MANAGEMENT_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  return seedFieldKeys().map((fieldKey, index) => ({
    key: `${SECTION_ID}:field-${index}`,
    sectionId: SECTION_ID,
    fieldId: `field-${index}`,
    fieldKey,
    label: seedField(fieldKey)?.label ?? fieldKey,
    fieldType: seedField(fieldKey)?.fieldType ?? 'TEXTAREA',
    required: seedField(fieldKey)?.required ?? false,
  })) as CarePlanFormFieldRef[];
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
    sectionNumber: 5,
    sectionTitle: 'Breathing, Distress/Pain & Swallowing',
    ...overrides,
  } as SubmissionAnswerForRules;
}

function fullPainAnswers(scoreValue = 7): SubmissionAnswerForRules[] {
  return [
    answer({ questionText: IA_Q_PAIN_SCORE, specRef: '5.3', numberValue: scoreValue }),
    answer({ questionText: IA_Q_PAIN_LOCATION, specRef: '5.3', textValue: 'Lower back, radiating to left hip' }),
    answer({ questionText: IA_Q_PAIN_TRIGGER, specRef: '5.3', textValue: 'Worse on movement and in the mornings' }),
    answer({ questionText: IA_Q_CURRENT_RELIEF, specRef: '5.3', textValue: 'Paracetamol 1g QDS; heat pad' }),
  ];
}

function ctxWith(answers: SubmissionAnswerForRules[] | null): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    ia: answers
      ? { submissionId: 'sub-1', status: 'REVIEWED', submittedAt: '2026-08-01T00:00:00.000Z', answers }
      : null,
  } as unknown as CarePlanComposeContext;
}

function suggestionFor(result: ReturnType<typeof composePainManagementCarePlan>, fieldKey: string) {
  const ref = fieldRefsFromSeed().find((f) => f.fieldKey === fieldKey);
  return result.suggestions?.find((s) => s.targetFieldKey === ref?.key);
}

// --------------------------------------------------------------------------
// 1 — the four approved §5.3 suggestions
// --------------------------------------------------------------------------

describe('Pain Management IA suggestions', () => {
  it('usual pain score comes from §5.3 "Pain score (0-10)" as a number', () => {
    const s = suggestionFor(
      composePainManagementCarePlan(ctxWith(fullPainAnswers(7)), fieldRefsFromSeed(), 'su-1'),
      'pain_management_usual_pain_score',
    );
    expect(s?.suggestedValue).toBe('7');
    expect(s?.sourceQuestions?.[0]?.sourceLabel).toBe(IA_Q_PAIN_SCORE);
    expect(s?.sourceQuestions?.[0]?.specRef).toBe('5.3');
  });

  it('suggests a pain score of 0 (a valid value, not treated as empty)', () => {
    const s = suggestionFor(
      composePainManagementCarePlan(ctxWith(fullPainAnswers(0)), fieldRefsFromSeed(), 'su-1'),
      'pain_management_usual_pain_score',
    );
    expect(s?.suggestedValue).toBe('0');
  });

  it('site comes from §5.3 "Pain location" (site only)', () => {
    const s = suggestionFor(
      composePainManagementCarePlan(ctxWith(fullPainAnswers()), fieldRefsFromSeed(), 'su-1'),
      'pain_management_site_and_character',
    );
    expect(s?.suggestedValue).toBe('Lower back, radiating to left hip');
  });

  it('what-worsens comes from §5.3 "Pain trigger / aggravating factors"', () => {
    const s = suggestionFor(
      composePainManagementCarePlan(ctxWith(fullPainAnswers()), fieldRefsFromSeed(), 'su-1'),
      'pain_management_worsens_relieves',
    );
    expect(s?.suggestedValue).toBe('Worse on movement and in the mornings');
  });

  it('regular analgesia comes from §5.3 "Current pain relief"', () => {
    const s = suggestionFor(
      composePainManagementCarePlan(ctxWith(fullPainAnswers()), fieldRefsFromSeed(), 'su-1'),
      'pain_management_regular_analgesia',
    );
    expect(s?.suggestedValue).toBe('Paracetamol 1g QDS; heat pad');
    expect(s?.sourceQuestions?.[0]?.sourceLabel).toBe(IA_Q_CURRENT_RELIEF);
  });

  it('produces exactly four suggestions on a full §5.3 assessment', () => {
    const result = composePainManagementCarePlan(ctxWith(fullPainAnswers()), fieldRefsFromSeed(), 'su-1');
    expect(result.suggestions).toHaveLength(4);
    expect(result.suggestions?.every((s) => s.sourceType === 'INITIAL_ASSESSMENT')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 2 — suggestions never auto-fill values
// --------------------------------------------------------------------------

describe('suggestions are never auto-filled', () => {
  it('writes nothing into values even with a full assessment', () => {
    const result = composePainManagementCarePlan(ctxWith(fullPainAnswers()), fieldRefsFromSeed(), 'su-1');
    expect(result.values).toEqual({});
    expect(result.fieldSources ?? {}).toEqual({});
  });

  it('leaves each suggested field unset in values', () => {
    const result = composePainManagementCarePlan(ctxWith(fullPainAnswers()), fieldRefsFromSeed(), 'su-1');
    for (const key of PAIN_SUGGESTION_KEYS) {
      const ref = fieldRefsFromSeed().find((f) => f.fieldKey === key);
      expect(result.values[ref!.key]).toBeUndefined();
    }
  });

  it('declares no auto-prefill fields at all', () => {
    expect(PAIN_AUTO_PREFILL_KEYS).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 3 — manual fields never receive suggestions
// --------------------------------------------------------------------------

describe('manual fields stay manual', () => {
  it('never suggests any of the ten manual fields, even with a full assessment', () => {
    const ctx = ctxWith([
      ...fullPainAnswers(),
      // Generic content that must not be mapped onto Care 2020 / non-pharmacological fields.
      answer({ questionText: 'What matters most?', textValue: 'Comfort', fieldKey: 'whatMattersMost' }),
      answer({ questionText: 'Pain management plan documented?', specRef: '5.3', booleanValue: true }),
    ]);
    const result = composePainManagementCarePlan(ctx, fieldRefsFromSeed(), 'su-1');

    for (const key of PAIN_MANUAL_KEYS) {
      expect(suggestionFor(result, key)).toBeUndefined();
    }
    expect(result.suggestions).toHaveLength(4);
    expect(result.values).toEqual({});
  });

  it('keeps the NRS toggle, non-pharmacological methods and when-to-call-GP manual', () => {
    expect(painFieldRegistryEntry('pain_management_nrs_needed')?.mode).toBe('MANUAL');
    expect(painFieldRegistryEntry('pain_management_non_pharmacological')?.mode).toBe('MANUAL');
    expect(painFieldRegistryEntry('pain_management_when_to_call_gp')?.mode).toBe('MANUAL');
  });

  it('registers every manual field with a recorded reason', () => {
    for (const key of PAIN_MANUAL_KEYS) {
      const entry = painFieldRegistryEntry(key);
      expect(entry?.mode).toBe('MANUAL');
      expect(entry?.sources[0]?.notes ?? '').not.toHaveLength(0);
    }
  });
});

// --------------------------------------------------------------------------
// 4 — empty / missing IA
// --------------------------------------------------------------------------

describe('no suggestion without evidence', () => {
  it('produces nothing when the assessment has no answers', () => {
    const result = composePainManagementCarePlan(ctxWith([]), fieldRefsFromSeed(), 'su-1');
    expect(result.suggestions ?? []).toHaveLength(0);
  });

  it('produces nothing when there is no assessment at all', () => {
    const result = composePainManagementCarePlan(
      { serviceUserId: 'su-1', ia: null } as unknown as CarePlanComposeContext,
      fieldRefsFromSeed(),
      'su-1',
    );
    expect(result.suggestions ?? []).toHaveLength(0);
    expect(result.values).toEqual({});
  });

  it.each([null, '', '   '])('skips a blank pain-location answer (%p)', (text) => {
    const ctx = ctxWith([answer({ questionText: IA_Q_PAIN_LOCATION, specRef: '5.3', textValue: text })]);
    const result = composePainManagementCarePlan(ctx, fieldRefsFromSeed(), 'su-1');
    expect(suggestionFor(result, 'pain_management_site_and_character')).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// 5 — merged template shape
// --------------------------------------------------------------------------

describe('merged Pain Management template', () => {
  it('has twelve unique fields across three sections', () => {
    const keys = seedFieldKeys();
    expect(keys).toHaveLength(18);
    expect(new Set(keys).size).toBe(18);
    expect(PAIN_MANAGEMENT_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Pain profile',
      'Management',
      'Needs, goals, support and risk',
    ]);
  });

  it('retains the six original local fields, types and required flags', () => {
    for (const key of Object.values(PAIN_MANAGEMENT_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(seedFieldKeys()).toContain(key);
    }
    expect(seedField('pain_management_usual_pain_score')?.fieldType).toBe('NUMBER');
    expect(seedField('pain_management_non_pharmacological')?.required).toBe(true);
  });

  it('adds the six Care 2020 fields, NRS toggle first', () => {
    const care2020 = PAIN_MANAGEMENT_CARE_PLAN_SEED.sections[2].fields.map((f) => f.fieldKey);
    expect(care2020[0]).toBe('pain_management_nrs_needed');
    expect(care2020).toContain('pain_management_area_risk');
    expect(care2020[care2020.length - 1]).toBe('pain_management_risk_management');
    expect(care2020).toHaveLength(12);
    expect(seedField('pain_management_nrs_needed')?.fieldType).toBe('YES_NO');
    expect(seedField('pain_management_area_risk')?.fieldType).toBe('YES_NO');
  });

  it('exposes exactly four suggestions and ten manual fields', () => {
    expect(PAIN_SUGGESTION_KEYS).toEqual([
      'pain_management_usual_pain_score',
      'pain_management_site_and_character',
      'pain_management_worsens_relieves',
      'pain_management_regular_analgesia',
    ]);
    expect(PAIN_MANUAL_KEYS).toHaveLength(14);
    expect(PAIN_FIELD_REGISTRY).toHaveLength(18);
  });

  it('keeps the registry and the template in lockstep', () => {
    expect(() => assertPainRegistryMatchesTemplate()).not.toThrow();
  });
});

// --------------------------------------------------------------------------
// 6 — dispatch and isolation
// --------------------------------------------------------------------------

describe('compose dispatch and isolation', () => {
  it('routes the Pain Management form name to its composer', () => {
    expect(PAIN_MANAGEMENT_CARE_PLAN_FORM_NAME).toBe('Pain Management');
    const result = runCarePlanCompose(PAIN_MANAGEMENT_CARE_PLAN_FORM_NAME, ctxWith(fullPainAnswers()), fieldRefsFromSeed());
    expect(result.composedFrom?.mapping).toBe('pain-management-care-plan-suggestions');
    expect(result.values).toEqual({});
    expect(result.suggestions).toHaveLength(4);
  });

  it('does not overlap keys with Mobility, Medication or Falls plans', () => {
    const others = new Set([
      ...MOBILITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...MEDICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...FALLS_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
