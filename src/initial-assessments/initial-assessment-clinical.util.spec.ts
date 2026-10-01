import {
  buildFallsAssessmentSnapshot,
  buildVitalsSnapshot,
} from './initial-assessment-clinical.util';

describe('initial-assessment-clinical.util', () => {
  const q = (id: string, text: string, fieldKey?: string) => ({
    id,
    questionText: text,
    metadata: fieldKey ? { fieldKey } : null,
  });

  it('builds vitals snapshot from fieldKey answers', () => {
    const questions = [
      q('c1', 'Assessor competent to record vital signs?'),
      q('t1', 'Temperature (°C)', 'temperature'),
      q('p1', 'Pulse (bpm)', 'pulse'),
    ];
    const snapshot = buildVitalsSnapshot({
      submissionId: 'sub-1',
      questions,
      answers: [
        { questionId: 'c1', checked: true, booleanValue: true, textValue: null, numberValue: null, dateValue: null },
        { questionId: 't1', checked: null, booleanValue: null, textValue: null, numberValue: 36.8 as never, dateValue: null },
        { questionId: 'p1', checked: null, booleanValue: null, textValue: null, numberValue: 72 as never, dateValue: null },
      ],
    });
    expect(snapshot?.readings.temperature).toBe(36.8);
    expect(snapshot?.readings.pulse).toBe(72);
    expect(snapshot?.competentAssessor).toBe(true);
    expect(snapshot?.sourceSubmissionId).toBe('sub-1');
  });

  it('builds a falls case-finding snapshot without a predictive score', () => {
    const questions = [
      q('f1', 'Falls in last 12 months?', 'fallsLast12Months'),
      q('f2', 'Number of falls (last 12 months)', 'fallsCount12Months'),
      q('f3', 'Injury caused by fall?', 'fallInjury'),
      q('f4', 'Any unsteadiness, gait or balance concern?', 'fallsUnsteadiness'),
    ];
    const yes = { checked: true, booleanValue: true, textValue: null, numberValue: null, dateValue: null };
    const falls = buildFallsAssessmentSnapshot({
      questions,
      answers: [
        { questionId: 'f1', ...yes },
        { questionId: 'f2', checked: null, booleanValue: null, textValue: null, numberValue: 2 as never, dateValue: null },
        { questionId: 'f3', ...yes },
        { questionId: 'f4', ...yes },
      ],
      metadata: { adl: { rows: [{ activity: 'Walking', score: 3 }] } },
    });
    expect(falls.fallsLast12Months).toBe(true);
    expect(falls.numberOfFalls).toBe(2);
    expect(falls.injuryCaused).toBe(true);
    expect(falls.caseFinding).toEqual({
      status: 'required',
      reasons: ['Fall in the last 12 months', 'Unsteadiness, gait or balance concern'],
    });
    expect(falls.riskScore).toBeNull();
    expect(falls.riskLevel).toBeNull();
    expect(falls.adlMobilityScore).toBe(3);
  });

  it('falls back to question text for older templates without fieldKeys', () => {
    const falls = buildFallsAssessmentSnapshot({
      questions: [q('f1', 'Falls in last 12 months?', 'fallsLast12Months'), q('f2', 'Number of falls (last 12 months)')],
      answers: [
        { questionId: 'f1', checked: false, booleanValue: false, textValue: null, numberValue: null, dateValue: null },
      ],
    });
    expect(falls.fallsLast12Months).toBe(false);
    expect(falls.caseFinding?.status).toBe('pending');
  });
});
