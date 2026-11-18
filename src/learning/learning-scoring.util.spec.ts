import { LearningQuestionType } from '@prisma/client';
import { calculateAttemptScore, gradeAnswer } from './learning-scoring.util';
import { gradeAttempt } from './learning-scoring.util';

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

describe('gradeAttempt (whole quiz)', () => {
  const single = (id: string, correct: string) => ({
    id,
    questionType: LearningQuestionType.SINGLE_CHOICE,
    points: 1,
    options: [
      { id: `${id}-a`, isCorrect: correct === 'a' },
      { id: `${id}-b`, isCorrect: correct === 'b' },
    ],
  });
  const quiz = [
    single('q1', 'a'),
    single('q2', 'b'),
    single('q3', 'a'),
    single('q4', 'b'),
  ];

  it('does not give 100% when only one question is answered', () => {
    const r = gradeAttempt(
      quiz,
      [{ questionId: 'q1', selectedOptionIds: ['q1-a'] }],
      80,
    );
    expect(r.percentage).toBe(25);
    expect(r.passed).toBe(false);
  });

  it('counts a question answered twice only once', () => {
    const r = gradeAttempt(
      quiz,
      [
        { questionId: 'q1', selectedOptionIds: ['q1-a'] },
        { questionId: 'q1', selectedOptionIds: ['q1-a'] },
      ],
      80,
    );
    expect(r.score).toBe(1);
    expect(r.percentage).toBe(25);
  });

  it('ignores answers to questions that are not in the quiz', () => {
    const r = gradeAttempt(
      quiz,
      [{ questionId: 'other', selectedOptionIds: ['x'] }],
      80,
    );
    expect(r.score).toBe(0);
    expect(r.graded).toHaveLength(4);
  });

  it('marks False as the correct answer when the author chose False', () => {
    const tf = [
      {
        id: 't1',
        questionType: LearningQuestionType.TRUE_FALSE,
        points: 1,
        options: [
          { id: 'true', isCorrect: false },
          { id: 'false', isCorrect: true },
        ],
      },
    ];
    expect(
      gradeAttempt(
        tf,
        [{ questionId: 't1', selectedOptionIds: ['false'] }],
        100,
      ).passed,
    ).toBe(true);
    expect(
      gradeAttempt(tf, [{ questionId: 't1', selectedOptionIds: ['true'] }], 100)
        .passed,
    ).toBe(false);
  });

  it('passes when all answers are right', () => {
    const r = gradeAttempt(
      quiz,
      quiz.map((q) => ({
        questionId: q.id,
        selectedOptionIds: [q.options.find((o) => o.isCorrect)!.id],
      })),
      80,
    );
    expect(r.percentage).toBe(100);
    expect(r.passed).toBe(true);
  });
});
