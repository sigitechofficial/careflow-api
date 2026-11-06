import { CONTACT_ME_PREFIX as LIBRARY_CONTACT_ME_PREFIX } from '../../prisma/seed-lib/survey-library';
import {
  ANSWER_WITHOUT_NAME_LABEL,
  ANSWER_WITHOUT_NAME_NOTE,
  CONTACT_ME_PREFIX,
  QUESTION_REMOVAL_REFUSED,
  MIN_WITHOUT_NAME_WRITTEN_ANSWERS,
  isAnsweredWithoutName,
  isContactRequestQuestion,
  offersAnswerWithoutName,
  questionsNotAskedWhenUnlinked,
  storedAllowAnonymousResponses,
  withoutNameAnswersHeldBack,
  withoutNameHeldBackNote,
  withoutNameShare,
  withoutNameWrittenVisibility,
} from './survey-respondent-anonymity.util';

describe('respondent-chosen anonymity', () => {
  it('finds the contact-me question the way the survey library writes it', () => {
    expect(CONTACT_ME_PREFIX).toBe(LIBRARY_CONTACT_ME_PREFIX);
    expect(
      isContactRequestQuestion({ questionType: 'YES_NO', questionText: 'Would you like someone to contact you about your answers?' }),
    ).toBe(true);
    expect(isContactRequestQuestion({ questionType: 'YES_NO', questionText: 'would you like us to contact you?' })).toBe(true);
    expect(isContactRequestQuestion({ questionType: 'TEXT', questionText: 'Would you like someone to contact you?' })).toBe(false);
    expect(isContactRequestQuestion({ questionType: 'YES_NO', questionText: 'Do you feel safe?' })).toBe(false);
  });

  it('is offered on named surveys with the setting only', () => {
    expect(offersAnswerWithoutName({ isAnonymous: false, allowAnonymousResponses: true })).toBe(true);
    expect(offersAnswerWithoutName({ isAnonymous: true, allowAnonymousResponses: true })).toBe(false);
    expect(offersAnswerWithoutName({ isAnonymous: false, allowAnonymousResponses: false })).toBe(false);
    expect(storedAllowAnonymousResponses(true, true)).toBe(false);
    expect(storedAllowAnonymousResponses(false, undefined)).toBe(false);
    expect(storedAllowAnonymousResponses(false, true)).toBe(true);
    expect(ANSWER_WITHOUT_NAME_LABEL).toBe('Answer without my name — we will not be able to reply to you');
  });

  it('tells answers given without a name online from ones staff recorded without a name', () => {
    expect(isAnsweredWithoutName({ isAnonymous: true, channel: 'ONLINE' })).toBe(true);
    expect(isAnsweredWithoutName({ isAnonymous: true, channel: 'PORTAL' })).toBe(true);
    expect(isAnsweredWithoutName({ isAnonymous: true, channel: 'PAPER' })).toBe(false);
    expect(isAnsweredWithoutName({ isAnonymous: false, channel: 'ONLINE' })).toBe(false);
  });

  it('shows their written answers only once closed with enough of them', () => {
    const n = MIN_WITHOUT_NAME_WRITTEN_ANSWERS;
    expect(withoutNameWrittenVisibility({ id: 's', status: 'ACTIVE' }, [], new Map([['s', 50]]))).toMatchObject({
      all: false,
      note: expect.stringMatching(/once the survey has closed and at least 5 people/),
    });
    expect(withoutNameWrittenVisibility({ id: 's', status: 'CLOSED' }, [], new Map([['s', n - 1]])).all).toBe(false);
    expect(withoutNameWrittenVisibility({ id: 's', status: 'CLOSED' }, [], new Map([['s', n]]))).toMatchObject({
      all: true,
      note: null,
    });
    // Repeating survey: closed periods only, once they hold enough between them.
    const periods = [
      { id: 'p1', status: 'CLOSED' as const },
      { id: 'p2', status: 'CLOSED' as const },
      { id: 'p3', status: 'ACTIVE' as const },
    ];
    const v = withoutNameWrittenVisibility({ id: 's', status: 'ACTIVE' }, periods, new Map([['p1', 3], ['p2', 2], ['p3', 9]]));
    expect(v.all).toBe(false);
    expect([...v.surveyIds]).toEqual(['p1', 'p2']);
    expect(v.note).toMatch(/^Closed periods only/);
  });

  it('gives the share as a whole per cent', () => {
    expect(withoutNameShare(1, 3)).toBe(33);
    expect(withoutNameShare(0, 0)).toBe(0);
  });

  it('holds back every answer given without a name until closed with 5 people answering that way', () => {
    // Closed: only the 5-people rule.
    expect([0, 1, 4, 5, 9].map((n) => withoutNameAnswersHeldBack(false, n, true))).toEqual([false, true, true, false, false]);
    // Still open: held however many answered that way (a new one could be matched to whoever just turned Completed).
    expect([0, 1, 4, 5, 9].map((n) => withoutNameAnswersHeldBack(false, n, false))).toEqual([false, true, true, true, true]);
    // Anonymous surveys follow their own rules (the whole audience is the crowd).
    expect(withoutNameAnswersHeldBack(true, 1, false)).toBe(false);
    expect(withoutNameHeldBackNote(0)).toBeNull();
    expect(withoutNameHeldBackNote(1)).toMatch(/^1 response was given without a name and is not shown/);
    expect(withoutNameHeldBackNote(3)).toMatch(
      /^3 responses were given without a name and are not shown .* once the survey \(or period\) has closed and at least 5 people/,
    );
  });

  it('tells the person staff can see they answered, never which answers are theirs', () => {
    expect(ANSWER_WITHOUT_NAME_NOTE).toBe('Staff can see that you have answered, but not which answers are yours.');
  });

  it('refuses a question removal without saying whether that question has answers', () => {
    expect(QUESTION_REMOVAL_REFUSED).toBe("This question can't be removed once the survey has responses.");
    expect(QUESTION_REMOVAL_REFUSED).not.toMatch(/answer/i);
  });
});

describe('questionsNotAskedWhenUnlinked', () => {
  const q = (id: string, questionText: string, showIf: unknown = null, questionType = 'YES_NO') => ({
    id,
    key: `k-${id}`,
    questionText,
    questionType,
    showIf,
  });
  it('is the contact-me question and every question asked only after it, however deep', () => {
    const questions = [
      q('a', 'Do you feel safe?'),
      q('c', 'Would you like someone to contact you about your answers?'),
      q('how', 'How should we contact you?', { questionKey: 'k-c', answers: ['Yes'] }, 'SINGLE_SELECT'),
      q('num', 'Your number', { questionKey: 'k-how', answers: ['Phone'] }, 'TEXT'),
      q('other', 'Why not?', { questionKey: 'k-a', answers: ['No'] }, 'TEXT'),
    ];
    expect([...questionsNotAskedWhenUnlinked(questions)].sort()).toEqual(['c', 'how', 'num']);
    expect(questionsNotAskedWhenUnlinked([q('a', 'Do you feel safe?')]).size).toBe(0);
  });
});
