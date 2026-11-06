import type { SurveyQuestionType } from '@prisma/client';
import { isQuestionShown } from './survey-question-config.util';
import { questionsNotAskedWhenUnlinked } from './survey-respondent-anonymity.util';

/**
 * "Answered every question" or "Skipped some optional questions", worked out per response and only
 * ever reported as two totals. Only the questions that applied to that person count:
 *  - a "Show only if" question whose condition their answers did not meet was not asked;
 *  - the contact-me question (and its follow-ups) is not asked of anyone whose answer is linked to no one (an anonymous
 *    survey, or a response given or recorded without a name: we could not reply);
 *  - a question added after they answered was not on their form.
 */

const DAY_MS = 86_400_000;

export type CompletenessQuestion = {
  id: string;
  key: string | null;
  questionText: string;
  questionType: SurveyQuestionType;
  options: unknown;
  showIf: unknown;
  createdAt?: Date | null;
};

export type CompletenessAnswer = {
  questionId: string;
  booleanValue: boolean | null;
  numberValue: number | null;
  selectedOptions: unknown;
};

/**
 * Whether one response answered every question that applied to it. `submittedAt` dates the response;
 * `dateOnly` (answers linked to no one keep only their day) counts any question added that day as
 * on their form.
 */
export function answeredEveryQuestion(
  questions: readonly CompletenessQuestion[],
  answers: readonly CompletenessAnswer[],
  opts: { unlinked: boolean; submittedAt?: Date | null; dateOnly?: boolean },
): boolean {
  const answerById = new Map(answers.map((a) => [a.questionId, a]));
  // The contact-me question and its follow-ups (at any depth) are not asked of anyone linked to no one.
  const notAsked = opts.unlinked ? questionsNotAskedWhenUnlinked(questions) : new Set<string>();
  const formEnd = opts.submittedAt ? opts.submittedAt.getTime() + (opts.dateOnly ? DAY_MS : 0) : null;
  const onForm = questions.filter(
    (q) =>
      !notAsked.has(q.id) &&
      (formEnd === null || !q.createdAt || q.createdAt.getTime() <= formEnd),
  );
  const byKey = new Map(onForm.filter((q) => q.key).map((q) => [q.key!, q]));
  return onForm.every(
    (q) => answerById.has(q.id) || !isQuestionShown(q, byKey, (id) => answerById.get(id)),
  );
}

export type CompletenessTotals = { answeredEveryQuestion: number; skippedSomeQuestions: number };

/**
 * Totals over responses. `responsesWithoutAnswers` are counted responses with no answer at all
 * (every question was optional and left blank): they skipped some, whenever anything applied.
 */
export function completenessTotals(
  responses: ReadonlyArray<{
    questions: readonly CompletenessQuestion[];
    answers: readonly CompletenessAnswer[];
    unlinked: boolean;
    submittedAt?: Date | null;
    dateOnly?: boolean;
  }>,
  responsesWithoutAnswers = 0,
): CompletenessTotals {
  let complete = 0;
  for (const r of responses) {
    if (answeredEveryQuestion(r.questions, r.answers, r)) complete += 1;
  }
  return {
    answeredEveryQuestion: complete,
    skippedSomeQuestions: responses.length - complete + Math.max(0, responsesWithoutAnswers),
  };
}
