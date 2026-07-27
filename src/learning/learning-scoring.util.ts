import { LearningQuestionType } from '@prisma/client';

export type ScoringOption = { id: string; isCorrect: boolean };

export type GradeAnswerResult = {
  isCorrect: boolean | null;
  pointsAwarded: number;
  maxPoints: number;
};

export function gradeAnswer(
  questionType: LearningQuestionType,
  selectedOptionIds: string[],
  options: ScoringOption[],
  points: number,
): GradeAnswerResult {
  const maxPoints = points;

  if (
    questionType === LearningQuestionType.SHORT_TEXT ||
    questionType === LearningQuestionType.LONG_TEXT
  ) {
    return { isCorrect: null, pointsAwarded: 0, maxPoints };
  }

  const correctIds = options.filter((o) => o.isCorrect).map((o) => o.id).sort();
  const selected = [...new Set(selectedOptionIds)].sort();

  if (questionType === LearningQuestionType.SINGLE_CHOICE || questionType === LearningQuestionType.TRUE_FALSE) {
    const isCorrect = selected.length === 1 && correctIds.length === 1 && selected[0] === correctIds[0];
    return { isCorrect, pointsAwarded: isCorrect ? maxPoints : 0, maxPoints };
  }

  if (questionType === LearningQuestionType.MULTIPLE_CHOICE) {
    const isCorrect =
      selected.length === correctIds.length &&
      selected.every((id, index) => id === correctIds[index]);
    return { isCorrect, pointsAwarded: isCorrect ? maxPoints : 0, maxPoints };
  }

  return { isCorrect: null, pointsAwarded: 0, maxPoints };
}

export function calculateAttemptScore(
  answers: GradeAnswerResult[],
  passingScore: number,
): { score: number; percentage: number; passed: boolean } {
  const gradable = answers.filter((a) => a.isCorrect !== null);
  const maxPoints = gradable.reduce((sum, a) => sum + a.maxPoints, 0);
  const score = gradable.reduce((sum, a) => sum + a.pointsAwarded, 0);
  const percentage = maxPoints > 0 ? Math.round((score / maxPoints) * 100) : 0;
  return { score, percentage, passed: percentage >= passingScore };
}

export function stripCorrectFlags<T extends { isCorrect?: boolean }>(option: T): Omit<T, 'isCorrect'> {
  const { isCorrect: _removed, ...rest } = option;
  return rest;
}
