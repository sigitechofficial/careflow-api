import {
  FINAL_DAYS_CARE_PLAN_SEED,
  FINAL_DAYS_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  FINAL_DAYS_CURRENT_FOCUS_OPTIONS,
} from '../../../prisma/seeds/final-days-care-plan.seed-data';
import {
  FINAL_DAYS_FIELD_REGISTRY,
  FINAL_DAYS_AUTO_PREFILL_KEYS,
  FINAL_DAYS_MANUAL_KEYS,
  FINAL_DAYS_SUGGESTION_KEYS,
  finalDaysFieldRegistryEntry,
  assertFinalDaysRegistryMatchesTemplate,
} from './final-days-care-plan-field-registry';
import {
  composeFinalDaysCarePlan,
  FINAL_DAYS_CARE_PLAN_FORM_NAME,
} from './final-days-care-plan.compose';
import { runCarePlanCompose } from './compose-context.loader';
import { HOME_CARE_PLAN_SEED } from '../../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../../prisma/seeds/home-support-plan.seed-data';
import { ADVANCE_CARE_PLAN_SEED } from '../../../prisma/seeds/advance-care-plan.seed-data';
import { FALLS_CARE_PLAN_SEED } from '../../../prisma/seeds/falls-care-plan.seed-data';
import type {
  CarePlanComposeContext,
  CarePlanFormFieldRef,
  CarePlanLegalDocumentEvidence,
} from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

// --------------------------------------------------------------------------
// Real Initial Assessment questions, verbatim from the seeded catalogue.
// --------------------------------------------------------------------------

const IA_FK_PAIN_PLAN = 'painManagementPlan';
const IA_Q_PAIN_PLAN = 'What pain management plan in place';
const IA_Q_CURRENT_PAIN = 'Current pain relief';
const IA_Q_REL_SPIRITUAL = 'Religious or spiritual needs';
const IA_Q_CULTURE = 'Cultural background and practices';
const IA_Q_FAMILY = 'Family, representative, next of kin, advocate, key contacts';
const IA_Q_ADRT = 'ReSPECT / DNACPR location and summary';

const SECTION_ID = 'fd-sec';

function seedFieldKeys(): string[] {
  return FINAL_DAYS_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of FINAL_DAYS_CARE_PLAN_SEED.sections) {
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

function fullAnswers(): SubmissionAnswerForRules[] {
  return [
    textAnswer(IA_Q_PAIN_PLAN, 'Paracetamol 1g QDS; oramorph PRN for breakthrough pain', {
      fieldKey: IA_FK_PAIN_PLAN,
      specRef: '5.3',
      sectionNumber: 5,
      sectionTitle: 'Clinical',
    }),
    textAnswer(IA_Q_CURRENT_PAIN, 'Currently comfortable on regular analgesia', { specRef: '5.3', sectionNumber: 5, sectionTitle: 'Clinical' }),
    textAnswer(IA_Q_REL_SPIRITUAL, 'Practising Catholic; would value visits from the priest', { specRef: '1.7' }),
    textAnswer(IA_Q_CULTURE, 'Irish heritage; prefers English', { fieldKey: 'culturalBackground', specRef: '1.7' }),
    textAnswer(IA_Q_FAMILY, 'Daughter Mary (next of kin), son Tom', { specRef: '1.2' }),
    textAnswer(IA_Q_ADRT, 'ReSPECT form in the red folder by the front door', { specRef: '13.6', sectionNumber: 13, sectionTitle: 'Safeguarding and legal' }),
  ];
}

function legalDoc(overrides: Partial<CarePlanLegalDocumentEvidence> = {}): CarePlanLegalDocumentEvidence {
  return {
    dnacprInPlace: true,
    dnacprStatusConfirmation: 'IN_PLACE',
    dnacprPhysicalLocation: 'Red folder, hallway',
    dnacprStartDate: '2026-05-12T00:00:00.000Z',
    ...overrides,
  };
}

function ctxWith(
  answers: SubmissionAnswerForRules[] | null,
  legalDocument: CarePlanLegalDocumentEvidence | null = null,
): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    legalDocument,
    ia: answers
      ? { submissionId: 'sub-1', status: 'REVIEWED', submittedAt: '2026-08-01T00:00:00.000Z', answers }
      : null,
  } as unknown as CarePlanComposeContext;
}

function suggestionFor(result: ReturnType<typeof composeFinalDaysCarePlan>, fieldKey: string) {
  const ref = fieldRefsFromSeed().find((f) => f.fieldKey === fieldKey);
  return result.suggestions?.find((s) => s.targetFieldKey === ref?.key);
}

// --------------------------------------------------------------------------
// 1 — the four approved suggestions
// --------------------------------------------------------------------------

describe('Final Days IA suggestions', () => {
  it('pain management plan combines §5.3 plan and current relief', () => {
    const s = suggestionFor(
      composeFinalDaysCarePlan(ctxWith(fullAnswers()), fieldRefsFromSeed(), 'su-1'),
      'final_days_pain_management_plan',
    );
    expect(s?.suggestedValue).toContain('oramorph');
    expect(s?.suggestedValue).toContain('comfortable on regular analgesia');
    expect((s?.sourceQuestions ?? []).map((q) => q.questionFieldKey)).toContain(IA_FK_PAIN_PLAN);
  });

  it('spiritual/cultural needs combine §1.7 spiritual and culture', () => {
    const s = suggestionFor(
      composeFinalDaysCarePlan(ctxWith(fullAnswers()), fieldRefsFromSeed(), 'su-1'),
      'final_days_spiritual_cultural_needs',
    );
    expect(s?.suggestedValue).toContain('priest');
    expect(s?.suggestedValue).toContain('Irish heritage');
    expect(s?.sourceQuestions?.[0]?.specRef).toBe('1.7');
  });

  it('family contact comes from §1.2 key contacts', () => {
    const s = suggestionFor(
      composeFinalDaysCarePlan(ctxWith(fullAnswers()), fieldRefsFromSeed(), 'su-1'),
      'final_days_family_contact_updates',
    );
    expect(s?.suggestedValue).toBe('Daughter Mary (next of kin), son Tom');
    expect(s?.sourceQuestions?.[0]?.specRef).toBe('1.2');
  });

  it('ADRT details combine the structured legal document and IA §13.6', () => {
    const s = suggestionFor(
      composeFinalDaysCarePlan(ctxWith(fullAnswers(), legalDoc()), fieldRefsFromSeed(), 'su-1'),
      'final_days_adrt_details',
    );
    expect(s?.suggestedValue).toContain('DNACPR is in place.');
    expect(s?.suggestedValue).toContain('Red folder, hallway');
    expect(s?.suggestedValue).toContain('In place since 2026-05-12');
    expect(s?.suggestedValue).toContain('red folder by the front door');
    const sections = (s?.sourceQuestions ?? []).map((q) => q.sourceSection);
    expect(sections).toContain('Legal documents record');
    expect((s?.sourceQuestions ?? []).some((q) => q.specRef === '13.6')).toBe(true);
  });

  it('ADRT details work from the legal document alone (no §13.6 answer)', () => {
    const s = suggestionFor(
      composeFinalDaysCarePlan(ctxWith([], legalDoc({ dnacprPhysicalLocation: null })), fieldRefsFromSeed(), 'su-1'),
      'final_days_adrt_details',
    );
    expect(s?.suggestedValue).toContain('DNACPR is in place.');
    expect(s?.suggestedValue).toContain('In place since 2026-05-12');
  });

  it('ADRT details work from IA §13.6 alone (no legal document)', () => {
    const s = suggestionFor(
      composeFinalDaysCarePlan(ctxWith(fullAnswers(), null), fieldRefsFromSeed(), 'su-1'),
      'final_days_adrt_details',
    );
    expect(s?.suggestedValue).toBe('ReSPECT form in the red folder by the front door');
  });

  it('produces no ADRT suggestion when DNACPR is not in place and §13.6 is blank', () => {
    const s = suggestionFor(
      composeFinalDaysCarePlan(ctxWith([], legalDoc({ dnacprInPlace: false })), fieldRefsFromSeed(), 'su-1'),
      'final_days_adrt_details',
    );
    expect(s).toBeUndefined();
  });

  it('produces exactly four suggestions on a full assessment plus legal document', () => {
    const result = composeFinalDaysCarePlan(ctxWith(fullAnswers(), legalDoc()), fieldRefsFromSeed(), 'su-1');
    expect(result.suggestions).toHaveLength(4);
    expect(result.suggestions?.every((s) => s.sourceType === 'INITIAL_ASSESSMENT')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 2 — suggestions never auto-fill values
// --------------------------------------------------------------------------

describe('suggestions are never auto-filled', () => {
  it('writes nothing into values even with a full assessment and legal document', () => {
    const result = composeFinalDaysCarePlan(ctxWith(fullAnswers(), legalDoc()), fieldRefsFromSeed(), 'su-1');
    expect(result.values).toEqual({});
    expect(result.fieldSources ?? {}).toEqual({});
  });

  it('leaves each suggested field unset in values', () => {
    const result = composeFinalDaysCarePlan(ctxWith(fullAnswers(), legalDoc()), fieldRefsFromSeed(), 'su-1');
    for (const key of FINAL_DAYS_SUGGESTION_KEYS) {
      const ref = fieldRefsFromSeed().find((f) => f.fieldKey === key);
      expect(result.values[ref!.key]).toBeUndefined();
    }
  });

  it('declares no auto-prefill fields at all', () => {
    expect(FINAL_DAYS_AUTO_PREFILL_KEYS).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 3 — manual fields never receive suggestions
// --------------------------------------------------------------------------

describe('manual fields stay manual', () => {
  it('never suggests any of the ten manual fields, even with a full assessment and generic content', () => {
    const ctx = ctxWith(
      [
        ...fullAnswers(),
        textAnswer('What matters most to the Service User?', 'To be at home', { fieldKey: 'whatMattersMost', specRef: '1.3' }),
        textAnswer('Preferred hospital', 'St Mary’s', { specRef: '13.9', sectionNumber: 13, sectionTitle: 'Safeguarding and legal' }),
        textAnswer('Continence / oral care notes', 'Assist with brushing teeth', { specRef: '7.1', sectionNumber: 7, sectionTitle: 'Personal care' }),
      ],
      legalDoc(),
    );
    const result = composeFinalDaysCarePlan(ctx, fieldRefsFromSeed(), 'su-1');

    for (const key of FINAL_DAYS_MANUAL_KEYS) {
      expect(suggestionFor(result, key)).toBeUndefined();
    }
    expect(result.suggestions).toHaveLength(4);
    expect(result.values).toEqual({});
  });

  it('registers every manual field with a recorded reason', () => {
    for (const key of FINAL_DAYS_MANUAL_KEYS) {
      const entry = finalDaysFieldRegistryEntry(key);
      expect(entry?.mode).toBe('MANUAL');
      expect(entry?.sources[0]?.notes ?? '').not.toHaveLength(0);
    }
  });

  it('keeps preferred place of death and current focus of care manual', () => {
    expect(finalDaysFieldRegistryEntry('final_days_preferred_place_of_death')?.mode).toBe('MANUAL');
    expect(finalDaysFieldRegistryEntry('final_days_current_focus_of_care')?.mode).toBe('MANUAL');
  });
});

// --------------------------------------------------------------------------
// 4 — empty / missing IA
// --------------------------------------------------------------------------

describe('no suggestion without evidence', () => {
  it('produces nothing when the assessment has no answers and no legal document', () => {
    const result = composeFinalDaysCarePlan(ctxWith([]), fieldRefsFromSeed(), 'su-1');
    expect(result.suggestions ?? []).toHaveLength(0);
  });

  it('produces nothing when there is no assessment at all', () => {
    const result = composeFinalDaysCarePlan(
      { serviceUserId: 'su-1', ia: null, legalDocument: legalDoc() } as unknown as CarePlanComposeContext,
      fieldRefsFromSeed(),
      'su-1',
    );
    expect(result.suggestions ?? []).toHaveLength(0);
    expect(result.values).toEqual({});
  });
});

// --------------------------------------------------------------------------
// 5 — merged template shape
// --------------------------------------------------------------------------

describe('merged Final Days template', () => {
  it('has twelve unique fields across three sections', () => {
    const keys = seedFieldKeys();
    expect(keys).toHaveLength(18);
    expect(new Set(keys).size).toBe(18);
    expect(FINAL_DAYS_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Comfort and symptoms',
      'People and wishes',
      'Needs, goals, support and risk',
    ]);
  });

  it('retains the six original local fields, types and options', () => {
    for (const key of Object.values(FINAL_DAYS_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(seedFieldKeys()).toContain(key);
    }
    expect(seedField('final_days_current_focus_of_care')?.fieldType).toBe('SELECT');
    expect(seedField('final_days_current_focus_of_care')?.options).toEqual(FINAL_DAYS_CURRENT_FOCUS_OPTIONS);
    expect(seedField('final_days_mouth_care_frequency')?.fieldType).toBe('TEXT');
    expect(seedField('final_days_preferred_place_of_death')?.fieldType).toBe('TEXT');
  });

  it('adds the six Care 2020 fields, with ADRT last', () => {
    for (const key of [
      'final_days_service_user_needs',
      'final_days_needs_person_centred',
      'final_days_desired_goals_outcomes',
      'final_days_support_required',
      'final_days_area_risk',
      'final_days_adrt_details',
    ]) {
      expect(seedFieldKeys()).toContain(key);
    }
    const lastSection = FINAL_DAYS_CARE_PLAN_SEED.sections[2];
    expect(lastSection.fields[lastSection.fields.length - 1].fieldKey).toBe('final_days_adrt_details');
    expect(seedField('final_days_adrt_details')?.fieldType).toBe('TEXTAREA');
    expect(seedField('final_days_area_risk')?.fieldType).toBe('YES_NO');
  });

  it('exposes exactly four suggestions and ten manual fields', () => {
    expect(FINAL_DAYS_SUGGESTION_KEYS).toEqual([
      'final_days_pain_management_plan',
      'final_days_family_contact_updates',
      'final_days_spiritual_cultural_needs',
      'final_days_adrt_details',
    ]);
    expect(FINAL_DAYS_MANUAL_KEYS).toHaveLength(14);
    expect(FINAL_DAYS_FIELD_REGISTRY).toHaveLength(18);
  });

  it('keeps the registry and the template in lockstep', () => {
    expect(() => assertFinalDaysRegistryMatchesTemplate()).not.toThrow();
  });
});

// --------------------------------------------------------------------------
// 6 — dispatch and isolation
// --------------------------------------------------------------------------

describe('compose dispatch and isolation', () => {
  it('routes the Final Days form name to its composer', () => {
    expect(FINAL_DAYS_CARE_PLAN_FORM_NAME).toBe('Final Days');
    const result = runCarePlanCompose(FINAL_DAYS_CARE_PLAN_FORM_NAME, ctxWith(fullAnswers(), legalDoc()), fieldRefsFromSeed());
    expect(result.composedFrom?.mapping).toBe('final-days-care-plan-suggestions');
    expect(result.values).toEqual({});
    expect(result.suggestions).toHaveLength(4);
  });

  it('does not overlap keys with Home Care, Home Support, Advance or Falls plans', () => {
    const others = new Set([
      ...HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...ADVANCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...FALLS_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
