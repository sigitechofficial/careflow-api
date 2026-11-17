import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LearningAssignmentReviewKind,
  LearningAssignmentStatus,
  LearningAssignmentType,
} from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignAgainDto,
  ExtendAssignmentWithReasonDto,
  RecordOutcomeDto,
  RecordAssignmentReviewDto,
} from './dto/learning.dto';
import { LearningAssignmentsService } from './learning-assignments.service';
import { LearningComplianceService } from './learning-compliance.service';
import { LearningPushService } from './learning-push.service';
import { LearningCompletionService } from './learning-completion.service';
import {
  courseNeedsManagerOutcome,
  courseNeedsSession,
  trainerMarksLessons,
} from './learning-completion.util';
import { quizIsRequired } from './learning-quiz-progress.util';
import {
  LEARNING_REVIEW_ACTIONS,
  LEARNING_REVIEW_REASONS,
  REVIEW_ACTION_CODES,
  REVIEW_REASON_CODES,
} from './learning-review.catalog';

const DONE: LearningAssignmentStatus[] = [
  LearningAssignmentStatus.COMPLETED,
  LearningAssignmentStatus.PASSED,
];
const CLOSED: LearningAssignmentStatus[] = [
  ...DONE,
  LearningAssignmentStatus.CANCELLED,
  LearningAssignmentStatus.EXEMPT,
  LearningAssignmentStatus.EXPIRED,
];

/**
 * Office side of overdue / late training (16 Nov 2026): one assignment's full record,
 * extend the due date (unlocks the course), record a reason / action, mark not completed.
 * Plan: docs/LEARNING_OVERDUE_ACTIONS_PLAN.md.
 */
@Injectable()
export class LearningAssignmentReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly assignments: LearningAssignmentsService,
    private readonly compliance: LearningComplianceService,
    private readonly push: LearningPushService,
    private readonly completion: LearningCompletionService,
  ) {}

  options() {
    return { reasons: LEARNING_REVIEW_REASONS, actions: LEARNING_REVIEW_ACTIONS };
  }

  private async userNames(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(
      users.map((u) => [
        u.id,
        `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
      ]),
    );
  }

  /** Everything recorded for one assignment, for the admin drawer. */
  async detail(id: string) {
    const a = await this.prisma.learningAssignment.findUnique({
      where: { id },
      include: {
        course: { select: { id: true, title: true, code: true, courseType: true, deliveryMethod: true } },
        progress: true,
        contentCompletions: true,
        assessmentAttempts: {
          orderBy: [{ assessmentId: 'asc' }, { attemptNumber: 'asc' }],
          include: { answers: true },
        },
        sessionAttendees: { include: { trainingEvent: true } },
        certificates: { orderBy: { issuedAt: 'desc' } },
        reviews: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    const versionId = a.courseVersionId ?? a.progress?.courseVersionId ?? null;
    const version = versionId
      ? await this.prisma.learningCourseVersion.findUnique({
          where: { id: versionId },
          include: {
            sections: {
              orderBy: { displayOrder: 'asc' },
              include: { contentItems: { orderBy: { displayOrder: 'asc' } } },
            },
            assessments: {
              orderBy: { displayOrder: 'asc' },
              include: {
                questions: {
                  orderBy: { displayOrder: 'asc' },
                  include: { options: { orderBy: { displayOrder: 'asc' } } },
                },
              },
            },
          },
        })
      : null;
    const person = a.employeeId
      ? await this.prisma.employeePersonalDetail.findFirst({
          where: { employeeId: a.employeeId },
          select: { firstName: true, lastName: true },
        })
      : null;
    const names = await this.userNames([
      a.assignedById,
      ...a.reviews.map((r) => r.createdById),
      ...a.contentCompletions.map((c) => c.markedById),
    ]);
    const policyIds = [
      ...new Set(a.reviews.map((r) => r.policyVersionId).filter((x): x is string => !!x)),
    ];
    const policies = policyIds.length
      ? await this.prisma.policyVersion.findMany({
          where: { id: { in: policyIds } },
          select: { id: true, documentId: true, titleSnapshot: true, versionMajor: true, versionMinor: true },
        })
      : [];
    const policyOf = new Map(policies.map((p) => [p.id, p]));
    const done = new Map(a.contentCompletions.map((c) => [c.contentItemId, c]));
    const reasonLabel = new Map(LEARNING_REVIEW_REASONS.map((r) => [r.code, r.label]));
    const actionLabel = new Map(LEARNING_REVIEW_ACTIONS.map((r) => [r.code, r.label]));

    return {
      id: a.id,
      status: a.status,
      // Face to face / workplace: a manager records Passed / Not passed (16 Nov 2026).
      needsOutcome:
        courseNeedsManagerOutcome(a.course.deliveryMethod) ||
        !!(a.progress?.courseVersionId &&
          (await this.prisma.learningCourseVersion.findUnique({
            where: { id: a.progress.courseVersionId },
            select: { requiresManagerApproval: true },
          }))?.requiresManagerApproval),
      managerApprovalStatus: a.progress?.managerApprovalStatus ?? null,
      completedLate: a.completedLate,
      employeeId: a.employeeId,
      employeeName: person ? `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() : null,
      course: a.course,
      assignedAt: a.assignedAt,
      assignedByName: a.assignedById ? (names.get(a.assignedById) ?? null) : null,
      assignmentReason: a.assignmentReason,
      dueAt: a.dueAt,
      startedAt: a.progress?.startedAt ?? null,
      lastAccessedAt: a.progress?.lastAccessedAt ?? null,
      completedAt: a.completedAt,
      progressPercentage: Number(a.progress?.progressPercentage ?? 0),
      lessons: (version?.sections ?? []).flatMap((s) =>
        s.contentItems.map((l) => ({
          id: l.id,
          moduleTitle: s.title,
          title: l.title,
          contentType: l.contentType,
          isRequired: l.isRequired,
          completedAt: done.get(l.id)?.completedAt ?? null,
          timeSpentSeconds: done.get(l.id)?.timeSpentSeconds ?? null,
          markedByName: done.get(l.id)?.markedById
            ? (names.get(done.get(l.id)!.markedById!) ?? null)
            : null,
        })),
      ),
      // Face to face: the trainer marks lessons; the outcome waits for lessons + attendance.
      lessonsMarkedByTrainer: trainerMarksLessons(a.course.deliveryMethod),
      hasRequiredQuiz: (version?.assessments ?? []).some((q) => quizIsRequired(q)),
      outcomeBlockedReason: trainerMarksLessons(a.course.deliveryMethod)
        ? this.outcomeBlockedReason({
            lessonsLeft: (version?.sections ?? [])
              .flatMap((s) => s.contentItems)
              .filter((l) => l.isRequired && !done.get(l.id)?.completedAt).length,
            needsSession: courseNeedsSession(a.course.courseType, a.course.deliveryMethod),
            attended: a.sessionAttendees.some((x) => x.attendanceStatus === 'ATTENDED'),
          })
        : null,
      quizzes: (version?.assessments ?? []).map((q) => ({
        id: q.id,
        title: q.title,
        isFinal: q.sectionId === null,
        isRequired: quizIsRequired(q),
        passingScore: q.passingScore,
        maximumAttempts: q.maximumAttempts,
        attempts: a.assessmentAttempts
          .filter((t) => t.assessmentId === q.id)
          .map((t) => ({
            id: t.id,
            attemptNumber: t.attemptNumber,
            startedAt: t.startedAt,
            submittedAt: t.submittedAt,
            percentage: t.percentage == null ? null : Number(t.percentage),
            result: t.result,
            correct: t.answers.filter((x) => x.isCorrect === true).length,
            answered: t.answers.length,
            // Question by question: what the carer chose and the right answer (16 Nov 2026).
            questions: q.questions.map((qq) => {
              const ans = t.answers.find((x) => x.questionId === qq.id);
              const chosen = new Set(ans?.selectedOptionIds ?? []);
              return {
                id: qq.id,
                questionText: qq.questionText,
                questionType: qq.questionType,
                explanation: qq.explanation,
                answered: !!ans,
                isCorrect: ans?.isCorrect ?? false,
                textAnswer: ans?.textAnswer ?? null,
                options: qq.options.map((o) => ({
                  id: o.id,
                  optionText: o.optionText,
                  isCorrect: o.isCorrect,
                  chosen: chosen.has(o.id),
                })),
              };
            }),
          })),
      })),
      sessions: a.sessionAttendees.map((s) => ({
        attendeeId: s.id,
        title: s.trainingEvent.title,
        startAt: s.trainingEvent.startAt,
        endAt: s.trainingEvent.endAt,
        eventStatus: s.trainingEvent.status,
        bookingStatus: s.bookingStatus,
        attendanceStatus: s.attendanceStatus,
        cantAttendReason: s.cantAttendReason,
        cantAttendAt: s.cantAttendAt,
      })),
      certificate: a.certificates[0]
        ? {
            id: a.certificates[0].id,
            certificateNumber: a.certificates[0].certificateNumber,
            issuedAt: a.certificates[0].issuedAt,
            expiresAt: a.certificates[0].expiresAt,
            status: a.certificates[0].status,
          }
        : null,
      reviews: a.reviews.map((r) => ({
        id: r.id,
        kind: r.kind,
        reasonCode: r.reasonCode,
        reasonLabel: r.reasonCode ? (reasonLabel.get(r.reasonCode) ?? r.reasonCode) : null,
        actionCodes: r.actionCodes,
        actionLabels: r.actionCodes.map((c) => actionLabel.get(c) ?? c),
        note: r.note,
        previousDueAt: r.previousDueAt,
        newDueAt: r.newDueAt,
        followUpAt: r.followUpAt,
        policy: r.policyVersionId
          ? (() => {
              const p = policyOf.get(r.policyVersionId);
              return p
                ? { versionId: p.id, documentId: p.documentId, title: p.titleSnapshot, version: `${p.versionMajor}.${p.versionMinor}` }
                : null;
            })()
          : null,
        createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
        createdAt: r.createdAt,
      })),
    };
  }

  private async policyVersionOrNull(id?: string | null) {
    if (!id) return null;
    const v = await this.prisma.policyVersion.findFirst({
      where: { id, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (!v) throw new BadRequestException('That policy version is not published');
    return v.id;
  }

  /** New due date with a reason. An overdue (locked) course opens again (decision 1, 16 Nov 2026). */
  async extend(
    id: string,
    userId: string,
    dto: ExtendAssignmentWithReasonDto,
    meta?: RequestAuditMeta,
  ) {
    const a = await this.prisma.learningAssignment.findUnique({
      where: { id },
      include: {
        course: { select: { title: true } },
        progress: { select: { startedAt: true } },
      },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    if (CLOSED.includes(a.status)) {
      throw new BadRequestException('This training is closed and cannot be extended');
    }
    const newDueAt = new Date(dto.dueAt);
    if (newDueAt.getTime() <= Date.now()) {
      throw new BadRequestException('The new due date must be in the future');
    }
    const policyVersionId = await this.policyVersionOrNull(dto.policyVersionId);
    const reopenedStatus =
      a.status === LearningAssignmentStatus.OVERDUE
        ? a.progress?.startedAt
          ? LearningAssignmentStatus.IN_PROGRESS
          : LearningAssignmentStatus.ASSIGNED
        : a.status;
    await this.prisma.$transaction([
      this.prisma.learningAssignment.update({
        where: { id },
        data: { dueAt: newDueAt, status: reopenedStatus },
      }),
      this.prisma.learningAssignmentReview.create({
        data: {
          assignmentId: id,
          employeeId: a.employeeId!,
          kind: LearningAssignmentReviewKind.EXTENDED,
          reasonCode: dto.reasonCode ?? null,
          note: dto.note?.trim() || null,
          previousDueAt: a.dueAt,
          newDueAt,
          policyVersionId,
          createdById: userId,
        },
      }),
    ]);
    await this.compliance.recalculateForAssignment(id);
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_assignment_due_extended',
      recordType: 'LearningAssignment',
      recordId: id,
      oldValues: { dueAt: a.dueAt, status: a.status },
      newValues: { dueAt: newDueAt, status: reopenedStatus, reasonCode: dto.reasonCode, note: dto.note },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    if (a.employeeId) {
      await this.push.dueDateExtended({
        employeeId: a.employeeId,
        assignmentId: id,
        courseTitle: a.course.title,
        dueAt: newDueAt,
      });
    }
    return this.detail(id);
  }

  /**
   * Reason and/or actions for an overdue or late course. NOT_COMPLETED also closes the
   * assignment (status EXPIRED, shown as "Not completed") and can re-assign the course.
   */
  async record(
    id: string,
    userId: string,
    dto: RecordAssignmentReviewDto,
    meta?: RequestAuditMeta,
  ) {
    const a = await this.prisma.learningAssignment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Assignment not found');
    if (dto.reasonCode && !REVIEW_REASON_CODES.includes(dto.reasonCode)) {
      throw new BadRequestException('Unknown reason');
    }
    const actionCodes = [...new Set(dto.actionCodes ?? [])];
    if (actionCodes.some((c) => !REVIEW_ACTION_CODES.includes(c))) {
      throw new BadRequestException('Unknown action');
    }
    // The carer gives the reason in the app; the office records the action (16 Nov 2026).
    if (dto.kind === 'REASON' && !actionCodes.length) {
      throw new BadRequestException('Choose at least one action');
    }
    if (dto.reasonCode === 'OTHER' && !dto.note?.trim()) {
      throw new BadRequestException('Write the reason in the note');
    }
    const closing = dto.kind === 'NOT_COMPLETED';
    if (closing && a.status !== LearningAssignmentStatus.OVERDUE) {
      throw new BadRequestException('Only an overdue course can be marked not completed');
    }
    if (!closing && !(a.status === LearningAssignmentStatus.OVERDUE || a.completedLate)) {
      throw new BadRequestException('Reasons and actions are recorded for overdue or late courses');
    }
    if (dto.reassignDueAt && !closing) {
      throw new BadRequestException('Re-assigning is done when marking the course not completed');
    }
    if (dto.reassignDueAt && new Date(dto.reassignDueAt).getTime() <= Date.now()) {
      throw new BadRequestException('The new due date must be in the future');
    }
    const policyVersionId = await this.policyVersionOrNull(dto.policyVersionId);
    if (dto.reassignDueAt && !actionCodes.includes('REASSIGN')) actionCodes.push('REASSIGN');

    await this.prisma.$transaction(async (tx) => {
      if (closing) {
        await tx.learningAssignment.update({
          where: { id },
          data: { status: LearningAssignmentStatus.EXPIRED },
        });
      }
      await tx.learningAssignmentReview.create({
        data: {
          assignmentId: id,
          employeeId: a.employeeId!,
          kind: closing
            ? LearningAssignmentReviewKind.NOT_COMPLETED
            : LearningAssignmentReviewKind.REASON,
          reasonCode: dto.reasonCode ?? null,
          actionCodes,
          note: dto.note?.trim() || null,
          followUpAt: dto.followUpAt ? new Date(dto.followUpAt) : null,
          previousDueAt: a.dueAt,
          newDueAt: dto.reassignDueAt ? new Date(dto.reassignDueAt) : null,
          policyVersionId,
          createdById: userId,
        },
      });
    });
    if (closing) await this.compliance.recalculateForAssignment(id);
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: closing ? 'learning_assignment_not_completed' : 'learning_assignment_review_recorded',
      recordType: 'LearningAssignment',
      recordId: id,
      oldValues: { status: a.status },
      newValues: { kind: dto.kind, reasonCode: dto.reasonCode, actionCodes, note: dto.note, followUpAt: dto.followUpAt },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    let reassignedId: string | null = null;
    if (closing && dto.reassignDueAt && a.employeeId) {
      const created = await this.assignments.create(
        userId,
        {
          courseId: a.courseId,
          employeeId: a.employeeId,
          assignmentType: LearningAssignmentType.INDIVIDUAL,
          dueAt: dto.reassignDueAt,
          assignmentReason: 'Re-assigned after the previous one was not completed',
        },
        meta,
      );
      reassignedId = created.id;
    }
    return { ...(await this.detail(id)), reassignedAssignmentId: reassignedId };
  }

  /**
   * Manager's outcome for a face to face / workplace course (user decision, 16 Nov 2026).
   * Passed: the course completes once nothing else is left, and the certificate is issued.
   * Not passed: the course is failed; it can be given again now or later.
   */
  async recordOutcome(id: string, userId: string, dto: RecordOutcomeDto, meta?: RequestAuditMeta) {
    const a = await this.prisma.learningAssignment.findUnique({
      where: { id },
      include: {
        course: { select: { title: true, deliveryMethod: true, courseType: true } },
        progress: { include: { courseVersion: { select: { requiresManagerApproval: true } } } },
      },
    });
    if (!a || !a.progress) throw new NotFoundException('Assignment not found');
    const needsOutcome =
      courseNeedsManagerOutcome(a.course.deliveryMethod) ||
      !!a.progress.courseVersion?.requiresManagerApproval;
    if (!needsOutcome) {
      throw new BadRequestException('This course does not need a manager outcome');
    }
    if (CLOSED.includes(a.status) || a.status === LearningAssignmentStatus.FAILED) {
      throw new BadRequestException('This training is already closed');
    }
    const passed = dto.result !== 'NOT_PASSED';
    const quizNext = dto.result === 'PASSED_AFTER_QUIZ';
    const note = dto.note?.trim() || null;
    if (trainerMarksLessons(a.course.deliveryMethod)) {
      const blocked = await this.outcomeBlockedFor(id, a.course.courseType, a.course.deliveryMethod);
      if (blocked) throw new BadRequestException(blocked);
    }
    if (quizNext) {
      const versionId = a.progress.courseVersionId;
      const quizzes = await this.prisma.learningAssessment.findMany({
        where: { courseVersionId: versionId },
        select: { isRequired: true, sectionId: true },
      });
      if (!quizzes.some((q) => quizIsRequired(q))) {
        throw new BadRequestException('This course has no quiz. Choose Passed instead.');
      }
    }
    if (!passed && (!note || note.length < 3)) {
      throw new BadRequestException('Write why the carer has not passed');
    }
    if (dto.reassignDueAt && passed) {
      throw new BadRequestException('Only a course that was not passed can be given again');
    }
    if (dto.reassignDueAt && new Date(dto.reassignDueAt).getTime() <= Date.now()) {
      throw new BadRequestException('The new due date must be in the future');
    }
    const policyVersionId = await this.policyVersionOrNull(dto.policyVersionId);

    await this.prisma.$transaction(async (tx) => {
      await tx.learningEmployeeProgress.update({
        where: { assignmentId: id },
        data: {
          managerApprovalStatus: passed ? 'COMPLETED' : 'FAILED',
          // Passed also covers the practical sign-off.
          ...(passed ? { practicalAssessmentStatus: 'COMPLETED' as const } : {}),
        },
      });
      if (!passed) {
        await tx.learningAssignment.update({
          where: { id },
          data: { status: LearningAssignmentStatus.FAILED },
        });
      }
      await tx.learningAssignmentReview.create({
        data: {
          assignmentId: id,
          employeeId: a.employeeId!,
          kind: quizNext
            ? LearningAssignmentReviewKind.OUTCOME_PASSED_AFTER_QUIZ
            : passed
              ? LearningAssignmentReviewKind.OUTCOME_PASSED
              : LearningAssignmentReviewKind.OUTCOME_NOT_PASSED,
          note,
          policyVersionId,
          createdById: userId,
        },
      });
    });
    if (passed) await this.completion.refreshProgress(id);
    else await this.compliance.recalculateForAssignment(id);
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: quizNext
        ? 'learning_outcome_passed_after_quiz'
        : passed
          ? 'learning_outcome_passed'
          : 'learning_outcome_not_passed',
      recordType: 'LearningAssignment',
      recordId: id,
      oldValues: { status: a.status },
      newValues: { result: dto.result, note },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    if (a.employeeId) {
      await this.push.outcome({
        employeeId: a.employeeId,
        assignmentId: id,
        courseTitle: a.course.title,
        passed,
        quizNext,
      });
    }
    let reassignedId: string | null = null;
    if (!passed && dto.reassignDueAt) {
      reassignedId = (await this.assignAgain(id, userId, { dueAt: dto.reassignDueAt }, meta))
        .reassignedAssignmentId;
    }
    return { ...(await this.detail(id)), reassignedAssignmentId: reassignedId };
  }

  private outcomeBlockedReason(input: { lessonsLeft: number; needsSession: boolean; attended: boolean }) {
    const parts: string[] = [];
    if (input.lessonsLeft) {
      parts.push(`mark ${input.lessonsLeft} lesson${input.lessonsLeft === 1 ? '' : 's'} done`);
    }
    if (input.needsSession && !input.attended) parts.push('mark the carer as attended at a session');
    return parts.length ? `Before the outcome: ${parts.join(' and ')}.` : null;
  }

  private async outcomeBlockedFor(id: string, courseType: string, deliveryMethod: string | null) {
    const progress = await this.prisma.learningEmployeeProgress.findUnique({
      where: { assignmentId: id },
      select: { courseVersionId: true },
    });
    if (!progress) return null;
    const [required, done, attended] = await Promise.all([
      this.prisma.learningContentItem.findMany({
        where: { isRequired: true, courseSection: { courseVersionId: progress.courseVersionId } },
        select: { id: true },
      }),
      this.prisma.learningContentItemCompletion.findMany({
        where: { assignmentId: id, completedAt: { not: null } },
        select: { contentItemId: true },
      }),
      this.prisma.learningTrainingEventAttendee.count({
        where: { assignmentId: id, attendanceStatus: 'ATTENDED' },
      }),
    ]);
    const doneIds = new Set(done.map((d) => d.contentItemId));
    return this.outcomeBlockedReason({
      lessonsLeft: required.filter((l) => !doneIds.has(l.id)).length,
      needsSession: courseNeedsSession(courseType, deliveryMethod),
      attended: attended > 0,
    });
  }

  private async openTrainerAssignment(id: string) {
    const a = await this.prisma.learningAssignment.findUnique({
      where: { id },
      include: { course: { select: { deliveryMethod: true } }, progress: true },
    });
    if (!a || !a.progress || !a.employeeId) throw new NotFoundException('Assignment not found');
    if (!trainerMarksLessons(a.course.deliveryMethod)) {
      throw new BadRequestException('Only face to face courses are marked by the office');
    }
    if (CLOSED.includes(a.status) || a.status === LearningAssignmentStatus.FAILED) {
      throw new BadRequestException('This training is already closed');
    }
    return a;
  }

  /** Face to face: the office starts the course for the carer (16 Nov 2026). */
  async startCourse(id: string, userId: string, meta?: RequestAuditMeta) {
    const a = await this.openTrainerAssignment(id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.learningEmployeeProgress.update({
        where: { assignmentId: id },
        data: { startedAt: a.progress!.startedAt ?? now },
      });
      if (
        a.status === LearningAssignmentStatus.ASSIGNED ||
        a.status === LearningAssignmentStatus.NOT_STARTED
      ) {
        await tx.learningAssignment.update({
          where: { id },
          data: { status: LearningAssignmentStatus.IN_PROGRESS },
        });
      }
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_course_started_by_office',
      recordType: 'LearningAssignment',
      recordId: id,
      oldValues: { status: a.status },
      newValues: { startedAt: (a.progress!.startedAt ?? now).toISOString() },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return this.detail(id);
  }

  /** Face to face: the office marks lessons done (or undoes one). Empty lessonIds = all lessons. */
  async markLessons(
    id: string,
    userId: string,
    body: { lessonIds?: string[]; done: boolean },
    meta?: RequestAuditMeta,
  ) {
    const a = await this.openTrainerAssignment(id);
    const items = await this.prisma.learningContentItem.findMany({
      where: { courseSection: { courseVersionId: a.progress!.courseVersionId } },
      select: { id: true },
    });
    const valid = new Set(items.map((i) => i.id));
    const ids = body.lessonIds?.length ? body.lessonIds : [...valid];
    if (ids.some((x) => !valid.has(x))) throw new BadRequestException('Lesson not found in this course');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const contentItemId of ids) {
        if (body.done) {
          await tx.learningContentItemCompletion.upsert({
            where: { assignmentId_contentItemId: { assignmentId: id, contentItemId } },
            create: {
              assignmentId: id,
              employeeId: a.employeeId!,
              contentItemId,
              startedAt: now,
              completedAt: now,
              markedById: userId,
            },
            update: { completedAt: now, markedById: userId },
          });
        } else {
          await tx.learningContentItemCompletion.updateMany({
            where: { assignmentId: id, contentItemId },
            data: { completedAt: null, markedById: userId },
          });
        }
      }
      await tx.learningEmployeeProgress.update({
        where: { assignmentId: id },
        data: { startedAt: a.progress!.startedAt ?? now },
      });
    });
    await this.completion.refreshProgress(id);
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: body.done ? 'learning_lessons_marked_done' : 'learning_lesson_marked_not_done',
      recordType: 'LearningAssignment',
      recordId: id,
      newValues: { lessonIds: ids, done: body.done },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return this.detail(id);
  }

  /** Give a failed or not completed course to the carer again; the old record is kept. */
  async assignAgain(id: string, userId: string, dto: AssignAgainDto, meta?: RequestAuditMeta) {
    const a = await this.prisma.learningAssignment.findUnique({ where: { id } });
    if (!a || !a.employeeId) throw new NotFoundException('Assignment not found');
    if (
      a.status !== LearningAssignmentStatus.FAILED &&
      a.status !== LearningAssignmentStatus.EXPIRED
    ) {
      throw new BadRequestException('Only a failed or not completed course can be given again');
    }
    if (new Date(dto.dueAt).getTime() <= Date.now()) {
      throw new BadRequestException('The new due date must be in the future');
    }
    const created = await this.assignments.create(
      userId,
      {
        courseId: a.courseId,
        employeeId: a.employeeId,
        assignmentType: LearningAssignmentType.INDIVIDUAL,
        dueAt: dto.dueAt,
        assignmentReason: dto.note?.trim() || 'Given again after the previous one was not passed',
      },
      meta,
    );
    await this.prisma.learningAssignmentReview.create({
      data: {
        assignmentId: id,
        employeeId: a.employeeId,
        kind: LearningAssignmentReviewKind.ASSIGNED_AGAIN,
        note: dto.note?.trim() || null,
        newDueAt: new Date(dto.dueAt),
        createdById: userId,
      },
    });
    return { ...(await this.detail(id)), reassignedAssignmentId: created.id as string };
  }
}
