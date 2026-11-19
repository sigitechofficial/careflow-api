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

export type ScoringQuestion = {
  id: string;
  questionType: LearningQuestionType;
  points: number;
  options: ScoringOption[];
};

export type SubmittedAnswer = {
  questionId: string;
  selectedOptionIds?: string[] | null;
};

/**
 * Grade a whole attempt against EVERY question of the quiz. A question left unanswered
 * scores 0 but still counts towards the total, answers to questions that are not in this
 * quiz are ignored, and a question answered twice is graded once (first answer wins).
 * Free-text questions are not auto-marked and do not count towards the percentage.
 */
export function gradeAttempt(
  questions: ScoringQuestion[],
  answers: SubmittedAnswer[],
  passingScore: number,
): {
  graded: Array<{ questionId: string; answered: boolean } & GradeAnswerResult>;
  score: number;
  percentage: number;
  passed: boolean;
} {
  const firstAnswer = new Map<string, SubmittedAnswer>();
  for (const answer of answers) {
    if (!firstAnswer.has(answer.questionId))
      firstAnswer.set(answer.questionId, answer);
  }
  const graded = questions.map((question) => {
    const answer = firstAnswer.get(question.id);
    const result = gradeAnswer(
      question.questionType,
      answer?.selectedOptionIds ?? [],
      question.options,
      question.points,
    );
    // Unanswered choice questions are wrong, not skipped.
    const isCorrect =
      result.isCorrect === null ? null : answer ? result.isCorrect : false;
    return {
      questionId: question.id,
      answered: Boolean(answer),
      ...result,
      isCorrect,
      pointsAwarded: answer ? result.pointsAwarded : 0,
    };
  });
  const summary = calculateAttemptScore(graded, passingScore);
  return { graded, ...summary };
}

export function stripCorrectFlags<T extends { isCorrect?: boolean }>(option: T): Omit<T, 'isCorrect'> {
  const { isCorrect: _removed, ...rest } = option;
  return rest;
}
