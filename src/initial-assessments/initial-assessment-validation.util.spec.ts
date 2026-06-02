import { InitialAssessmentStatus } from '@prisma/client';
import { validateInitialAssessmentSubmission } from './initial-assessment-validation.util';

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
    expect(result.blocks.some((b) => b.message.includes('Required: Needs help with washing?'))).toBe(false);
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
      answers: [{ questionId: 'c1', checked: false, booleanValue: false, textValue: null, numberValue: null, dateValue: null, timeValue: null, selectedOptions: null }],
      metadata: { adl: { rows: defaultAdlRows() } },
    });
    expect(result.canSubmit).toBe(false);
    expect(result.blocks.some((b) => b.message.includes('Consent to assessment'))).toBe(true);
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
        showWhen: { gateTextIncludes: 'currently has ulcers or wounds', yes: true },
      },
    });
    const result = validateInitialAssessmentSubmission({
      status: InitialAssessmentStatus.IN_PROGRESS,
      questions: [gate, followUp],
      answers: [
        { questionId: 'g1', checked: false, booleanValue: false, textValue: null, numberValue: null, dateValue: null, timeValue: null, selectedOptions: null },
      ],
      metadata: { adl: { rows: defaultAdlRows() } },
    });
    expect(result.blocks.some((b) => b.message.includes('wound assessment been completed'))).toBe(false);
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
      metadata: { specRef: '13.1', showWhen: { gateTextIncludes: 'safeguarding concerns identified', yes: true } },
    });
    const result = validateInitialAssessmentSubmission({
      status: InitialAssessmentStatus.IN_PROGRESS,
      questions: [gate, details],
      answers: [
        { questionId: 'sg1', checked: true, booleanValue: true, textValue: null, numberValue: null, dateValue: null, timeValue: null, selectedOptions: null },
      ],
      metadata: { adl: { rows: defaultAdlRows() } },
    });
    expect(result.canSubmit).toBe(false);
    expect(result.blocks.some((b) => b.message.includes('Safeguarding concern flagged but details'))).toBe(true);
  });
});

function defaultAdlRows() {
  return ['Mobility', 'Transfer', 'Personal hygiene', 'Toilet use', 'Continence', 'Feeding'].map((activity) => ({
    activity,
    score: 0,
  }));
}
