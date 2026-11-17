import { BadRequestException } from '@nestjs/common';
import { LearningQuestionType } from '@prisma/client';

/**
 * Quiz questions an admin can author. Free-text types stay in the enum for old data but
 * cannot be marked automatically (gradeAttempt skips them), so new ones are not allowed.
 */
export const AUTHORABLE_QUESTION_TYPES: LearningQuestionType[] = [
  LearningQuestionType.SINGLE_CHOICE,
  LearningQuestionType.MULTIPLE_CHOICE,
  LearningQuestionType.TRUE_FALSE,
];

export const MAX_QUESTION_OPTIONS = 10;

export type QuestionOptionInput = {
  optionText?: string | null;
  isCorrect?: boolean | null;
};
export type CheckedOption = {
  optionText: string;
  isCorrect: boolean;
  displayOrder: number;
};

/** Returns the reason a question is not valid, or null when it is. */
export function questionError(
  questionType: LearningQuestionType,
  questionText: string | null | undefined,
  options: QuestionOptionInput[] | null | undefined,
): string | null {
  if (!AUTHORABLE_QUESTION_TYPES.includes(questionType)) {
    return 'Questions can be single answer, multiple answers or true/false';
  }
  if (!questionText?.trim()) return 'Write the question';
  const list = options ?? [];
  const texts = list.map((o) => (o.optionText ?? '').trim());
  if (texts.some((t) => !t)) return 'Every answer needs text';
  const unique = new Set(texts.map((t) => t.toLowerCase()));
  if (unique.size !== texts.length) return 'Two answers have the same text';
  const correct = list.filter((o) => o.isCorrect === true).length;

  if (questionType === LearningQuestionType.TRUE_FALSE) {
    const pair = [...unique].sort().join('|');
    if (list.length !== 2 || pair !== 'false|true')
      return 'A true/false question has the answers True and False';
    if (correct !== 1) return 'Mark True or False as the correct answer';
    return null;
  }
  if (list.length < 2) return 'Add at least 2 answers';
  if (list.length > MAX_QUESTION_OPTIONS)
    return `A question can have at most ${MAX_QUESTION_OPTIONS} answers`;
  if (questionType === LearningQuestionType.SINGLE_CHOICE && correct !== 1) {
    return 'Mark exactly one correct answer';
  }
  if (questionType === LearningQuestionType.MULTIPLE_CHOICE && correct < 1) {
    return 'Mark at least one correct answer';
  }
  return null;
}

/** Validates and normalises a question's answers (trimmed text, order by position). */
export function checkedQuestionOptions(
  questionType: LearningQuestionType,
  questionText: string | null | undefined,
  options: QuestionOptionInput[] | null | undefined,
): CheckedOption[] {
  const error = questionError(questionType, questionText, options);
  if (error) throw new BadRequestException(error);
  return (options ?? []).map((o, index) => ({
    optionText: (o.optionText ?? '').trim(),
    isCorrect: o.isCorrect === true,
    displayOrder: index,
  }));
}

/** Competency checklist: trimmed, non-empty, no duplicates. */
export function checkedCompetencyCriteria(
  criteria: string[] | null | undefined,
): string[] {
  const list = (criteria ?? []).map((c) => (c ?? '').trim()).filter(Boolean);
  if (!list.length)
    throw new BadRequestException('Add at least one checklist item');
  const seen = new Set<string>();
  for (const item of list) {
    const key = item.toLowerCase();
    if (seen.has(key))
      throw new BadRequestException(`"${item}" is in the checklist twice`);
    seen.add(key);
  }
  return list;
}
