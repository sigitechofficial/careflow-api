import { InitialAssessmentStatus } from '@prisma/client';
import {
  hasAgreedGoal,
  isSkippableIncompleteValidationMessage,
  validateInitialAssessmentSubmission,
} from './initial-assessment-validation.util';

const baseQuestion = (overrides: {
  id: string;
  questionText: string;
  sectionNumber: number;
  isRequired?: boolean;
  questionType?: string;
  metadata?: object;
}) => ({
  questionType: 'YES_NO',
  isRequired: false,
  metadata: null,
  ...overrides,
  section: { sectionNumber: overrides.sectionNumber },
});

describe('validateInitialAssessmentSubmission', () => {
  it('accepts explicit No for required yes/no questions', () => {
    const required = baseQuestion({
      id: 'r1',
      questionText: 'Needs help with washing?',
      sectionNumber: 3,
      isRequired: true,
    });
    const result = validateInitialAssessmentSubmission({
      status: InitialAssessmentStatus.IN_PROGRESS,
      questions: [required],
      answers: [
        {
          questionId: 'r1',
          checked: false,
          booleanValue: false,
          textValue: null,
          numberValue: null,
          dateValue: null,
          timeValue: null,
          selectedOptions: null,
        },
      ],
      metadata: { adl: { rows: defaultAdlRows() } },
    });
    expect(
      result.blocks.some((b) =>
        b.message.includes('Required: Needs help with washing?'),
      ),
    ).toBe(false);
  });

  describe('consent refusal and capacity doubt (Consent tab)', () => {
    const consent = baseQuestion({
      id: 'c1',
      questionText:
        'Does the service user consent to this Initial Assessment being carried out?',
      sectionNumber: 2,
      metadata: { specRef: '2.1', fieldKey: 'consentToAssessment' },
    });
    const doubt = baseQuestion({
      id: 'd1',
      questionText:
        'Is there any reason to doubt the service user’s capacity to make this specific decision?',
      sectionNumber: 2,
      metadata: { specRef: '2.4', fieldKey: 'capacityDoubt' },
    });
    const mcaDone = baseQuestion({
      id: 'm1',
      questionText: 'MCA completed?',
      sectionNumber: 2,
      metadata: { specRef: '2.5' },
    });
    const understands = baseQuestion({
      id: 'u1',
      questionText:
        'Does the service user understand the information provided about this assessment?',
      sectionNumber: 2,
      questionType: 'SINGLE_SELECT',
      metadata: { specRef: '2.3', fieldKey: 'understandsAssessmentInfo' },
    });
    const answer = (questionId: string, patch: object) => ({
      questionId,
      checked: null,
      booleanValue: null,
      textValue: null,
      numberValue: null,
      dateValue: null,
      timeValue: null,
      selectedOptions: null,
      ...patch,
    });
    const yn = (questionId: string, value: boolean) =>
      answer(questionId, { checked: value, booleanValue: value });
    const run = (answers: ReturnType<typeof answer>[]) =>
      validateInitialAssessmentSubmission({
        status: InitialAssessmentStatus.IN_PROGRESS,
        questions: [consent, doubt, mcaDone, understands],
        answers,
        metadata: { adl: { rows: defaultAdlRows() } },
      });
    const messages = (r: ReturnType<typeof run>) =>
      r.blocks.map((b) => b.message);

    it('blocks a refusal when there is no reason to doubt capacity', () => {
      expect(messages(run([yn('c1', false), yn('d1', false)]))).toContain(
        'Consent to assessment is No — cannot submit (section 2.1)',
      );
    });

    it('does not simply block a refusal when capacity is in doubt — MCA is required instead', () => {
      const blocks = messages(
        run([yn('c1', false), yn('d1', true), yn('m1', false)]),
      );
      expect(blocks).not.toContain(
        'Consent to assessment is No — cannot submit (section 2.1)',
      );
      expect(blocks).toContain(
        'Capacity in doubt — MCA must be completed before submit (section 2.4–2.5)',
      );
    });

    it('clears the capacity block once the MCA is completed', () => {
      const blocks = messages(
        run([yn('c1', false), yn('d1', true), yn('m1', true)]),
      );
      expect(blocks.some((m) => m.startsWith('Capacity in doubt'))).toBe(false);
    });

    it.each(['no', 'unsure'])(
      'warns (not blocks) when understanding is %s',
      (value) => {
        const r = run([
          yn('c1', true),
          yn('d1', false),
          answer('u1', { selectedOptions: [value] }),
        ]);
        expect(r.warnings.map((w) => w.message)).toContain(
          'Service user may not understand the assessment — consider a Mental Capacity Assessment (section 2.3)',
        );
        expect(
          r.blocks.some((b) => b.message.includes('may not understand')),
        ).toBe(false);
      },
    );

    it('still reads the old "capacity appears intact?" question (No = doubt)', () => {
      const legacy = baseQuestion({
        id: 'l1',
        questionText: 'Capacity to consent to assessment appears intact?',
        sectionNumber: 2,
        metadata: { specRef: '2.4' },
      });
      const r = validateInitialAssessmentSubmission({
        status: InitialAssessmentStatus.IN_PROGRESS,
        questions: [consent, legacy, mcaDone],
        answers: [yn('c1', true), yn('l1', false), yn('m1', false)],
        metadata: { adl: { rows: defaultAdlRows() } },
      });
      expect(messages(r)).toContain(
        'Capacity in doubt — MCA must be completed before submit (section 2.4–2.5)',
      );
    });
  });

  describe('decision-specific capacity records (metadata.capacityDecisions)', () => {
    const consent = baseQuestion({
      id: 'c1',
      questionText:
        'Does the service user consent to this Initial Assessment being carried out?',
      sectionNumber: 2,
      metadata: { specRef: '2.1', fieldKey: 'consentToAssessment' },
    });
    const doubt = baseQuestion({
      id: 'd1',
      questionText:
        'Is there any reason to doubt the service user’s capacity to make this specific decision?',
      sectionNumber: 2,
      metadata: { specRef: '2.4', fieldKey: 'capacityDoubt' },
    });
    const mcaDone = baseQuestion({
      id: 'm1',
      questionText: 'MCA completed?',
      sectionNumber: 2,
      metadata: { specRef: '2.5' },
    });
    const legacyOutcome = baseQuestion({
      id: 'o1',
      questionText: 'Outcome of the mental capacity screening tool',
      sectionNumber: 2,
      questionType: 'SINGLE_SELECT',
      isRequired: true,
      metadata: { specRef: '2.mca', fieldKey: 'mcaScreeningOutcome' },
    });
    const legacyStage1 = baseQuestion({
      id: 's1',
      questionText:
        'Does the person have an impairment or disturbance in the functioning of the mind or brain?',
      sectionNumber: 2,
      isRequired: true,
      metadata: { specRef: '2.mca', fieldKey: 'mcaStage1Impairment' },
    });
    const yn = (questionId: string, value: boolean) => ({
      questionId,
      checked: value,
      booleanValue: value,
      textValue: null,
      numberValue: null,
      dateValue: null,
      timeValue: null,
      selectedOptions: null,
    });
    const record = (patch: object) => ({
      id: 'r1',
      decision: 'consent_to_assessment',
      relevantInformation: 'Purpose of the assessment and what happens next',
      practicableSteps: 'Quiet room, daughter present',
      understand: 'yes',
      retain: 'yes',
      weigh: 'yes',
      communicate: 'yes',
      outcome: 'has_capacity',
      wishes: 'Does not want strangers in the house',
      objection: 'no',
      assessorName: 'A. Assessor',
      assessedOn: '2026-09-20',
      ...patch,
    });
    const lacks = (patch: object = {}) =>
      record({
        weigh: 'no',
        impairment: 'yes',
        causativeNexus: 'yes',
        outcome: 'lacks_capacity',
        authorityCovers: 'no',
        bestInterestsDecisionMaker: 'Registered manager',
        bestInterestsConsulted: 'Daughter, GP',
        bestInterestsOutcome: 'Short assessment with daughter present',
        ...patch,
      });
    const run = (
      answers: ReturnType<typeof yn>[],
      capacityDecisions: object[] = [],
      extra = [] as ReturnType<typeof baseQuestion>[],
    ) =>
      validateInitialAssessmentSubmission({
        status: InitialAssessmentStatus.IN_PROGRESS,
        questions: [consent, doubt, mcaDone, ...extra],
        answers,
        metadata: { adl: { rows: defaultAdlRows() }, capacityDecisions },
      });
    const blocks = (r: ReturnType<typeof run>) =>
      r.blocks.map((b) => b.message);

    it('capacity doubt asks for a record for the decision (skippable), not a global screening', () => {
      const r = run(
        [yn('c1', true), yn('d1', true), yn('m1', true)],
        [],
        [legacyOutcome, legacyStage1],
      );
      const required =
        'Required: capacity assessment for "Consent to the proposed care" — Reason to doubt capacity (Consent)';
      expect(blocks(r)).toContain(required);
      expect(isSkippableIncompleteValidationMessage(required)).toBe(true);
      expect(
        blocks(r).some(
          (m) =>
            m === 'Required: Outcome of the mental capacity screening tool',
        ),
      ).toBe(false);
    });

    it('a refusal by a person with capacity for this decision stands, even with a doubt', () => {
      const r = run(
        [yn('c1', false), yn('d1', true), yn('m1', true)],
        [record({})],
      );
      expect(blocks(r)).toContain(
        'Consent to assessment is No — cannot submit (section 2.1)',
      );
    });

    it('lacking capacity, the refusal is not ignored: best interests + manager review', () => {
      const noBi = run(
        [yn('c1', false), yn('d1', true), yn('m1', true)],
        [lacks({ bestInterestsOutcome: '' })],
      );
      expect(
        blocks(noBi).some((m) =>
          m.startsWith('Consent to assessment is No and capacity is in doubt'),
        ),
      ).toBe(true);

      const withBi = run(
        [yn('c1', false), yn('d1', true), yn('m1', true)],
        [lacks({ objection: 'yes', objectionDetails: 'Says go away' })],
      );
      expect(
        blocks(withBi).some((m) => m.startsWith('Consent to assessment is No')),
      ).toBe(false);
      const warnings = withBi.warnings.map((w) => w.message);
      expect(
        warnings.some((m) =>
          m.startsWith(
            'Consent to assessment refused by a person assessed as lacking capacity',
          ),
        ),
      ).toBe(true);
      expect(
        warnings.some((m) =>
          /the person objects — manager review required/.test(m),
        ),
      ).toBe(true);
    });

    it('an unfinished record is a skippable block naming what is missing', () => {
      const r = run(
        [yn('c1', true), yn('d1', false)],
        [{ id: 'x', decision: 'photography' }],
      );
      const msg = blocks(r).find((m) =>
        m.startsWith('Capacity assessment incomplete — Clinical photography:'),
      );
      expect(msg).toBeDefined();
      expect(isSkippableIncompleteValidationMessage(msg!)).toBe(true);
    });

    it('old IAs that already used the global screening keep the old rules', () => {
      const outcomeAnswer = {
        ...yn('o1', false),
        checked: null,
        booleanValue: null,
        selectedOptions: ['has_capacity'],
      };
      const r = run(
        [
          yn('c1', true),
          yn('d1', true),
          yn('m1', true),
          outcomeAnswer as never,
        ],
        [],
        [legacyOutcome, legacyStage1],
      );
      expect(
        blocks(r).some((m) =>
          m.startsWith('Required: capacity assessment for'),
        ),
      ).toBe(false);
      expect(blocks(r)).toContain(
        'Required: Does the person have an impairment or disturbance in the functioning of the mind or brain?',
      );
    });
  });

  it('blocks when consent to assessment is No', () => {
    const consent = baseQuestion({
      id: 'c1',
      questionText: 'Consent to assessment?',
      sectionNumber: 2,
      metadata: { specRef: '2.1' },
    });
    const result = validateInitialAssessmentSubmission({
      status: InitialAssessmentStatus.IN_PROGRESS,
      questions: [consent],
      answers: [
        {
          questionId: 'c1',
          checked: false,
          booleanValue: false,
          textValue: null,
          numberValue: null,
          dateValue: null,
          timeValue: null,
          selectedOptions: null,
        },
      ],
      metadata: { adl: { rows: defaultAdlRows() } },
    });
    expect(result.canSubmit).toBe(false);
    expect(
      result.blocks.some((b) => b.message.includes('Consent to assessment')),
    ).toBe(true);
  });

  it('skips required fields hidden by showWhen metadata', () => {
    const gate = baseQuestion({
      id: 'g1',
      questionText: 'Currently has ulcers or wounds?',
      sectionNumber: 11,
      metadata: { specRef: '11.2', fieldKey: 'hasWounds' },
    });
    const followUp = baseQuestion({
      id: 'f1',
      questionText: 'Has wound assessment been completed?',
      sectionNumber: 11,
      isRequired: true,
      metadata: {
        specRef: '11.2',
        showWhen: {
          gateTextIncludes: 'currently has ulcers or wounds',
          yes: true,
        },
      },
    });
    const result = validateInitialAssessmentSubmission({
      status: InitialAssessmentStatus.IN_PROGRESS,
      questions: [gate, followUp],
      answers: [
        {
          questionId: 'g1',
          checked: false,
          booleanValue: false,
          textValue: null,
          numberValue: null,
          dateValue: null,
          timeValue: null,
          selectedOptions: null,
        },
      ],
      metadata: { adl: { rows: defaultAdlRows() } },
    });
    expect(
      result.blocks.some((b) =>
        b.message.includes('wound assessment been completed'),
      ),
    ).toBe(false);
  });

  it('blocks safeguarding concern without details', () => {
    const gate = baseQuestion({
      id: 'sg1',
      questionText: 'Any safeguarding concerns identified?',
      sectionNumber: 13,
      isRequired: true,
      metadata: { specRef: '13.1', fieldKey: 'safeguardingConcern' },
    });
    const details = baseQuestion({
      id: 'sg2',
      questionText: 'Safeguarding concern details',
      sectionNumber: 13,
      questionType: 'TEXTAREA',
      metadata: {
        specRef: '13.1',
        showWhen: {
          gateTextIncludes: 'safeguarding concerns identified',
          yes: true,
        },
      },
    });
    const result = validateInitialAssessmentSubmission({
      status: InitialAssessmentStatus.IN_PROGRESS,
      questions: [gate, details],
      answers: [
        {
          questionId: 'sg1',
          checked: true,
          booleanValue: true,
          textValue: null,
          numberValue: null,
          dateValue: null,
          timeValue: null,
          selectedOptions: null,
        },
      ],
      metadata: { adl: { rows: defaultAdlRows() } },
    });
    expect(result.canSubmit).toBe(false);
    expect(
      result.blocks.some((b) =>
        b.message.includes('Safeguarding concern flagged but details'),
      ),
    ).toBe(true);
    expect(result.canSubmitIncomplete).toBe(false);
  });

  it('allows incomplete submit when only skippable required fields are missing', () => {
    const required = baseQuestion({
      id: 'r1',
      questionText: 'Preferred name?',
      sectionNumber: 1,
      isRequired: true,
      questionType: 'TEXT',
    });
    const result = validateInitialAssessmentSubmission({
      status: InitialAssessmentStatus.IN_PROGRESS,
      questions: [required],
      answers: [],
      metadata: { adl: { rows: defaultAdlRows() } },
    });
    expect(result.canSubmit).toBe(false);
    expect(result.canSubmitIncomplete).toBe(true);
    expect(result.blocks.some((b) => b.message.startsWith('Required:'))).toBe(
      true,
    );
  });
});

function defaultAdlRows() {
  return [
    'Mobility',
    'Transfer',
    'Personal hygiene',
    'Toilet use',
    'Continence',
    'Feeding',
  ].map((activity) => ({
    activity,
    score: 0,
  }));
}

describe('agreed goals (final tab)', () => {
  const run = (metadata: object) =>
    validateInitialAssessmentSubmission({
      status: InitialAssessmentStatus.IN_PROGRESS,
      questions: [],
      answers: [],
      metadata: metadata as never,
    });

  it('adds a skippable block until at least one goal is written', () => {
    const block = run({}).blocks.find((b) =>
      b.message.startsWith('Agreed goals:'),
    );
    expect(block?.sectionNumber).toBe(14);
    expect(isSkippableIncompleteValidationMessage(block!.message)).toBe(true);
    expect(
      run({ agreedGoals: { goals: [{ goal: '  ' }] } }).blocks.some((b) =>
        b.message.startsWith('Agreed goals:'),
      ),
    ).toBe(true);
  });

  it('clears once a goal is agreed', () => {
    const metadata = {
      agreedGoals: {
        goals: [
          { goal: 'Walk to the shop again', outcomeArea: 'community_services' },
        ],
      },
    };
    expect(hasAgreedGoal(metadata as never)).toBe(true);
    expect(
      run(metadata).blocks.some((b) => b.message.startsWith('Agreed goals:')),
    ).toBe(false);
  });
});
