import { LearningProgressStatus } from '@prisma/client';

export type CourseCompletionRequirements = {
  requiresAssessment: boolean;
  requiresPracticalAssessment: boolean;
  requiresManagerApproval: boolean;
  /** Classroom / virtual part: the trainer must mark the carer Attended (agreed 13 Nov 2026). */
  requiresSession?: boolean;
};

export type ProgressSnapshot = {
  completedRequiredContentItems: number;
  totalRequiredContentItems: number;
  assessmentStatus: LearningProgressStatus;
  practicalAssessmentStatus: LearningProgressStatus;
  managerApprovalStatus: LearningProgressStatus;
  sessionAttended?: boolean;
};

/**
 * Face to face and workplace courses are only finished when a manager records the outcome
 * as Passed (user decision, 16 Nov 2026). Virtual courses are not included.
 */
export function courseNeedsManagerOutcome(
  deliveryMethod: string | null | undefined,
): boolean {
  return deliveryMethod === 'FACE_TO_FACE' || deliveryMethod === 'WORKPLACE';
}

/**
 * Face to face and workplace: the trainer / office marks the lessons, not the carer
 * (16 Nov 2026; workplace added 17 Nov 2026).
 */
export function trainerMarksLessons(deliveryMethod: string | null | undefined): boolean {
  return deliveryMethod === 'FACE_TO_FACE' || deliveryMethod === 'WORKPLACE';
}

/**
 * A training course delivered face to face, virtually or blended has a session the carer
 * must attend. Practical competencies are signed off by an assessor instead.
 */
export function courseNeedsSession(
  courseType: string | null | undefined,
  deliveryMethod: string | null | undefined,
): boolean {
  return (
    courseType === 'COURSE' &&
    (deliveryMethod === 'FACE_TO_FACE' ||
      deliveryMethod === 'VIRTUAL' ||
      deliveryMethod === 'BLENDED')
  );
}

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

  if (requirements.requiresSession && !snapshot.sessionAttended) {
    return LearningProgressStatus.IN_PROGRESS;
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
