import {
  LearningContentType,
  LearningCourseType,
  LearningDeliveryMethod,
  LearningQuestionType,
} from '@prisma/client';
import {
  checkPublishable,
  type PublishCheckInput,
} from './learning-publish-check.util';

const lesson = (
  over: Partial<PublishCheckInput['sections'][number]['lessons'][number]> = {},
) => ({
  title: 'Intro',
  contentType: LearningContentType.TEXT,
  contentBody: '<p>Hello</p>',
  videoUrl: null,
  externalUrl: null,
  file: null,
  isRequired: true,
  ...over,
});

const quiz = (questions = 1, sectionId: string | null = null) => ({
  title: 'Quiz',
  sectionId,
  questions: Array.from({ length: questions }, () => ({
    questionType: LearningQuestionType.SINGLE_CHOICE,
    questionText: 'Q?',
    options: [
      { optionText: 'A', isCorrect: true },
      { optionText: 'B', isCorrect: false },
    ],
  })),
});

function base(over: Partial<PublishCheckInput> = {}): PublishCheckInput {
  return {
    course: {
      title: 'Fire safety',
      categoryId: 'cat',
      categoryActive: true,
      courseType: LearningCourseType.COURSE,
      deliveryMethod: LearningDeliveryMethod.ONLINE,
      status: 'DRAFT',
      estimatedDurationMinutes: 30,
    },
    version: {
      versionNumber: 1,
      requiresAssessment: false,
      requiresPracticalAssessment: false,
      certificateEnabled: true,
      refresherFrequencyDays: null,
      learningObjectives: 'Know the fire plan',
    },
    competency: null,
    hasCompetencyLink: false,
    sections: [{ title: 'S1', lessons: [lesson()] }],
    quizzes: [],
    ...over,
  };
}

const codes = (r: ReturnType<typeof checkPublishable>['blockers']) =>
  r.map((i) => i.code);

describe('checkPublishable', () => {
  it('passes a valid training course', () => {
    const r = checkPublishable(base());
    expect(r.canPublish).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('blocks an empty training course and a lesson with no content', () => {
    expect(codes(checkPublishable(base({ sections: [] })).blockers)).toContain(
      'no_lessons',
    );
    const r = checkPublishable(
      base({
        sections: [
          { title: 'S', lessons: [lesson({ contentBody: '<p> </p>' })] },
        ],
      }),
    );
    expect(codes(r.blockers)).toContain('lesson_invalid');
    const pdf = checkPublishable(
      base({
        sections: [
          {
            title: 'S',
            lessons: [
              lesson({ contentType: LearningContentType.PDF, file: null }),
            ],
          },
        ],
      }),
    );
    expect(codes(pdf.blockers)).toContain('lesson_invalid');
  });

  it('assessment-only course needs a final assessment but no lessons', () => {
    const course = {
      ...base().course,
      courseType: LearningCourseType.ASSESSMENT,
    };
    expect(
      codes(checkPublishable(base({ course, sections: [] })).blockers),
    ).toEqual(['no_final']);
    expect(
      checkPublishable(base({ course, sections: [], quizzes: [quiz()] }))
        .canPublish,
    ).toBe(true);
  });

  it('blocks an empty quiz, an invalid question and an empty module', () => {
    expect(
      codes(checkPublishable(base({ quizzes: [quiz(0)] })).blockers),
    ).toContain('quiz_empty');
    const bad = quiz(1, 's1');
    bad.questions[0].options[1].isCorrect = true;
    const badResult = checkPublishable(base({ quizzes: [bad] }));
    expect(codes(badResult.blockers)).toContain('question_invalid');
    // A module quiz problem points at the outline, a final one at its own tab.
    expect(
      badResult.blockers.find((b) => b.code === 'question_invalid')?.step,
    ).toBe('Course outline');
    expect(
      checkPublishable(base({ quizzes: [quiz(0)] })).blockers[0]?.step,
    ).toBe('Final assessment');
    const sections = [...base().sections, { title: 'Empty', lessons: [] }];
    expect(codes(checkPublishable(base({ sections })).blockers)).toContain(
      'empty_module',
    );
  });

  it('practical course needs an active competency with a checklist', () => {
    const course = {
      ...base().course,
      courseType: LearningCourseType.PRACTICAL_COMPETENCY,
      deliveryMethod: LearningDeliveryMethod.WORKPLACE,
    };
    expect(codes(checkPublishable(base({ course })).blockers)).toContain(
      'no_competency',
    );
    const inactive = checkPublishable(
      base({
        course,
        hasCompetencyLink: true,
        competency: { active: false, criteriaCount: 0 },
      }),
    );
    expect(codes(inactive.blockers)).toEqual(
      expect.arrayContaining(['competency_inactive', 'competency_checklist']),
    );
    expect(
      checkPublishable(
        base({
          course,
          hasCompetencyLink: true,
          competency: { active: true, criteriaCount: 3 },
        }),
      ).canPublish,
    ).toBe(true);
  });

  it('an online course can be quiz only; a course with nothing to do is blocked (17 Nov 2026)', () => {
    expect(
      codes(checkPublishable(base({ sections: [], quizzes: [quiz()] })).blockers),
    ).not.toContain('no_lessons');
    expect(
      codes(checkPublishable(base({ sections: [], quizzes: [] })).blockers),
    ).toContain('no_lessons');
  });

  it('blocks a wrong type/delivery pair, a refresher without certificate, and v2 without a change summary', () => {
    // Training + Virtual is retired (17 Nov 2026).
    const course = {
      ...base().course,
      deliveryMethod: LearningDeliveryMethod.VIRTUAL,
    };
    expect(codes(checkPublishable(base({ course })).blockers)).toContain(
      'type_delivery',
    );
    const version = {
      ...base().version,
      certificateEnabled: false,
      refresherFrequencyDays: 365,
    };
    expect(codes(checkPublishable(base({ version })).blockers)).toContain(
      'refresher_no_certificate',
    );
    const v2 = { ...base().version, versionNumber: 2 };
    expect(
      codes(
        checkPublishable(base({ version: v2, changeSummary: ' ' })).blockers,
      ),
    ).toContain('change_summary');
    expect(checkPublishable(base({ version: v2 })).canPublish).toBe(true);
  });

  it('warns but does not block for a missing certificate and the practical sign-off gap', () => {
    const version = {
      ...base().version,
      certificateEnabled: false,
      requiresPracticalAssessment: true,
    };
    const r = checkPublishable(
      base({
        version,
        quizzes: [quiz()],
        hasCompetencyLink: true,
        competency: { active: true, criteriaCount: 2 },
      }),
    );
    expect(r.canPublish).toBe(true);
    // The sign-off screen exists now (17 Nov 2026): no practical_signoff warning.
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['no_certificate']));
    expect(r.warnings.map((w) => w.code)).not.toContain('practical_signoff');
  });
});
