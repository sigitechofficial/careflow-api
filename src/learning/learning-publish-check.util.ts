import {
  LearningContentType,
  LearningCourseType,
  type LearningDeliveryMethod,
  type LearningQuestionType,
} from '@prisma/client';
import {
  courseTypeDeliveryError,
  isCreatableCourseType,
} from './learning-course-rules.util';
import {
  fileFitsContentType,
  isHttpsUrl,
  isHttpUrl,
} from './learning-file.util';
import { questionError } from './learning-quiz-rules.util';

/** Builder step an issue belongs to, so the admin can jump there. */
/** Builder tabs (course outline redesign, 13 Nov 2026). */
export type PublishStep =
  | 'Details'
  | 'Course outline'
  | 'Final assessment'
  | 'Finish and certificate'
  | 'Review and publish';
export type PublishIssue = { code: string; message: string; step: PublishStep };
export type PublishCheckResult = {
  canPublish: boolean;
  blockers: PublishIssue[];
  warnings: PublishIssue[];
};

export type PublishCheckInput = {
  course: {
    title: string | null;
    categoryId: string | null;
    categoryActive: boolean;
    courseType: LearningCourseType | null;
    deliveryMethod: LearningDeliveryMethod | null;
    status: string;
    estimatedDurationMinutes: number | null;
  };
  version: {
    versionNumber: number;
    requiresAssessment: boolean;
    requiresPracticalAssessment: boolean;
    certificateEnabled: boolean;
    refresherFrequencyDays: number | null;
    learningObjectives: string | null;
  };
  /** Linked competency, or null when none is linked. */
  competency: { active: boolean; criteriaCount: number } | null;
  hasCompetencyLink: boolean;
  sections: Array<{
    title: string;
    lessons: Array<{
      title: string;
      contentType: LearningContentType;
      contentBody: string | null;
      videoUrl: string | null;
      externalUrl: string | null;
      file: { mimeType: string; deleted: boolean } | null;
      isRequired: boolean;
    }>;
  }>;
  quizzes: Array<{
    title: string;
    /** Module the quiz belongs to; null = final assessment. */
    sectionId: string | null;
    questions: Array<{
      questionType: LearningQuestionType;
      questionText: string;
      options: Array<{ optionText: string; isCorrect: boolean }>;
    }>;
  }>;
  /** Change summary typed for this publish (required from version 2). */
  changeSummary?: string | null;
};

const SUPPORTED_LESSON_TYPES: LearningContentType[] = [
  LearningContentType.TEXT,
  LearningContentType.IMAGE,
  LearningContentType.PDF,
  LearningContentType.DOCUMENT,
  LearningContentType.VIDEO,
  LearningContentType.EXTERNAL_LINK,
];

function lessonProblem(
  lesson: PublishCheckInput['sections'][number]['lessons'][number],
): string | null {
  switch (lesson.contentType) {
    case LearningContentType.TEXT:
      return (lesson.contentBody ?? '').replace(/<[^>]*>/g, '').trim()
        ? null
        : 'has no text';
    case LearningContentType.VIDEO:
      return isHttpsUrl(lesson.videoUrl)
        ? null
        : 'has no valid https video link';
    case LearningContentType.EXTERNAL_LINK:
      return isHttpUrl(lesson.externalUrl) ? null : 'has no valid web link';
    case LearningContentType.IMAGE:
    case LearningContentType.PDF:
    case LearningContentType.DOCUMENT:
      if (!lesson.file || lesson.file.deleted) return 'has no file';
      return fileFitsContentType(lesson.file.mimeType, lesson.contentType)
        ? null
        : 'has a file of the wrong type';
    default:
      return null;
  }
}

/**
 * Checks a draft version before it is published (spec 11.1). Blockers stop the publish;
 * warnings are shown but do not stop it. Rules depend on the course type:
 * a training course needs lessons, an assessment-only course needs a final assessment,
 * a practical course needs a competency with a checklist.
 */
export function checkPublishable(input: PublishCheckInput): PublishCheckResult {
  const blockers: PublishIssue[] = [];
  const warnings: PublishIssue[] = [];
  const block = (code: string, message: string, step: PublishStep) =>
    blockers.push({ code, message, step });
  const warn = (code: string, message: string, step: PublishStep) =>
    warnings.push({ code, message, step });
  const { course, version } = input;

  // Basic information
  if (course.status === 'ARCHIVED')
    block('archived', 'The course is archived', 'Details');
  if (!course.title?.trim())
    block('title', 'The course has no title', 'Details');
  if (!course.categoryId) block('category', 'Choose a category', 'Details');
  else if (!course.categoryActive)
    warn('category_retired', 'The category is no longer active', 'Details');
  if (!course.courseType) block('type', 'Choose a course type', 'Details');
  if (!course.deliveryMethod)
    block('delivery', 'Choose how the course is delivered', 'Details');
  if (course.courseType && course.deliveryMethod) {
    if (isCreatableCourseType(course.courseType)) {
      const pairError = courseTypeDeliveryError(
        course.courseType,
        course.deliveryMethod,
      );
      if (pairError) block('type_delivery', pairError, 'Details');
    } else {
      warn('legacy_type', 'This course uses an old course type', 'Details');
    }
  }
  if (!course.estimatedDurationMinutes)
    warn('duration', 'No estimated time is set', 'Details');
  if (!version.learningObjectives?.trim())
    warn('objectives', 'No learning objectives are set', 'Details');

  // Course outline: modules and their lessons
  const lessons = input.sections.flatMap((s) => s.lessons);
  // A course needs something to do (17 Nov 2026): lessons, a quiz (an online quiz-only course)
  // or a practical test (a workplace sign-off).
  if (
    course.courseType === LearningCourseType.COURSE &&
    lessons.length === 0 &&
    input.quizzes.length === 0 &&
    !version.requiresPracticalAssessment
  ) {
    block(
      'no_lessons',
      'Add at least one lesson, a quiz or a practical test',
      'Course outline',
    );
  }
  for (const section of input.sections) {
    // An empty module blocks publishing (agreed 13 Nov 2026).
    if (!section.lessons.length) {
      block(
        'empty_module',
        `Module "${section.title}" has no lessons`,
        'Course outline',
      );
    }
    for (const lesson of section.lessons) {
      if (!SUPPORTED_LESSON_TYPES.includes(lesson.contentType)) {
        warn(
          'lesson_type',
          `Lesson "${lesson.title}" uses an old lesson type`,
          'Course outline',
        );
        continue;
      }
      const problem = lessonProblem(lesson);
      if (problem)
        block(
          'lesson_invalid',
          `Lesson "${lesson.title}" ${problem}`,
          'Course outline',
        );
    }
  }

  // Quizzes: module quizzes live in the outline, final assessments in their own tab
  const finals = input.quizzes.filter((q) => q.sectionId === null);
  if (
    course.courseType === LearningCourseType.ASSESSMENT &&
    finals.length === 0
  ) {
    block(
      'no_final',
      'An assessment-only course needs a final assessment',
      'Final assessment',
    );
  }
  for (const quiz of input.quizzes) {
    const step: PublishStep = quiz.sectionId
      ? 'Course outline'
      : 'Final assessment';
    const label = quiz.sectionId
      ? `Quiz "${quiz.title}"`
      : `Final assessment "${quiz.title}"`;
    if (!quiz.questions.length) {
      block('quiz_empty', `${label} has no questions`, step);
      continue;
    }
    quiz.questions.forEach((q, i) => {
      const error = questionError(q.questionType, q.questionText, q.options);
      if (error)
        block(
          'question_invalid',
          `${label}, question ${i + 1}: ${error}`,
          step,
        );
    });
  }

  // Practical competency (Finish and certificate tab)
  const isPractical =
    course.courseType === LearningCourseType.PRACTICAL_COMPETENCY;
  if (
    (isPractical || version.requiresPracticalAssessment) &&
    !input.hasCompetencyLink
  ) {
    block(
      'no_competency',
      'Link a practical competency',
      'Finish and certificate',
    );
  }
  if (input.hasCompetencyLink) {
    if (!input.competency) {
      block(
        'competency_missing',
        'The linked competency was deleted',
        'Finish and certificate',
      );
    } else {
      if (!input.competency.active) {
        block(
          'competency_inactive',
          'The linked competency is inactive',
          'Finish and certificate',
        );
      }
      if (input.competency.criteriaCount === 0) {
        block(
          'competency_checklist',
          'The linked competency has no checklist',
          'Finish and certificate',
        );
      }
    }
  }

  // Finish and certificate
  if (isPractical && !version.requiresPracticalAssessment) {
    warn(
      'practical_not_required',
      'The practical assessment is not required to finish',
      'Finish and certificate',
    );
  }
  if (version.refresherFrequencyDays && !version.certificateEnabled) {
    block(
      'refresher_no_certificate',
      'A refresher needs a certificate',
      'Finish and certificate',
    );
  }
  if (!version.certificateEnabled) {
    warn(
      'no_certificate',
      'No certificate will be issued',
      'Finish and certificate',
    );
  }

  // Review
  if (
    version.versionNumber > 1 &&
    input.changeSummary !== undefined &&
    !input.changeSummary?.trim()
  ) {
    block(
      'change_summary',
      'Write what changed in this version',
      'Review and publish',
    );
  }

  return { canPublish: blockers.length === 0, blockers, warnings };
}
