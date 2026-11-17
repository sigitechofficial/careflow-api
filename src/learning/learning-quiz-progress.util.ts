import {
  LearningAssessmentResult,
  LearningProgressStatus,
} from '@prisma/client';

/**
 * Quiz rules for a carer on one course version (course outline redesign, 13 Nov 2026):
 * - module quizzes are Required or Optional; final assessments (no module) are always required;
 * - the quiz step is done when every required quiz has a passed attempt;
 * - the assignment fails only when a required quiz has no pass and no tries left;
 * - a module quiz opens when that module's required lessons are done;
 * - a final assessment opens when all required lessons are done and all required module quizzes are passed.
 */
export type QuizForProgress = {
  id: string;
  sectionId: string | null;
  isRequired: boolean;
  maximumAttempts: number | null;
};

export type AttemptForProgress = {
  assessmentId: string;
  result: LearningAssessmentResult;
};

/** Final assessments are always required, whatever is stored. */
export function quizIsRequired(
  quiz: Pick<QuizForProgress, 'sectionId' | 'isRequired'>,
): boolean {
  return quiz.sectionId === null || quiz.isRequired;
}

function submitted(attempts: AttemptForProgress[], quizId: string) {
  return attempts.filter(
    (a) =>
      a.assessmentId === quizId &&
      a.result !== LearningAssessmentResult.IN_PROGRESS &&
      a.result !== LearningAssessmentResult.INVALIDATED,
  );
}

export function quizPassed(
  attempts: AttemptForProgress[],
  quizId: string,
): boolean {
  return submitted(attempts, quizId).some(
    (a) => a.result === LearningAssessmentResult.PASSED,
  );
}

/** No pass yet and every allowed try used (null limit = never out of tries). */
export function quizOutOfTries(
  quiz: QuizForProgress,
  attempts: AttemptForProgress[],
): boolean {
  if (quiz.maximumAttempts == null) return false;
  if (quizPassed(attempts, quiz.id)) return false;
  return submitted(attempts, quiz.id).length >= quiz.maximumAttempts;
}

/** Status of the whole quiz step for one assignment. */
export function quizStepStatus(
  quizzes: QuizForProgress[],
  attempts: AttemptForProgress[],
): LearningProgressStatus {
  const required = quizzes.filter(quizIsRequired);
  if (required.some((q) => quizOutOfTries(q, attempts)))
    return LearningProgressStatus.FAILED;
  if (required.length && required.every((q) => quizPassed(attempts, q.id))) {
    return LearningProgressStatus.COMPLETED;
  }
  if (!required.length) return LearningProgressStatus.COMPLETED;
  const started = required.some((q) => submitted(attempts, q.id).length > 0);
  return started
    ? LearningProgressStatus.IN_PROGRESS
    : LearningProgressStatus.NOT_STARTED;
}

export type LessonForProgress = { id: string; sectionId: string };

/** Why a quiz cannot be started yet, or null when it is open. */
export function quizLockReason(
  quiz: QuizForProgress,
  input: {
    requiredLessons: LessonForProgress[];
    completedLessonIds: Set<string>;
    quizzes: QuizForProgress[];
    attempts: AttemptForProgress[];
  },
): string | null {
  const { requiredLessons, completedLessonIds, quizzes, attempts } = input;
  if (quiz.sectionId) {
    const left = requiredLessons.filter(
      (l) => l.sectionId === quiz.sectionId && !completedLessonIds.has(l.id),
    ).length;
    return left ? `Finish this module's lessons first (${left} left)` : null;
  }
  const lessonsLeft = requiredLessons.filter(
    (l) => !completedLessonIds.has(l.id),
  ).length;
  const moduleQuizzesLeft = quizzes.filter(
    (q) => q.sectionId && quizIsRequired(q) && !quizPassed(attempts, q.id),
  ).length;
  if (!lessonsLeft && !moduleQuizzesLeft) return null;
  const parts: string[] = [];
  if (lessonsLeft)
    parts.push(`${lessonsLeft} lesson${lessonsLeft === 1 ? '' : 's'}`);
  if (moduleQuizzesLeft) {
    parts.push(
      `${moduleQuizzesLeft} module quiz${moduleQuizzesLeft === 1 ? '' : 'zes'}`,
    );
  }
  return `Opens when you finish all modules (${parts.join(' and ')} left)`;
}
