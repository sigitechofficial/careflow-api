import { DEMENTIA_CARE_PLAN_SEED } from '../../../prisma/seeds/dementia-care-plan.seed-data';
import { runCarePlanCompose } from './compose-context.loader';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

const DEMENTIA_FORM_NAME = 'Dementia Care plan';

/** Field refs as the loader builds them from the (unchanged) 25-field / 4-section schema. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  DEMENTIA_CARE_PLAN_SEED.sections.forEach((section, si) => {
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

function keyOf(fieldKey: string): string {
  return fieldRefsFromSeed().find((f) => f.fieldKey === fieldKey)!.key;
}

type Answer = Record<string, unknown>;
function boolAnswer(questionText: string, specRef: string, value: boolean): Answer {
  return {
    questionId: `q-${questionText}`,
    questionText,
    checked: null,
    booleanValue: value,
    textValue: null,
    selectedOptions: null,
    specRef,
    sectionNumber: 10,
    sectionTitle: 'Cognition',
  };
}

function ctxWith(opts: { aboutMe?: Record<string, unknown>; answers?: Answer[] }): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    serviceUserName: 'Margaret Hughes',
    personalisation: {},
    emergencyContacts: [],
    allergies: [],
    aboutMe: opts.aboutMe ?? null,
    ia: {
      submissionId: 'ia-1',
      submittedAt: '2026-06-01T10:00:00.000Z',
      answers: opts.answers ?? [],
    },
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
  } as unknown as CarePlanComposeContext;
}

function run(ctx: CarePlanComposeContext) {
  return runCarePlanCompose(DEMENTIA_FORM_NAME, ctx, fieldRefsFromSeed());
}

describe('Dementia compose value normalisation (rendering fixes)', () => {
  it('1. empty rich text (<p><br></p>) does not render — the field is left empty', () => {
    const result = run(ctxWith({ aboutMe: { communication: '<p><br></p>' } }));
    // No IA §8 note and only empty editor HTML from About Me → field must be absent, never raw HTML.
    expect(result.values[keyOf('dementia_communication')]).toBeUndefined();
  });

  it('1b. other empty rich-text shapes (<p></p>, whitespace) also normalise to empty', () => {
    for (const empty of ['<p></p>', '   ', '<p>\n</p>', '<div><br/></div>']) {
      const result = run(ctxWith({ aboutMe: { routineSummary: empty } }));
      expect(result.values[keyOf('dementia_daily_routines')]).toBeUndefined();
    }
  });

  it('2. boolean IA answers are labelled, never rendered as bare stacked Yes/No', () => {
    const result = run(
      ctxWith({
        answers: [
          boolAnswer('Good long-term memory recall', '10.6a', true),
          boolAnswer('Good short-term memory recall', '10.6a', true),
          boolAnswer('Fully orientated', '10.6a', false),
          boolAnswer('De-orientated', '10.6a', true),
          boolAnswer('Able to follow basic instructions', '10.6a', true),
        ],
      }),
    );
    const value = result.values[keyOf('dementia_memory_orientation')] as string;
    expect(typeof value).toBe('string');
    expect(value).toContain('Good long-term memory recall: Yes');
    expect(value).toContain('Fully orientated: No');
    // No line may be a bare, context-free Yes/No.
    for (const line of value.split('\n')) {
      expect(line).not.toMatch(/^(Yes|No)$/);
      expect(line).toContain(': ');
    }
  });

  it('3. duplicate source values are collapsed (no "No\\nNo" / repeated lines)', () => {
    // Known triggers: About Me and an IA line that resolve to the same text must not duplicate.
    const result = run(
      ctxWith({
        aboutMe: { triggersCalm: 'Loud noise upsets her', howToSupport: 'Loud noise upsets her' },
      }),
    );
    const calming = result.values[keyOf('dementia_calming_strategies')] as string;
    // howToSupport === triggersCalm → collapsed to a single line, not doubled.
    expect(calming.split('\n').filter((l) => l === 'Loud noise upsets her')).toHaveLength(1);

    // Two boolean triggers both "No" must not render as bare "No\nNo".
    const triggers = run(
      ctxWith({
        answers: [
          boolAnswer('Gets agitated with change', '10.6a', false),
          boolAnswer('Challenging behaviour or agitation with change', '10.6a', false),
        ],
      }),
    ).values[keyOf('dementia_triggers')] as string;
    expect(triggers).not.toBe('No\nNo');
    for (const line of triggers.split('\n')) {
      expect(line).not.toMatch(/^(Yes|No)$/);
    }
  });

  it('4. existing valid plain-text values remain unchanged', () => {
    const result = run(
      ctxWith({
        aboutMe: {
          lifeHistoryInterests: 'Retired teacher, loves gardening',
          goodDay: 'A walk in the park',
          routineSummary: 'Breakfast at 8, nap after lunch',
        },
      }),
    );
    expect(result.values[keyOf('dementia_life_history')]).toBe('Retired teacher, loves gardening');
    expect(result.values[keyOf('dementia_good_day')]).toBe('A walk in the park');
    expect(result.values[keyOf('dementia_daily_routines')]).toBe('Breakfast at 8, nap after lunch');
  });

  it('4b. plain rich text is stripped to plain text (no editor HTML exposed) but content preserved', () => {
    const result = run(ctxWith({ aboutMe: { lifeHistoryInterests: '<p>Loves <strong>gardening</strong></p>' } }));
    const value = result.values[keyOf('dementia_life_history')] as string;
    expect(value).toContain('gardening');
    expect(value).not.toContain('<');
  });

  it('5. the YES_NO "Diagnosed dementia" field still returns a real boolean (not normalised away)', () => {
    const result = run(
      ctxWith({ answers: [boolAnswer('Diagnosed dementia', '10.6a', true)] }),
    );
    expect(result.values[keyOf('dementia_diagnosed')]).toBe(true);
  });

  it('6. still routes to the single existing engine (no duplicate engine/dispatch)', () => {
    const result = run(ctxWith({ aboutMe: { lifeHistoryInterests: 'x' } }));
    expect((result.composedFrom as Record<string, unknown>).mapping).toBe('dementia-care-plan');
    expect(result.suggestions).toBeUndefined();
  });
});

describe('Dementia schema is untouched by the compose fix', () => {
  it('still has 31 fields across 4 sections with exactly one required PCD', () => {
    const fields = DEMENTIA_CARE_PLAN_SEED.sections.flatMap((s) => s.fields);
    expect(fields).toHaveLength(31);
    expect(DEMENTIA_CARE_PLAN_SEED.sections).toHaveLength(4);
    const pcd = fields.filter((f) => f.label === 'Person-centred details');
    expect(pcd).toHaveLength(1);
    expect(pcd[0].fieldKey).toBe('dementia_needs_person_centred');
    expect(pcd[0].required).toBe(true);
    expect(fields.map((f) => f.fieldKey)).not.toContain('dementia_goals_person_centred');
    expect(fields.map((f) => f.fieldKey)).not.toContain('dementia_support_person_centred');
  });
});
