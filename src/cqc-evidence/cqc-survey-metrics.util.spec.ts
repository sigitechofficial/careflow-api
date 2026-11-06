import {
  OVERALL_QUESTION_KEY,
  buildSurveyMetrics,
  findOverallQuestion,
  questionResult,
  surveyMetricsSummary,
} from './cqc-survey-metrics.util';

const input = (over: Record<string, unknown> = {}) => ({
  survey: { id: 's1', title: 'Annual survey', targetKind: 'SERVICE_USER', isAnonymous: false, periodKey: null, clonedFromId: null },
  libraryReference: null,
  recipients: 20,
  completed: 10,
  responses: 10,
  questions: [],
  answers: [],
  questionIds: null,
  now: new Date('2026-11-05T10:00:00.000Z'),
  ...over,
});

describe('CQC survey metrics: answers given without a name', () => {
  it('keeps the share answered without a name on named surveys', () => {
    const m = buildSurveyMetrics(input({ answeredWithoutName: 3 }) as any);
    expect(m).toMatchObject({ answeredWithoutName: 3, answeredWithoutNamePercent: 30 });
    expect(surveyMetricsSummary(m)).toMatch(/3 \(30%\) answered without their name\./);
  });

  it('says nothing when none did, and never on anonymous surveys', () => {
    const none = buildSurveyMetrics(input() as any);
    expect(none).toMatchObject({ answeredWithoutName: 0, answeredWithoutNamePercent: 0 });
    expect(surveyMetricsSummary(none)).not.toMatch(/without their name/);
    const anonymous = buildSurveyMetrics(
      input({ survey: { ...input().survey, isAnonymous: true }, answeredWithoutName: 4 }) as any,
    );
    expect(anonymous).toMatchObject({ answeredWithoutName: null, answeredWithoutNamePercent: null });
  });
});

describe('CQC survey metrics: the overall question and answers not counted', () => {
  const scale = ['Very good', 'Good', 'Neither good nor poor', 'Poor', 'Very poor'];
  const q = (over: Record<string, unknown> = {}) => ({
    id: 'q1',
    questionText: 'How was your experience?',
    questionType: 'SINGLE_SELECT',
    options: [...scale, 'Not sure'],
    sectionTitle: null,
    sortOrder: 0,
    ...over,
  });

  it('finds the overall question by its library key even when reworded', () => {
    const reworded = q({ id: 'ov', key: OVERALL_QUESTION_KEY, questionText: 'All in all, how was our service?', sortOrder: 3 });
    expect(findOverallQuestion([q(), reworded])?.id).toBe('ov');
    expect(findOverallQuestion([q()])).toBeNull();
  });

  it('leaves answers marked "Not counted in percentages" out of the base', () => {
    const answers = [['Very good'], ['Poor'], ['Not sure'], ['Not sure']].map((s) => ({ questionId: 'q1', selectedOptions: s }));
    // Not on the scale anyway, so already out of the base…
    expect(questionResult(q() as any, answers, 1)).toMatchObject({ base: 2, positive: 1, percent: 50 });
    // …and a scale answer marked not counted is left out too.
    const marked = q({ config: { notCountedOptions: ['Poor'] } });
    expect(questionResult(marked as any, answers, 1)).toMatchObject({ base: 1, positive: 1, percent: 100 });
  });
});

describe('CQC survey metrics: the satisfaction scale', () => {
  it('counts Very satisfied or Satisfied as the top two', () => {
    const q = {
      id: 'q1',
      questionText: 'How satisfied are you with the help you get?',
      questionType: 'LIKERT',
      options: ['Very satisfied', 'Satisfied', 'Neither satisfied nor dissatisfied', 'Dissatisfied', 'Very dissatisfied'],
      sectionTitle: null,
      sortOrder: 0,
    };
    const answers = [['Very satisfied'], ['Satisfied'], ['Dissatisfied'], ['Neither satisfied nor dissatisfied']].map((s) => ({
      questionId: 'q1',
      selectedOptions: s,
    }));
    expect(questionResult(q as any, answers, 1)).toMatchObject({
      positiveLabels: ['Very satisfied', 'Satisfied'],
      base: 4,
      positive: 2,
      percent: 50,
    });
  });
});
