import { LearningProgressStatus } from '@prisma/client';
import {
  calculateContentProgressPercentage,
  courseNeedsSession,
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

  describe('classroom / virtual session (13 Nov 2026)', () => {
    const doneContent = {
      completedRequiredContentItems: 1,
      totalRequiredContentItems: 1,
      assessmentStatus: LearningProgressStatus.NOT_STARTED,
      practicalAssessmentStatus: LearningProgressStatus.NOT_STARTED,
      managerApprovalStatus: LearningProgressStatus.NOT_STARTED,
    };
    const noQuiz = { ...baseRequirements, requiresAssessment: false };

    it('only training courses delivered face to face, virtual or blended need a session', () => {
      expect(courseNeedsSession('COURSE', 'FACE_TO_FACE')).toBe(true);
      expect(courseNeedsSession('COURSE', 'VIRTUAL')).toBe(true);
      expect(courseNeedsSession('COURSE', 'BLENDED')).toBe(true);
      expect(courseNeedsSession('COURSE', 'ONLINE')).toBe(false);
      expect(courseNeedsSession('PRACTICAL_COMPETENCY', 'FACE_TO_FACE')).toBe(false);
      expect(courseNeedsSession('ASSESSMENT', 'ONLINE')).toBe(false);
    });

    it('is not finished until the carer attended', () => {
      expect(
        deriveCourseCompletionStatus(
          { ...noQuiz, requiresSession: true },
          { ...doneContent, sessionAttended: false },
        ),
      ).toBe(LearningProgressStatus.IN_PROGRESS);
    });

    it('attended with no required quiz finishes the course', () => {
      expect(
        isCourseFullyComplete(
          { ...noQuiz, requiresSession: true },
          { ...doneContent, sessionAttended: true },
        ),
      ).toBe(true);
    });

    it('attended but a required quiz is still open waits for the quiz', () => {
      expect(
        deriveCourseCompletionStatus(
          { ...baseRequirements, requiresSession: true },
          { ...doneContent, sessionAttended: true },
        ),
      ).toBe(LearningProgressStatus.AWAITING_ASSESSMENT);
    });

    it('online courses are unchanged', () => {
      expect(isCourseFullyComplete(noQuiz, doneContent)).toBe(true);
    });
  });
});
