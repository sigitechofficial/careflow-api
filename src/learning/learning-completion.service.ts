import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { LearningNotificationHook } from './learning-notification.hook';
import {
  LearningAssessmentResult,
  LearningAssignmentReviewKind,
  LearningAssignmentStatus,
  LearningProgressStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  calculateCourseProgressPercentage,
  calculateCourseProgressSteps,
  courseNeedsManagerOutcome,
  courseNeedsSession,
  deriveCourseCompletionStatus,
  isCourseFullyComplete,
} from './learning-completion.util';
import { quizIsRequired, quizStepStatus } from './learning-quiz-progress.util';
import { LearningCertificatesService } from './learning-certificates.service';
import { LearningComplianceService } from './learning-compliance.service';
import { LearningIncidentLinkService } from './learning-incident-link.service';

@Injectable()
export class LearningCompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly certificates: LearningCertificatesService,
    private readonly compliance: LearningComplianceService,
    @Optional() private readonly notifications?: LearningNotificationHook,
    @Optional() private readonly incidentLink?: LearningIncidentLinkService,
  ) {}

  async countRequiredContentItems(courseVersionId: string): Promise<number> {
    return this.prisma.learningContentItem.count({
      where: {
        isRequired: true,
        courseSection: { courseVersionId, isRequired: true },
      },
    });
  }

  async countCompletedContentItems(assignmentId: string): Promise<number> {
    return this.prisma.learningContentItemCompletion.count({
      where: {
        assignmentId,
        completedAt: { not: null },
        contentItem: { isRequired: true },
      },
    });
  }

  /** Where the carer is on the course: completion rules, current steps and whole-course %. */
  private async evaluateProgress(assignmentId: string, db: Prisma.TransactionClient | PrismaService) {
    const assignment = await db.learningAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        course: true,
        progress: { include: { courseVersion: true } },
      },
    });
    if (!assignment || !assignment.progress) throw new NotFoundException('Assignment progress not found');
    // Rules come from the version this learner is on (frozen at publish), not the live course.
    const rules = assignment.progress.courseVersion ?? assignment.course;

    const totalRequired = await this.countRequiredContentItems(assignment.progress.courseVersionId);
    const completedRequired = await this.countCompletedContentItems(assignmentId);
    const requiresSession = courseNeedsSession(
      assignment.course.courseType,
      assignment.course.deliveryMethod,
    );
    const sessionAttended = requiresSession
      ? (await db.learningTrainingEventAttendee.count({
          where: { assignmentId, attendanceStatus: 'ATTENDED' },
        })) > 0
      : false;

    const snapshot = {
      completedRequiredContentItems: completedRequired,
      totalRequiredContentItems: totalRequired,
      assessmentStatus: assignment.progress.assessmentStatus,
      practicalAssessmentStatus: assignment.progress.practicalAssessmentStatus,
      managerApprovalStatus: assignment.progress.managerApprovalStatus,
      sessionAttended,
    };

    // Face to face / workplace: a manager records the outcome; Passed also covers the
    // practical sign-off (user decision, 16 Nov 2026).
    const needsOutcome = courseNeedsManagerOutcome(assignment.course.deliveryMethod);
    // Face to face / workplace: plain "Passed" completes the course without the quiz;
    // "Passed, quiz to pass" keeps the quiz required (user decision, 16 Nov 2026).
    const lastOutcome = needsOutcome
      ? await db.learningAssignmentReview.findFirst({
          where: {
            assignmentId,
            kind: {
              in: [
                LearningAssignmentReviewKind.OUTCOME_PASSED,
                LearningAssignmentReviewKind.OUTCOME_PASSED_AFTER_QUIZ,
                LearningAssignmentReviewKind.OUTCOME_NOT_PASSED,
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
          select: { kind: true },
        })
      : null;
    const plainPass = lastOutcome?.kind === LearningAssignmentReviewKind.OUTCOME_PASSED;
    const requirements = {
      requiresSession,
      requiresAssessment: plainPass ? false : rules.requiresAssessment,
      requiresPracticalAssessment: needsOutcome ? false : rules.requiresPracticalAssessment,
      requiresManagerApproval: rules.requiresManagerApproval || needsOutcome,
    };

    // Whole course, not only lessons (18 Nov 2026): required quizzes, session and office step count too.
    let quizzesTotal = 0;
    let quizzesDone = 0;
    if (requirements.requiresAssessment) {
      const { quizzes, attempts } = await this.quizProgressInput(assignmentId, db);
      const required = quizzes.filter((q) => quizIsRequired(q));
      quizzesTotal = required.length;
      quizzesDone = required.filter((q) =>
        attempts.some((a) => a.assessmentId === q.id && a.result === LearningAssessmentResult.PASSED),
      ).length;
    }
    const officeRequired = requirements.requiresManagerApproval || requirements.requiresPracticalAssessment;
    const officeDone =
      (!requirements.requiresManagerApproval || snapshot.managerApprovalStatus === LearningProgressStatus.COMPLETED) &&
      (!requirements.requiresPracticalAssessment ||
        snapshot.practicalAssessmentStatus === LearningProgressStatus.COMPLETED);
    const stepInput = {
      lessonsDone: completedRequired,
      lessonsTotal: totalRequired,
      quizzesDone,
      quizzesTotal,
      sessionRequired: requiresSession,
      sessionDone: sessionAttended,
      officeRequired,
      officeDone,
    };
    const progressPercentage = calculateCourseProgressPercentage(stepInput);
    const progressSteps = calculateCourseProgressSteps(stepInput);
    return {
      // Spread keeps the non-null progress narrowing for callers.
      assignment: { ...assignment, progress: assignment.progress },
      rules,
      sessionAttended,
      totalRequired,
      completedRequired,
      snapshot,
      requirements,
      progressPercentage,
      progressSteps,
    };
  }

  /**
   * Required steps done / in total for the carer app (20 Nov 2026): lets the phone move the bar
   * for lessons it has not sent yet. Read-only; null when the course has no progress row yet.
   */
  async progressSteps(assignmentId: string): Promise<{ done: number; total: number } | null> {
    try {
      return (await this.evaluateProgress(assignmentId, this.prisma)).progressSteps;
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw e;
    }
  }

  /**
   * Only the % (18 Nov 2026): fixes courses saved under the old lessons-only rule without
   * touching started / status. Returns true when it changed.
   */
  async recalculatePercentage(assignmentId: string): Promise<boolean> {
    const { assignment, progressPercentage } = await this.evaluateProgress(assignmentId, this.prisma);
    if (Number(assignment.progress.progressPercentage) === progressPercentage) return false;
    await this.prisma.learningEmployeeProgress.update({
      where: { assignmentId },
      data: { progressPercentage },
    });
    return true;
  }

  async refreshProgress(assignmentId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const {
      assignment,
      rules,
      sessionAttended,
      totalRequired,
      completedRequired,
      snapshot,
      requirements,
      progressPercentage,
    } = await this.evaluateProgress(assignmentId, db);
    const courseCompletionStatus = deriveCourseCompletionStatus(requirements, snapshot);
    const complete = isCourseFullyComplete(requirements, snapshot);

    const updated = await db.learningEmployeeProgress.update({
      where: { assignmentId },
      data: {
        completedContentItems: completedRequired,
        totalRequiredContentItems: totalRequired,
        progressPercentage,
        courseCompletionStatus,
        completedAt: complete ? assignment.progress.completedAt ?? new Date() : null,
        lastAccessedAt: new Date(),
        startedAt: assignment.progress.startedAt ?? new Date(),
      },
    });

    // Started but not finished: show it as In progress (was left as Assigned, 16 Nov 2026).
    // A practical sign-off or manager outcome also counts as started (17 Nov 2026): "Practical
    // passed – quiz to pass" left the course as Scheduled.
    const started =
      completedRequired > 0 ||
      sessionAttended ||
      assignment.progress.assessmentStatus !== LearningProgressStatus.NOT_STARTED ||
      assignment.progress.practicalAssessmentStatus !== LearningProgressStatus.NOT_STARTED ||
      assignment.progress.managerApprovalStatus === LearningProgressStatus.COMPLETED;
    const waitingForManager =
      courseCompletionStatus === LearningProgressStatus.AWAITING_APPROVAL;
    const openStatuses: LearningAssignmentStatus[] = [
      LearningAssignmentStatus.ASSIGNED,
      LearningAssignmentStatus.NOT_STARTED,
      LearningAssignmentStatus.IN_PROGRESS,
    ];
    if (!complete && waitingForManager && openStatuses.includes(assignment.status)) {
      // Everything else is done: waiting for the manager's outcome ("Awaiting sign-off").
      await db.learningAssignment.update({
        where: { id: assignmentId },
        data: { status: LearningAssignmentStatus.AWAITING_APPROVAL },
      });
      if (assignment.employeeId) {
        await this.notifications
          ?.notifyAwaitingOutcome({
            assignmentId,
            employeeId: assignment.employeeId,
            courseTitle: assignment.course.title,
          })
          .catch(() => undefined);
      }
    } else if (
      !complete &&
      started &&
      (assignment.status === LearningAssignmentStatus.ASSIGNED ||
        assignment.status === LearningAssignmentStatus.NOT_STARTED)
    ) {
      await db.learningAssignment.update({
        where: { id: assignmentId },
        data: { status: LearningAssignmentStatus.IN_PROGRESS },
      });
    }

    if (complete) {
      const firstTime =
        assignment.status !== LearningAssignmentStatus.COMPLETED &&
        assignment.status !== LearningAssignmentStatus.PASSED;
      const completedAt = assignment.completedAt ?? new Date();
      // Finished after the due date: flag it and tell the managers (16 Nov 2026).
      const late =
        firstTime && !!assignment.dueAt && completedAt > assignment.dueAt;
      await db.learningAssignment.update({
        where: { id: assignmentId },
        data: {
          status: LearningAssignmentStatus.COMPLETED,
          completedAt,
          ...(late ? { completedLate: true } : {}),
        },
      });
      if (late && assignment.employeeId) {
        await this.notifications
          ?.notifyCompletedLate({
            assignmentId,
            employeeId: assignment.employeeId,
            courseTitle: assignment.course.title,
            dueAt: assignment.dueAt!,
            completedAt,
          })
          .catch(() => undefined);
      }

      if (rules.certificateEnabled) {
        await this.certificates.issueForAssignment(assignmentId, tx);
      }
      // Given by an incident measure: complete that measure (17 Nov 2026).
      if (firstTime) await this.incidentLink?.onAssignmentCompleted(assignmentId, db);
    }

    if (!tx) {
      await this.compliance.recalculateForAssignment(assignmentId);
    }

    return updated;
  }

  /**
   * Everything the quiz rules need for one assignment: its version's quizzes, the carer's
   * attempts, the required lessons (with their module) and which lessons are done.
   */
  async quizProgressInput(
    assignmentId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const progress = await db.learningEmployeeProgress.findUnique({
      where: { assignmentId },
      select: { courseVersionId: true },
    });
    if (!progress) throw new NotFoundException('Assignment progress not found');
    const versionId = progress.courseVersionId;
    const [quizzes, attempts, requiredLessons, completions] = await Promise.all(
      [
        db.learningAssessment.findMany({
          where: { courseVersionId: versionId },
          select: {
            id: true,
            sectionId: true,
            isRequired: true,
            maximumAttempts: true,
          },
        }),
        db.learningAssessmentAttempt.findMany({
          where: { assignmentId },
          select: { assessmentId: true, result: true },
        }),
        db.learningContentItem.findMany({
          where: {
            isRequired: true,
            courseSection: { courseVersionId: versionId, isRequired: true },
          },
          select: { id: true, courseSectionId: true },
        }),
        db.learningContentItemCompletion.findMany({
          where: { assignmentId, completedAt: { not: null } },
          select: { contentItemId: true },
        }),
      ],
    );
    return {
      quizzes,
      attempts,
      requiredLessons: requiredLessons.map((l) => ({
        id: l.id,
        sectionId: l.courseSectionId,
      })),
      completedLessonIds: new Set(completions.map((c) => c.contentItemId)),
    };
  }

  /**
   * After a quiz attempt: the quiz step is done when every required quiz is passed, and the
   * assignment fails only when a required quiz has no tries left (agreed 13 Nov 2026).
   */
  async recordAssessmentResult(
    assignmentId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const { quizzes, attempts } = await this.quizProgressInput(
      assignmentId,
      db,
    );
    const status = quizStepStatus(quizzes, attempts);
    await db.learningEmployeeProgress.update({
      where: { assignmentId },
      data: { assessmentStatus: status },
    });

    if (status === LearningProgressStatus.FAILED) {
      await db.learningAssignment.update({
        where: { id: assignmentId },
        data: { status: LearningAssignmentStatus.FAILED },
      });
    }

    return this.refreshProgress(assignmentId, tx);
  }

  async setManagerApproval(assignmentId: string, approved: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await tx.learningEmployeeProgress.update({
        where: { assignmentId },
        data: {
          managerApprovalStatus: approved
            ? LearningProgressStatus.COMPLETED
            : LearningProgressStatus.FAILED,
        },
      });

      if (!approved) {
        await tx.learningAssignment.update({
          where: { id: assignmentId },
          data: { status: LearningAssignmentStatus.FAILED },
        });
      }

      return this.refreshProgress(assignmentId, tx);
    });
  }

  async setPracticalAssessment(assignmentId: string, passed: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await tx.learningEmployeeProgress.update({
        where: { assignmentId },
        data: {
          practicalAssessmentStatus: passed
            ? LearningProgressStatus.COMPLETED
            : LearningProgressStatus.FAILED,
        },
      });
      return this.refreshProgress(assignmentId, tx);
    });
  }

  async markAssessmentAttemptSubmitted(
    attemptId: string,
    result: LearningAssessmentResult,
    passed: boolean,
  ) {
    const attempt = await this.prisma.learningAssessmentAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');

    void result;
    void passed;
    await this.recordAssessmentResult(attempt.assignmentId);
    return attempt;
  }
}
