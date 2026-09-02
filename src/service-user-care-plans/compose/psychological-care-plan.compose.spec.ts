import {
  PSYCHOLOGICAL_CARE_PLAN_SEED,
  PSYCHOLOGICAL_CARE_PLAN_LEGACY_LABEL_TO_KEY,
} from '../../../prisma/seeds/psychological-care-plan.seed-data';
import {
  PSYCH_FIELD_REGISTRY,
  PSYCH_AUTO_PREFILL_KEYS,
  PSYCH_MANUAL_KEYS,
  PSYCH_SUGGESTION_KEYS,
  psychFieldRegistryEntry,
  assertPsychRegistryMatchesTemplate,
} from './psychological-care-plan-field-registry';
import {
  composePsychologicalCarePlan,
  PSYCHOLOGICAL_CARE_PLAN_FORM_NAME,
} from './psychological-care-plan.compose';
import { runCarePlanCompose } from './compose-context.loader';
import { COGNITION_BEHAVIOUR_CARE_PLAN_SEED } from '../../../prisma/seeds/cognition-behaviour-care-plan.seed-data';
import { PAIN_MANAGEMENT_CARE_PLAN_SEED } from '../../../prisma/seeds/pain-management-care-plan.seed-data';
import { SKIN_INTEGRITY_CARE_PLAN_SEED } from '../../../prisma/seeds/skin-integrity-care-plan.seed-data';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

const IA_Q_CPN_NAME = 'CPN name and contact';
const SECTION_ID = 'psych-sec';

function seedFieldKeys(): string[] {
  return PSYCHOLOGICAL_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}
function seedField(fieldKey: string) {
  for (const section of PSYCHOLOGICAL_CARE_PLAN_SEED.sections) {
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
function cpnAnswer(text: string | null): SubmissionAnswerForRules {
  return answer({ questionText: IA_Q_CPN_NAME, specRef: '10.1', textValue: text } as Partial<SubmissionAnswerForRules>);
}
function ctxWith(answers: SubmissionAnswerForRules[] | null): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    ia: answers
      ? { submissionId: 'sub-1', status: 'REVIEWED', submittedAt: '2026-08-01T00:00:00.000Z', answers }
      : null,
  } as unknown as CarePlanComposeContext;
}
function suggestionFor(result: ReturnType<typeof composePsychologicalCarePlan>, fieldKey: string) {
  const ref = fieldRefsFromSeed().find((f) => f.fieldKey === fieldKey);
  return result.suggestions?.find((s) => s.targetFieldKey === ref?.key);
}

describe('Psychological IA suggestion (CMHT/counsellor ← §10.1 CPN name and contact)', () => {
  it('suggests the CMHT/counsellor field from §10.1 "CPN name and contact"', () => {
    const s = suggestionFor(
      composePsychologicalCarePlan(ctxWith([cpnAnswer('Jane Doe, CPN — 0161 123 4567')]), fieldRefsFromSeed(), 'su-1'),
      'psychological_cmht_counsellor',
    );
    expect(s?.suggestedValue).toBe('Jane Doe, CPN — 0161 123 4567');
    expect(s?.sourceQuestions?.[0]?.specRef).toBe('10.1');
    expect(s?.sourceQuestions?.[0]?.sourceLabel).toBe(IA_Q_CPN_NAME);
  });

  it('produces exactly one suggestion; values{} stays empty', () => {
    const result = composePsychologicalCarePlan(ctxWith([cpnAnswer('Local CMHT team')]), fieldRefsFromSeed(), 'su-1');
    expect(result.suggestions).toHaveLength(1);
    expect(result.values).toEqual({});
    expect(result.fieldSources ?? {}).toEqual({});
  });

  it.each([null, '', '   '])('produces nothing when the CPN answer is %p', (text) => {
    const result = composePsychologicalCarePlan(ctxWith([cpnAnswer(text)]), fieldRefsFromSeed(), 'su-1');
    expect(suggestionFor(result, 'psychological_cmht_counsellor')).toBeUndefined();
    expect(result.suggestions ?? []).toHaveLength(0);
  });

  it('declares no auto-prefill fields', () => {
    expect(PSYCH_AUTO_PREFILL_KEYS).toHaveLength(0);
  });
});

describe('manual fields stay manual', () => {
  it('never suggests any manual field, even with rich §10 content', () => {
    const ctx = ctxWith([
      cpnAnswer('Jane Doe, CPN'),
      answer({ questionText: 'Emotional wellbeing status', fieldKey: 'emotionalWellbeing', specRef: '10.2', selectedOptions: ['sad_most'] }),
      answer({ questionText: 'Current mental health details', specRef: '10.1', textValue: 'Anxiety and low mood' }),
      answer({ questionText: 'GP referral for mental health requested?', specRef: '10.5', booleanValue: true }),
      answer({ questionText: 'What matters most?', fieldKey: 'whatMattersMost', textValue: 'Family' }),
    ]);
    const result = composePsychologicalCarePlan(ctx, fieldRefsFromSeed(), 'su-1');
    for (const key of PSYCH_MANUAL_KEYS) {
      expect(suggestionFor(result, key)).toBeUndefined();
    }
    expect(result.suggestions).toHaveLength(1);
    expect(result.values).toEqual({});
  });

  it('keeps Current mood and Mental health diagnosis manual (rejected candidates)', () => {
    expect(psychFieldRegistryEntry('psychological_current_mood')?.mode).toBe('MANUAL');
    expect(psychFieldRegistryEntry('psychological_mh_diagnosis')?.mode).toBe('MANUAL');
    expect(psychFieldRegistryEntry('psychological_current_mood')?.sources[0]?.notes).toMatch(/incompatible|option/i);
  });

  it('registers every manual field with a recorded reason', () => {
    for (const key of PSYCH_MANUAL_KEYS) {
      const entry = psychFieldRegistryEntry(key);
      expect(entry?.mode).toBe('MANUAL');
      expect(entry?.sources[0]?.notes ?? '').not.toHaveLength(0);
    }
  });
});

describe('no assessment', () => {
  it('produces nothing when there is no assessment', () => {
    const result = composePsychologicalCarePlan(
      { serviceUserId: 'su-1', ia: null } as unknown as CarePlanComposeContext,
      fieldRefsFromSeed(),
      'su-1',
    );
    expect(result.suggestions ?? []).toHaveLength(0);
    expect(result.values).toEqual({});
  });
});

describe('merged Psychological template', () => {
  it('has eleven unique fields across three sections with exactly one PCD', () => {
    const keys = seedFieldKeys();
    expect(keys).toHaveLength(17);
    expect(new Set(keys).size).toBe(17);
    const pcd = PSYCHOLOGICAL_CARE_PLAN_SEED.sections.flatMap((s) => s.fields).filter((f) => f.label === 'Person-centred details');
    expect(pcd).toHaveLength(1);
  });

  it('retains the six original local fields', () => {
    for (const key of Object.values(PSYCHOLOGICAL_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(seedFieldKeys()).toContain(key);
    }
  });

  it('exposes exactly one suggestion and ten manual fields', () => {
    expect(PSYCH_SUGGESTION_KEYS).toEqual(['psychological_cmht_counsellor']);
    expect(PSYCH_MANUAL_KEYS).toHaveLength(16);
    expect(PSYCH_FIELD_REGISTRY).toHaveLength(17);
  });

  it('keeps the registry and the template in lockstep', () => {
    expect(() => assertPsychRegistryMatchesTemplate()).not.toThrow();
  });
});

describe('compose dispatch and isolation', () => {
  it('routes the Psychological form name to its composer', () => {
    expect(PSYCHOLOGICAL_CARE_PLAN_FORM_NAME).toBe('Psychological');
    const result = runCarePlanCompose(PSYCHOLOGICAL_CARE_PLAN_FORM_NAME, ctxWith([cpnAnswer('CPN Jane')]), fieldRefsFromSeed());
    expect(result.composedFrom?.mapping).toBe('psychological-care-plan-suggestions');
    expect(result.values).toEqual({});
    expect(result.suggestions).toHaveLength(1);
  });

  it('does not overlap keys with Cognition, Pain or Skin Integrity plans', () => {
    const others = new Set([
      ...COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...PAIN_MANAGEMENT_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...SKIN_INTEGRITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
