import { Prisma } from '@prisma/client';
import { ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS } from '../../prisma/seeds/initial-assessment-enterprise.seed';
import {
  CARE_PLAN_IA_DEMO_OVERLAYS,
  CARE_PLAN_IA_DEMO_OVERLAY_META_FLAG,
  type IaDemoOverlayAnswer,
} from '../../prisma/seeds/care-plan-ia-demo-overlay.data';
import {
  IA_DEMO_DETERMINISTIC_DATES,
  IA_DEMO_INTENTIONALLY_EMPTY_QUESTIONS,
} from '../../prisma/seeds/care-plan-ia-demo-expansion.data';
import {
  applyCarePlanIaDemoOverlay,
  expandedCarePlanIaDemoOverlays,
  matchOverlayQuestion,
  overlayAnswerWriteData,
} from '../../prisma/seeds/care-plan-ia-demo-overlay.seed';

const EXPECTED_NUMBERS = ['SU-1042', 'SU-TEST-P01', 'SU-TEST-P02', 'SU-TEST-P04', 'SU-TEST-P10'] as const;

const PERSON_CENTRED_QUESTIONS = new Set([
  'What matters most to the Service User?',
  'What do they want support to achieve?',
  'What are they worried about?',
  'Bathing / shower and dressing preferences',
  'Morning, meal, evening and bedtime routine',
  'How should staff support privacy during personal care?',
  'How and when to support me',
  'Personal hygiene',
  'Night support',
  'What is most important to me',
  'Things they want to keep doing independently',
  'How I communicate and how to communicate with me',
  'Communication needs',
  'Things they do not want support with',
  'Food likes and dislikes',
  'Known triggers (anxiety, distress, confusion)',
  'Lifestyle, role and choices',
  'Care package comments',
  'Modesty requirements',
  'Religion, culture, language, reasonable adjustments',
  'Religious or spiritual needs',
  'Prayer routine or worship needs',
  'Religious or cultural dietary requirements',
  'Any equality related risk or need',
  'Nutrition / hydration comments',
  'Hydration comment',
  'Continence product details',
  'Transfer comments',
  'Staff communication instructions',
  'Communication support notes',
  'Ulcers or wounds comment',
  'Skin / wound notes',
  'Pressure equipment details',
  'Further pressure equipment comment',
]);

const NAME_ONLY_ABOUT_ME_KEYS = new Set([
  'peopleImportantToMe',
  'supportedToWriteThisBy',
  'favouriteItems',
  'tvProgrammes',
  'favouriteRooms',
]);

const FIRST_PERSON_RE = /\b(I|I'm|I've|I'd|I'll|me|my|myself)\b/i;

const PERSONA_DOBS = new Set([
  '1944-03-12',
  '1943-05-18',
  '1954-09-03',
  '1971-02-14',
  '1941-01-20',
]);

type CatalogQuestion = {
  id: string;
  questionText: string;
  questionType: string;
  carePlanTrigger: boolean;
  riskFlag: boolean;
  metadata: Prisma.JsonValue;
  sectionNumber: number;
};

function catalogFromSeeds(): CatalogQuestion[] {
  const rows: CatalogQuestion[] = [];
  let i = 0;
  for (const section of ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS) {
    for (const row of section.questions) {
      rows.push({
        id: `q-${i++}`,
        questionText: row.questionText,
        questionType: String(row.questionType ?? 'TEXT'),
        carePlanTrigger: false,
        riskFlag: false,
        metadata: (row.metadata ?? null) as Prisma.JsonValue,
        sectionNumber: section.sectionNumber,
      });
    }
  }
  return rows;
}

function answerByKey(answers: IaDemoOverlayAnswer[], fieldKey: string): IaDemoOverlayAnswer | undefined {
  return answers.find((a) => a.fieldKey === fieldKey);
}

function answerByText(answers: IaDemoOverlayAnswer[], questionText: string): IaDemoOverlayAnswer | undefined {
  return answers.find((a) => a.questionText === questionText);
}

function yesNoValue(answers: IaDemoOverlayAnswer[], questionText: string, fieldKey?: string): boolean | undefined {
  const row = fieldKey
    ? answerByKey(answers, fieldKey) ?? answerByText(answers, questionText)
    : answerByText(answers, questionText);
  return typeof row?.value === 'boolean' ? row.value : undefined;
}

function selectValue(answers: IaDemoOverlayAnswer[], questionText: string, fieldKey?: string): string | undefined {
  const row = fieldKey
    ? answerByKey(answers, fieldKey) ?? answerByText(answers, questionText)
    : answerByText(answers, questionText);
  return typeof row?.value === 'string' ? row.value : undefined;
}

function lastByKey(answers: IaDemoOverlayAnswer[], fieldKey: string): IaDemoOverlayAnswer | undefined {
  return [...answers].reverse().find((a) => a.fieldKey === fieldKey);
}

describe('Care Plan IA demo overlay', () => {
  const catalog = catalogFromSeeds();
  const expanded = expandedCarePlanIaDemoOverlays();

  it('covers exactly the five approved people', () => {
    expect(CARE_PLAN_IA_DEMO_OVERLAYS.map((p) => p.serviceUserNumber)).toEqual([...EXPECTED_NUMBERS]);
    expect(new Set(CARE_PLAN_IA_DEMO_OVERLAYS.map((p) => p.serviceUserNumber)).size).toBe(5);
  });

  it('matches every overlay and expansion answer to an enterprise IA question', () => {
    for (const persona of expanded) {
      const unmatched = persona.answers
        .filter((answer) => !matchOverlayQuestion(catalog, answer))
        .map((answer) => answer.fieldKey ?? answer.questionText);
      expect({ person: persona.serviceUserNumber, unmatched }).toEqual({
        person: persona.serviceUserNumber,
        unmatched: [],
      });
    }
  });

  it('keeps person-centred narrative in first person and does not force it into clinical fields', () => {
    for (const persona of expanded) {
      for (const answer of persona.answers) {
        if (answer.kind !== 'text') continue;
        const text = String(answer.value);
        if (!PERSON_CENTRED_QUESTIONS.has(answer.questionText ?? '')) continue;
        if (text.split(/\s+/).length < 3) continue;
        expect({ person: persona.serviceUserNumber, question: answer.questionText, text }).toEqual(
          expect.objectContaining({ text: expect.stringMatching(FIRST_PERSON_RE) }),
        );
        expect(text.toLowerCase()).not.toContain('the service user');
      }
      for (const [key, value] of Object.entries(persona.aboutMe)) {
        if (NAME_ONLY_ABOUT_ME_KEYS.has(key)) continue;
        if (value.split(/\s+/).length < 3) continue;
        expect(value).toMatch(FIRST_PERSON_RE);
        expect(value.toLowerCase()).not.toContain('the service user');
      }
    }
  });

  it('does not infer ethnicity and does not fill optional fields with Not applicable', () => {
    for (const persona of expanded) {
      const ethnicity = lastByKey(persona.answers, 'ethnicity') ?? answerByText(persona.answers, 'Ethnicity');
      expect(ethnicity?.kind).toBe('clear');
      for (const answer of persona.answers) {
        if (answer.kind !== 'text') continue;
        expect(String(answer.value).toLowerCase()).not.toBe('not applicable');
        expect(String(answer.value).toLowerCase()).not.toBe('n/a');
      }
    }
    for (const questionText of IA_DEMO_INTENTIONALLY_EMPTY_QUESTIONS) {
      if (questionText === 'LPA name' || questionText === 'LPA designation' || questionText === 'LPA contact details') {
        continue;
      }
      if (questionText === 'GP name' || questionText === 'GP practice and phone' || questionText === 'GP contact details') {
        continue;
      }
      for (const persona of expanded) {
        const last = [...persona.answers].reverse().find((a) => a.questionText === questionText);
        expect({ person: persona.serviceUserNumber, questionText, kind: last?.kind }).toEqual({
          person: persona.serviceUserNumber,
          questionText,
          kind: 'clear',
        });
      }
    }
  });

  it('uses deterministic assessment dates from persona service-start data, not today', () => {
    const allowed = new Set<string>([
      ...Object.values(IA_DEMO_DETERMINISTIC_DATES).flatMap((d) => [d.assessment, d.review]),
      ...PERSONA_DOBS,
    ]);
    for (const persona of expanded) {
      for (const answer of persona.answers) {
        if (answer.kind !== 'date') continue;
        expect(allowed.has(String(answer.value))).toBe(true);
      }
    }
  });

  it('keeps Fatima living with her son and Betty/Fatima continence aligned to the persona spec', () => {
    const byNumber = Object.fromEntries(expanded.map((p) => [p.serviceUserNumber, p]));

    expect(yesNoValue(byNumber['SU-TEST-P04'].answers, 'Does the client live alone?', 'livesAlone')).toBe(false);

    expect(selectValue(byNumber['SU-TEST-P04'].answers, 'Gender')).toBe('female');
    expect(lastByKey(byNumber['SU-TEST-P04'].answers, 'lpoaAppointed')?.value).toBe('health');

    const fatimaBladder = answerByKey(byNumber['SU-TEST-P04'].answers, 'bladderContinenceOptions')?.value;
    const fatimaBowel = answerByKey(byNumber['SU-TEST-P04'].answers, 'bowelContinenceOptions')?.value;
    expect(fatimaBladder).toEqual(expect.arrayContaining(['incontinence', 'products']));
    expect(fatimaBowel).toEqual(expect.arrayContaining(['incontinence', 'products']));
    expect(yesNoValue(byNumber['SU-TEST-P04'].answers, 'Doubly incontinent?')).toBe(true);
    expect(yesNoValue(byNumber['SU-TEST-P04'].answers, 'Continence products in use?')).toBe(true);

    const bettyBladder = answerByKey(byNumber['SU-TEST-P10'].answers, 'bladderContinenceOptions')?.value;
    const bettyBowel = answerByKey(byNumber['SU-TEST-P10'].answers, 'bowelContinenceOptions')?.value;
    expect(bettyBladder).toEqual(['products']);
    expect(bettyBowel).toEqual(['products']);
    expect(yesNoValue(byNumber['SU-TEST-P10'].answers, 'Doubly incontinent?')).toBe(false);
    expect(yesNoValue(byNumber['SU-TEST-P10'].answers, 'Continence products in use?')).toBe(true);
  });

  it('keeps hidden follow-ups empty when the parent gate is No', () => {
    for (const persona of expanded) {
      const interpreter = yesNoValue(persona.answers, 'Interpreter required?', 'interpreterRequired');
      expect(interpreter).toBe(false);
      const language = [...persona.answers].reverse().find((a) => a.questionText === 'Language required');
      expect(language?.kind).toBe('clear');

      const choking = yesNoValue(persona.answers, 'Swallowing or choking concerns?');
      expect(choking).toBe(false);
      expect(answerByText(persona.answers, 'Choking history details')).toBeUndefined();
      expect(answerByText(persona.answers, 'SALT referral required?')).toBeUndefined();

      const pets = yesNoValue(persona.answers, 'Pets present?', 'petsPresent');
      expect(pets).toBe(false);
      expect(answerByText(persona.answers, 'Pets secured during visits?')).toBeUndefined();

      const diabetic = yesNoValue(persona.answers, 'Service User is diabetic?', 'serviceUserIsDiabetic');
      if (diabetic === false) {
        expect(lastByKey(persona.answers, 'diabetesType')).toBeUndefined();
      }
    }
  });

  it('keeps gender preference consistent with opposite-sex acceptance', () => {
    for (const persona of expanded) {
      const gender = selectValue(persona.answers, 'Staff gender preference for personal care');
      const opposite = yesNoValue(
        persona.answers,
        'Will the Service User accept care from the opposite sex?',
      );
      expect(gender).toBeDefined();
      expect(opposite).toBeDefined();
      if (gender === 'female' || gender === 'male') {
        expect(opposite).toBe(false);
      }
      if (gender === 'no_preference') {
        expect(opposite).toBe(true);
      }
    }
  });

  it('keeps wound flags consistent with comments and known clinical facts', () => {
    const byNumber = Object.fromEntries(expanded.map((p) => [p.serviceUserNumber, p]));

    expect(yesNoValue(byNumber['SU-1042'].answers, 'Currently has ulcers or wounds?', 'hasWounds')).toBe(true);
    expect(String(answerByText(byNumber['SU-1042'].answers, 'Ulcers or wounds comment')?.value)).toMatch(
      /sacrum|leg/i,
    );

    expect(yesNoValue(byNumber['SU-TEST-P01'].answers, 'Currently has ulcers or wounds?', 'hasWounds')).toBe(false);
    expect(yesNoValue(byNumber['SU-TEST-P02'].answers, 'Currently has ulcers or wounds?', 'hasWounds')).toBe(false);
    expect(yesNoValue(byNumber['SU-TEST-P10'].answers, 'Currently has ulcers or wounds?', 'hasWounds')).toBe(false);

    expect(yesNoValue(byNumber['SU-TEST-P04'].answers, 'Currently has ulcers or wounds?', 'hasWounds')).toBe(true);
    const fatimaWound = String(answerByText(byNumber['SU-TEST-P04'].answers, 'Ulcers or wounds comment')?.value);
    expect(fatimaWound.toLowerCase()).toMatch(/pressure/);
    expect(fatimaWound).not.toMatch(/category\s*[0-9]|grade\s*[0-9]/i);
  });

  it('keeps hoist and double-up flags consistent with each persona package', () => {
    const byNumber = Object.fromEntries(expanded.map((p) => [p.serviceUserNumber, p]));

    expect(yesNoValue(byNumber['SU-1042'].answers, 'Uses hoist or sling?', 'usesHoistOrSling')).toBe(false);
    expect(yesNoValue(byNumber['SU-1042'].answers, 'Comfortable with double-up care?')).toBe(true);

    expect(yesNoValue(byNumber['SU-TEST-P01'].answers, 'Uses hoist or sling?', 'usesHoistOrSling')).toBe(false);
    expect(yesNoValue(byNumber['SU-TEST-P01'].answers, 'Comfortable with double-up care?')).toBe(false);

    expect(yesNoValue(byNumber['SU-TEST-P02'].answers, 'Uses hoist or sling?', 'usesHoistOrSling')).toBe(false);
    expect(yesNoValue(byNumber['SU-TEST-P02'].answers, 'Comfortable with double-up care?')).toBe(true);

    expect(yesNoValue(byNumber['SU-TEST-P04'].answers, 'Uses hoist or sling?', 'usesHoistOrSling')).toBe(true);
    expect(yesNoValue(byNumber['SU-TEST-P04'].answers, 'Comfortable with double-up care?')).toBe(true);

    expect(yesNoValue(byNumber['SU-TEST-P10'].answers, 'Uses hoist or sling?', 'usesHoistOrSling')).toBe(true);
    expect(yesNoValue(byNumber['SU-TEST-P10'].answers, 'Comfortable with double-up care?')).toBe(true);
  });

  it('does not invent Waterlow scores in question text; MUST score 0 is allowed when MUST is completed', () => {
    for (const persona of expanded) {
      expect(yesNoValue(persona.answers, 'MUST assessment completed?')).toBe(true);
      expect(answerByText(persona.answers, 'MUST score')?.value).toBe(0);
      for (const answer of persona.answers) {
        if (answer.kind !== 'text') continue;
        expect(String(answer.value)).not.toMatch(/waterlow\s*(score)?\s*[0-9]/i);
      }
    }
  });

  it('writes structured YES/NO, SELECT, DATE, NUMBER, JSON and clear values in their existing formats', () => {
    const yesNo = overlayAnswerWriteData({
      kind: 'yesNo',
      questionText: 'Currently has ulcers or wounds?',
      fieldKey: 'hasWounds',
      value: true,
    });
    expect(yesNo.booleanValue).toBe(true);
    expect(yesNo.checked).toBe(true);
    expect(yesNo.textValue).toBeNull();

    const select = overlayAnswerWriteData({
      kind: 'select',
      questionText: 'Staff gender preference for personal care',
      value: 'female',
    });
    expect(select.selectedOptions).toEqual(['female']);
    expect(select.textValue).toBeNull();

    const multi = overlayAnswerWriteData({
      kind: 'multi',
      questionText: 'Personal care completed in — locations',
      fieldKey: 'personalCareLocations',
      value: ['bed', 'bathroom'],
    });
    expect(multi.selectedOptions).toEqual(['bed', 'bathroom']);

    const date = overlayAnswerWriteData({
      kind: 'date',
      questionText: 'Assessment date',
      fieldKey: 'assessmentDate',
      value: '2025-11-01',
    });
    expect(date.dateValue).toEqual(new Date('2025-11-01T12:00:00.000Z'));

    const number = overlayAnswerWriteData({
      kind: 'number',
      questionText: 'Weight (kg)',
      fieldKey: 'weightKg',
      value: 68.4,
    });
    expect(number.numberValue).toBe(68.4);

    const json = overlayAnswerWriteData({
      kind: 'json',
      questionText: 'Preferred visit times',
      fieldKey: 'preferredVisitTimes',
      value: { MORNING: { selected: true, from: '08:00', to: '10:00', roundName: 'Morning' } },
    });
    expect(json.selectedOptions).toEqual({
      MORNING: { selected: true, from: '08:00', to: '10:00', roundName: 'Morning' },
    });

    const cleared = overlayAnswerWriteData({
      kind: 'clear',
      questionText: 'Ethnicity',
      value: null,
    });
    expect(cleared.textValue).toBeNull();
    expect(cleared.selectedOptions).toBe(Prisma.JsonNull);
  });

  it('upserts overlay answers without deleting unrelated existing answers', async () => {
    const storedAnswers = new Map<string, Record<string, unknown>>();
    storedAnswers.set('unrelated-q', {
      questionId: 'unrelated-q',
      textValue: 'keep me',
      booleanValue: null,
      checked: null,
      selectedOptions: null,
      notes: null,
      numberValue: null,
      dateValue: null,
    });

    const questions = [
      {
        id: 'gender-q',
        questionText: 'Staff gender preference for personal care',
        questionType: 'SINGLE_SELECT',
        carePlanTrigger: false,
        riskFlag: false,
        metadata: {},
        sectionNumber: 1,
      },
      {
        id: 'wounds-q',
        questionText: 'Currently has ulcers or wounds?',
        questionType: 'YES_NO',
        carePlanTrigger: true,
        riskFlag: true,
        metadata: { fieldKey: 'hasWounds' },
        sectionNumber: 11,
      },
    ];

    const prisma = {
      initialAssessmentTemplate: {
        findFirst: async () => ({ id: 'template-1' }),
      },
      initialAssessmentSection: {
        findMany: async () => [{ sectionNumber: 1, questions }],
      },
      serviceUser: {
        findFirst: async ({ where }: { where: { serviceUserNumber: string } }) =>
          where.serviceUserNumber === 'SU-1042' ? { id: 'su-margaret' } : null,
      },
      initialAssessmentSubmission: {
        findFirst: async () => ({
          id: 'sub-1',
          status: 'SUBMITTED',
          submittedAt: new Date('2026-01-01'),
          completedAt: new Date('2026-01-01'),
          metadata: { adl: { keep: true }, waterlow: { keep: true }, customKeep: true },
        }),
        update: async ({ data }: { data: { metadata?: Record<string, unknown> } }) => {
          expect(data.metadata).toEqual(
            expect.objectContaining({
              customKeep: true,
              [CARE_PLAN_IA_DEMO_OVERLAY_META_FLAG]: true,
              overlayVersion: 2,
            }),
          );
          expect(data.metadata?.waterlow).not.toEqual({ keep: true });
          return { id: 'sub-1' };
        },
        create: async () => {
          throw new Error('should reuse existing submission');
        },
      },
      initialAssessmentAnswer: {
        findMany: async () => Array.from(storedAnswers.values()),
        upsert: async ({
          where,
          create,
        }: {
          where: { submissionId_questionId: { questionId: string } };
          create: Record<string, unknown>;
        }) => {
          storedAnswers.set(where.submissionId_questionId.questionId, create);
          return create;
        },
      },
      serviceUserReference: {
        findFirst: async () => ({
          id: 'about-1',
          referenceValue: JSON.stringify({ version: 1, myChildhood: 'keep this', customKeep: 'stay' }),
        }),
        update: async ({ data }: { data: { referenceValue: string } }) => {
          const parsed = JSON.parse(data.referenceValue) as Record<string, unknown>;
          expect(parsed.customKeep).toBe('stay');
          expect(String(parsed.whatIsMostImportantToMe)).toMatch(/\bI\b/);
          expect(parsed.routine).toBeDefined();
          return { id: 'about-1' };
        },
        create: async () => {
          throw new Error('should update existing About Me');
        },
      },
    };

    const result = await applyCarePlanIaDemoOverlay(prisma as never);
    expect(result.people.filter((p) => !p.skipped)).toHaveLength(1);
    expect(result.people.find((p) => p.serviceUserNumber === 'SU-1042')?.upserted).toBeGreaterThan(0);
    expect(storedAnswers.get('unrelated-q')?.textValue).toBe('keep me');
    expect(storedAnswers.get('gender-q')).toEqual(expect.objectContaining({ selectedOptions: ['female'] }));
    expect(storedAnswers.get('wounds-q')).toEqual(expect.objectContaining({ booleanValue: true, checked: true }));
  });
});
