import { Injectable, NotFoundException } from '@nestjs/common';
import {
  LearningAssessmentResult,
  LearningAssignmentStatus,
  LearningProgressStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  calculateContentProgressPercentage,
  deriveCourseCompletionStatus,
  isCourseFullyComplete,
} from './learning-completion.util';
import { LearningCertificatesService } from './learning-certificates.service';
import { LearningComplianceService } from './learning-compliance.service';

@Injectable()
export class LearningCompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly certificates: LearningCertificatesService,
    private readonly compliance: LearningComplianceService,
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

  async refreshProgress(assignmentId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const assignment = await db.learningAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        course: true,
        progress: true,
      },
    });
    if (!assignment || !assignment.progress) throw new NotFoundException('Assignment progress not found');

    const totalRequired = await this.countRequiredContentItems(assignment.progress.courseVersionId);
    const completedRequired = await this.countCompletedContentItems(assignmentId);

    const snapshot = {
      completedRequiredContentItems: completedRequired,
      totalRequiredContentItems: totalRequired,
      assessmentStatus: assignment.progress.assessmentStatus,
      practicalAssessmentStatus: assignment.progress.practicalAssessmentStatus,
      managerApprovalStatus: assignment.progress.managerApprovalStatus,
    };

    const requirements = {
      requiresAssessment: assignment.course.requiresAssessment,
      requiresPracticalAssessment: assignment.course.requiresPracticalAssessment,
      requiresManagerApproval: assignment.course.requiresManagerApproval,
    };

    const progressPercentage = calculateContentProgressPercentage(snapshot);
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

    if (complete) {
      await db.learningAssignment.update({
        where: { id: assignmentId },
        data: {
          status: LearningAssignmentStatus.COMPLETED,
          completedAt: assignment.completedAt ?? new Date(),
        },
      });

      if (assignment.course.certificateEnabled) {
        await this.certificates.issueForAssignment(assignmentId, tx);
      }
    }

    if (!tx) {
      await this.compliance.recalculateForAssignment(assignmentId);
    }

    return updated;
  }

  async recordAssessmentResult(
    assignmentId: string,
    passed: boolean,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    await db.learningEmployeeProgress.update({
      where: { assignmentId },
      data: {
        assessmentStatus: passed
          ? LearningProgressStatus.COMPLETED
          : LearningProgressStatus.FAILED,
      },
    });

    if (!passed) {
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

    await this.recordAssessmentResult(attempt.assignmentId, passed);
    return attempt;
  }
}
