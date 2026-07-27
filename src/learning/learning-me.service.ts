import {
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
import { calculateAttemptScore, gradeAnswer, stripCorrectFlags } from './learning-scoring.util';
import { LearningCompletionService } from './learning-completion.service';

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

    return {
      id: row.id,
      status: row.status,
      course: { id: row.course.id, title: row.course.title, code: row.course.code },
      progress: row.progress,
      sections: row.courseVersion?.sections ?? [],
      assessments: (row.courseVersion?.assessments ?? []).map((a) => ({
        ...a,
        questions: a.questions.map((q) => ({
          ...q,
          options: q.options.map((o) => stripCorrectFlags(o)),
        })),
      })),
    };
  }

  async completeContent(user: RequestUser, assignmentId: string, contentId: string, dto: CompleteContentDto) {
    const employeeId = this.requireEmployeeId(user);
    const assignment = await this.prisma.learningAssignment.findFirst({
      where: { id: assignmentId, employeeId },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

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
    const assignment = await this.prisma.learningAssignment.findFirst({
      where: { id: assignmentId, employeeId },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const latest = await this.prisma.learningAssessmentAttempt.findFirst({
      where: { assignmentId, assessmentId },
      orderBy: { attemptNumber: 'desc' },
    });
    const attemptNumber = (latest?.attemptNumber ?? 0) + 1;

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
    const assignment = await this.prisma.learningAssignment.findFirst({
      where: { id: assignmentId, employeeId },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const assessment = await this.prisma.learningAssessment.findUnique({
      where: { id: assessmentId },
      include: {
        questions: { include: { options: true } },
      },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    const latest = await this.prisma.learningAssessmentAttempt.findFirst({
      where: { assignmentId, assessmentId },
      orderBy: { attemptNumber: 'desc' },
    });
    if (!latest || latest.result !== LearningAssessmentResult.IN_PROGRESS) {
      throw new NotFoundException('No in-progress attempt found');
    }

    const gradedAnswers = dto.answers.map((answer) => {
      const question = assessment.questions.find((q) => q.id === answer.questionId);
      if (!question) {
        return { isCorrect: false, pointsAwarded: 0, maxPoints: 0 };
      }
      return gradeAnswer(
        question.questionType,
        answer.selectedOptionIds ?? [],
        question.options,
        question.points,
      );
    });

    const summary = calculateAttemptScore(gradedAnswers, assessment.passingScore);
    const result = summary.passed ? LearningAssessmentResult.PASSED : LearningAssessmentResult.FAILED;

    await this.prisma.$transaction(async (tx) => {
      for (const answer of dto.answers) {
        const question = assessment.questions.find((q) => q.id === answer.questionId);
        if (!question) continue;
        const graded = gradeAnswer(
          question.questionType,
          answer.selectedOptionIds ?? [],
          question.options,
          question.points,
        );
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

    await this.completion.recordAssessmentResult(assignmentId, summary.passed);
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
