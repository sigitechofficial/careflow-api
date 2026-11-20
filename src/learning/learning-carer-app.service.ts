import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { LearningNotificationHook } from './learning-notification.hook';
import {
  LearningAssessmentResult,
  LearningAssignmentStatus,
  LearningTrainingEventStatus,
  Prisma,
} from '@prisma/client';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import {
  courseNeedsManagerOutcome,
  courseNeedsSession,
  trainerMarksLessons,
} from './learning-completion.util';
import { signedLearningFileUrl } from './learning-file.util';
import {
  CARER_LATE_REASON_CODES,
  CARER_LATE_REASONS,
  LOCK_OVERDUE_COURSES,
  LOCKED_MESSAGE,
  OVERDUE_MESSAGE,
} from './learning-review.catalog';
import { LearningMeService } from './learning-me.service';
import { LearningCompletionService } from './learning-completion.service';
import {
  quizIsRequired,
  quizLockReason,
  quizOutOfTries,
  quizPassed,
} from './learning-quiz-progress.util';

/** "To do" in the app: the carer can still work on these. */
const OPEN_STATUSES = new Set<LearningAssignmentStatus>([
  LearningAssignmentStatus.ASSIGNED,
  LearningAssignmentStatus.NOT_STARTED,
  LearningAssignmentStatus.IN_PROGRESS,
  LearningAssignmentStatus.AWAITING_ASSESSMENT,
  LearningAssignmentStatus.AWAITING_APPROVAL,
  LearningAssignmentStatus.OVERDUE,
]);
const DONE_STATUSES = new Set<LearningAssignmentStatus>([
  LearningAssignmentStatus.COMPLETED,
  LearningAssignmentStatus.PASSED,
]);
/** Never shown to the carer. */
const HIDDEN_STATUSES: LearningAssignmentStatus[] = [
  LearningAssignmentStatus.CANCELLED,
  LearningAssignmentStatus.EXEMPT,
];
/** Sessions the office has not finished setting up are not shown. */
const VISIBLE_EVENT_STATUSES: LearningTrainingEventStatus[] = [
  LearningTrainingEventStatus.SCHEDULED,
  LearningTrainingEventStatus.IN_PROGRESS,
  LearningTrainingEventStatus.COMPLETED,
  LearningTrainingEventStatus.CANCELLED,
];

const sessionInclude = {
  trainingEvent: true,
} satisfies Prisma.LearningTrainingEventAttendeeInclude;
type SessionRow = Prisma.LearningTrainingEventAttendeeGetPayload<{
  include: typeof sessionInclude;
}>;

type AttemptRow = {
  assessmentId: string;
  result: LearningAssessmentResult;
  percentage: Prisma.Decimal | number | null;
  submittedAt: Date | null;
};

/**
 * Carer app → Learn. Read models shaped for the phone, over the same rules the staff
 * learner API uses (LearningMeService). Only the signed-in carer's own records.
 * Contract: docs/LEARNING_CARER_APP_API.md.
 */
@Injectable()
export class LearningCarerAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly me: LearningMeService,
    private readonly completion: LearningCompletionService,
    @Optional() private readonly notifications?: LearningNotificationHook,
  ) {}

  private asUser(employeeId: string): RequestUser {
    return { employeeId } as RequestUser;
  }

  // ─── List ────────────────────────────────────────────────────────────────

  async list(employeeId: string) {
    const rows = await this.prisma.learningAssignment.findMany({
      where: { employeeId, status: { notIn: HIDDEN_STATUSES } },
      include: this.summaryInclude(employeeId),
    });
    const [certificates] = await Promise.all([
      this.prisma.learningCertificate.count({
        where: { employeeId, status: 'ACTIVE' },
      }),
    ]);
    const now = Date.now();
    const summaries = rows.map((r) => this.summary(r, now));
    summaries.sort((a, b) => this.compare(a, b));
    return {
      lateReasons: CARER_LATE_REASONS.map(({ code, label }) => ({ code, label })),
      counts: {
        toDo: summaries.filter((s) => s.isOpen).length,
        overdue: summaries.filter((s) => s.status === 'OVERDUE').length,
        done: summaries.filter((s) => !s.isOpen).length,
        certificates,
      },
      assignments: summaries,
    };
  }

  private summaryInclude(employeeId: string) {
    return {
      course: { include: { category: { select: { name: true } } } },
      progress: true,
      courseVersion: {
        select: {
          estimatedDurationMinutes: true,
          sections: {
            select: {
              contentItems: { select: { id: true, isRequired: true } },
            },
          },
          _count: { select: { assessments: true } },
          assessments: {
            select: { id: true, sectionId: true, isRequired: true, maximumAttempts: true },
          },
        },
      },
      // Finished attempts only: passed, or failed (20 Nov 2026, "to take" vs "to retry").
      assessmentAttempts: {
        where: {
          result: {
            in: [LearningAssessmentResult.PASSED, LearningAssessmentResult.FAILED],
          },
        },
        select: { assessmentId: true, result: true },
      },
      reviews: {
        where: {
          kind: {
            in: ['CARER_LATE_REASON', 'OUTCOME_PASSED', 'OUTCOME_PASSED_AFTER_QUIZ', 'OUTCOME_NOT_PASSED'],
          },
        },
        select: { kind: true, reasonCode: true, note: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
      contentCompletions: {
        where: { completedAt: { not: null } },
        select: { contentItemId: true },
      },
      sessionAttendees: {
        where: {
          employeeId,
          trainingEvent: { status: { in: VISIBLE_EVENT_STATUSES } },
        },
        include: sessionInclude,
      },
    } satisfies Prisma.LearningAssignmentInclude;
  }

  private summary(
    r: Prisma.LearningAssignmentGetPayload<{
      include: ReturnType<LearningCarerAppService['summaryInclude']>;
    }>,
    now: number,
  ) {
    const lessons = (r.courseVersion?.sections ?? []).flatMap(
      (s) => s.contentItems,
    );
    const done = new Set(r.contentCompletions.map((c) => c.contentItemId));
    const passedQuizIds = new Set(
      r.assessmentAttempts
        .filter((t) => t.result === LearningAssessmentResult.PASSED)
        .map((t) => t.assessmentId),
    );
    const triedQuizIds = new Set(r.assessmentAttempts.map((t) => t.assessmentId));
    const quizzesLeft = (r.courseVersion?.assessments ?? []).filter(
      (q) => quizIsRequired(q) && !passedQuizIds.has(q.id),
    );
    const sessions = r.sessionAttendees.map((a) => this.session(a, now));
    const lateReview = r.reviews.find((x) => x.kind === 'CARER_LATE_REASON');
    const outcomeReview = r.reviews.find(
      (x) =>
        x.kind === 'OUTCOME_PASSED' ||
        x.kind === 'OUTCOME_PASSED_AFTER_QUIZ' ||
        x.kind === 'OUTCOME_NOT_PASSED',
    );
    const upcoming = sessions
      .filter(
        (s) =>
          s.eventStatus !== 'CANCELLED' && new Date(s.endAt).getTime() >= now,
      )
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    // No upcoming session: show the latest booked one that has passed (waiting for attendance).
    const lastBooked = sessions
      .filter(
        (s) =>
          s.eventStatus !== 'CANCELLED' &&
          s.bookingStatus !== 'CANCELLED' &&
          new Date(s.endAt).getTime() < now,
      )
      .sort((a, b) => b.startAt.localeCompare(a.startAt))[0];
    return {
      id: r.id,
      courseId: r.courseId,
      title: r.course.title,
      code: r.course.code,
      categoryName: r.course.category?.name ?? null,
      description: r.course.description ?? r.course.shortDescription ?? null,
      courseType: r.course.courseType,
      deliveryMethod: r.course.deliveryMethod,
      status: r.status,
      isOpen: OPEN_STATUSES.has(r.status),
      // Overdue = locked until the office extends the due date (16 Nov 2026).
      locked: LOCK_OVERDUE_COURSES && r.status === LearningAssignmentStatus.OVERDUE,
      lockedMessage:
        LOCK_OVERDUE_COURSES && r.status === LearningAssignmentStatus.OVERDUE
          ? LOCKED_MESSAGE
          : null,
      // Lock is off for now: overdue only warns (16 Nov 2026).
      overdueMessage:
        r.status === LearningAssignmentStatus.OVERDUE ? OVERDUE_MESSAGE : null,
      // Overdue: the carer must say why before carrying on (16 Nov 2026).
      lateReasonRequired:
        r.status === LearningAssignmentStatus.OVERDUE && !lateReview,
      lateReason: lateReview
        ? {
            code: lateReview.reasonCode,
            label:
              CARER_LATE_REASONS.find((x) => x.code === lateReview.reasonCode)?.label ??
              lateReview.reasonCode,
            note: lateReview.note,
            givenAt: lateReview.createdAt.toISOString(),
          }
        : null,
      // Face to face / workplace: the manager decides Passed / Not passed (16 Nov 2026).
      needsManagerOutcome: courseNeedsManagerOutcome(r.course.deliveryMethod),
      // Face to face: lessons are marked by the trainer; the carer only views them.
      lessonsMarkedByTrainer: trainerMarksLessons(r.course.deliveryMethod),
      outcome: outcomeReview
        ? {
            result:
              outcomeReview.kind === 'OUTCOME_PASSED'
                ? 'PASSED'
                : outcomeReview.kind === 'OUTCOME_PASSED_AFTER_QUIZ'
                  ? 'PASSED_AFTER_QUIZ'
                  : 'NOT_PASSED',
            note: outcomeReview.note,
            decidedAt: outcomeReview.createdAt.toISOString(),
          }
        : null,
      completedLate: r.completedLate,
      startedAt: r.progress?.startedAt?.toISOString() ?? null,
      isMandatory: r.isMandatory,
      dueAt: r.dueAt?.toISOString() ?? null,
      assignedAt: r.assignedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      progressPercentage: DONE_STATUSES.has(r.status)
        ? 100
        : Math.round(Number(r.progress?.progressPercentage ?? 0)),
      estimatedDurationMinutes:
        r.courseVersion?.estimatedDurationMinutes ??
        r.course.estimatedDurationMinutes ??
        null,
      lessonCount: lessons.length,
      lessonsDone: lessons.filter((l) => done.has(l.id)).length,
      quizCount: r.courseVersion?._count.assessments ?? 0,
      // Required quizzes / final assessments not passed yet.
      requiredQuizzesLeft: quizzesLeft.length,
      // Split for the carer (20 Nov 2026): not tried yet vs tried and failed.
      quizzesToTake: quizzesLeft.filter((q) => !triedQuizIds.has(q.id)).length,
      quizzesToRetry: quizzesLeft.filter(
        (q) => triedQuizIds.has(q.id) && !quizOutOfTries(q, r.assessmentAttempts),
      ).length,
      quizzesOutOfTries: quizzesLeft.filter((q) => quizOutOfTries(q, r.assessmentAttempts)).length,
      needsSession: courseNeedsSession(
        r.course.courseType,
        r.course.deliveryMethod,
      ),
      nextSession: upcoming[0] ?? lastBooked ?? null,
    };
  }

  /** Open first (overdue, then soonest due, no due date last); then done, latest first. */
  private compare(
    a: ReturnType<LearningCarerAppService['summary']>,
    b: ReturnType<LearningCarerAppService['summary']>,
  ): number {
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    if (a.isOpen) {
      const ao = a.status === 'OVERDUE' ? 0 : 1;
      const bo = b.status === 'OVERDUE' ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt || b.dueAt) return a.dueAt ? -1 : 1;
      return b.assignedAt.localeCompare(a.assignedAt);
    }
    return (b.completedAt ?? b.assignedAt).localeCompare(
      a.completedAt ?? a.assignedAt,
    );
  }

  private session(a: SessionRow, now: number) {
    const e = a.trainingEvent;
    const cancelledByMe =
      a.bookingStatus === 'CANCELLED' || a.cantAttendAt !== null;
    return {
      attendeeId: a.id,
      eventId: e.id,
      title: e.title,
      deliveryMethod: e.deliveryMethod,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt.toISOString(),
      location: e.location ?? null,
      meetingUrl: e.virtualMeetingUrl ?? null,
      trainerName: e.trainerName ?? null,
      eventStatus: e.status,
      bookingStatus: a.bookingStatus,
      attendanceStatus: a.attendanceStatus,
      cantAttendReason: a.cantAttendReason ?? null,
      canSayCantAttend:
        e.status === LearningTrainingEventStatus.SCHEDULED &&
        e.startAt.getTime() > now &&
        !cancelledByMe &&
        a.attendanceStatus !== 'ATTENDED',
    };
  }

  // ─── Detail ──────────────────────────────────────────────────────────────

  async detail(employeeId: string, assignmentId: string) {
    const row = await this.prisma.learningAssignment.findFirst({
      where: {
        id: assignmentId,
        employeeId,
        status: { notIn: HIDDEN_STATUSES },
      },
      include: this.summaryInclude(employeeId),
    });
    if (!row) throw new NotFoundException('Training not found');
    const now = Date.now();
    const base = this.summary(row, now);

    const versionId =
      row.courseVersionId ?? row.progress?.courseVersionId ?? null;
    const version = versionId
      ? await this.prisma.learningCourseVersion.findUnique({
          where: { id: versionId },
          include: {
            sections: {
              orderBy: { displayOrder: 'asc' },
              include: {
                contentItems: {
                  orderBy: { displayOrder: 'asc' },
                  include: { file: true },
                },
              },
            },
            assessments: {
              orderBy: { displayOrder: 'asc' },
              include: { _count: { select: { questions: true } } },
            },
          },
        })
      : null;

    const [attempts, certificate, progressSteps] = await Promise.all([
      this.prisma.learningAssessmentAttempt.findMany({
        where: { assignmentId },
        select: {
          assessmentId: true,
          result: true,
          percentage: true,
          submittedAt: true,
        },
      }),
      this.prisma.learningCertificate.findFirst({
        where: { assignmentId, employeeId },
        orderBy: { issuedAt: 'desc' },
      }),
      // Same steps as the % (20 Nov 2026): the app moves the bar for lessons not sent yet.
      this.completion.progressSteps(assignmentId),
    ]);

    const completedLessonIds = new Set(
      row.contentCompletions.map((c) => c.contentItemId),
    );
    const sections = version?.sections ?? [];
    const lockInput = {
      requiredLessons: sections.flatMap((s) =>
        s.isRequired
          ? s.contentItems
              .filter((l) => l.isRequired)
              .map((l) => ({ id: l.id, sectionId: s.id }))
          : [],
      ),
      completedLessonIds,
      quizzes: (version?.assessments ?? []).map((a) => ({
        id: a.id,
        sectionId: a.sectionId,
        isRequired: a.isRequired,
        maximumAttempts: a.maximumAttempts,
      })),
      attempts: attempts.map((a) => ({
        assessmentId: a.assessmentId,
        result: a.result,
      })),
    };
    const byTrainer = trainerMarksLessons(row.course.deliveryMethod);
    const quizzes = (version?.assessments ?? []).map((a) => {
      const q = this.quiz(a, attempts, lockInput, now);
      // Face to face: lessons are marked by the trainer, so say who unlocks the quiz.
      return byTrainer && q.lockedReason
        ? { ...q, lockedReason: 'Opens when your trainer marks all lessons done' }
        : q;
    });

    return {
      ...base,
      objectives: version?.learningObjectives ?? null,
      passingScore: version?.passingScore ?? row.course.passingScore ?? null,
      certificateEnabled:
        version?.certificateEnabled ?? row.course.certificateEnabled,
      progressSteps,
      modules: sections.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description ?? null,
        lessons: s.contentItems.map((l) => ({
          id: l.id,
          title: l.title,
          description: l.description ?? null,
          contentType: l.contentType,
          contentBody: l.contentBody ?? null,
          videoUrl: l.videoUrl ?? null,
          externalUrl: l.externalUrl ?? null,
          // Signed, short-lived link: the file is not public.
          file:
            l.file && !l.file.deletedAt
              ? {
                  url: signedLearningFileUrl(l.file.id),
                  name: l.file.originalName,
                  mimeType: l.file.mimeType,
                  size: l.file.fileSize,
                }
              : null,
          estimatedDurationMinutes: l.estimatedDurationMinutes ?? null,
          isRequired: l.isRequired,
          // Counts towards progressSteps (required lesson in a required module).
          countsForProgress: s.isRequired && l.isRequired,
          completed: completedLessonIds.has(l.id),
        })),
        quizzes: quizzes.filter((q) => q.sectionId === s.id).map(stripSection),
      })),
      finalAssessments: quizzes
        .filter((q) => q.sectionId === null)
        .map(stripSection),
      sessions: row.sessionAttendees
        .map((a) => this.session(a, now))
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
      sessionAttended: row.sessionAttendees.some(
        (a) => a.attendanceStatus === 'ATTENDED',
      ),
      certificate: certificate
        ? {
            id: certificate.id,
            certificateNumber: certificate.certificateNumber,
            issuedAt: certificate.issuedAt.toISOString(),
            expiresAt: certificate.expiresAt?.toISOString() ?? null,
            status: certificate.status,
          }
        : null,
    };
  }

  private quiz(
    a: {
      id: string;
      title: string;
      instructions: string | null;
      sectionId: string | null;
      isRequired: boolean;
      passingScore: number;
      maximumAttempts: number | null;
      retakeDelayMinutes: number | null;
      _count: { questions: number };
    },
    attempts: AttemptRow[],
    lockInput: Parameters<typeof quizLockReason>[1],
    now: number,
  ) {
    const mine = attempts.filter((t) => t.assessmentId === a.id);
    const submitted = mine.filter((t) => t.submittedAt !== null);
    const forRules = mine.map((t) => ({
      assessmentId: t.assessmentId,
      result: t.result,
    }));
    const passed = quizPassed(forRules, a.id);
    const quizForRules = {
      id: a.id,
      sectionId: a.sectionId,
      isRequired: a.isRequired,
      maximumAttempts: a.maximumAttempts,
    };
    const outOfTries = quizOutOfTries(quizForRules, forRules);
    const percentages = submitted
      .map((t) => (t.percentage == null ? null : Number(t.percentage)))
      .filter((p): p is number => p !== null);
    const lastSubmitted = submitted
      .map((t) => t.submittedAt!.getTime())
      .sort((x, y) => y - x)[0];
    const retakeAt =
      !passed && !outOfTries && lastSubmitted && a.retakeDelayMinutes
        ? lastSubmitted + a.retakeDelayMinutes * 60_000
        : null;
    return {
      id: a.id,
      sectionId: a.sectionId,
      title: a.title,
      instructions: a.instructions ?? null,
      isFinal: a.sectionId === null,
      isRequired: quizIsRequired(a),
      passingScore: a.passingScore,
      maximumAttempts: a.maximumAttempts,
      attemptsUsed: submitted.length,
      attemptsLeft:
        a.maximumAttempts == null
          ? null
          : Math.max(0, a.maximumAttempts - submitted.length),
      bestPercentage: percentages.length ? Math.max(...percentages) : null,
      passed,
      outOfTries,
      lockedReason: quizLockReason(quizForRules, lockInput),
      questionCount: a._count.questions,
      retakeAvailableAt:
        retakeAt && retakeAt > now ? new Date(retakeAt).toISOString() : null,
      hasAttemptInProgress: mine.some(
        (t) => t.result === LearningAssessmentResult.IN_PROGRESS,
      ),
    };
  }

  // ─── Actions (same rules as the staff learner API) ───────────────────────

  /**
   * "Start course" tapped: records when the carer started (first time only) and shows the
   * course as In progress. Safe to retry (16 Nov 2026).
   */
  async start(employeeId: string, assignmentId: string) {
    const row = await this.prisma.learningAssignment.findFirst({
      where: { id: assignmentId, employeeId, status: { notIn: HIDDEN_STATUSES } },
      select: {
        id: true,
        status: true,
        progress: { select: { startedAt: true } },
      },
    });
    if (!row) throw new NotFoundException('Training not found');
    const now = new Date();
    if (row.progress) {
      await this.prisma.learningEmployeeProgress.update({
        where: { assignmentId },
        data: {
          startedAt: row.progress.startedAt ?? now,
          lastAccessedAt: now,
        },
      });
    }
    if (
      row.status === LearningAssignmentStatus.ASSIGNED ||
      row.status === LearningAssignmentStatus.NOT_STARTED
    ) {
      await this.prisma.learningAssignment.update({
        where: { id: assignmentId },
        data: { status: LearningAssignmentStatus.IN_PROGRESS },
      });
    }
    return this.statusOf(employeeId, assignmentId, {
      startedAt: (row.progress?.startedAt ?? now).toISOString(),
    });
  }

  async completeLesson(
    employeeId: string,
    assignmentId: string,
    lessonId: string,
    timeSpentSeconds?: number,
  ) {
    const own = await this.prisma.learningAssignment.findFirst({
      where: { id: assignmentId, employeeId },
      select: { course: { select: { deliveryMethod: true } } },
    });
    if (own && trainerMarksLessons(own.course.deliveryMethod)) {
      throw new BadRequestException('Your trainer marks these lessons as done.');
    }
    await this.me.completeContent(
      this.asUser(employeeId),
      assignmentId,
      lessonId,
      { timeSpentSeconds },
    );
    return this.statusOf(employeeId, assignmentId, { completed: true });
  }

  async getQuiz(employeeId: string, assignmentId: string, quizId: string) {
    const detail = await this.detail(employeeId, assignmentId);
    const summary = [
      ...detail.modules.flatMap((m) => m.quizzes),
      ...detail.finalAssessments,
    ].find((q) => q.id === quizId);
    if (!summary) throw new NotFoundException('Quiz not found');
    const questions = await this.prisma.learningAssessmentQuestion.findMany({
      where: { assessmentId: quizId },
      orderBy: { displayOrder: 'asc' },
      include: { options: { orderBy: { displayOrder: 'asc' } } },
    });
    return {
      id: summary.id,
      title: summary.title,
      instructions: summary.instructions,
      passingScore: summary.passingScore,
      maximumAttempts: summary.maximumAttempts,
      attemptsUsed: summary.attemptsUsed,
      attemptsLeft: summary.attemptsLeft,
      lockedReason: summary.lockedReason,
      // Never the correct answers.
      questions: questions.map((q) => ({
        id: q.id,
        questionType: q.questionType,
        questionText: q.questionText,
        points: q.points,
        options: q.options.map((o) => ({ id: o.id, optionText: o.optionText })),
      })),
    };
  }

  async startQuiz(employeeId: string, assignmentId: string, quizId: string) {
    const attempt = await this.me.startAssessmentAttempt(
      this.asUser(employeeId),
      assignmentId,
      quizId,
    );
    return { attemptId: attempt.id, attemptNumber: attempt.attemptNumber };
  }

  async submitQuiz(
    employeeId: string,
    assignmentId: string,
    quizId: string,
    body: {
      answers: {
        questionId: string;
        selectedOptionIds?: string[];
        textAnswer?: string;
      }[];
      timeSpentSeconds?: number;
    },
  ) {
    const result = await this.me.submitAssessmentAttempt(
      this.asUser(employeeId),
      assignmentId,
      quizId,
      body,
    );
    const quiz = await this.prisma.learningAssessment.findUnique({
      where: { id: quizId },
      select: { passingScore: true, maximumAttempts: true },
    });
    const used = await this.prisma.learningAssessmentAttempt.count({
      where: { assignmentId, assessmentId: quizId, submittedAt: { not: null } },
    });
    return this.statusOf(employeeId, assignmentId, {
      attemptId: result.attemptId,
      percentage: Number(result.percentage),
      passed: result.passed,
      passingScore: quiz?.passingScore ?? null,
      attemptsLeft:
        quiz?.maximumAttempts == null
          ? null
          : Math.max(0, quiz.maximumAttempts - used),
    });
  }

  private async statusOf<T extends object>(
    employeeId: string,
    assignmentId: string,
    extra: T,
  ) {
    const row = await this.prisma.learningAssignment.findFirst({
      where: { id: assignmentId, employeeId },
      select: {
        status: true,
        progress: { select: { progressPercentage: true } },
      },
    });
    return {
      ...extra,
      progressPercentage: row
        ? DONE_STATUSES.has(row.status)
          ? 100
          : Math.round(Number(row.progress?.progressPercentage ?? 0))
        : 0,
      status: row?.status ?? null,
    };
  }

  /** Carer says why an overdue course is late. Required before carrying on (16 Nov 2026). */
  async giveLateReason(
    employeeId: string,
    assignmentId: string,
    reasonCode: string,
    note?: string,
  ) {
    const a = await this.prisma.learningAssignment.findFirst({
      where: { id: assignmentId, employeeId },
      select: { id: true, status: true, dueAt: true, course: { select: { title: true } } },
    });
    if (!a) throw new NotFoundException('Training not found');
    if (a.status !== LearningAssignmentStatus.OVERDUE) {
      throw new BadRequestException('This course is not overdue');
    }
    if (!CARER_LATE_REASON_CODES.includes(reasonCode)) {
      throw new BadRequestException('Choose a reason');
    }
    const text = note?.trim() || null;
    if (reasonCode === 'OTHER' && (!text || text.length < 3)) {
      throw new BadRequestException('Write the reason (at least 3 characters)');
    }
    await this.prisma.learningAssignmentReview.create({
      data: {
        assignmentId,
        employeeId,
        kind: 'CARER_LATE_REASON',
        reasonCode,
        note: text,
        previousDueAt: a.dueAt,
      },
    });
    const label = CARER_LATE_REASONS.find((r) => r.code === reasonCode)?.label ?? reasonCode;
    await this.notifications
      ?.notifyCarerLateReason({
        assignmentId,
        employeeId,
        courseTitle: a.course.title,
        reason: text ? `${label}: ${text}` : label,
      })
      .catch(() => undefined);
    return this.statusOf(employeeId, assignmentId, { lateReasonGiven: true });
  }

  async certificates(employeeId: string) {
    const rows = await this.prisma.learningCertificate.findMany({
      where: { employeeId },
      include: { course: { select: { title: true } } },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((c) => ({
      id: c.id,
      courseTitle: c.course.title,
      certificateNumber: c.certificateNumber,
      issuedAt: c.issuedAt.toISOString(),
      expiresAt: c.expiresAt?.toISOString() ?? null,
      status: c.status,
    }));
  }

  /** Carer says they can't attend a session; the office moves them to another one. */
  async cantAttend(employeeId: string, attendeeId: string, reason: string) {
    const attendee = await this.prisma.learningTrainingEventAttendee.findFirst({
      where: { id: attendeeId, employeeId },
      include: sessionInclude,
    });
    if (!attendee) throw new NotFoundException('Session not found');
    const now = Date.now();
    if (!this.session(attendee, now).canSayCantAttend) {
      throw new BadRequestException(
        'You can no longer change your place on this session. Please call the office.',
      );
    }
    const updated = await this.prisma.learningTrainingEventAttendee.update({
      where: { id: attendee.id },
      data: {
        cantAttendReason: reason.trim(),
        cantAttendAt: new Date(),
        bookingStatus: 'CANCELLED',
      },
      include: sessionInclude,
    });
    return this.session(updated, now);
  }
}

function stripSection<T extends { sectionId: string | null }>(
  q: T,
): Omit<T, 'sectionId'> {
  const { sectionId: _sectionId, ...rest } = q;
  void _sectionId;
  return rest;
}
