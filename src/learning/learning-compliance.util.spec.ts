import { LearningAssignmentStatus, LearningComplianceStatus } from '@prisma/client';
import { deriveComplianceStatus } from './learning-compliance.util';

describe('learning-compliance.util', () => {
  const now = new Date('2026-07-27T12:00:00.000Z');

  it('returns OVERDUE when due date passed and incomplete', () => {
    expect(
      deriveComplianceStatus({
        assignmentStatus: LearningAssignmentStatus.IN_PROGRESS,
        dueAt: new Date('2026-07-20T00:00:00.000Z'),
        now,
      }),
    ).toBe(LearningComplianceStatus.OVERDUE);
  });

  it('returns EXPIRING_SOON for compliant records nearing expiry', () => {
    expect(
      deriveComplianceStatus({
        assignmentStatus: LearningAssignmentStatus.COMPLETED,
        progressComplete: true,
        expiresAt: new Date('2026-08-10T00:00:00.000Z'),
        expiryWarningDays: 30,
        now,
      }),
    ).toBe(LearningComplianceStatus.EXPIRING_SOON);
  });

  it('returns EXPIRED when expiry date passed', () => {
    expect(
      deriveComplianceStatus({
        assignmentStatus: LearningAssignmentStatus.COMPLETED,
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
        now,
      }),
    ).toBe(LearningComplianceStatus.EXPIRED);
  });

  it('returns EXEMPT when flagged', () => {
    expect(
      deriveComplianceStatus({
        isExempt: true,
        assignmentStatus: LearningAssignmentStatus.ASSIGNED,
        now,
      }),
    ).toBe(LearningComplianceStatus.EXEMPT);
  });
});
