import { LearningProgressStatus } from '@prisma/client';

export type CourseCompletionRequirements = {
  requiresAssessment: boolean;
  requiresPracticalAssessment: boolean;
  requiresManagerApproval: boolean;
};

export type ProgressSnapshot = {
  completedRequiredContentItems: number;
  totalRequiredContentItems: number;
  assessmentStatus: LearningProgressStatus;
  practicalAssessmentStatus: LearningProgressStatus;
  managerApprovalStatus: LearningProgressStatus;
};

export function calculateContentProgressPercentage(snapshot: ProgressSnapshot): number {
  const { completedRequiredContentItems, totalRequiredContentItems } = snapshot;
  if (totalRequiredContentItems <= 0) return 100;
  return Math.min(
    100,
    Math.round((completedRequiredContentItems / totalRequiredContentItems) * 100),
  );
}

export function isContentComplete(snapshot: ProgressSnapshot): boolean {
  if (snapshot.totalRequiredContentItems <= 0) return true;
  return snapshot.completedRequiredContentItems >= snapshot.totalRequiredContentItems;
}

export function isAssessmentComplete(
  requirements: Pick<CourseCompletionRequirements, 'requiresAssessment'>,
  assessmentStatus: LearningProgressStatus,
): boolean {
  if (!requirements.requiresAssessment) return true;
  return assessmentStatus === LearningProgressStatus.COMPLETED;
}

export function isPracticalComplete(
  requirements: Pick<CourseCompletionRequirements, 'requiresPracticalAssessment'>,
  practicalStatus: LearningProgressStatus,
): boolean {
  if (!requirements.requiresPracticalAssessment) return true;
  return practicalStatus === LearningProgressStatus.COMPLETED;
}

export function isManagerApprovalComplete(
  requirements: Pick<CourseCompletionRequirements, 'requiresManagerApproval'>,
  managerStatus: LearningProgressStatus,
): boolean {
  if (!requirements.requiresManagerApproval) return true;
  return managerStatus === LearningProgressStatus.COMPLETED;
}

export function deriveCourseCompletionStatus(
  requirements: CourseCompletionRequirements,
  snapshot: ProgressSnapshot,
): LearningProgressStatus {
  if (!isContentComplete(snapshot)) {
    return snapshot.completedRequiredContentItems > 0
      ? LearningProgressStatus.IN_PROGRESS
      : LearningProgressStatus.NOT_STARTED;
  }

  if (!isAssessmentComplete(requirements, snapshot.assessmentStatus)) {
    return snapshot.assessmentStatus === LearningProgressStatus.FAILED
      ? LearningProgressStatus.FAILED
      : LearningProgressStatus.AWAITING_ASSESSMENT;
  }

  if (!isPracticalComplete(requirements, snapshot.practicalAssessmentStatus)) {
    return LearningProgressStatus.IN_PROGRESS;
  }

  if (!isManagerApprovalComplete(requirements, snapshot.managerApprovalStatus)) {
    return LearningProgressStatus.AWAITING_APPROVAL;
  }

  return LearningProgressStatus.COMPLETED;
}

export function isCourseFullyComplete(
  requirements: CourseCompletionRequirements,
  snapshot: ProgressSnapshot,
): boolean {
  return deriveCourseCompletionStatus(requirements, snapshot) === LearningProgressStatus.COMPLETED;
}
