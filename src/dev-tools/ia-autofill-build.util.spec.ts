import {
  buildAutofillAnswers,
  buildHolisticWorksheetMetadata,
  collectWritableDemoQuestionIds,
  extraQuestionsForHolisticTab,
  IA_DEMO_ADL_ACTIVITY_IDS,
  type IaAutofillLevel,
  type TemplateQuestion,
} from './ia-autofill-build.util';

function q(
  id: string,
  sectionNumber: number,
  extra: Partial<TemplateQuestion> = {},
): TemplateQuestion {
  return {
    id,
    questionText: extra.questionText ?? `Question ${id}`,
    questionType: extra.questionType ?? 'YES_NO',
    isRequired: extra.isRequired ?? true,
    sortOrder: extra.sortOrder ?? 1,
    metadata: extra.metadata ?? null,
    options: extra.options,
    sectionNumber,
  };
}

const FIXTURE: TemplateQuestion[] = [
  q('assessor-s1', 1, {
    questionText: 'Assessor name',
    questionType: 'TEXT',
    metadata: { specRef: '1.1', fieldKey: 'assessorName' },
  }),
  q('interpreter', 1, {
    questionText: 'Interpreter required?',
    metadata: { specRef: '1.8', syncKey: 'interpreterRequired' },
  }),
  q('language', 1, {
    questionText: 'Language required',
    questionType: 'TEXT',
    isRequired: false,
    sortOrder: 40,
    metadata: { specRef: '1.8', showWhen: { gateTextIncludes: 'interpreter required', yes: true } },
  }),
  q('consent-assess', 2, {
    questionText: 'Has the Service User consented to this assessment?',
    metadata: { specRef: '2.1' },
  }),
  q('consent-by', 2, {
    questionText: 'Consent given by',
    questionType: 'SINGLE_SELECT',
    options: [{ value: 'service_user', label: 'Service user' }],
    metadata: { specRef: '2.1', fieldKey: 'consentGivenBy' },
  }),
  q('consent-care', 2, {
    questionText: 'Has the Service User consented to receive care and support?',
    metadata: { specRef: '2.2' },
  }),
  q('consent-explained', 2, {
    questionText: 'Information explained in a way they understand?',
    metadata: { specRef: '2.3' },
  }),
  q('capacity', 2, {
    questionText: 'Capacity to consent to assessment appears intact?',
    metadata: { specRef: '2.4' },
  }),
  q('mca-required', 2, {
    questionText: 'MCA required?',
    metadata: { specRef: '2.5' },
  }),
  q('share-gp', 2, { questionText: 'Consent to share with GP', metadata: { specRef: '2.8' } }),
  q('share-family', 2, { questionText: 'Consent to share with family', metadata: { specRef: '2.8' } }),
  q('manage-home', 3, {
    questionText: 'Can client manage home environment safely?',
    metadata: { specRef: '3.3', fieldKey: 'manageHomeEnvironmentSafely' },
  }),
  q('home-measures', 3, {
    questionText: 'If no, what measure should be taken?',
    questionType: 'TEXTAREA',
    isRequired: false,
    metadata: {
      specRef: '3.4',
      fieldKey: 'homeEnvironmentSafetyMeasures',
      showWhen: { gateTextIncludes: 'manage home environment safely', no: true },
    },
  }),
  q('access', 3, {
    questionText: 'Access instructions for staff',
    questionType: 'TEXTAREA',
    metadata: { specRef: '3.5', fieldKey: 'accessInstructions', prefillKey: 'accessInstruction' },
  }),
  q('key-safe-present', 3, {
    questionText: 'Key safe present?',
    isRequired: false,
    metadata: { specRef: '3.5', fieldKey: 'keySafePresent' },
  }),
  q('key-safe-code', 3, {
    questionText: 'Key safe code',
    questionType: 'TEXT',
    isRequired: false,
    metadata: { specRef: '3.6', fieldKey: 'keySafeCode', secureField: true },
  }),
  q('key-safe-location', 3, {
    questionText: 'Key safe location',
    questionType: 'TEXT',
    isRequired: false,
    metadata: { specRef: '3.6', fieldKey: 'keySafeLocation' },
  }),
  q('lone-worker', 3, {
    questionText: 'Lone worker risk identified?',
    metadata: { specRef: '3.9' },
  }),
  q('diabetic', 4, {
    questionText: 'Service User is diabetic?',
    metadata: { specRef: '4.4', fieldKey: 'serviceUserIsDiabetic' },
  }),
  q('diabetes-type', 4, {
    questionText: 'Type of diabetes',
    questionType: 'SINGLE_SELECT',
    options: ['Type A', 'Type B'],
    metadata: {
      specRef: '4.4',
      fieldKey: 'diabetesType',
      showWhen: { gateTextIncludes: 'service user is diabetic', yes: true },
    },
  }),
  q('wounds', 11, {
    questionText: 'Currently has ulcers or wounds?',
    isRequired: false,
    metadata: { specRef: '11.1', fieldKey: 'hasWounds' },
  }),
  q('wound-assessment', 11, {
    questionText: 'Has wound assessment been completed?',
    metadata: { specRef: '11.1' },
  }),
  q('falls', 12, {
    questionText: 'Falls in last 12 months?',
    isRequired: false,
    metadata: { specRef: '12.7', fieldKey: 'fallsLast12Months' },
  }),
  q('falls-count', 12, {
    questionText: 'Number of falls (last 12 months)',
    questionType: 'NUMBER',
    isRequired: false,
    metadata: { specRef: '12.7', showWhen: { gateTextIncludes: 'falls in last', yes: true } },
  }),
  q('falls-date', 12, {
    questionText: 'Most recent fall date',
    questionType: 'DATE',
    isRequired: false,
    metadata: { specRef: '12.7', showWhen: { gateTextIncludes: 'falls in last', yes: true } },
  }),
  q('safeguarding', 13, {
    questionText: 'Any safeguarding concerns identified?',
    metadata: { specRef: '13.1', fieldKey: 'safeguardingConcern' },
  }),
  q('sg-types', 13, {
    questionText: 'Safeguarding concern types',
    questionType: 'MULTI_SELECT',
    isRequired: false,
    options: ['neglect', 'self-neglect'],
    metadata: { specRef: '13.2', showWhen: { gateTextIncludes: 'safeguarding concerns identified', yes: true } },
  }),
  q('sg-details', 13, {
    questionText: 'Safeguarding concern details',
    questionType: 'TEXTAREA',
    isRequired: false,
    metadata: { specRef: '13.1', showWhen: { gateTextIncludes: 'safeguarding concerns identified', yes: true } },
  }),
  q('sg-action', 13, {
    questionText: 'Immediate action taken?',
    questionType: 'TEXTAREA',
    isRequired: false,
    metadata: { specRef: '13.7', showWhen: { gateTextIncludes: 'safeguarding concerns identified', yes: true } },
  }),
  q('emergency', 13, {
    questionText: 'Emergency contact 1 recorded?',
    metadata: { specRef: '13.3' },
  }),
  q('no-response', 13, {
    questionText: 'No response procedure agreed?',
    metadata: { specRef: '13.5', fieldKey: 'noResponseProcedureAgreed' },
  }),
  q('assessment-reason', 14, {
    questionText: 'Assessment reason',
    questionType: 'SINGLE_SELECT',
    options: [{ value: 'initial', label: 'Initial' }],
    metadata: { specRef: '14.1', fieldKey: 'assessmentReason' },
  }),
  q('assessment-date', 14, {
    questionText: 'Assessment date',
    questionType: 'DATE',
    metadata: { specRef: '14.1', fieldKey: 'assessmentDate' },
  }),
  q('next-review', 14, {
    questionText: 'Next review date',
    questionType: 'DATE',
    metadata: { specRef: '14.1', fieldKey: 'nextReviewDate' },
  }),
  q('review-freq', 14, {
    questionText: 'Review frequency',
    questionType: 'SINGLE_SELECT',
    options: [{ value: '6_months', label: '6 months' }],
    metadata: { specRef: '14.1', fieldKey: 'reviewFrequency' },
  }),
  q('reviewer', 14, {
    questionText: 'Responsible reviewer (name or role)',
    questionType: 'TEXT',
    metadata: { specRef: '14.1', fieldKey: 'responsibleReviewer' },
  }),
  q('assessor-s14', 14, {
    questionText: 'Assessor name',
    questionType: 'TEXT',
    metadata: { specRef: '14.8', fieldKey: 'assessorName' },
  }),
  q('unrelated-pain', 5, { questionText: 'Pain comment', questionType: 'TEXTAREA', isRequired: false }),
];

function idsForTab(
  tabId: number,
  requested: string[],
  level: IaAutofillLevel,
  identity?: import('./ia-autofill-build.util').IaDemoIdentity | null,
) {
  return collectWritableDemoQuestionIds(tabId, FIXTURE, requested, level, identity);
}

function generateTab(
  tabId: number,
  requested: string[],
  level: IaAutofillLevel,
  identity?: import('./ia-autofill-build.util').IaDemoIdentity | null,
) {
  const writable = idsForTab(tabId, requested, level, identity);
  return buildAutofillAnswers(FIXTURE, level, writable, identity);
}

function mergeAllTabs(level: IaAutofillLevel) {
  const tabRequests: Record<number, string[]> = {
    1: ['interpreter', 'diabetic', 'wounds', 'manage-home'],
    3: [],
    8: [],
    10: ['unrelated-pain'],
    12: [],
    13: [],
    16: ['assessor-s14'],
  };
  const merged = new Map<string, ReturnType<typeof generateTab>[number]>();
  for (const [tab, requested] of Object.entries(tabRequests)) {
    for (const a of generateTab(Number(tab), requested, level)) {
      merged.set(a.questionId, a);
    }
  }
  return merged;
}

describe('IA demo builder — tab extras, follow-ups, ADL', () => {
  it.each(['critical', 'normal', 'low'] as const)(
    '%s complete generation covers required submit fields',
    (level) => {
      const answers = mergeAllTabs(level);
      const must = [
        'lone-worker',
        'emergency',
        'safeguarding',
        'no-response',
        'next-review',
        'assessment-reason',
        'assessment-date',
        'review-freq',
        'reviewer',
        'consent-assess',
        'consent-by',
        'consent-care',
        'consent-explained',
        'capacity',
        'mca-required',
        'share-gp',
        'share-family',
        'assessor-s1',
        'assessor-s14',
        'diabetic',
        'diabetes-type',
        'manage-home',
      ];
      for (const id of must) {
        expect(answers.has(id)).toBe(true);
      }
    },
  );

  it('Very Critical: wounds = Yes also generates wound assessment', () => {
    const answers = generateTab(1, ['wounds'], 'critical');
    const byId = new Map(answers.map((a) => [a.questionId, a]));
    expect(byId.get('wounds')?.booleanValue).toBe(true);
    expect(byId.get('wound-assessment')?.booleanValue).toBe(true);
  });

  it('diabetes = Yes generates Type of diabetes at every level', () => {
    for (const level of ['critical', 'normal', 'low'] as const) {
      const answers = generateTab(1, ['diabetic'], level);
      const byId = new Map(answers.map((a) => [a.questionId, a]));
      expect(byId.get('diabetic')?.booleanValue).toBe(true);
      expect(byId.get('diabetes-type')?.selectedOptions).toBeTruthy();
    }
  });

  it('Very Critical safeguarding chain includes types, details and action', () => {
    const answers = generateTab(13, [], 'critical');
    const ids = answers.map((a) => a.questionId);
    expect(ids).toEqual(expect.arrayContaining(['safeguarding', 'sg-types', 'sg-details', 'sg-action']));
    const byId = new Map(answers.map((a) => [a.questionId, a]));
    expect(byId.get('safeguarding')?.booleanValue).toBe(true);
    expect(byId.get('sg-details')?.textValue).toBeTruthy();
  });

  it('Moderate/Stable safeguarding stays No and does not require details', () => {
    for (const level of ['normal', 'low'] as const) {
      const answers = generateTab(13, [], level);
      const byId = new Map(answers.map((a) => [a.questionId, a]));
      expect(byId.get('safeguarding')?.booleanValue).toBe(false);
      expect(byId.has('sg-details')).toBe(false);
    }
  });

  it('Very Critical falls = Yes generates falls count and date', () => {
    const answers = generateTab(8, [], 'critical');
    const ids = answers.map((a) => a.questionId);
    expect(ids).toEqual(expect.arrayContaining(['falls', 'falls-count', 'falls-date']));
    const byId = new Map(answers.map((a) => [a.questionId, a]));
    expect(byId.get('falls')?.booleanValue).toBe(true);
    expect(byId.get('falls-date')?.dateValue).toBeTruthy();
  });

  it('ADL metadata has every activity row and a falls date when completed', () => {
    const critical = buildHolisticWorksheetMetadata('critical');
    const adl = critical.adl as {
      rows: { id: string }[];
      fallsAssessmentCompleted: boolean;
      fallsAssessmentDate: string | null;
    };
    expect(adl.rows.map((r) => r.id).sort()).toEqual([...IA_DEMO_ADL_ACTIVITY_IDS].sort());
    expect(adl.fallsAssessmentCompleted).toBe(true);
    expect(adl.fallsAssessmentDate).toBeTruthy();

    const stable = buildHolisticWorksheetMetadata('low');
    const stableAdl = stable.adl as { rows: { id: string }[]; fallsAssessmentCompleted: boolean };
    expect(stableAdl.rows).toHaveLength(IA_DEMO_ADL_ACTIVITY_IDS.length);
    expect(stableAdl.fallsAssessmentCompleted).toBe(false);
  });

  it('§1 assessorName is populated (submit lookup first-match)', () => {
    const answers = generateTab(1, [], 'critical');
    const s1 = answers.find((a) => a.questionId === 'assessor-s1');
    expect(s1?.textValue).toBeTruthy();
    expect(s1?.textValue).not.toMatch(/E2E|lorem|test user/i);
  });

  it('§14.1 next review / planning fields are generated on tab 16', () => {
    const answers = generateTab(16, [], 'normal');
    const ids = answers.map((a) => a.questionId);
    expect(ids).toEqual(
      expect.arrayContaining([
        'next-review',
        'assessment-reason',
        'assessment-date',
        'review-freq',
        'reviewer',
      ]),
    );
  });

  it('§2.1–§2.8 consent fields are generated on tab 3', () => {
    const answers = generateTab(3, [], 'low');
    expect(answers.map((a) => a.questionId)).toEqual(
      expect.arrayContaining([
        'consent-assess',
        'consent-by',
        'consent-care',
        'consent-explained',
        'capacity',
        'mca-required',
        'share-gp',
        'share-family',
      ]),
    );
    const consentBy = answers.find((a) => a.questionId === 'consent-by');
    expect(consentBy?.selectedOptions).toBe('service_user');
    expect(consentBy?.booleanValue).toBeUndefined();
  });

  it('fills empty access instructions, but never overwrites an existing profile value or secure code', () => {
    const empty = generateTab(12, ['access', 'key-safe-code', 'key-safe-present'], 'critical');
    expect(empty.map((a) => a.questionId)).toContain('access');
    expect(empty.map((a) => a.questionId)).not.toContain('key-safe-code');

    const occupied = generateTab(
      12,
      ['access', 'key-safe-code', 'key-safe-present'],
      'critical',
      { accessInstruction: 'Use the side gate.' },
    );
    expect(occupied.map((a) => a.questionId)).not.toContain('access');
    expect(occupied.map((a) => a.questionId)).not.toContain('key-safe-code');
    expect(occupied.map((a) => a.questionId)).toContain('lone-worker');
  });

  it('tab 10 Fill does not populate tab 13 safeguarding fields', () => {
    const answers = generateTab(10, ['unrelated-pain'], 'critical');
    const ids = answers.map((a) => a.questionId);
    expect(ids).toContain('unrelated-pain');
    expect(ids).not.toContain('safeguarding');
    expect(ids).not.toContain('emergency');
    expect(ids).not.toContain('lone-worker');
  });

  it('manage-home is a tab-1 extra (template question, not only worksheet metadata)', () => {
    const extras = extraQuestionsForHolisticTab(1, FIXTURE).map((x) => x.id);
    expect(extras).toContain('manage-home');
    const answers = generateTab(1, [], 'critical');
    expect(answers.some((a) => a.questionId === 'manage-home')).toBe(true);
  });

  it('interpreter = No leaves language required empty at every level', () => {
    for (const level of ['critical', 'normal', 'low'] as const) {
      const answers = generateTab(1, ['interpreter', 'language'], level);
      const byId = new Map(answers.map((a) => [a.questionId, a]));
      expect(byId.get('interpreter')?.booleanValue).toBe(false);
      expect(byId.has('language')).toBe(false);
    }
  });

  it('optional fields are filled at Moderate and Stable, not only required ones', () => {
    for (const level of ['normal', 'low'] as const) {
      const answers = generateTab(10, ['unrelated-pain'], level);
      expect(answers.some((a) => a.questionId === 'unrelated-pain' && a.textValue)).toBe(true);
    }
  });

  it('About Me prefills are filled; empty DOB is filled; occupied DOB is not overwritten', () => {
    const about = q('about-priorities', 1, {
      questionText: 'Personal priorities, goals, independence goals',
      questionType: 'TEXTAREA',
      isRequired: false,
      metadata: { specRef: '1.3', prefillKey: 'aboutMePriorities' },
    });
    const dob = q('dob', 1, {
      questionText: 'Date of birth',
      questionType: 'DATE',
      metadata: { specRef: '1.1', prefillKey: 'dateOfBirth' },
    });
    const questions = [...FIXTURE, about, dob];
    const emptyWritable = collectWritableDemoQuestionIds(1, questions, ['about-priorities', 'dob'], 'normal');
    const empty = buildAutofillAnswers(questions, 'normal', emptyWritable);
    expect(empty.map((a) => a.questionId)).toEqual(expect.arrayContaining(['about-priorities', 'dob']));
    expect(empty.find((a) => a.questionId === 'dob')?.dateValue).toBe('1948-06-15');

    const occupiedWritable = collectWritableDemoQuestionIds(
      1,
      questions,
      ['about-priorities', 'dob'],
      'normal',
      { dateOfBirth: '1944-03-12' },
    );
    const occupied = buildAutofillAnswers(questions, 'normal', occupiedWritable, { dateOfBirth: '1944-03-12' });
    expect(occupied.map((a) => a.questionId)).toContain('about-priorities');
    expect(occupied.map((a) => a.questionId)).not.toContain('dob');
    const text = occupied.find((a) => a.questionId === 'about-priorities')?.textValue ?? '';
    expect(text).toMatch(/^(I |I'm |Please |My )/i);
  });

  it('photography consent uses the Service User identity, never Margaret Hughes', () => {
    const meta = buildHolisticWorksheetMetadata('normal', {
      firstName: 'Helen',
      lastName: 'Wright',
      preferredName: 'Helen',
      nhsNumber: '943 476 5919',
    });
    const photo = meta.photographyConsent as { firstNames: string; surname: string; consentSubjectName: string };
    expect(photo.firstNames).toBe('Helen');
    expect(photo.surname).toBe('Wright');
    expect(photo.consentSubjectName).toBe('Helen');
  });

  it('key safe present = Yes generates location but never the secure code', () => {
    const answers = generateTab(12, ['key-safe-present'], 'critical');
    const ids = answers.map((a) => a.questionId);
    expect(ids).toContain('key-safe-location');
    expect(ids).not.toContain('key-safe-code');
  });
});
