import { LearningAssignmentStatus, LearningComplianceStatus } from '@prisma/client';

export type ComplianceInput = {
  assignmentStatus?: LearningAssignmentStatus | null;
  progressComplete?: boolean;
  dueAt?: Date | null;
  expiresAt?: Date | null;
  isExempt?: boolean;
  hasExternalEvidence?: boolean;
  now?: Date;
  expiryWarningDays?: number;
};

export function deriveComplianceStatus(input: ComplianceInput): LearningComplianceStatus {
  const now = input.now ?? new Date();
  const warningDays = input.expiryWarningDays ?? 30;

  if (input.isExempt) return LearningComplianceStatus.EXEMPT;
  if (input.hasExternalEvidence) return LearningComplianceStatus.EXTERNAL_EVIDENCE;

  if (!input.assignmentStatus) return LearningComplianceStatus.NOT_ASSIGNED;

  if (input.assignmentStatus === LearningAssignmentStatus.EXEMPT) {
    return LearningComplianceStatus.EXEMPT;
  }

  if (input.assignmentStatus === LearningAssignmentStatus.CANCELLED) {
    return LearningComplianceStatus.NOT_ASSIGNED;
  }

  if (input.expiresAt && input.expiresAt.getTime() < now.getTime()) {
    return LearningComplianceStatus.EXPIRED;
  }

  if (
    input.dueAt &&
    input.dueAt.getTime() < now.getTime() &&
    !input.progressComplete &&
    input.assignmentStatus !== LearningAssignmentStatus.COMPLETED &&
    input.assignmentStatus !== LearningAssignmentStatus.PASSED
  ) {
    return LearningComplianceStatus.OVERDUE;
  }

  if (input.progressComplete || input.assignmentStatus === LearningAssignmentStatus.COMPLETED || input.assignmentStatus === LearningAssignmentStatus.PASSED) {
    if (input.expiresAt) {
      const warningMs = warningDays * 86_400_000;
      if (input.expiresAt.getTime() - now.getTime() <= warningMs) {
        return LearningComplianceStatus.EXPIRING_SOON;
      }
    }
    return LearningComplianceStatus.COMPLIANT;
  }

  if (input.assignmentStatus === LearningAssignmentStatus.OVERDUE) {
    return LearningComplianceStatus.OVERDUE;
  }

  if (input.assignmentStatus === LearningAssignmentStatus.AWAITING_ASSESSMENT) {
    return LearningComplianceStatus.AWAITING_ASSESSMENT;
  }

  if (
    input.assignmentStatus === LearningAssignmentStatus.IN_PROGRESS ||
    input.assignmentStatus === LearningAssignmentStatus.AWAITING_APPROVAL
  ) {
    return LearningComplianceStatus.IN_PROGRESS;
  }

  if (input.assignmentStatus === LearningAssignmentStatus.NOT_STARTED) {
    return LearningComplianceStatus.NOT_STARTED;
  }

  if (input.expiresAt) {
    const warningMs = warningDays * 86_400_000;
    if (input.expiresAt.getTime() - now.getTime() <= warningMs && input.expiresAt.getTime() >= now.getTime()) {
      return LearningComplianceStatus.EXPIRING_SOON;
    }
  }

  return LearningComplianceStatus.ASSIGNED;
}
