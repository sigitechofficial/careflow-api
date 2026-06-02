import {
  buildFallsAssessmentSnapshot,
  buildVitalsSnapshot,
  computeFallsRisk,
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

  it('computes falls risk level from falls history', () => {
    expect(computeFallsRisk({ fallsLast12Months: false, numberOfFalls: null, injuryCaused: null, adlMobilityScore: null })).toEqual({
      riskScore: 0,
      riskLevel: null,
    });
    expect(
      computeFallsRisk({ fallsLast12Months: true, numberOfFalls: 3, injuryCaused: true, adlMobilityScore: 4 }),
    ).toEqual({
      riskScore: 100,
      riskLevel: 'HIGH',
    });
  });

  it('builds falls assessment snapshot with risk score', () => {
    const questions = [
      q('f1', 'Falls in last 12 months?', 'fallsLast12Months'),
      q('f2', 'Number of falls (last 12 months)'),
      q('f3', 'Injury caused by fall?'),
    ];
    const falls = buildFallsAssessmentSnapshot({
      questions,
      answers: [
        { questionId: 'f1', checked: true, booleanValue: true, textValue: null, numberValue: null, dateValue: null },
        { questionId: 'f2', checked: null, booleanValue: null, textValue: null, numberValue: 2 as never, dateValue: null },
        { questionId: 'f3', checked: true, booleanValue: true, textValue: null, numberValue: null, dateValue: null },
      ],
      metadata: { adl: { rows: [{ activity: 'Mobility', score: 3 }] } },
    });
    expect(falls.fallsLast12Months).toBe(true);
    expect(falls.numberOfFalls).toBe(2);
    expect(falls.riskLevel).toBe('HIGH');
    expect(falls.adlMobilityScore).toBe(3);
  });
});
