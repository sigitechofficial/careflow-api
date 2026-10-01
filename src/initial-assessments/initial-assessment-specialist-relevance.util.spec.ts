import { SPECIALIST_TAB_IDS, specialistRelevanceFromInputs } from './initial-assessment-specialist-relevance.rules';
import { specialistInputsFromSubmission, specialistRequiredIssues } from './initial-assessment-specialist-relevance.util';

const q = (id: string, fieldKey: string, questionType = 'YES_NO') => ({
  id,
  questionText: id,
  questionType,
  metadata: { fieldKey },
  section: { sectionNumber: 5 },
});
const answer = (questionId: string, over: Record<string, unknown>) => ({
  questionId,
  checked: null,
  booleanValue: null,
  textValue: null,
  numberValue: null,
  dateValue: null,
  timeValue: null,
  selectedOptions: null,
  ...over,
});

describe('specialist relevance (server)', () => {
  const questions = [q('pain', 'painConcerns', 'MULTI_SELECT'), q('eol', 'eolRelevant', 'SINGLE_SELECT')];

  it('reads the screening answers and makes the Pain tool required for reported pain', () => {
    const inputs = specialistInputsFromSubmission({
      questions,
      answers: [answer('pain', { selectedOptions: ['severe_rest'] })],
      metadata: {},
    });
    expect(specialistRelevanceFromInputs(SPECIALIST_TAB_IDS.pain, inputs)?.status).toBe('required');
    const issues = specialistRequiredIssues({
      questions,
      answers: [answer('pain', { selectedOptions: ['severe_rest'] })],
      metadata: {},
    });
    expect(issues.map((i) => i.message)).toEqual([
      'Specialist assessment required: Pain Assessment Tool — Pain at rest',
    ]);
  });

  it('raises nothing for a clear negative screen, and honours a reasoned override', () => {
    expect(
      specialistRequiredIssues({
        questions,
        answers: [answer('pain', { selectedOptions: ['no_concern'] }), answer('eol', { selectedOptions: ['no'] })],
        metadata: {},
      }),
    ).toEqual([]);
    expect(
      specialistRequiredIssues({
        questions,
        answers: [answer('pain', { selectedOptions: ['mild_rest'] })],
        metadata: {
          tabRelevanceOverrides: { '10': { status: 'not_needed', reason: 'GP confirms resolved', at: '2026-09-29' } },
        },
      }),
    ).toEqual([]);
  });

  it('ignores a downgrade without a reason', () => {
    expect(
      specialistRequiredIssues({
        questions,
        answers: [answer('pain', { selectedOptions: ['mild_rest'] })],
        metadata: { tabRelevanceOverrides: { '10': { status: 'not_needed', at: '2026-09-29' } } },
      }),
    ).toHaveLength(1);
  });
});
