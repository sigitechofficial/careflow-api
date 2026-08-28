import {
  COGNITION_BEHAVIOUR_CARE_PLAN_SEED,
  COGNITION_BEHAVIOUR_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  COGNITION_ORIENTATION_OPTIONS,
} from '../../../prisma/seeds/cognition-behaviour-care-plan.seed-data';
import {
  COG_FIELD_REGISTRY,
  COG_AUTO_PREFILL_KEYS,
  COG_MANUAL_KEYS,
  COG_SUGGESTION_KEYS,
  cogFieldRegistryEntry,
  assertCogRegistryMatchesTemplate,
} from './cognition-behaviour-care-plan-field-registry';
import {
  composeCognitionBehaviourCarePlan,
  COGNITION_BEHAVIOUR_CARE_PLAN_FORM_NAME,
} from './cognition-behaviour-care-plan.compose';
import { runCarePlanCompose } from './compose-context.loader';
import { HOME_CARE_PLAN_SEED } from '../../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../../prisma/seeds/home-support-plan.seed-data';
import { ADVANCE_CARE_PLAN_SEED } from '../../../prisma/seeds/advance-care-plan.seed-data';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

// --------------------------------------------------------------------------
// Real Initial Assessment §10.6 / §10.6a cognition & behaviour questions,
// taken verbatim from the seeded enterprise catalogue.
// --------------------------------------------------------------------------

const IA_COGNITIVE_IMPAIRMENT_FIELD_KEY = 'cognitiveImpairment';
const IA_10_6_SPEC = '10.6';
const IA_10_6A_SPEC = '10.6a';

const IA_Q_DIAGNOSED_DEMENTIA = 'Diagnosed dementia?';
const IA_Q_LEARNING_DISABILITY = 'Learning disability?';
const IA_Q_BRAIN_INJURY = 'Ever had a brain injury?';
const IA_Q_AGITATED_WITH_CHANGE = 'Gets agitated with change?';
const IA_Q_CHALLENGING_BEHAVIOUR = 'Challenging behaviour or agitation with change?';
const IA_Q_FULLY_ORIENTATED = 'Fully orientated?';
const IA_Q_DE_ORIENTATED = 'De-orientated?';

const SECTION_ID = 'cog-sec';

function seedFieldKeys(): string[] {
  return COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections.flatMap((s) =>
    s.fields.map((f) => f.fieldKey as string),
  );
}

function seedField(fieldKey: string) {
  for (const section of COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections) {
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
    sectionNumber: 10,
    sectionTitle: 'Emotional health and cognition',
    ...overrides,
  } as SubmissionAnswerForRules;
}

function impairmentAnswer(code: 'none' | 'mild' | 'moderate' | 'severe'): SubmissionAnswerForRules {
  return answer({
    questionText: 'Cognitive impairment level',
    fieldKey: IA_COGNITIVE_IMPAIRMENT_FIELD_KEY,
    specRef: IA_10_6_SPEC,
    selectedOptions: [code],
  } as Partial<SubmissionAnswerForRules>);
}

function yesNo10_6a(questionText: string, value: boolean): SubmissionAnswerForRules {
  return answer({
    questionText,
    specRef: IA_10_6A_SPEC,
    booleanValue: value,
  } as Partial<SubmissionAnswerForRules>);
}

function ctxWithAnswers(answers: SubmissionAnswerForRules[]): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers,
    },
  } as unknown as CarePlanComposeContext;
}

function suggestionFor(
  result: ReturnType<typeof composeCognitionBehaviourCarePlan>,
  fieldKey: string,
) {
  const ref = fieldRefsFromSeed().find((f) => f.fieldKey === fieldKey);
  return result.suggestions?.find((s) => s.targetFieldKey === ref?.key);
}

// --------------------------------------------------------------------------
// 1 — "Diagnosis or cognitive concern" suggestion (IA §10.6 / §10.6a)
// --------------------------------------------------------------------------

describe('Diagnosis or cognitive concern suggestion', () => {
  it('assembles the graded impairment level and positive diagnosis flags', () => {
    const ctx = ctxWithAnswers([
      impairmentAnswer('moderate'),
      yesNo10_6a(IA_Q_DIAGNOSED_DEMENTIA, true),
      yesNo10_6a(IA_Q_LEARNING_DISABILITY, false),
      yesNo10_6a(IA_Q_BRAIN_INJURY, true),
    ]);

    const suggestion = suggestionFor(
      composeCognitionBehaviourCarePlan(ctx, fieldRefsFromSeed(), 'su-1'),
      'cog_diagnosis_or_concern',
    );

    expect(suggestion).toBeDefined();
    expect(suggestion?.suggestedValue).toContain('Moderate cognitive impairment');
    expect(suggestion?.suggestedValue).toContain('Diagnosed dementia');
    expect(suggestion?.suggestedValue).toContain('History of brain injury');
    // Learning disability was "No" — it must not appear.
    expect(suggestion?.suggestedValue).not.toContain('Learning disability');
    expect(suggestion?.sourceType).toBe('INITIAL_ASSESSMENT');
  });

  it('skips "none" impairment and produces nothing when there are no positive findings', () => {
    const ctx = ctxWithAnswers([
      impairmentAnswer('none'),
      yesNo10_6a(IA_Q_DIAGNOSED_DEMENTIA, false),
      yesNo10_6a(IA_Q_LEARNING_DISABILITY, false),
      yesNo10_6a(IA_Q_BRAIN_INJURY, false),
    ]);

    const suggestion = suggestionFor(
      composeCognitionBehaviourCarePlan(ctx, fieldRefsFromSeed(), 'su-1'),
      'cog_diagnosis_or_concern',
    );

    expect(suggestion).toBeUndefined();
  });

  it('carries provenance back to the source IA questions', () => {
    const ctx = ctxWithAnswers([
      impairmentAnswer('severe'),
      yesNo10_6a(IA_Q_DIAGNOSED_DEMENTIA, true),
    ]);
    const suggestion = suggestionFor(
      composeCognitionBehaviourCarePlan(ctx, fieldRefsFromSeed(), 'su-1'),
      'cog_diagnosis_or_concern',
    );

    const refs = suggestion?.sourceQuestions ?? [];
    expect(refs.length).toBe(2);
    expect(refs.some((r) => r.questionFieldKey === IA_COGNITIVE_IMPAIRMENT_FIELD_KEY)).toBe(true);
    expect(refs.some((r) => r.sourceLabel === IA_Q_DIAGNOSED_DEMENTIA)).toBe(true);
    expect(suggestion?.submissionId).toBe('sub-1');
  });
});

// --------------------------------------------------------------------------
// 2 — "Known triggers" suggestion (IA §10.6a change-related behaviour)
// --------------------------------------------------------------------------

describe('Known triggers suggestion', () => {
  it('is produced from the change-related behaviour questions when Yes', () => {
    const ctx = ctxWithAnswers([
      yesNo10_6a(IA_Q_AGITATED_WITH_CHANGE, true),
      yesNo10_6a(IA_Q_CHALLENGING_BEHAVIOUR, true),
    ]);

    const suggestion = suggestionFor(
      composeCognitionBehaviourCarePlan(ctx, fieldRefsFromSeed(), 'su-1'),
      'cog_known_triggers',
    );

    expect(suggestion).toBeDefined();
    expect(suggestion?.suggestedValue).toContain('agitated with change');
    expect(suggestion?.suggestedValue).toContain('Challenging behaviour or agitation with change');
    expect(suggestion?.sourceQuestions?.[0]?.specRef).toBe(IA_10_6A_SPEC);
  });

  it('produces nothing when both change questions are No', () => {
    const ctx = ctxWithAnswers([
      yesNo10_6a(IA_Q_AGITATED_WITH_CHANGE, false),
      yesNo10_6a(IA_Q_CHALLENGING_BEHAVIOUR, false),
    ]);
    expect(
      suggestionFor(
        composeCognitionBehaviourCarePlan(ctx, fieldRefsFromSeed(), 'su-1'),
        'cog_known_triggers',
      ),
    ).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// 3 — suggestions go into suggestions[], never values
// --------------------------------------------------------------------------

describe('suggestions are never auto-filled', () => {
  it('writes nothing into values even when both suggestions fire', () => {
    const ctx = ctxWithAnswers([
      impairmentAnswer('mild'),
      yesNo10_6a(IA_Q_DIAGNOSED_DEMENTIA, true),
      yesNo10_6a(IA_Q_AGITATED_WITH_CHANGE, true),
    ]);
    const result = composeCognitionBehaviourCarePlan(ctx, fieldRefsFromSeed(), 'su-1');

    expect(result.suggestions).toHaveLength(2);
    expect(result.values).toEqual({});
    expect(result.fieldSources ?? {}).toEqual({});
  });

  it('leaves the target fields themselves unset in values', () => {
    const ctx = ctxWithAnswers([
      impairmentAnswer('moderate'),
      yesNo10_6a(IA_Q_AGITATED_WITH_CHANGE, true),
    ]);
    const result = composeCognitionBehaviourCarePlan(ctx, fieldRefsFromSeed(), 'su-1');
    const diagnosis = fieldRefsFromSeed().find((f) => f.fieldKey === 'cog_diagnosis_or_concern');
    const triggers = fieldRefsFromSeed().find((f) => f.fieldKey === 'cog_known_triggers');

    expect(result.values[diagnosis!.key]).toBeUndefined();
    expect(result.values[triggers!.key]).toBeUndefined();
  });

  it('declares no auto-prefill fields at all', () => {
    expect(COG_AUTO_PREFILL_KEYS).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 4 — manual fields never receive suggestions
// --------------------------------------------------------------------------

describe('manual fields stay manual', () => {
  it('never suggests anything for the twelve manual fields, even with a full assessment', () => {
    const ctx = ctxWithAnswers([
      impairmentAnswer('moderate'),
      yesNo10_6a(IA_Q_DIAGNOSED_DEMENTIA, true),
      yesNo10_6a(IA_Q_LEARNING_DISABILITY, true),
      yesNo10_6a(IA_Q_BRAIN_INJURY, true),
      yesNo10_6a(IA_Q_AGITATED_WITH_CHANGE, true),
      yesNo10_6a(IA_Q_CHALLENGING_BEHAVIOUR, true),
      // Orientation booleans must NOT flow into the orientation SELECT.
      yesNo10_6a(IA_Q_FULLY_ORIENTATED, false),
      yesNo10_6a(IA_Q_DE_ORIENTATED, true),
      // General IA content that must not be mapped on wording similarity.
      answer({ fieldKey: 'supportGoals', questionText: 'Support to achieve?', textValue: 'Stay home' }),
      answer({ fieldKey: 'whatMattersMost', questionText: 'What matters most?', textValue: 'Family' }),
      answer({ questionText: 'Any risk identified?', booleanValue: true }),
    ]);

    const result = composeCognitionBehaviourCarePlan(ctx, fieldRefsFromSeed(), 'su-1');

    for (const key of COG_MANUAL_KEYS) {
      expect(suggestionFor(result, key)).toBeUndefined();
    }
    // Only the two approved suggestion fields fire.
    expect(result.suggestions).toHaveLength(2);
    expect(result.values).toEqual({});
  });

  it('registers every manual field with a recorded reason', () => {
    for (const key of COG_MANUAL_KEYS) {
      const entry = cogFieldRegistryEntry(key);
      expect(entry?.mode).toBe('MANUAL');
      expect(entry?.sources[0]?.notes ?? '').not.toHaveLength(0);
    }
  });

  it('keeps orientation manual because the IA options are incompatible', () => {
    expect(cogFieldRegistryEntry('cog_orientation')?.mode).toBe('MANUAL');
  });
});

// --------------------------------------------------------------------------
// 5 — empty / missing IA produces no suggestion
// --------------------------------------------------------------------------

describe('no suggestion without evidence', () => {
  it('produces nothing when the assessment has no answers', () => {
    const result = composeCognitionBehaviourCarePlan(ctxWithAnswers([]), fieldRefsFromSeed(), 'su-1');
    expect(result.suggestions ?? []).toHaveLength(0);
  });

  it('produces nothing when there is no assessment at all', () => {
    const result = composeCognitionBehaviourCarePlan(
      { serviceUserId: 'su-1', ia: null } as unknown as CarePlanComposeContext,
      fieldRefsFromSeed(),
      'su-1',
    );
    expect(result.suggestions ?? []).toHaveLength(0);
    expect(result.values).toEqual({});
  });
});

// --------------------------------------------------------------------------
// 6 — merged template: existing local fields + Care 2020 fields
// --------------------------------------------------------------------------

describe('merged Cognition and Behaviour template', () => {
  it('has twelve unique fields across three sections', () => {
    const keys = seedFieldKeys();
    expect(keys).toHaveLength(12);
    expect(new Set(keys).size).toBe(12);
    expect(COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Cognition',
      'Behaviour support',
      'Needs, goals, support and risk',
    ]);
  });

  it('retains the seven original local fields, types and options', () => {
    for (const key of Object.values(COGNITION_BEHAVIOUR_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(seedFieldKeys()).toContain(key);
    }
    expect(seedField('cog_diagnosis_or_concern')?.fieldType).toBe('TEXTAREA');
    expect(seedField('cog_orientation')?.fieldType).toBe('SELECT');
    expect(seedField('cog_orientation')?.options).toEqual(COGNITION_ORIENTATION_OPTIONS);
    expect(seedField('cog_memory_prompts')?.fieldType).toBe('TEXT');
    expect(seedField('cog_calming_strategies')?.required).toBe(true);
    expect(seedField('cog_wandering_risk')?.fieldType).toBe('YES_NO');
  });

  it('adds the five Care 2020 needs / goals / support / risk fields', () => {
    for (const key of [
      'cog_service_user_needs',
      'cog_needs_person_centred',
      'cog_desired_goals_outcomes',
      'cog_support_required',
      'cog_area_risk',
    ]) {
      expect(seedFieldKeys()).toContain(key);
    }
    expect(seedField('cog_area_risk')?.fieldType).toBe('YES_NO');
  });

  it('exposes exactly two suggestions and twelve manual fields', () => {
    expect(COG_SUGGESTION_KEYS).toEqual(['cog_diagnosis_or_concern', 'cog_known_triggers']);
    expect(COG_MANUAL_KEYS).toHaveLength(10);
    expect(COG_FIELD_REGISTRY).toHaveLength(12);
  });

  it('keeps the registry and the template in lockstep', () => {
    expect(() => assertCogRegistryMatchesTemplate()).not.toThrow();
  });
});

// --------------------------------------------------------------------------
// 7 — dispatch and isolation from other care plans
// --------------------------------------------------------------------------

describe('compose dispatch and isolation', () => {
  it('routes the Cognition and Behaviour form name to its composer', () => {
    expect(COGNITION_BEHAVIOUR_CARE_PLAN_FORM_NAME).toBe('Cognition and Behaviour');

    const ctx = ctxWithAnswers([impairmentAnswer('moderate')]);
    const result = runCarePlanCompose(COGNITION_BEHAVIOUR_CARE_PLAN_FORM_NAME, ctx, fieldRefsFromSeed());

    expect(result.composedFrom?.mapping).toBe('cognition-behaviour-care-plan-suggestions');
    expect(result.values).toEqual({});
  });

  it('does not overlap keys with Home Care, Home Support or Advance plans', () => {
    const hcp = HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const hsp = HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const acp = ADVANCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));

    expect(hcp).toHaveLength(36);
    expect(hsp).toHaveLength(45);
    expect(acp).toHaveLength(11);

    const others = new Set([...hcp, ...hsp, ...acp]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
