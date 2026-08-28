import {
  ADVANCE_CARE_PLAN_SEED,
  ADVANCE_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  ACP_TREATMENT_ESCALATION_OPTIONS,
} from '../../../prisma/seeds/advance-care-plan.seed-data';
import {
  ACP_FIELD_REGISTRY,
  ACP_AUTO_PREFILL_KEYS,
  ACP_MANUAL_KEYS,
  ACP_SUGGESTION_KEYS,
  acpFieldRegistryEntry,
  assertAcpRegistryMatchesTemplate,
} from './advance-care-plan-field-registry';
import { ACP_ADRT_IA_QUERY } from './advance-care-plan-field-mappings';
import { composeAdvanceCarePlan, ADVANCE_CARE_PLAN_FORM_NAME } from './advance-care-plan.compose';
import { runCarePlanCompose } from './compose-context.loader';
import { HOME_CARE_PLAN_SEED } from '../../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../../prisma/seeds/home-support-plan.seed-data';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

// --------------------------------------------------------------------------
// Real Initial Assessment §13.6 questions.
//
// Both carry NO fieldKey and share specRef "13.6", taken verbatim from the seeded
// catalogue. The gate question must never reach "DNACPR in place".
// --------------------------------------------------------------------------

const IA_13_6_GATE_QUESTION = 'DNACPR or ReSPECT in place?';
const IA_13_6_DETAIL_QUESTION = 'ReSPECT / DNACPR location and summary';
const IA_13_6_SPEC_REF = '13.6';

const SECTION_ID = 'acp-sec';

function seedFieldKeys(): string[] {
  return ADVANCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of ADVANCE_CARE_PLAN_SEED.sections) {
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
    sectionNumber: 13,
    sectionTitle: 'Safeguarding and legal',
    ...overrides,
  } as SubmissionAnswerForRules;
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

/** The §13.6 detail answer, as the assessment actually stores it. */
function adrtDetailAnswer(text: string | null): SubmissionAnswerForRules {
  return answer({
    questionText: IA_13_6_DETAIL_QUESTION,
    specRef: IA_13_6_SPEC_REF,
    textValue: text,
  } as Partial<SubmissionAnswerForRules>);
}

/** The §13.6 yes/no gate answer, which must never populate a care plan field. */
function dnacprGateAnswer(value: boolean): SubmissionAnswerForRules {
  return answer({
    questionText: IA_13_6_GATE_QUESTION,
    specRef: IA_13_6_SPEC_REF,
    booleanValue: value,
  } as Partial<SubmissionAnswerForRules>);
}

function suggestionFor(result: ReturnType<typeof composeAdvanceCarePlan>, fieldKey: string) {
  const ref = fieldRefsFromSeed().find((f) => f.fieldKey === fieldKey);
  return result.suggestions?.find((s) => s.targetFieldKey === ref?.key);
}

// --------------------------------------------------------------------------
// 1 — §13.6 location/summary produces a suggestion
// --------------------------------------------------------------------------

describe('ADRT details suggestion', () => {
  it('is produced from the §13.6 location and summary answer', () => {
    const ctx = ctxWithAnswers([
      adrtDetailAnswer('DNACPR form held in the red folder by the front door. Signed 12 May 2026.'),
    ]);

    const suggestion = suggestionFor(
      composeAdvanceCarePlan(ctx, fieldRefsFromSeed(), 'su-1'),
      'acp_adrt_details',
    );

    expect(suggestion).toBeDefined();
    expect(suggestion?.suggestedValue).toContain('red folder');
    expect(suggestion?.sourceType).toBe('INITIAL_ASSESSMENT');
  });

  it('carries provenance back to the source IA question', () => {
    const ctx = ctxWithAnswers([adrtDetailAnswer('Held with the GP record.')]);
    const suggestion = suggestionFor(
      composeAdvanceCarePlan(ctx, fieldRefsFromSeed(), 'su-1'),
      'acp_adrt_details',
    );

    expect(suggestion?.sourceQuestions?.[0]?.specRef).toBe(IA_13_6_SPEC_REF);
    expect(suggestion?.sourceQuestions?.[0]?.sourceLabel).toBe(IA_13_6_DETAIL_QUESTION);
    expect(suggestion?.submissionId).toBe('sub-1');
  });

  it('narrows on question text, because both §13.6 questions share the spec ref', () => {
    expect(ACP_ADRT_IA_QUERY.specRef).toBe(IA_13_6_SPEC_REF);
    expect(ACP_ADRT_IA_QUERY.questionTextContains).toBe('location and summary');
    expect(IA_13_6_DETAIL_QUESTION.toLowerCase()).toContain(
      ACP_ADRT_IA_QUERY.questionTextContains,
    );
    expect(IA_13_6_GATE_QUESTION.toLowerCase()).not.toContain(
      ACP_ADRT_IA_QUERY.questionTextContains,
    );
  });
});

// --------------------------------------------------------------------------
// 2 — the suggestion goes into suggestions[], not values
// --------------------------------------------------------------------------

describe('suggestion is never auto-filled', () => {
  it('writes nothing into values', () => {
    const ctx = ctxWithAnswers([adrtDetailAnswer('Copy in the care folder.')]);
    const result = composeAdvanceCarePlan(ctx, fieldRefsFromSeed(), 'su-1');

    expect(result.suggestions).toHaveLength(1);
    expect(result.values).toEqual({});
    expect(result.fieldSources ?? {}).toEqual({});
  });

  it('leaves the ADRT field itself unset in values', () => {
    const ctx = ctxWithAnswers([adrtDetailAnswer('Copy in the care folder.')]);
    const result = composeAdvanceCarePlan(ctx, fieldRefsFromSeed(), 'su-1');
    const ref = fieldRefsFromSeed().find((f) => f.fieldKey === 'acp_adrt_details');

    expect(result.values[ref!.key]).toBeUndefined();
  });

  it('declares no auto-prefill fields at all', () => {
    expect(ACP_AUTO_PREFILL_KEYS).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 3 — the §13.6 YES/NO answer does NOT populate "DNACPR in place"
// --------------------------------------------------------------------------

describe('DNACPR in place stays manual', () => {
  it('is not populated or suggested when the IA gate answer is Yes', () => {
    const ctx = ctxWithAnswers([dnacprGateAnswer(true)]);
    const result = composeAdvanceCarePlan(ctx, fieldRefsFromSeed(), 'su-1');
    const ref = fieldRefsFromSeed().find((f) => f.fieldKey === 'acp_dnacpr_in_place');

    expect(suggestionFor(result, 'acp_dnacpr_in_place')).toBeUndefined();
    expect(result.values[ref!.key]).toBeUndefined();
  });

  it('is not populated when the gate is Yes and the detail answer is present', () => {
    const ctx = ctxWithAnswers([
      dnacprGateAnswer(true),
      adrtDetailAnswer('ReSPECT form in the hallway folder.'),
    ]);
    const result = composeAdvanceCarePlan(ctx, fieldRefsFromSeed(), 'su-1');

    // The detail suggestion appears; the boolean field remains untouched.
    expect(suggestionFor(result, 'acp_adrt_details')).toBeDefined();
    expect(suggestionFor(result, 'acp_dnacpr_in_place')).toBeUndefined();
    expect(result.values).toEqual({});
  });

  it('is registered as MANUAL with a recorded reason', () => {
    const entry = acpFieldRegistryEntry('acp_dnacpr_in_place');
    expect(entry?.mode).toBe('MANUAL');
    expect(entry?.sources[0]?.notes ?? '').not.toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 4 — empty / missing IA answer produces no suggestion
// --------------------------------------------------------------------------

describe('no suggestion without evidence', () => {
  it('produces nothing when the assessment has no answers', () => {
    const result = composeAdvanceCarePlan(ctxWithAnswers([]), fieldRefsFromSeed(), 'su-1');
    expect(result.suggestions ?? []).toHaveLength(0);
  });

  it('produces nothing when there is no assessment at all', () => {
    const result = composeAdvanceCarePlan(
      { serviceUserId: 'su-1', ia: null } as unknown as CarePlanComposeContext,
      fieldRefsFromSeed(),
      'su-1',
    );
    expect(result.suggestions ?? []).toHaveLength(0);
    expect(result.values).toEqual({});
  });

  it.each([null, '', '   '])('produces nothing when the answer text is %p', (text) => {
    const ctx = ctxWithAnswers([adrtDetailAnswer(text)]);
    const result = composeAdvanceCarePlan(ctx, fieldRefsFromSeed(), 'su-1');
    expect(suggestionFor(result, 'acp_adrt_details')).toBeUndefined();
  });

  it('produces nothing when only the yes/no gate was answered', () => {
    const ctx = ctxWithAnswers([dnacprGateAnswer(true)]);
    const result = composeAdvanceCarePlan(ctx, fieldRefsFromSeed(), 'su-1');
    expect(result.suggestions ?? []).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 5 — existing Advance Care Plan fields remain unchanged
// --------------------------------------------------------------------------

describe('existing Advance Care Plan fields are unchanged', () => {
  it('still has all eleven fields with their keys', () => {
    const keys = seedFieldKeys();
    expect(keys).toHaveLength(11);
    expect(new Set(keys).size).toBe(11);
  });

  it('retains the seven original local fields, types and options', () => {
    for (const key of Object.values(ADVANCE_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(seedFieldKeys()).toContain(key);
    }
    expect(seedField('acp_discussion_date')?.fieldType).toBe('DATE');
    expect(seedField('acp_capacity_to_participate')?.fieldType).toBe('YES_NO');
    expect(seedField('acp_dnacpr_in_place')?.fieldType).toBe('YES_NO');
    expect(seedField('acp_treatment_escalation')?.options).toEqual(ACP_TREATMENT_ESCALATION_OPTIONS);
    expect(seedField('acp_summary_of_wishes')?.required).toBe(true);
  });

  it('exposes exactly one suggestion and ten manual fields', () => {
    expect(ACP_SUGGESTION_KEYS).toEqual(['acp_adrt_details']);
    expect(ACP_MANUAL_KEYS).toHaveLength(10);
    expect(ACP_FIELD_REGISTRY).toHaveLength(11);
  });

  it('keeps the registry and the template in lockstep', () => {
    expect(() => assertAcpRegistryMatchesTemplate()).not.toThrow();
  });

  it.each([
    'acp_discussion_date',
    'acp_people_present',
    'acp_capacity_to_participate',
    'acp_treatment_escalation',
    'acp_preferred_place_of_care',
    'acp_summary_of_wishes',
    'acp_service_user_needs',
    'acp_desired_goals_outcomes',
    'acp_support_required',
  ])('%s remains MANUAL with a documented reason', (key) => {
    const entry = acpFieldRegistryEntry(key);
    expect(entry?.mode).toBe('MANUAL');
    expect(entry?.sources[0]?.notes ?? '').not.toHaveLength(0);
  });

  it('never suggests anything for the audited manual fields, even with a full assessment', () => {
    const ctx = ctxWithAnswers([
      dnacprGateAnswer(true),
      adrtDetailAnswer('Held in the red folder.'),
      answer({ fieldKey: 'assessmentDate', questionText: 'Assessment date', textValue: '2026-07-15' }),
      answer({ fieldKey: 'whatMattersMost', questionText: 'What matters most?', textValue: 'Family' }),
      answer({ fieldKey: 'supportGoals', questionText: 'Support to achieve?', textValue: 'Stay home' }),
      answer({ questionText: 'Capacity to consent to assessment appears intact?', booleanValue: true }),
      answer({ questionText: 'Preferred hospital', textValue: 'St Mary’s' }),
    ]);

    const result = composeAdvanceCarePlan(ctx, fieldRefsFromSeed(), 'su-1');

    for (const key of ACP_MANUAL_KEYS) {
      expect(suggestionFor(result, key)).toBeUndefined();
    }
    expect(result.suggestions).toHaveLength(1);
    expect(result.values).toEqual({});
  });
});

// --------------------------------------------------------------------------
// Dispatch and isolation
// --------------------------------------------------------------------------

describe('compose dispatch', () => {
  it('routes the Advance form name to the Advance composer', () => {
    expect(ADVANCE_CARE_PLAN_FORM_NAME).toBe('Advance');

    const ctx = ctxWithAnswers([adrtDetailAnswer('Red folder.')]);
    const result = runCarePlanCompose(ADVANCE_CARE_PLAN_FORM_NAME, ctx, fieldRefsFromSeed());

    expect(result.composedFrom?.mapping).toBe('advance-care-plan-suggestions');
    expect(result.suggestions).toHaveLength(1);
    expect(result.values).toEqual({});
  });

  it('does not affect Home Care Plan or Home Support Plan templates', () => {
    const hcp = HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const hsp = HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));

    expect(hcp).toHaveLength(36);
    expect(hsp).toHaveLength(45);

    const others = new Set([...hcp, ...hsp]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
