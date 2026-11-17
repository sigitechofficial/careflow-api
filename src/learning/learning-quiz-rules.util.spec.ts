import { LearningQuestionType } from '@prisma/client';
import {
  checkedCompetencyCriteria,
  checkedQuestionOptions,
  questionError,
} from './learning-quiz-rules.util';

const { SINGLE_CHOICE, MULTIPLE_CHOICE, TRUE_FALSE, SHORT_TEXT } =
  LearningQuestionType;
const opt = (optionText: string, isCorrect = false) => ({
  optionText,
  isCorrect,
});

describe('learning-quiz-rules.util', () => {
  it('accepts a single answer question with exactly one correct answer', () => {
    expect(
      questionError(SINGLE_CHOICE, 'Q?', [opt('A', true), opt('B')]),
    ).toBeNull();
    expect(
      questionError(SINGLE_CHOICE, 'Q?', [opt('A', true), opt('B', true)]),
    ).toMatch(/exactly one/);
    expect(questionError(SINGLE_CHOICE, 'Q?', [opt('A'), opt('B')])).toMatch(
      /exactly one/,
    );
    expect(questionError(SINGLE_CHOICE, 'Q?', [opt('A', true)])).toMatch(
      /at least 2/,
    );
  });

  it('needs at least one correct answer for multiple answers', () => {
    expect(
      questionError(MULTIPLE_CHOICE, 'Q?', [
        opt('A', true),
        opt('B', true),
        opt('C'),
      ]),
    ).toBeNull();
    expect(questionError(MULTIPLE_CHOICE, 'Q?', [opt('A'), opt('B')])).toMatch(
      /at least one/,
    );
  });

  it('true/false must be exactly True and False with one correct', () => {
    expect(
      questionError(TRUE_FALSE, 'Q?', [opt('True', true), opt('False')]),
    ).toBeNull();
    expect(
      questionError(TRUE_FALSE, 'Q?', [opt('Yes', true), opt('No')]),
    ).toMatch(/True and False/);
    expect(
      questionError(TRUE_FALSE, 'Q?', [opt('True', true), opt('False', true)]),
    ).toMatch(/correct/);
  });

  it('rejects empty text, duplicate answers, free-text types and too many answers', () => {
    expect(
      questionError(SINGLE_CHOICE, '  ', [opt('A', true), opt('B')]),
    ).toMatch(/Write the question/);
    expect(
      questionError(SINGLE_CHOICE, 'Q?', [opt('A', true), opt(' ')]),
    ).toMatch(/needs text/);
    expect(
      questionError(SINGLE_CHOICE, 'Q?', [opt('A', true), opt('a ')]),
    ).toMatch(/same text/);
    expect(questionError(SHORT_TEXT, 'Q?', [])).toMatch(/single answer/);
    const many = Array.from({ length: 11 }, (_, i) => opt(`A${i}`, i === 0));
    expect(questionError(SINGLE_CHOICE, 'Q?', many)).toMatch(/at most 10/);
  });

  it('normalises answers and sets their order', () => {
    expect(
      checkedQuestionOptions(SINGLE_CHOICE, 'Q?', [opt(' B ', true), opt('A')]),
    ).toEqual([
      { optionText: 'B', isCorrect: true, displayOrder: 0 },
      { optionText: 'A', isCorrect: false, displayOrder: 1 },
    ]);
    expect(() => checkedQuestionOptions(SINGLE_CHOICE, 'Q?', [])).toThrow();
  });

  it('checks the competency checklist', () => {
    expect(
      checkedCompetencyCriteria([' Check sling ', '', 'Talk to the person']),
    ).toEqual(['Check sling', 'Talk to the person']);
    expect(() => checkedCompetencyCriteria([])).toThrow();
    expect(() => checkedCompetencyCriteria(['A', 'a'])).toThrow();
  });
});
