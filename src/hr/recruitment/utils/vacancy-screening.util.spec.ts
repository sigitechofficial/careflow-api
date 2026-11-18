import { evaluateAnswers, normaliseQuestions, payText, publicQuestions, yesNoAnswerOfKind } from './vacancy-screening.util';

const rtw = { id: 'q1', kind: 'RIGHT_TO_WORK', text: 'Do you have the right to work in the UK?', type: 'YES_NO', required: false, acceptedAnswers: ['Yes'] };
const exp = {
  id: 'q2',
  kind: 'CARE_EXPERIENCE',
  text: 'How much care experience do you have?',
  type: 'CHOICE',
  options: ['None', 'Under 1 year', '1–3 years', '3+ years'],
  required: true,
  acceptedAnswers: ['1–3 years', '3+ years', 'Banana'],
};
const note = { id: 'q3', kind: 'CUSTOM', text: 'Anything else?', type: 'TEXT', required: false };

describe('normaliseQuestions', () => {
  it('keeps valid questions, forces right to work to be required, drops unknown accepted answers', () => {
    const q = normaliseQuestions([rtw, exp, note]);
    expect(q[0]).toMatchObject({ required: true, acceptedAnswers: ['Yes'] });
    expect(q[1].acceptedAnswers).toEqual(['1–3 years', '3+ years']);
    expect(q[2]).not.toHaveProperty('acceptedAnswers');
  });

  it('a deal breaker that accepts every answer is not a deal breaker', () => {
    const [q] = normaliseQuestions([{ ...rtw, acceptedAnswers: ['Yes', 'No'] }]);
    expect(q).not.toHaveProperty('acceptedAnswers');
  });

  it('refuses a choice question with fewer than two answers, or no wording', () => {
    expect(() => normaliseQuestions([{ ...exp, options: ['Only'] }])).toThrow(/two answers/);
    expect(() => normaliseQuestions([{ ...note, text: ' ' }])).toThrow(/wording/);
  });

  it('never shows applicants which answers are wanted', () => {
    expect(publicQuestions(normaliseQuestions([rtw]))[0]).not.toHaveProperty('acceptedAnswers');
  });
});

describe('evaluateAnswers', () => {
  const questions = normaliseQuestions([rtw, exp, note]);

  it('marks missed deal breakers without rejecting', () => {
    const r = evaluateAnswers(questions, { q1: 'Yes', q2: 'Under 1 year', q3: '' });
    expect(r.problems).toEqual([]);
    expect(r.missed).toEqual(['How much care experience do you have?']);
    expect(r.answers.map((a) => a.dealBreakerMissed)).toEqual([false, true]);
    expect(yesNoAnswerOfKind(questions, r.answers, 'RIGHT_TO_WORK')).toBe(true);
    expect(yesNoAnswerOfKind(questions, r.answers, 'DRIVING')).toBeUndefined();
  });

  it('asks for required answers and answers from the list', () => {
    const r = evaluateAnswers(questions, { q2: 'Ten years' });
    expect(r.problems).toEqual([
      'Please answer: Do you have the right to work in the UK?',
      'Choose one of the answers for: How much care experience do you have?',
    ]);
  });
});

describe('payText', () => {
  it('shows a range, a single figure, or nothing', () => {
    expect(payText(12.6, 13.5)).toBe('£12.60 – £13.50');
    expect(payText(25000, 28000)).toBe('£25,000 – £28,000');
    expect(payText(12.6, null)).toBe('£12.60');
    expect(payText(null, null)).toBeNull();
  });
});
