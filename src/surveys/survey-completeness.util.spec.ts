import { SurveyQuestionType } from '@prisma/client';
import { answeredEveryQuestion } from './survey-completeness.util';

describe('answeredEveryQuestion: the contact-me question and its follow-ups', () => {
  const questions = [
    { id: 'q1', key: 'q-safe', questionText: 'Do you feel safe?', questionType: SurveyQuestionType.YES_NO, options: null, showIf: null },
    {
      id: 'q2',
      key: 'q-contact',
      questionText: 'Would you like someone to contact you about your answers?',
      questionType: SurveyQuestionType.YES_NO,
      options: null,
      showIf: null,
    },
    {
      id: 'q3',
      key: 'q-how',
      questionText: 'How should we contact you?',
      questionType: SurveyQuestionType.SINGLE_SELECT,
      options: ['Phone', 'Email'],
      showIf: { questionKey: 'q-contact', answers: ['Yes'] },
    },
    {
      id: 'q4',
      key: 'q-when',
      questionText: 'When is best?',
      questionType: SurveyQuestionType.TEXT,
      options: null,
      showIf: { questionKey: 'q-how', answers: ['Phone'] },
    },
  ];
  const safe = { questionId: 'q1', booleanValue: true, numberValue: null, selectedOptions: null };

  it('linked to no one: none of them were asked, at any depth', () => {
    expect(answeredEveryQuestion(questions, [safe], { unlinked: true })).toBe(true);
  });

  it('named: the contact-me question was asked (its follow-ups only after a Yes)', () => {
    expect(answeredEveryQuestion(questions, [safe], { unlinked: false })).toBe(false);
    const no = { questionId: 'q2', booleanValue: false, numberValue: null, selectedOptions: null };
    expect(answeredEveryQuestion(questions, [safe, no], { unlinked: false })).toBe(true);
  });
});
