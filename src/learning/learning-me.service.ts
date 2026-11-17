import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LearningAssessmentResult,
  LearningAssignmentStatus,
  LearningProgressStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import {
  CompleteContentDto,
  ManagerApprovalDto,
  SubmitAssessmentAttemptDto,
} from './dto/learning.dto';
import { gradeAttempt, stripCorrectFlags } from './learning-scoring.util';
import { quizIsRequired, quizLockReason } from './learning-quiz-progress.util';
import {
  LATE_REASON_REQUIRED_MESSAGE,
  LOCK_OVERDUE_COURSES,
  LOCKED_MESSAGE,
} from './learning-review.catalog';
import { LearningCompletionService } from './learning-completion.service';

const CLOSED_ASSIGNMENT_STATUSES = new Set<LearningAssignmentStatus>([
  LearningAssignmentStatus.CANCELLED,
  LearningAssignmentStatus.EXEMPT,
  LearningAssignmentStatus.COMPLETED,
  LearningAssignmentStatus.PASSED,
]);

@Injectable()
export class LearningMeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly completion: LearningCompletionService,
  ) {}

  private requireEmployeeId(user: RequestUser): string {
    if (!user.employeeId) {
      throw new ForbiddenException('Employee context required');
    }
    return user.employeeId;
  }

  /**
   * The learner's own assignment, still open for learning, and the course version it uses.
   * Cancelled, exempt and completed assignments take no more lessons or quiz attempts.
   */
  private async loadOpenAssignment(assignmentId: string, employeeId: string) {
    const assignment = await this.prisma.learningAssignment.findFirst({
      where: { id: assignmentId, employeeId },
      include: { progress: { select: { courseVersionId: true } } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (CLOSED_ASSIGNMENT_STATUSES.has(assignment.status)) {
      throw new BadRequestException('This training is no longer open');
    }
    const versionId =
      assignment.courseVersionId ??
      assignment.progress?.courseVersionId ??
      null;
    if (!versionId)
      throw new BadRequestException('This training has no course version');
    return { assignment, versionId };
  }

  /** Overdue course: the carer must give a late reason before going on (16 Nov 2026). */
  private async assertLateReasonGiven(assignment: {
    id: string;
    status: LearningAssignmentStatus;
  }) {
    if (assignment.status !== LearningAssignmentStatus.OVERDUE) return;
    const given = await this.prisma.learningAssignmentReview.count({
      where: { assignmentId: assignment.id, kind: 'CARER_LATE_REASON' },
    });
    if (!given) throw new BadRequestException(LATE_REASON_REQUIRED_MESSAGE);
  }

  private assertSelf(user: RequestUser, employeeId: string) {
    if (user.employeeId !== employeeId) {
      throw new ForbiddenException('Cannot access another employee learning record');
    }
  }

  async getDashboard(user: RequestUser) {
    const employeeId = this.requireEmployeeId(user);
    const [assignments, certificates, overdue] = await Promise.all([
      this.prisma.learningAssignment.count({
        where: {
          employeeId,
          status: {
            in: [
              LearningAssignmentStatus.ASSIGNED,
              LearningAssignmentStatus.NOT_STARTED,
              LearningAssignmentStatus.IN_PROGRESS,
              LearningAssignmentStatus.AWAITING_ASSESSMENT,
              LearningAssignmentStatus.AWAITING_APPROVAL,
            ],
          },
        },
      }),
      this.prisma.learningCertificate.count({ where: { employeeId, status: 'ACTIVE' } }),
      this.prisma.learningAssignment.count({
        where: { employeeId, status: LearningAssignmentStatus.OVERDUE },
      }),
    ]);

    return { openAssignments: assignments, activeCertificates: certificates, overdueAssignments: overdue };
  }

  async listAssignments(user: RequestUser) {
    const employeeId = this.requireEmployeeId(user);
    const rows = await this.prisma.learningAssignment.findMany({
      where: { employeeId },
      include: {
        course: { select: { title: true, code: true } },
        progress: true,
      },
      orderBy: { assignedAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      courseId: r.courseId,
      courseTitle: r.course.title,
      courseCode: r.course.code,
      status: r.status,
      dueAt: r.dueAt?.toISOString() ?? null,
      progressPercentage: Number(r.progress?.progressPercentage ?? 0),
    }));
  }

  async getAssignment(user: RequestUser, assignmentId: string) {
    const employeeId = this.requireEmployeeId(user);
    const row = await this.prisma.learningAssignment.findFirst({
      where: { id: assignmentId, employeeId },
      include: {
        course: true,
        progress: true,
        courseVersion: {
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
        },
      },
    });
    if (!row) throw new NotFoundException('Assignment not found');
    const quizInput = row.progress
      ? await this.completion.quizProgressInput(row.id)
      : null;

    return {
      id: row.id,
      status: row.status,
      course: { id: row.course.id, title: row.course.title, code: row.course.code },
      progress: row.progress,
      sections: row.courseVersion?.sections ?? [],
      assessments: (row.courseVersion?.assessments ?? []).map((a) => ({
        ...a,
        // Module quiz (sectionId) or final assessment (null); final ones are always required.
        isRequired: quizIsRequired(a),
        isFinal: a.sectionId === null,
        lockedReason: quizInput ? quizLockReason(a, quizInput) : null,
        questions: a.questions.map((q) => ({
          ...q,
          options: q.options.map((o) => stripCorrectFlags(o)),
        })),
      })),
    };
  }

  async completeContent(user: RequestUser, assignmentId: string, contentId: string, dto: CompleteContentDto) {
    const employeeId = this.requireEmployeeId(user);
    const { versionId, assignment } = await this.loadOpenAssignment(
      assignmentId,
      employeeId,
    );
    // Overdue courses are locked until the office extends the due date (16 Nov 2026).
    if (
      LOCK_OVERDUE_COURSES &&
      assignment.status === LearningAssignmentStatus.OVERDUE
    ) {
      throw new BadRequestException(LOCKED_MESSAGE);
    }
    await this.assertLateReasonGiven(assignment);
    const item = await this.prisma.learningContentItem.findFirst({
      where: { id: contentId, courseSection: { courseVersionId: versionId } },
      select: { id: true },
    });
    if (!item)
      throw new NotFoundException('Lesson not found in this course version');

    await this.prisma.learningContentItemCompletion.upsert({
      where: { assignmentId_contentItemId: { assignmentId, contentItemId: contentId } },
      create: {
        assignmentId,
        employeeId,
        contentItemId: contentId,
        startedAt: new Date(),
        completedAt: new Date(),
        timeSpentSeconds: dto.timeSpentSeconds ?? 0,
        acknowledgementText: dto.acknowledgementText,
      },
      update: {
        completedAt: new Date(),
        timeSpentSeconds: dto.timeSpentSeconds ?? 0,
        acknowledgementText: dto.acknowledgementText,
      },
    });

    await this.completion.refreshProgress(assignmentId);
    return { assignmentId, contentId, completed: true };
  }

  async startAssessmentAttempt(user: RequestUser, assignmentId: string, assessmentId: string) {
    const employeeId = this.requireEmployeeId(user);
    const { versionId, assignment } = await this.loadOpenAssignment(
      assignmentId,
      employeeId,
    );
    const assessment = await this.prisma.learningAssessment.findFirst({
      where: { id: assessmentId, courseVersionId: versionId },
    });
    if (!assessment)
      throw new NotFoundException('Quiz not found in this course version');

    // Module quiz: after that module's lessons. Final: after all modules (agreed 13 Nov 2026).
    const lockedReason = quizLockReason(
      assessment,
      await this.completion.quizProgressInput(assignmentId),
    );
    if (lockedReason) throw new BadRequestException(lockedReason);

    const latest = await this.prisma.learningAssessmentAttempt.findFirst({
      where: { assignmentId, assessmentId },
      orderBy: { attemptNumber: 'desc' },
    });
    // An unfinished attempt is resumed, never duplicated. It may be finished even after the
    // course went overdue; finishing the course then marks it late (16 Nov 2026).
    if (latest?.result === LearningAssessmentResult.IN_PROGRESS) return latest;
    if (
      LOCK_OVERDUE_COURSES &&
      assignment.status === LearningAssignmentStatus.OVERDUE
    ) {
      throw new BadRequestException(LOCKED_MESSAGE);
    }
    await this.assertLateReasonGiven(assignment);
    const used = latest?.attemptNumber ?? 0;
    if (
      assessment.maximumAttempts != null &&
      used >= assessment.maximumAttempts
    ) {
      throw new BadRequestException('No attempts left for this quiz');
    }
    if (latest?.submittedAt && assessment.retakeDelayMinutes) {
      const retryAt =
        latest.submittedAt.getTime() + assessment.retakeDelayMinutes * 60_000;
      if (Date.now() < retryAt) {
        throw new BadRequestException('You can retake this quiz later');
      }
    }
    const attemptNumber = used + 1;

    return this.prisma.learningAssessmentAttempt.create({
      data: {
        assessmentId,
        assignmentId,
        employeeId,
        attemptNumber,
      },
    });
  }

  async submitAssessmentAttempt(
    user: RequestUser,
    assignmentId: string,
    assessmentId: string,
    dto: SubmitAssessmentAttemptDto,
  ) {
    const employeeId = this.requireEmployeeId(user);
    const { versionId } = await this.loadOpenAssignment(
      assignmentId,
      employeeId,
    );

    const assessment = await this.prisma.learningAssessment.findFirst({
      where: { id: assessmentId, courseVersionId: versionId },
      include: {
        questions: { include: { options: true } },
      },
    });
    if (!assessment)
      throw new NotFoundException('Quiz not found in this course version');

    const latest = await this.prisma.learningAssessmentAttempt.findFirst({
      where: { assignmentId, assessmentId },
      orderBy: { attemptNumber: 'desc' },
    });
    if (!latest || latest.result !== LearningAssessmentResult.IN_PROGRESS) {
      throw new NotFoundException('No in-progress attempt found');
    }

    // Score over ALL questions of this quiz (unanswered = 0), not only what was sent.
    const { graded: gradedQuestions, ...summary } = gradeAttempt(
      assessment.questions,
      dto.answers,
      assessment.passingScore,
    );
    const result = summary.passed ? LearningAssessmentResult.PASSED : LearningAssessmentResult.FAILED;
    const answerByQuestion = new Map<string, (typeof dto.answers)[number]>();
    for (const answer of dto.answers) {
      if (!answerByQuestion.has(answer.questionId))
        answerByQuestion.set(answer.questionId, answer);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const graded of gradedQuestions) {
        const answer = answerByQuestion.get(graded.questionId);
        if (!answer) continue;
        await tx.learningAssessmentAnswer.upsert({
          where: {
            assessmentAttemptId_questionId: {
              assessmentAttemptId: latest.id,
              questionId: answer.questionId,
            },
          },
          create: {
            assessmentAttemptId: latest.id,
            questionId: answer.questionId,
            selectedOptionIds: answer.selectedOptionIds ?? [],
            textAnswer: answer.textAnswer,
            isCorrect: graded.isCorrect,
            pointsAwarded: graded.pointsAwarded,
          },
          update: {
            selectedOptionIds: answer.selectedOptionIds ?? [],
            textAnswer: answer.textAnswer,
            isCorrect: graded.isCorrect,
            pointsAwarded: graded.pointsAwarded,
          },
        });
      }

      await tx.learningAssessmentAttempt.update({
        where: { id: latest.id },
        data: {
          submittedAt: new Date(),
          score: summary.score,
          percentage: summary.percentage,
          result,
          timeSpentSeconds: dto.timeSpentSeconds ?? latest.timeSpentSeconds,
        },
      });
    });

    await this.completion.recordAssessmentResult(assignmentId);
    return { attemptId: latest.id, ...summary, result };
  }

  async listProgress(user: RequestUser) {
    const employeeId = this.requireEmployeeId(user);
    return this.prisma.learningEmployeeProgress.findMany({
      where: { employeeId },
      include: { assignment: { include: { course: { select: { title: true } } } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listCertificates(user: RequestUser) {
    const employeeId = this.requireEmployeeId(user);
    return this.prisma.learningCertificate.findMany({
      where: { employeeId },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async approveAssignment(user: RequestUser, assignmentId: string, dto: ManagerApprovalDto) {
    if (!user.permissions.includes('learning.assignments.manage')) {
      throw new ForbiddenException('Manager approval permission required');
    }
    return this.completion.setManagerApproval(assignmentId, true);
  }
}
