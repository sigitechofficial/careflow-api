import { LearningProgressStatus } from '@prisma/client';
import {
  calculateContentProgressPercentage,
  deriveCourseCompletionStatus,
  isCourseFullyComplete,
} from './learning-completion.util';

const baseRequirements = {
  requiresAssessment: true,
  requiresPracticalAssessment: false,
  requiresManagerApproval: false,
};

describe('learning-completion.util', () => {
  it('calculates content progress percentage', () => {
    expect(
      calculateContentProgressPercentage({
        completedRequiredContentItems: 1,
        totalRequiredContentItems: 4,
        assessmentStatus: LearningProgressStatus.NOT_STARTED,
        practicalAssessmentStatus: LearningProgressStatus.NOT_STARTED,
        managerApprovalStatus: LearningProgressStatus.NOT_STARTED,
      }),
    ).toBe(25);
  });

  it('requires assessment when configured', () => {
    const status = deriveCourseCompletionStatus(baseRequirements, {
      completedRequiredContentItems: 2,
      totalRequiredContentItems: 2,
      assessmentStatus: LearningProgressStatus.NOT_STARTED,
      practicalAssessmentStatus: LearningProgressStatus.NOT_STARTED,
      managerApprovalStatus: LearningProgressStatus.NOT_STARTED,
    });
    expect(status).toBe(LearningProgressStatus.AWAITING_ASSESSMENT);
  });

  it('marks course complete when all gates pass', () => {
    const snapshot = {
      completedRequiredContentItems: 3,
      totalRequiredContentItems: 3,
      assessmentStatus: LearningProgressStatus.COMPLETED,
      practicalAssessmentStatus: LearningProgressStatus.NOT_STARTED,
      managerApprovalStatus: LearningProgressStatus.NOT_STARTED,
    };
    expect(isCourseFullyComplete(baseRequirements, snapshot)).toBe(true);
  });

  it('waits for manager approval when required', () => {
    const status = deriveCourseCompletionStatus(
      { ...baseRequirements, requiresAssessment: false, requiresManagerApproval: true },
      {
        completedRequiredContentItems: 1,
        totalRequiredContentItems: 1,
        assessmentStatus: LearningProgressStatus.NOT_STARTED,
        practicalAssessmentStatus: LearningProgressStatus.NOT_STARTED,
        managerApprovalStatus: LearningProgressStatus.IN_PROGRESS,
      },
    );
    expect(status).toBe(LearningProgressStatus.AWAITING_APPROVAL);
  });
});
