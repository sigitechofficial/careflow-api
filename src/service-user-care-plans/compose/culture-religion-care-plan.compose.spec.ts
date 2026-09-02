import {
  CULTURE_RELIGION_CARE_PLAN_SEED,
  CULTURE_RELIGION_CARE_PLAN_LEGACY_LABEL_TO_KEY,
} from '../../../prisma/seeds/culture-religion-care-plan.seed-data';
import {
  CRS_FIELD_REGISTRY,
  CRS_AUTO_PREFILL_KEYS,
  CRS_MANUAL_KEYS,
  CRS_SUGGESTION_KEYS,
  crsFieldRegistryEntry,
  assertCrsRegistryMatchesTemplate,
} from './culture-religion-care-plan-field-registry';
import {
  composeCultureReligionCarePlan,
  CULTURE_RELIGION_CARE_PLAN_FORM_NAME,
} from './culture-religion-care-plan.compose';
import { runCarePlanCompose } from './compose-context.loader';
import { HOME_CARE_PLAN_SEED } from '../../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../../prisma/seeds/home-support-plan.seed-data';
import { ADVANCE_CARE_PLAN_SEED } from '../../../prisma/seeds/advance-care-plan.seed-data';
import { COGNITION_BEHAVIOUR_CARE_PLAN_SEED } from '../../../prisma/seeds/cognition-behaviour-care-plan.seed-data';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

// --------------------------------------------------------------------------
// Real Initial Assessment §1.1 / §1.3b / §1.6 / §1.7 questions, verbatim from
// the seeded catalogue.
// --------------------------------------------------------------------------

const IA_FK_RELIGIOUS_SPIRITUAL_PREFS = 'religiousSpiritualPreferences';
const IA_FK_BELIEFS = 'beliefs';
const IA_Q_CULTURE = 'Religion, culture, language, reasonable adjustments';
const IA_Q_PRAYER = 'Prayer routine or worship needs';
const IA_Q_REL_SPIRITUAL_NEEDS = 'Religious or spiritual needs';
const IA_Q_DIETARY = 'Religious or cultural dietary requirements';
const IA_Q_GENDER_PREF = 'Staff gender preference for personal care';

const SECTION_ID = 'crs-sec';

function seedFieldKeys(): string[] {
  return CULTURE_RELIGION_CARE_PLAN_SEED.sections.flatMap((s) =>
    s.fields.map((f) => f.fieldKey as string),
  );
}

function seedField(fieldKey: string) {
  for (const section of CULTURE_RELIGION_CARE_PLAN_SEED.sections) {
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
    sectionNumber: 1,
    sectionTitle: 'About me',
    ...overrides,
  } as SubmissionAnswerForRules;
}

function textAnswer(
  questionText: string,
  value: string | null,
  extra: Partial<SubmissionAnswerForRules> = {},
): SubmissionAnswerForRules {
  return answer({ questionText, textValue: value, ...extra } as Partial<SubmissionAnswerForRules>);
}

/** The full, richly-answered culture/religion assessment used across the tests. */
function fullCultureAnswers(): SubmissionAnswerForRules[] {
  return [
    textAnswer('Religious and/or spiritual preferences', 'Church of England', {
      fieldKey: IA_FK_RELIGIOUS_SPIRITUAL_PREFS,
      specRef: '1.3b',
    }),
    textAnswer('Beliefs', 'Believes strongly in Sunday observance', {
      fieldKey: IA_FK_BELIEFS,
      specRef: '1.1',
    }),
    textAnswer(IA_Q_CULTURE, 'Punjabi heritage; interpreter for Punjabi useful', { specRef: '1.7' }),
    textAnswer(IA_Q_PRAYER, 'Prays five times a day; needs a quiet space', { specRef: '1.7' }),
    textAnswer(IA_Q_REL_SPIRITUAL_NEEDS, 'Would value a visit from the local imam', { specRef: '1.7' }),
    textAnswer(IA_Q_DIETARY, 'Halal only; no pork or alcohol', { specRef: '1.7' }),
    answer({
      questionText: IA_Q_GENDER_PREF,
      specRef: '1.6',
      selectedOptions: ['female'],
    } as Partial<SubmissionAnswerForRules>),
  ];
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
  result: ReturnType<typeof composeCultureReligionCarePlan>,
  fieldKey: string,
) {
  const ref = fieldRefsFromSeed().find((f) => f.fieldKey === fieldKey);
  return result.suggestions?.find((s) => s.targetFieldKey === ref?.key);
}

// --------------------------------------------------------------------------
// 1 — each approved IA suggestion
// --------------------------------------------------------------------------

describe('Culture/Religion IA suggestions', () => {
  it('faith or belief system combines §1.3b preferences and §1.1 beliefs', () => {
    const s = suggestionFor(
      composeCultureReligionCarePlan(ctxWithAnswers(fullCultureAnswers()), fieldRefsFromSeed(), 'su-1'),
      'crs_faith_belief_system',
    );
    expect(s?.suggestedValue).toContain('Church of England');
    expect(s?.suggestedValue).toContain('Believes strongly in Sunday observance');
    expect((s?.sourceQuestions ?? []).map((q) => q.questionFieldKey)).toEqual([
      IA_FK_RELIGIOUS_SPIRITUAL_PREFS,
      IA_FK_BELIEFS,
    ]);
  });

  it('cultural practices come from §1.7 religion/culture/language', () => {
    const s = suggestionFor(
      composeCultureReligionCarePlan(ctxWithAnswers(fullCultureAnswers()), fieldRefsFromSeed(), 'su-1'),
      'crs_cultural_practices',
    );
    expect(s?.suggestedValue).toContain('Punjabi heritage');
    expect(s?.sourceQuestions?.[0]?.specRef).toBe('1.7');
    expect(s?.sourceQuestions?.[0]?.sourceLabel).toBe(IA_Q_CULTURE);
  });

  it('religious observances combine §1.7 prayer/worship and religious/spiritual needs', () => {
    const s = suggestionFor(
      composeCultureReligionCarePlan(ctxWithAnswers(fullCultureAnswers()), fieldRefsFromSeed(), 'su-1'),
      'crs_religious_observances',
    );
    expect(s?.suggestedValue).toContain('Prays five times a day');
    expect(s?.suggestedValue).toContain('visit from the local imam');
    expect((s?.sourceQuestions ?? []).map((q) => q.sourceLabel)).toEqual([
      IA_Q_PRAYER,
      IA_Q_REL_SPIRITUAL_NEEDS,
    ]);
  });

  it('dietary requirements come from §1.7 religious/cultural diet', () => {
    const s = suggestionFor(
      composeCultureReligionCarePlan(ctxWithAnswers(fullCultureAnswers()), fieldRefsFromSeed(), 'su-1'),
      'crs_dietary_requirements',
    );
    expect(s?.suggestedValue).toBe('Halal only; no pork or alcohol');
    expect(s?.sourceQuestions?.[0]?.sourceLabel).toBe(IA_Q_DIETARY);
  });

  it('gender preference maps the §1.6 SELECT value to its label', () => {
    const s = suggestionFor(
      composeCultureReligionCarePlan(ctxWithAnswers(fullCultureAnswers()), fieldRefsFromSeed(), 'su-1'),
      'crs_gender_preference',
    );
    expect(s?.suggestedValue).toBe('Female');
    expect(s?.sourceQuestions?.[0]?.specRef).toBe('1.6');
  });

  it('produces exactly five suggestions on a full assessment, sourced to INITIAL_ASSESSMENT', () => {
    const result = composeCultureReligionCarePlan(
      ctxWithAnswers(fullCultureAnswers()),
      fieldRefsFromSeed(),
      'su-1',
    );
    expect(result.suggestions).toHaveLength(5);
    expect(result.suggestions?.every((s) => s.sourceType === 'INITIAL_ASSESSMENT')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 2 — suggestions go into suggestions[], never values
// --------------------------------------------------------------------------

describe('suggestions are never auto-filled', () => {
  it('writes nothing into values even with a full assessment', () => {
    const result = composeCultureReligionCarePlan(
      ctxWithAnswers(fullCultureAnswers()),
      fieldRefsFromSeed(),
      'su-1',
    );
    expect(result.values).toEqual({});
    expect(result.fieldSources ?? {}).toEqual({});
  });

  it('leaves each suggested field unset in values (special-category data not auto-filled)', () => {
    const result = composeCultureReligionCarePlan(
      ctxWithAnswers(fullCultureAnswers()),
      fieldRefsFromSeed(),
      'su-1',
    );
    for (const key of CRS_SUGGESTION_KEYS) {
      const ref = fieldRefsFromSeed().find((f) => f.fieldKey === key);
      expect(result.values[ref!.key]).toBeUndefined();
    }
  });

  it('declares no auto-prefill fields at all', () => {
    expect(CRS_AUTO_PREFILL_KEYS).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 3 — manual fields never receive suggestions
// --------------------------------------------------------------------------

describe('manual fields stay manual', () => {
  it('never suggests anything for the eight manual fields, even with a full assessment plus generic IA content', () => {
    const ctx = ctxWithAnswers([
      ...fullCultureAnswers(),
      // Generic IA content that must not be mapped on wording similarity.
      textAnswer('What matters most to you?', 'Seeing my grandchildren', { fieldKey: 'whatMattersMost' }),
      textAnswer('Support goals', 'Stay independent at home', { fieldKey: 'supportGoals' }),
      textAnswer('Any equality related risk or need', 'None noted', { specRef: '1.7' }),
    ]);
    const result = composeCultureReligionCarePlan(ctx, fieldRefsFromSeed(), 'su-1');

    for (const key of CRS_MANUAL_KEYS) {
      expect(suggestionFor(result, key)).toBeUndefined();
    }
    expect(result.suggestions).toHaveLength(5);
    expect(result.values).toEqual({});
  });

  it('registers every manual field with a recorded reason', () => {
    for (const key of CRS_MANUAL_KEYS) {
      const entry = crsFieldRegistryEntry(key);
      expect(entry?.mode).toBe('MANUAL');
      expect(entry?.sources[0]?.notes ?? '').not.toHaveLength(0);
    }
  });

  it('keeps staff notes and the risk gate manual', () => {
    expect(crsFieldRegistryEntry('crs_staff_notes')?.mode).toBe('MANUAL');
    expect(crsFieldRegistryEntry('crs_area_risk')?.mode).toBe('MANUAL');
  });
});

// --------------------------------------------------------------------------
// 4 — empty / partial / missing IA
// --------------------------------------------------------------------------

describe('no suggestion without evidence', () => {
  it('produces nothing when the assessment has no answers', () => {
    const result = composeCultureReligionCarePlan(ctxWithAnswers([]), fieldRefsFromSeed(), 'su-1');
    expect(result.suggestions ?? []).toHaveLength(0);
  });

  it('produces nothing when there is no assessment at all', () => {
    const result = composeCultureReligionCarePlan(
      { serviceUserId: 'su-1', ia: null } as unknown as CarePlanComposeContext,
      fieldRefsFromSeed(),
      'su-1',
    );
    expect(result.suggestions ?? []).toHaveLength(0);
    expect(result.values).toEqual({});
  });

  it.each([null, '', '   '])('skips a blank faith answer (%p) but still maps the others', (text) => {
    const ctx = ctxWithAnswers([
      textAnswer('Religious and/or spiritual preferences', text, {
        fieldKey: IA_FK_RELIGIOUS_SPIRITUAL_PREFS,
        specRef: '1.3b',
      }),
      textAnswer(IA_Q_DIETARY, 'Vegetarian on religious grounds', { specRef: '1.7' }),
    ]);
    const result = composeCultureReligionCarePlan(ctx, fieldRefsFromSeed(), 'su-1');
    expect(suggestionFor(result, 'crs_faith_belief_system')).toBeUndefined();
    expect(suggestionFor(result, 'crs_dietary_requirements')?.suggestedValue).toBe(
      'Vegetarian on religious grounds',
    );
  });
});

// --------------------------------------------------------------------------
// 5 — merged template: existing local fields + Care 2020 fields
// --------------------------------------------------------------------------

describe('merged Culture/Religion/Spirituality template', () => {
  it('has eleven unique fields across three sections', () => {
    const keys = seedFieldKeys();
    expect(keys).toHaveLength(17);
    expect(new Set(keys).size).toBe(17);
    expect(CULTURE_RELIGION_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Identity and beliefs',
      'Daily care impact',
      'Needs, goals, support and risk',
    ]);
  });

  it('retains the six original local fields, types and the required flag', () => {
    for (const key of Object.values(CULTURE_RELIGION_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(seedFieldKeys()).toContain(key);
    }
    expect(seedField('crs_faith_belief_system')?.fieldType).toBe('TEXT');
    expect(seedField('crs_cultural_practices')?.fieldType).toBe('TEXTAREA');
    expect(seedField('crs_gender_preference')?.fieldType).toBe('TEXT');
    expect(seedField('crs_staff_notes')?.required).toBe(true);
  });

  it('adds the five Care 2020 needs / goals / support / risk fields', () => {
    for (const key of [
      'crs_service_user_needs',
      'crs_needs_person_centred',
      'crs_desired_goals_outcomes',
      'crs_support_required',
      'crs_area_risk',
    ]) {
      expect(seedFieldKeys()).toContain(key);
    }
    expect(seedField('crs_area_risk')?.fieldType).toBe('YES_NO');
  });

  it('exposes nine suggestions and eight manual fields', () => {
    expect(CRS_SUGGESTION_KEYS).toEqual([
      'crs_faith_belief_system',
      'crs_cultural_practices',
      'crs_religious_observances',
      'crs_dietary_requirements',
      'crs_gender_preference',
      'crs_service_user_needs',
      'crs_needs_person_centred',
      'crs_desired_goals_outcomes',
      'crs_support_required',
    ]);
    expect(CRS_MANUAL_KEYS).toHaveLength(8);
    expect(CRS_FIELD_REGISTRY).toHaveLength(17);
  });

  it('keeps the registry and the template in lockstep', () => {
    expect(() => assertCrsRegistryMatchesTemplate()).not.toThrow();
  });
});

// --------------------------------------------------------------------------
// 6 — dispatch and isolation from other care plans
// --------------------------------------------------------------------------

describe('compose dispatch and isolation', () => {
  it('routes the Culture/Religion form name to its composer', () => {
    expect(CULTURE_RELIGION_CARE_PLAN_FORM_NAME).toBe('Culture/Religion/Spirituality');

    const result = runCarePlanCompose(
      CULTURE_RELIGION_CARE_PLAN_FORM_NAME,
      ctxWithAnswers(fullCultureAnswers()),
      fieldRefsFromSeed(),
    );
    expect(result.composedFrom?.mapping).toBe('culture-religion-care-plan-suggestions');
    expect(result.values).toEqual({});
    expect(result.suggestions).toHaveLength(5);
  });

  it('does not overlap keys with Home Care, Home Support, Advance or Cognition plans', () => {
    const hcp = HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const hsp = HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const acp = ADVANCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const cog = COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections.flatMap((s) =>
      s.fields.map((f) => f.fieldKey as string),
    );

    const others = new Set([...hcp, ...hsp, ...acp, ...cog]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
