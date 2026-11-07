import { BadRequestException } from '@nestjs/common';
import { SurveyQuestionType } from '@prisma/client';
import {
  DEFAULT_LIKERT_OPTIONS,
  DEFAULT_OTHER_LABEL,
  answerLabelsFor,
  assertSurveyLogic,
  cleanRespondentText,
  currentAnswerLabels,
  isCommentShown,
  isQuestionShown,
  keptNotCountedConfig,
  normaliseQuestionLogic,
  normaliseQuestionSettings,
  surveyLogicProblems,
  type LogicQuestion,
  ratingRange,
  readNotCountedOptions,
  usesDefaultLikertScale,
} from './survey-question-config.util';

const T = SurveyQuestionType;

describe('normaliseQuestionSettings', () => {
  it('trims choice options and keeps their order', () => {
    expect(normaliseQuestionSettings(T.SINGLE_SELECT, [' Always ', 'Sometimes', 'Never'], undefined)).toEqual({
      options: ['Always', 'Sometimes', 'Never'],
      config: null,
    });
  });

  it.each([
    ['no options', undefined],
    ['one option', ['Yes']],
    ['an empty option', ['Yes', '  ']],
    ['a non-string option', ['Yes', 3]],
    ['duplicate options (case-insensitive)', ['Yes', 'yes']],
    ['options that are not a list', 'Yes,No'],
  ])('rejects a choice question with %s', (_label, options) => {
    expect(() => normaliseQuestionSettings(T.MULTI_SELECT, options, undefined, 'Q1')).toThrow(
      BadRequestException,
    );
  });

  it('uses the standard agree scale for Likert unless custom labels are valid', () => {
    expect(normaliseQuestionSettings(T.LIKERT, undefined, undefined).options).toBeNull();
    expect(normaliseQuestionSettings(T.LIKERT, ['Agree', 'Disagree'], undefined).options).toEqual([
      'Agree',
      'Disagree',
    ]);
    expect(() => normaliseQuestionSettings(T.LIKERT, ['Agree', 'agree'], undefined)).toThrow(
      BadRequestException,
    );
  });

  it('accepts whole-number rating bounds and rejects bad ones', () => {
    expect(normaliseQuestionSettings(T.RATING, undefined, { min: 1, max: 5 }).config).toEqual({ min: 1, max: 5 });
    expect(normaliseQuestionSettings(T.RATING, undefined, undefined).config).toBeNull();
    for (const bad of [
      { min: 1.5, max: 5 },
      { min: 5, max: 5 },
      { min: 6, max: 2 },
      { min: '1', max: 5 },
      { min: -1, max: 5 },
      { min: 0, max: 500 },
      { min: 0, max: 5, step: 1 },
    ]) {
      expect(() => normaliseQuestionSettings(T.RATING, undefined, bad)).toThrow(BadRequestException);
    }
  });

  it('rejects options or settings on types that do not use them', () => {
    expect(() => normaliseQuestionSettings(T.TEXT, ['a', 'b'], undefined)).toThrow(BadRequestException);
    expect(() => normaliseQuestionSettings(T.YES_NO, undefined, { min: 0, max: 1 })).toThrow(
      BadRequestException,
    );
    expect(normaliseQuestionSettings(T.TEXT, [], {})).toEqual({ options: null, config: null });
  });

  it('reads rating ranges with the 0–10 default', () => {
    expect(ratingRange(null)).toEqual({ min: 0, max: 10 });
    expect(ratingRange({ min: 1, max: 5 })).toEqual({ min: 1, max: 5 });
    expect(ratingRange({ min: 5, max: 1 })).toEqual({ min: 0, max: 10 });
  });
});

describe('built-in Likert scale wording', () => {
  it('has "Neither agree nor disagree" in the middle', () => {
    expect(DEFAULT_LIKERT_OPTIONS).toEqual([
      'Strongly agree',
      'Agree',
      'Neither agree nor disagree',
      'Disagree',
      'Strongly disagree',
    ]);
  });

  it('reads an old "Neutral" answer on the built-in scale with the new label', () => {
    expect(usesDefaultLikertScale(T.LIKERT, null)).toBe(true);
    expect(usesDefaultLikertScale(T.LIKERT, [])).toBe(true);
    expect(currentAnswerLabels(T.LIKERT, null, ['Neutral'])).toEqual(['Neither agree nor disagree']);
    expect(currentAnswerLabels(T.LIKERT, null, ['Agree'])).toEqual(['Agree']);
  });

  it('leaves custom scales and other question types alone', () => {
    expect(usesDefaultLikertScale(T.LIKERT, ['Good', 'Neutral', 'Bad'])).toBe(false);
    expect(currentAnswerLabels(T.LIKERT, ['Good', 'Neutral', 'Bad'], ['Neutral'])).toEqual(['Neutral']);
    expect(currentAnswerLabels(T.SINGLE_SELECT, ['Neutral', 'Other'], ['Neutral'])).toEqual(['Neutral']);
  });
});

describe('normaliseQuestionLogic', () => {
  const choice = ['Always', 'Rarely', 'Never'];

  it('fills in the Other defaults and trims', () => {
    expect(normaliseQuestionLogic(T.SINGLE_SELECT, choice, null, { otherOption: {} }).otherOption).toEqual({
      label: DEFAULT_OTHER_LABEL,
      textPrompt: 'Please tell us',
      textRequired: true,
    });
    expect(
      normaliseQuestionLogic(T.MULTI_SELECT, choice, null, {
        otherOption: { label: ' Something else ', textPrompt: ' Say what ', textRequired: false },
      }).otherOption,
    ).toEqual({ label: 'Something else', textPrompt: 'Say what', textRequired: false });
  });

  it.each([
    ['Other on a scale', T.LIKERT, null, { otherOption: {} }],
    ['an Other label that is already an option', T.SINGLE_SELECT, choice, { otherOption: { label: 'never' } }],
    ['an empty Other label', T.SINGLE_SELECT, choice, { otherOption: { label: '  ' } }],
    ['an unknown Other setting', T.SINGLE_SELECT, choice, { otherOption: { colour: 'red' } }],
    ['a comment box on a written answer', T.TEXTAREA, null, { commentConfig: { prompt: 'Why?' } }],
    ['showWhen on a number question', T.NUMBER, null, { commentConfig: { showWhen: ['3'] } }],
    ['showWhen with an answer the question does not have', T.SINGLE_SELECT, choice, { commentConfig: { showWhen: ['Often'] } }],
    ['a prompt over 200 characters', T.YES_NO, null, { commentConfig: { prompt: 'x'.repeat(201) } }],
    ['clearing answers on a single choice', T.SINGLE_SELECT, choice, { exclusiveOptions: ['Never'] }],
    ['a clearing answer that is not an option', T.MULTI_SELECT, choice, { exclusiveOptions: ['None'] }],
    ['a show-if rule without answers', T.YES_NO, null, { showIf: { questionKey: 'q-a', answers: [] } }],
    ['a show-if rule with a bad key', T.YES_NO, null, { showIf: { questionKey: 'has space', answers: ['Yes'] } }],
  ])('rejects %s', (_label, type, options, logic) => {
    expect(() => normaliseQuestionLogic(type, options, null, logic, 'Q')).toThrow(BadRequestException);
  });

  it('comment boxes: after any answer, or after listed answers (Other and rating scores count)', () => {
    expect(normaliseQuestionLogic(T.NUMBER, null, null, { commentConfig: {} }).commentConfig).toEqual({
      prompt: 'Please tell us why', // same default as the survey builder
      showWhen: null,
    });
    expect(
      normaliseQuestionLogic(T.SINGLE_SELECT, choice, null, {
        otherOption: {},
        commentConfig: { prompt: 'Why?', showWhen: ['Never', ' Rarely ', 'Never', DEFAULT_OTHER_LABEL] },
      }).commentConfig,
    ).toEqual({ prompt: 'Why?', showWhen: ['Never', 'Rarely', DEFAULT_OTHER_LABEL] });
    expect(
      normaliseQuestionLogic(T.RATING, null, { min: 1, max: 5 }, { commentConfig: { showWhen: ['1', '2'] } }).commentConfig
        ?.showWhen,
    ).toEqual(['1', '2']);
    expect(() =>
      normaliseQuestionLogic(T.RATING, null, { min: 1, max: 5 }, { commentConfig: { showWhen: ['0'] } }),
    ).toThrow(BadRequestException);
  });

  it('keeps clearing answers in order without repeats', () => {
    expect(
      normaliseQuestionLogic(T.MULTI_SELECT, ['A', 'None of these', 'Prefer not to say'], null, {
        exclusiveOptions: ['Prefer not to say', 'None of these', 'None of these'],
      }).exclusiveOptions,
    ).toEqual(['Prefer not to say', 'None of these']);
    expect(normaliseQuestionLogic(T.MULTI_SELECT, ['A', 'B'], null, { exclusiveOptions: [] }).exclusiveOptions).toBeNull();
  });
});

describe('surveyLogicProblems', () => {
  const q = (over: Partial<LogicQuestion>): LogicQuestion => ({
    key: null,
    questionText: 'Q',
    questionType: T.YES_NO,
    options: null,
    config: null,
    otherOption: null,
    showIf: null,
    ...over,
  });

  it('accepts a rule on an earlier, always-asked question', () => {
    expect(
      surveyLogicProblems([
        q({ key: 'a', questionType: T.SINGLE_SELECT, options: ['X', 'Y'], otherOption: { label: 'Other' } }),
        q({ key: 'b', showIf: { questionKey: 'a', answers: ['Y', 'Other'] } }),
      ]),
    ).toEqual([]);
  });

  it.each([
    ['a duplicate key', [q({ key: 'a' }), q({ key: 'a' })], /share the id/],
    ['an unknown question', [q({ key: 'a', showIf: { questionKey: 'z', answers: ['Yes'] } })], /not in this survey/],
    ['a later question', [q({ key: 'a', showIf: { questionKey: 'b', answers: ['Yes'] } }), q({ key: 'b' })], /earlier/],
    ['itself', [q({ key: 'a', showIf: { questionKey: 'a', answers: ['Yes'] } })], /earlier/],
    [
      'a question that is itself conditional',
      [q({ key: 'a' }), q({ key: 'b', showIf: { questionKey: 'a', answers: ['Yes'] } }), q({ key: 'c', showIf: { questionKey: 'b', answers: ['No'] } })],
      /always asked/,
    ],
    ['a written answer', [q({ key: 'a', questionType: T.TEXT }), q({ key: 'b', showIf: { questionKey: 'a', answers: ['x'] } })], /written or number/],
    ['an answer that question cannot have', [q({ key: 'a' }), q({ key: 'b', showIf: { questionKey: 'a', answers: ['Maybe'] } })], /"Maybe" is not one/],
  ])('rejects a rule pointing at %s', (_label, questions, message) => {
    expect(surveyLogicProblems(questions)[0]).toMatch(message);
    expect(() => assertSurveyLogic(questions)).toThrow(BadRequestException);
  });
});

describe('answering: show-if and comment boxes', () => {
  const questions = [
    { id: '1', key: 'a', questionType: T.MULTI_SELECT, options: ['Meals', 'Washing'], showIf: null },
    { id: '2', key: 'b', questionType: T.YES_NO, options: null, showIf: { questionKey: 'a', answers: ['Meals'] } },
    { id: '3', key: 'c', questionType: T.YES_NO, options: null, showIf: { questionKey: 'gone', answers: ['Yes'] } },
  ];
  const byKey = new Map(questions.map((x) => [x.key, x]));

  it('shows a question when any selected answer matches; an unknown reference never hides it', () => {
    const shown = (selected: string[]) =>
      questions.filter((x) => isQuestionShown(x, byKey, (id) => (id === '1' ? { selectedOptions: selected } : undefined))).map((x) => x.id);
    expect(shown(['Washing'])).toEqual(['1', '3']);
    expect(shown(['Washing', 'Meals'])).toEqual(['1', '2', '3']);
    expect(shown([])).toEqual(['1', '3']);
  });

  it('labels answers the way rules list them', () => {
    expect(answerLabelsFor({ questionType: T.YES_NO, options: null }, { booleanValue: false })).toEqual(['No']);
    expect(answerLabelsFor({ questionType: T.RATING, options: null }, { numberValue: 3 })).toEqual(['3']);
    expect(answerLabelsFor({ questionType: T.LIKERT, options: null }, { selectedOptions: ['Neutral'] })).toEqual([
      'Neither agree nor disagree',
    ]);
  });

  it('offers the comment box only once answered, and only after the listed answers', () => {
    expect(isCommentShown({ prompt: 'Why?', showWhen: null }, false, [])).toBe(false);
    expect(isCommentShown({ prompt: 'Why?', showWhen: null }, true, ['Always'])).toBe(true);
    expect(isCommentShown({ prompt: 'Why?', showWhen: ['Never'] }, true, ['Always'])).toBe(false);
    expect(isCommentShown({ prompt: 'Why?', showWhen: ['Never'] }, true, ['Never'])).toBe(true);
    expect(isCommentShown(null, true, ['Never'])).toBe(false);
  });

  it('keeps respondent text trimmed, empty as null', () => {
    expect(cleanRespondentText('  hi  ')).toBe('hi');
    expect(cleanRespondentText('   ')).toBeNull();
    expect(cleanRespondentText(undefined)).toBeNull();
  });
});

describe('answers not counted in percentages', () => {
  it('choice and scale questions can mark some of their answers', () => {
    expect(
      normaliseQuestionSettings(T.SINGLE_SELECT, ['Yes', 'No', "Don't know"], { notCountedOptions: [" Don't know ", "Don't know"] }),
    ).toEqual({ options: ['Yes', 'No', "Don't know"], config: { notCountedOptions: ["Don't know"] } });
    expect(
      normaliseQuestionSettings(T.MULTI_SELECT, ['A', 'B', 'Prefer not to say'], { notCountedOptions: ['Prefer not to say'] }).config,
    ).toEqual({ notCountedOptions: ['Prefer not to say'] });
    // The built-in agree ↔ disagree scale's labels.
    expect(normaliseQuestionSettings(T.LIKERT, null, { notCountedOptions: ['Neither agree nor disagree'] }).config).toEqual({
      notCountedOptions: ['Neither agree nor disagree'],
    });
    // None marked: nothing stored.
    expect(normaliseQuestionSettings(T.SINGLE_SELECT, ['Yes', 'No'], { notCountedOptions: [] }).config).toBeNull();
  });

  it.each([
    ['an answer the question does not have', T.SINGLE_SELECT, ['Yes', 'No'], { notCountedOptions: ['Maybe'] }, /not one of the answers/],
    ['every answer', T.SINGLE_SELECT, ['Yes', 'No'], { notCountedOptions: ['Yes', 'No'] }, /at least one answer must be counted/],
    ['an unknown setting', T.MULTI_SELECT, ['A', 'B'], { notCountedOptions: ['A'], min: 1 }, /unknown setting "min"/],
    ['a yes / no question', T.YES_NO, null, { notCountedOptions: ['No'] }, /settings only apply to rating, choice and scale/],
    ['a list that is not answers', T.SINGLE_SELECT, ['Yes', 'No'], { notCountedOptions: 'Yes' }, /must be a list of answers/],
  ])('refuses %s', (_label, type, options, config, message) => {
    expect(() => normaliseQuestionSettings(type, options, config, 'Q')).toThrow(message);
  });

  it('reads them back, and keeps only those still on the question when its options change', () => {
    expect(readNotCountedOptions({ notCountedOptions: ["Don't know"] })).toEqual(["Don't know"]);
    expect(readNotCountedOptions({ min: 0, max: 10 })).toEqual([]);
    const config = { notCountedOptions: ["Don't know", 'Not applicable'] };
    expect(keptNotCountedConfig(config, T.SINGLE_SELECT, ['Yes', 'No', "Don't know"])).toEqual({ notCountedOptions: ["Don't know"] });
    expect(keptNotCountedConfig(config, T.SINGLE_SELECT, ['Yes', 'No'])).toBeNull();
    expect(keptNotCountedConfig(config, T.TEXT, null)).toBeNull();
  });
});
