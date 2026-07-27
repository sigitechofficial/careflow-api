import { LearningQuestionType } from '@prisma/client';
import { calculateAttemptScore, gradeAnswer } from './learning-scoring.util';

describe('learning-scoring.util', () => {
  it('grades single choice correctly', () => {
    const result = gradeAnswer(
      LearningQuestionType.SINGLE_CHOICE,
      ['a'],
      [
        { id: 'a', isCorrect: true },
        { id: 'b', isCorrect: false },
      ],
      2,
    );
    expect(result).toEqual({ isCorrect: true, pointsAwarded: 2, maxPoints: 2 });
  });

  it('grades multiple choice by exact set match', () => {
    const result = gradeAnswer(
      LearningQuestionType.MULTIPLE_CHOICE,
      ['a', 'c'],
      [
        { id: 'a', isCorrect: true },
        { id: 'b', isCorrect: false },
        { id: 'c', isCorrect: true },
      ],
      3,
    );
    expect(result.isCorrect).toBe(true);
    expect(result.pointsAwarded).toBe(3);
  });

  it('grades true/false', () => {
    const result = gradeAnswer(
      LearningQuestionType.TRUE_FALSE,
      ['true'],
      [{ id: 'true', isCorrect: true }],
      1,
    );
    expect(result.isCorrect).toBe(true);
  });

  it('returns null for free-text questions', () => {
    const result = gradeAnswer(LearningQuestionType.SHORT_TEXT, [], [], 1);
    expect(result.isCorrect).toBeNull();
    expect(result.pointsAwarded).toBe(0);
  });

  it('calculates attempt pass/fail from percentage', () => {
    const summary = calculateAttemptScore(
      [
        { isCorrect: true, pointsAwarded: 8, maxPoints: 10 },
        { isCorrect: false, pointsAwarded: 0, maxPoints: 10 },
      ],
      80,
    );
    expect(summary.percentage).toBe(40);
    expect(summary.passed).toBe(false);
  });
});
