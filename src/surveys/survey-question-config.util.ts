import { BadRequestException } from '@nestjs/common';
import { SurveyQuestionType } from '@prisma/client';

/** Question types answered by picking from `options`. */
export const CHOICE_QUESTION_TYPES: readonly SurveyQuestionType[] = [
  SurveyQuestionType.SINGLE_SELECT,
  SurveyQuestionType.MULTI_SELECT,
];

export const DEFAULT_RATING_RANGE = { min: 0, max: 10 } as const;

/** The built-in agree ↔ disagree scale, used by a LIKERT question with no labels of its own. */
export const DEFAULT_LIKERT_OPTIONS: readonly string[] = [
  'Strongly agree',
  'Agree',
  'Neither agree nor disagree',
  'Disagree',
  'Strongly disagree',
];

/**
 * The built-in scale's middle label used to be "Neutral". Answers store the label text, so
 * answers given then still read "Neutral"; they mean the same as today's middle label.
 */
export const LEGACY_LIKERT_NEUTRAL = 'Neutral';
const DEFAULT_LIKERT_MIDDLE = DEFAULT_LIKERT_OPTIONS[2]!;
const MAX_OPTIONS = 50;
const MAX_OPTION_LENGTH = 200;
const RATING_LIMITS = { min: 0, max: 100 } as const;

/** Choice and scale questions: answers left out of the percentages (see readNotCountedOptions). */
export type NotCountedSettings = { notCountedOptions: string[] };

export type SurveyQuestionSettings = {
  options: string[] | null;
  /** RATING: its lowest / highest score. Choice and scale questions: answers not counted. */
  config: { min: number; max: number } | NotCountedSettings | null;
};

/** Question types whose answers can be marked "Not counted in percentages". */
export const NOT_COUNTED_QUESTION_TYPES: readonly SurveyQuestionType[] = [
  SurveyQuestionType.SINGLE_SELECT,
  SurveyQuestionType.MULTI_SELECT,
  SurveyQuestionType.LIKERT,
];

const isEmptyValue = (value: unknown) =>
  value === undefined ||
  value === null ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0);

function validateOptionList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${label}: options must be a list of answers`);
  }
  const options: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new BadRequestException(`${label}: every option needs some text`);
    }
    const option = raw.trim();
    if (option.length > MAX_OPTION_LENGTH) {
      throw new BadRequestException(`${label}: options can be at most ${MAX_OPTION_LENGTH} characters`);
    }
    const key = option.toLocaleLowerCase('en-GB');
    if (seen.has(key)) {
      throw new BadRequestException(`${label}: "${option}" is listed more than once`);
    }
    seen.add(key);
    options.push(option);
  }
  if (options.length < 2) {
    throw new BadRequestException(`${label}: add at least two options`);
  }
  if (options.length > MAX_OPTIONS) {
    throw new BadRequestException(`${label}: at most ${MAX_OPTIONS} options`);
  }
  return options;
}

/**
 * Choice and scale questions: { notCountedOptions } — answers such as "Don't know" left out of the
 * percentages. Each must be one of the question's answers, and at least one answer stays counted.
 * Null when none are marked.
 */
function validateNotCountedConfig(value: unknown, answers: readonly string[], label: string): NotCountedSettings | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(`${label}: settings must list the answers not counted in percentages`);
  }
  const extra = Object.keys(value).filter((k) => k !== 'notCountedOptions');
  if (extra.length) {
    throw new BadRequestException(`${label}: unknown setting "${extra[0]}"`);
  }
  const raw = (value as { notCountedOptions?: unknown }).notCountedOptions;
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return null;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string' || !v.trim())) {
    throw new BadRequestException(`${label}: answers not counted in percentages must be a list of answers`);
  }
  const out: string[] = [];
  for (const v of raw as string[]) {
    const answer = v.trim();
    if (!answers.includes(answer)) {
      throw new BadRequestException(`${label}: "${answer}" is marked not counted, but it is not one of the answers`);
    }
    if (!out.includes(answer)) out.push(answer);
  }
  if (out.length >= answers.length) {
    throw new BadRequestException(`${label}: at least one answer must be counted in the percentages`);
  }
  return { notCountedOptions: out };
}

/**
 * Answers marked not counted that are still on the question (its options can change after they
 * were marked); kept as a config for normaliseQuestionSettings, or null.
 */
export function keptNotCountedConfig(config: unknown, questionType: SurveyQuestionType, options: unknown): NotCountedSettings | null {
  if (!NOT_COUNTED_QUESTION_TYPES.includes(questionType)) return null;
  const answers = questionAnswerChoices(questionType, options, null, null) ?? [];
  const kept = readNotCountedOptions(config).filter((o) => answers.includes(o));
  return kept.length && kept.length < answers.length ? { notCountedOptions: kept } : null;
}

function validateRatingConfig(value: unknown, label: string): { min: number; max: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(`${label}: rating settings must give a lowest and highest score`);
  }
  const extra = Object.keys(value).filter((k) => k !== 'min' && k !== 'max');
  if (extra.length) {
    throw new BadRequestException(`${label}: unknown rating setting "${extra[0]}"`);
  }
  const { min, max } = value as { min?: unknown; max?: unknown };
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new BadRequestException(`${label}: the lowest and highest score must be whole numbers`);
  }
  const lo = min as number;
  const hi = max as number;
  if (lo < RATING_LIMITS.min || hi > RATING_LIMITS.max) {
    throw new BadRequestException(
      `${label}: scores must be between ${RATING_LIMITS.min} and ${RATING_LIMITS.max}`,
    );
  }
  if (lo >= hi) {
    throw new BadRequestException(`${label}: the highest score must be above the lowest`);
  }
  return { min: lo, max: hi };
}

/**
 * Validate and normalise a question's options / config for its type, so every saved question
 * can be answered: choice questions need two or more distinct, non-empty options; a rating
 * needs whole-number bounds; choice and scale questions may mark answers "Not counted in
 * percentages" ({ notCountedOptions }); other types carry neither.
 */
export function normaliseQuestionSettings(
  questionType: SurveyQuestionType,
  options: unknown,
  config: unknown,
  questionText = 'This question',
): SurveyQuestionSettings {
  const label = questionText.trim() || 'This question';
  let normalisedOptions: string[] | null = null;
  if (CHOICE_QUESTION_TYPES.includes(questionType)) {
    normalisedOptions = validateOptionList(options ?? [], label);
  } else if (questionType === SurveyQuestionType.LIKERT) {
    // Agree ↔ disagree uses the standard five-point scale unless custom labels are given.
    normalisedOptions = isEmptyValue(options) ? null : validateOptionList(options, label);
  } else if (!isEmptyValue(options)) {
    throw new BadRequestException(`${label}: options only apply to choice questions`);
  }

  let normalisedConfig: SurveyQuestionSettings['config'] = null;
  if (questionType === SurveyQuestionType.RATING) {
    normalisedConfig = isEmptyValue(config) ? null : validateRatingConfig(config, label);
  } else if (NOT_COUNTED_QUESTION_TYPES.includes(questionType)) {
    const answers =
      questionType === SurveyQuestionType.LIKERT ? (normalisedOptions ?? [...DEFAULT_LIKERT_OPTIONS]) : (normalisedOptions ?? []);
    normalisedConfig = isEmptyValue(config) ? null : validateNotCountedConfig(config, answers, label);
  } else if (!isEmptyValue(config)) {
    throw new BadRequestException(`${label}: settings only apply to rating, choice and scale questions`);
  }

  return { options: normalisedOptions, config: normalisedConfig };
}

/** A LIKERT question with no labels of its own uses the built-in agree ↔ disagree scale. */
export function usesDefaultLikertScale(questionType: SurveyQuestionType, options: unknown): boolean {
  return (
    questionType === SurveyQuestionType.LIKERT &&
    !(Array.isArray(options) && options.some((o) => typeof o === 'string'))
  );
}

/**
 * Selected labels as they read today: on the built-in scale, an answer saved as "Neutral"
 * (the old middle label) reads "Neither agree nor disagree". Everything else is unchanged.
 */
export function currentAnswerLabels(
  questionType: SurveyQuestionType,
  options: unknown,
  selected: readonly string[],
): string[] {
  if (!usesDefaultLikertScale(questionType, options)) return [...selected];
  return selected.map((s) => (s === LEGACY_LIKERT_NEUTRAL ? DEFAULT_LIKERT_MIDDLE : s));
}

/** Rating bounds for a stored question config (defaults 0–10). */
export function ratingRange(config: unknown): { min: number; max: number } {
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    const { min, max } = config as { min?: unknown; max?: unknown };
    if (Number.isInteger(min) && Number.isInteger(max) && (min as number) < (max as number)) {
      return { min: min as number, max: max as number };
    }
  }
  return { ...DEFAULT_RATING_RANGE };
}

// ─── Respondent text and conditional questions ─────────────────────────────

/** Longest text a respondent can write in an "Other" box or a comment box (after trimming). */
export const MAX_RESPONDENT_TEXT = 2000;
const MAX_PROMPT_LENGTH = 200;
const MAX_SHOW_IF_ANSWERS = 50;
export const DEFAULT_OTHER_LABEL = 'Other (please tell us)';
export const DEFAULT_OTHER_PROMPT = 'Please tell us';
/** The comment box prompt when none is given (the survey builder offers the same). */
export const DEFAULT_COMMENT_PROMPT = 'Please tell us why';
export const YES_NO_ANSWERS: readonly string[] = ['Yes', 'No'];
/** A question's stable reference within its survey ("Show only if" rules point at it). */
export const QUESTION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Written-answer questions: the answer is already the respondent's own text, so no comment box. */
export const NO_COMMENT_QUESTION_TYPES: readonly SurveyQuestionType[] = [
  SurveyQuestionType.TEXT,
  SurveyQuestionType.TEXTAREA,
];
/** Questions with a fixed set of answers, which "Show only if" can refer to. */
export const SHOW_IF_SOURCE_TYPES: readonly SurveyQuestionType[] = [
  SurveyQuestionType.YES_NO,
  SurveyQuestionType.SINGLE_SELECT,
  SurveyQuestionType.MULTI_SELECT,
  SurveyQuestionType.LIKERT,
  SurveyQuestionType.RATING,
];

/** "Other (please tell us)" on a single / multiple choice question. */
export type OtherOptionSettings = { label: string; textPrompt: string; textRequired: boolean };
/** Comment box alongside the answer; showWhen null = after any answer. */
export type CommentSettings = { prompt: string; showWhen: string[] | null };
/** Ask the question only when an earlier question's answer is one of `answers`. */
export type ShowIfSettings = { questionKey: string; answers: string[] };

export type SurveyQuestionLogic = {
  otherOption: OtherOptionSettings | null;
  /** MULTI_SELECT: options that cannot be combined with any other ("None of these"). */
  exclusiveOptions: string[] | null;
  commentConfig: CommentSettings | null;
  showIf: ShowIfSettings | null;
};

type LogicInput = { otherOption?: unknown; exclusiveOptions?: unknown; commentConfig?: unknown; showIf?: unknown };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Every answer a question can be given, as the labels respondents see (YES_NO: Yes / No; choice
 * questions: their options plus the Other label; scales: their labels; rating: each score as text).
 * Null for free-entry questions (text, number), whose answers cannot be listed.
 */
export function questionAnswerChoices(
  questionType: SurveyQuestionType,
  options: unknown,
  config: unknown,
  otherOption: unknown,
): string[] | null {
  const strings = Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string') : [];
  switch (questionType) {
    case SurveyQuestionType.YES_NO:
      return [...YES_NO_ANSWERS];
    case SurveyQuestionType.SINGLE_SELECT:
    case SurveyQuestionType.MULTI_SELECT: {
      const other = readOtherOption(otherOption);
      return other ? [...strings, other.label] : strings;
    }
    case SurveyQuestionType.LIKERT:
      return strings.length ? strings : [...DEFAULT_LIKERT_OPTIONS];
    case SurveyQuestionType.RATING: {
      const { min, max } = ratingRange(config);
      return Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
    }
    default:
      return null;
  }
}

function promptText(value: unknown, fallback: string, problem: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_PROMPT_LENGTH) {
    throw new Error(problem);
  }
  return value.trim();
}

function otherOptionOrThrow(
  questionType: SurveyQuestionType,
  value: unknown,
  options: readonly string[] | null,
): OtherOptionSettings | null {
  if (value === undefined || value === null) return null;
  if (!CHOICE_QUESTION_TYPES.includes(questionType)) {
    throw new Error('an Other choice only applies to single and multiple choice questions');
  }
  if (!isPlainObject(value)) throw new Error('the Other choice must give a label and a text prompt');
  const extra = Object.keys(value).find((k) => !['label', 'textPrompt', 'textRequired'].includes(k));
  if (extra) throw new Error(`unknown Other setting "${extra}"`);
  const label = promptText(
    value.label,
    DEFAULT_OTHER_LABEL,
    `the Other choice needs a label of at most ${MAX_PROMPT_LENGTH} characters`,
  );
  const textPrompt = promptText(
    value.textPrompt,
    DEFAULT_OTHER_PROMPT,
    `the Other text box needs a prompt of at most ${MAX_PROMPT_LENGTH} characters`,
  );
  if (value.textRequired !== undefined && typeof value.textRequired !== 'boolean') {
    throw new Error('the Other choice must say whether its text is required (true or false)');
  }
  const key = label.toLocaleLowerCase('en-GB');
  if ((options ?? []).some((o) => o.trim().toLocaleLowerCase('en-GB') === key)) {
    throw new Error(`"${label}" is already one of the options; give the Other choice a different label`);
  }
  return { label, textPrompt, textRequired: value.textRequired ?? true };
}

function exclusiveOptionsOrThrow(
  questionType: SurveyQuestionType,
  value: unknown,
  options: readonly string[] | null,
): string[] | null {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return null;
  if (questionType !== SurveyQuestionType.MULTI_SELECT) {
    throw new Error('only multiple choice questions can have answers that clear the others');
  }
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
    throw new Error('answers that clear the others (exclusiveOptions) must be a list of options');
  }
  const out: string[] = [];
  for (const raw of value as string[]) {
    const option = raw.trim();
    if (!(options ?? []).includes(option)) {
      throw new Error(`"${option}" is set to clear the other answers, but it is not one of the options`);
    }
    if (!out.includes(option)) out.push(option);
  }
  return out;
}

function commentConfigOrThrow(
  questionType: SurveyQuestionType,
  value: unknown,
  choices: readonly string[] | null,
): CommentSettings | null {
  if (value === undefined || value === null) return null;
  if (NO_COMMENT_QUESTION_TYPES.includes(questionType)) {
    throw new Error('a comment box does not apply to written-answer questions');
  }
  if (!isPlainObject(value)) throw new Error('the comment box must give a prompt');
  const extra = Object.keys(value).find((k) => !['prompt', 'showWhen'].includes(k));
  if (extra) throw new Error(`unknown comment setting "${extra}"`);
  const prompt = promptText(
    value.prompt,
    DEFAULT_COMMENT_PROMPT,
    `the comment box needs a prompt of at most ${MAX_PROMPT_LENGTH} characters`,
  );
  const raw = value.showWhen;
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) {
    return { prompt, showWhen: null };
  }
  if (!Array.isArray(raw) || raw.some((a) => typeof a !== 'string' || !a.trim())) {
    throw new Error('the comment box answers (showWhen) must be a list of answers');
  }
  if (!choices) {
    throw new Error('a comment box on this question is offered after any answer, so leave out showWhen');
  }
  const showWhen: string[] = [];
  for (const a of raw as string[]) {
    const answer = a.trim();
    if (!choices.includes(answer)) {
      throw new Error(
        `the comment box is set to show after "${answer}", which is not one of this question's answers`,
      );
    }
    if (!showWhen.includes(answer)) showWhen.push(answer);
  }
  return { prompt, showWhen };
}

function showIfOrThrow(value: unknown): ShowIfSettings | null {
  if (value === undefined || value === null) return null;
  const problem = '"Show only if" needs an earlier question and at least one of its answers';
  if (!isPlainObject(value)) throw new Error(problem);
  const extra = Object.keys(value).find((k) => !['questionKey', 'answers'].includes(k));
  if (extra) throw new Error(`unknown "Show only if" setting "${extra}"`);
  const { questionKey, answers } = value;
  if (typeof questionKey !== 'string' || !QUESTION_KEY_PATTERN.test(questionKey.trim())) throw new Error(problem);
  if (!Array.isArray(answers) || !answers.length || answers.some((a) => typeof a !== 'string' || !a.trim())) {
    throw new Error(problem);
  }
  const list = [...new Set((answers as string[]).map((a) => a.trim()))];
  if (list.length > MAX_SHOW_IF_ANSWERS) {
    throw new Error(`"Show only if" can list at most ${MAX_SHOW_IF_ANSWERS} answers`);
  }
  return { questionKey: questionKey.trim(), answers: list };
}

function normaliseLogicOrThrow(
  questionType: SurveyQuestionType,
  options: unknown,
  config: unknown,
  logic: LogicInput,
): SurveyQuestionLogic {
  const optionList = Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string') : null;
  const otherOption = otherOptionOrThrow(questionType, logic.otherOption, optionList);
  const exclusiveOptions = exclusiveOptionsOrThrow(questionType, logic.exclusiveOptions, optionList);
  const choices = questionAnswerChoices(questionType, options, config, otherOption);
  const commentConfig = commentConfigOrThrow(questionType, logic.commentConfig, choices);
  const showIf = showIfOrThrow(logic.showIf);
  return { otherOption, exclusiveOptions, commentConfig, showIf };
}

/**
 * Why a question's Other choice / comment box / show-if rule cannot be saved, or null when it can.
 * `options` and `config` are the question's (valid) settings. Whether a show-if rule points at a
 * real, earlier question is a survey-wide check: see surveyLogicProblems.
 */
export function questionLogicProblem(
  questionType: SurveyQuestionType,
  options: unknown,
  config: unknown,
  logic: LogicInput,
): string | null {
  try {
    normaliseLogicOrThrow(questionType, options, config, logic);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * Validate and normalise a question's Other choice, comment box and "Show only if" rule (trimmed,
 * defaults filled in). Call after normaliseQuestionSettings, with the options / config it returned.
 */
export function normaliseQuestionLogic(
  questionType: SurveyQuestionType,
  options: unknown,
  config: unknown,
  logic: LogicInput,
  questionText = 'This question',
): SurveyQuestionLogic {
  try {
    return normaliseLogicOrThrow(questionType, options, config, logic);
  } catch (err) {
    throw new BadRequestException(`${questionText.trim() || 'This question'}: ${(err as Error).message}`);
  }
}

/** A stored Other choice, or null (defaults filled in for partial values). */
export function readOtherOption(value: unknown): OtherOptionSettings | null {
  if (!isPlainObject(value)) return null;
  const label = typeof value.label === 'string' && value.label.trim() ? value.label.trim() : DEFAULT_OTHER_LABEL;
  const textPrompt =
    typeof value.textPrompt === 'string' && value.textPrompt.trim() ? value.textPrompt.trim() : DEFAULT_OTHER_PROMPT;
  return { label, textPrompt, textRequired: value.textRequired !== false };
}

/** A stored list of options that clear the others (MULTI_SELECT), or an empty list. */
export function readExclusiveOptions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Answers left out of a question's percentages ("Don't know", "Prefer not to say", "Not applicable"):
 * still counted and shown ("12 said Don't know"), but not in the base a percentage is worked out
 * from. Stored in the question's `config` as { notCountedOptions: string[] } on choice and scale
 * questions; empty when none are marked.
 */
export function readNotCountedOptions(config: unknown): string[] {
  if (!isPlainObject(config) || !Array.isArray(config.notCountedOptions)) return [];
  return config.notCountedOptions.filter((v): v is string => typeof v === 'string');
}

/** A stored comment box, or null. */

export function readCommentConfig(value: unknown): CommentSettings | null {
  if (!isPlainObject(value)) return null;
  const prompt =
    typeof value.prompt === 'string' && value.prompt.trim() ? value.prompt.trim() : DEFAULT_COMMENT_PROMPT;
  const showWhen = Array.isArray(value.showWhen)
    ? value.showWhen.filter((a): a is string => typeof a === 'string')
    : [];
  return { prompt, showWhen: showWhen.length ? showWhen : null };
}

/** A stored "Show only if" rule, or null. */
export function readShowIf(value: unknown): ShowIfSettings | null {
  if (!isPlainObject(value) || typeof value.questionKey !== 'string' || !Array.isArray(value.answers)) return null;
  const answers = value.answers.filter((a): a is string => typeof a === 'string');
  return answers.length ? { questionKey: value.questionKey, answers } : null;
}

export type LogicQuestion = {
  key: string | null;
  questionText: string;
  questionType: SurveyQuestionType;
  options: unknown;
  config: unknown;
  otherOption: unknown;
  showIf: unknown;
};

/**
 * Survey-wide checks, with the questions in the order respondents see them: question keys are
 * unique, and every "Show only if" rule points at an earlier question that is always asked, has a
 * fixed set of answers, and lists only answers that question can be given.
 */
export function surveyLogicProblems(questions: readonly LogicQuestion[]): string[] {
  const problems: string[] = [];
  const indexByKey = new Map<string, number>();
  questions.forEach((q, i) => {
    if (!q.key) return;
    if (indexByKey.has(q.key)) problems.push(`two questions share the id "${q.key}"`);
    else indexByKey.set(q.key, i);
  });
  questions.forEach((q, i) => {
    const rule = readShowIf(q.showIf);
    if (!rule) return;
    const label = `"${q.questionText.trim().slice(0, 80)}"`;
    const refIndex = indexByKey.get(rule.questionKey);
    if (refIndex === undefined) {
      problems.push(`${label}: "Show only if" refers to a question that is not in this survey`);
      return;
    }
    if (refIndex >= i) {
      problems.push(`${label}: "Show only if" must refer to an earlier question`);
      return;
    }
    const ref = questions[refIndex]!;
    if (readShowIf(ref.showIf)) {
      problems.push(`${label}: "Show only if" can only refer to a question that is always asked`);
      return;
    }
    if (!SHOW_IF_SOURCE_TYPES.includes(ref.questionType)) {
      problems.push(`${label}: "Show only if" cannot refer to a written or number answer`);
      return;
    }
    const choices = questionAnswerChoices(ref.questionType, ref.options, ref.config, ref.otherOption) ?? [];
    const missing = rule.answers.find((a) => !choices.includes(a));
    if (missing !== undefined) {
      problems.push(
        `${label}: "Show only if": "${missing}" is not one of the answers to "${ref.questionText.trim().slice(0, 80)}"`,
      );
    }
  });
  return problems;
}

/** Throws (400) with the first survey-wide logic problem. */
export function assertSurveyLogic(questions: readonly LogicQuestion[]): void {
  const [problem] = surveyLogicProblems(questions);
  if (problem) throw new BadRequestException(problem);
}

/** A new question key ("q-" and eight letters / digits), unique within its survey. */
export function newQuestionKey(taken: ReadonlySet<string>, random: () => string): string {
  for (let attempt = 0; ; attempt += 1) {
    const key = `q-${random().replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
    if (key.length === 10 && !taken.has(key)) return key;
    if (attempt > 100) throw new Error('Could not create a question key');
  }
}

/**
 * The labels an answer reads as, for "Show only if" and comment-box rules: Yes / No, the chosen
 * options (MULTI_SELECT: all of them), a rating's score as text. Empty when unanswered or free entry.
 */
export function answerLabelsFor(
  question: { questionType: SurveyQuestionType; options: unknown },
  answer:
    | { booleanValue?: boolean | null; numberValue?: number | null; selectedOptions?: unknown }
    | undefined
    | null,
): string[] {
  if (!answer) return [];
  switch (question.questionType) {
    case SurveyQuestionType.YES_NO:
      return typeof answer.booleanValue === 'boolean' ? [answer.booleanValue ? 'Yes' : 'No'] : [];
    case SurveyQuestionType.SINGLE_SELECT:
    case SurveyQuestionType.MULTI_SELECT:
    case SurveyQuestionType.LIKERT:
      return currentAnswerLabels(
        question.questionType,
        question.options,
        Array.isArray(answer.selectedOptions)
          ? answer.selectedOptions.filter((v): v is string => typeof v === 'string')
          : [],
      );
    case SurveyQuestionType.RATING:
      return typeof answer.numberValue === 'number' && !Number.isNaN(answer.numberValue)
        ? [String(answer.numberValue)]
        : [];
    default:
      return [];
  }
}

/**
 * Whether a question is asked, given the answers so far. A question without a rule is always
 * asked; one whose rule points at a question that is not on the form is asked too (never lost).
 */
export function isQuestionShown<
  Q extends { id: string; key: string | null; questionType: SurveyQuestionType; options: unknown; showIf: unknown },
  A extends { booleanValue?: boolean | null; numberValue?: number | null; selectedOptions?: unknown },
>(question: Q, questionsByKey: ReadonlyMap<string, Q>, answerOf: (questionId: string) => A | undefined | null, depth = 0): boolean {
  const rule = readShowIf(question.showIf);
  if (!rule) return true;
  const ref = questionsByKey.get(rule.questionKey);
  if (!ref || ref.id === question.id) return true;
  if (depth < 5 && !isQuestionShown(ref, questionsByKey, answerOf, depth + 1)) return false;
  const labels = answerLabelsFor(ref, answerOf(ref.id));
  return labels.some((l) => rule.answers.includes(l));
}

/** Whether the comment box is offered for this answer (only once the question is answered). */
export function isCommentShown(commentConfig: unknown, answered: boolean, labels: readonly string[]): boolean {
  const comment = readCommentConfig(commentConfig);
  if (!comment || !answered) return false;
  return !comment.showWhen || labels.some((l) => comment.showWhen!.includes(l));
}

/** Respondent text as stored: trimmed, empty → null. */
export function cleanRespondentText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
