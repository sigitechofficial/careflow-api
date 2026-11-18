import {
  LearningAssessmentResult,
  LearningProgressStatus,
} from '@prisma/client';
import {
  quizIsRequired,
  quizLockReason,
  quizOutOfTries,
  quizStepStatus,
  type AttemptForProgress,
  type QuizForProgress,
} from './learning-quiz-progress.util';

const { PASSED, FAILED, IN_PROGRESS } = LearningAssessmentResult;
const moduleQuiz = (
  id: string,
  sectionId: string,
  isRequired = true,
  maximumAttempts: number | null = 3,
): QuizForProgress => ({
  id,
  sectionId,
  isRequired,
  maximumAttempts,
});
const finalQuiz = (
  id: string,
  maximumAttempts: number | null = 3,
): QuizForProgress => ({
  id,
  sectionId: null,
  isRequired: false,
  maximumAttempts,
});
const att = (
  assessmentId: string,
  result: LearningAssessmentResult,
): AttemptForProgress => ({ assessmentId, result });

describe('learning-quiz-progress.util', () => {
  it('final assessments are always required', () => {
    expect(quizIsRequired({ sectionId: null, isRequired: false })).toBe(true);
    expect(quizIsRequired({ sectionId: 's1', isRequired: false })).toBe(false);
  });

  it('quiz step is done only when every required quiz is passed', () => {
    const quizzes = [
      moduleQuiz('m1', 's1'),
      moduleQuiz('m2', 's2', false),
      finalQuiz('f1'),
    ];
    expect(quizStepStatus(quizzes, [])).toBe(
      LearningProgressStatus.NOT_STARTED,
    );
    expect(quizStepStatus(quizzes, [att('m1', PASSED)])).toBe(
      LearningProgressStatus.IN_PROGRESS,
    );
    // Optional quiz never needed.
    expect(
      quizStepStatus(quizzes, [att('m1', PASSED), att('f1', PASSED)]),
    ).toBe(LearningProgressStatus.COMPLETED);
  });

  it('no required quiz means the quiz step is complete', () => {
    expect(quizStepStatus([moduleQuiz('m1', 's1', false)], [])).toBe(
      LearningProgressStatus.COMPLETED,
    );
    expect(quizStepStatus([], [])).toBe(LearningProgressStatus.COMPLETED);
  });

  it('fails only when a required quiz has used every try without a pass', () => {
    const q = moduleQuiz('m1', 's1', true, 2);
    expect(quizOutOfTries(q, [att('m1', FAILED)])).toBe(false);
    expect(quizStepStatus([q], [att('m1', FAILED)])).toBe(
      LearningProgressStatus.IN_PROGRESS,
    );
    expect(quizOutOfTries(q, [att('m1', FAILED), att('m1', FAILED)])).toBe(
      true,
    );
    expect(quizStepStatus([q], [att('m1', FAILED), att('m1', FAILED)])).toBe(
      LearningProgressStatus.FAILED,
    );
    // In-progress attempt is not a used try; a pass after a fail is fine.
    expect(quizOutOfTries(q, [att('m1', FAILED), att('m1', IN_PROGRESS)])).toBe(
      false,
    );
    expect(quizOutOfTries(q, [att('m1', FAILED), att('m1', PASSED)])).toBe(
      false,
    );
    // Optional quiz out of tries does not fail the course.
    const optional = moduleQuiz('m2', 's1', false, 1);
    expect(quizStepStatus([optional], [att('m2', FAILED)])).toBe(
      LearningProgressStatus.COMPLETED,
    );
    // No limit = never out of tries.
    expect(
      quizOutOfTries(moduleQuiz('m3', 's1', true, null), [
        att('m3', FAILED),
        att('m3', FAILED),
      ]),
    ).toBe(false);
  });

  it('module quiz opens when that module lessons are done', () => {
    const quizzes = [moduleQuiz('m1', 's1'), finalQuiz('f1')];
    const requiredLessons = [
      { id: 'l1', sectionId: 's1' },
      { id: 'l2', sectionId: 's1' },
      { id: 'l3', sectionId: 's2' },
    ];
    const base = {
      requiredLessons,
      quizzes,
      attempts: [] as AttemptForProgress[],
    };
    expect(
      quizLockReason(quizzes[0], {
        ...base,
        completedLessonIds: new Set(['l1']),
      }),
    ).toMatch(/1 left/);
    expect(
      quizLockReason(quizzes[0], {
        ...base,
        completedLessonIds: new Set(['l1', 'l2']),
      }),
    ).toBeNull();
  });

  it('final assessment opens after all required lessons and required module quizzes', () => {
    const quizzes = [
      moduleQuiz('m1', 's1'),
      moduleQuiz('m2', 's1', false),
      finalQuiz('f1'),
    ];
    const requiredLessons = [{ id: 'l1', sectionId: 's1' }];
    const done = new Set(['l1']);
    const final = quizzes[2];
    expect(
      quizLockReason(final, {
        requiredLessons,
        completedLessonIds: new Set(),
        quizzes,
        attempts: [],
      }),
    ).toMatch(/1 lesson and 1 module quiz left/);
    expect(
      quizLockReason(final, {
        requiredLessons,
        completedLessonIds: done,
        quizzes,
        attempts: [],
      }),
    ).toMatch(/1 module quiz left/);
    // Optional module quiz m2 not needed.
    expect(
      quizLockReason(final, {
        requiredLessons,
        completedLessonIds: done,
        quizzes,
        attempts: [att('m1', PASSED)],
      }),
    ).toBeNull();
  });
});
