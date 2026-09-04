import { BadRequestException } from '@nestjs/common';
import { PolicyStatus } from '@prisma/client';

export const POLICY_IN_PROGRESS_STATUSES: PolicyStatus[] = [
  PolicyStatus.DRAFT,
  PolicyStatus.IN_REVIEW,
  PolicyStatus.APPROVED,
];

export const POLICY_IMMUTABLE_STATUSES: PolicyStatus[] = [
  PolicyStatus.IN_REVIEW,
  PolicyStatus.APPROVED,
  PolicyStatus.PUBLISHED,
  PolicyStatus.SUPERSEDED,
  PolicyStatus.ARCHIVED,
];

export type PolicyWorkflowAction =
  | 'submit'
  | 'request_changes'
  | 'approve'
  | 'publish'
  | 'archive'
  | 'supersede';

const TRANSITIONS: Record<PolicyWorkflowAction, { from: PolicyStatus; to: PolicyStatus }> = {
  submit: { from: PolicyStatus.DRAFT, to: PolicyStatus.IN_REVIEW },
  request_changes: { from: PolicyStatus.IN_REVIEW, to: PolicyStatus.DRAFT },
  approve: { from: PolicyStatus.IN_REVIEW, to: PolicyStatus.APPROVED },
  publish: { from: PolicyStatus.APPROVED, to: PolicyStatus.PUBLISHED },
  archive: { from: PolicyStatus.PUBLISHED, to: PolicyStatus.ARCHIVED },
  supersede: { from: PolicyStatus.PUBLISHED, to: PolicyStatus.SUPERSEDED },
};

export function isDraft(status: PolicyStatus): boolean {
  return status === PolicyStatus.DRAFT;
}

export function assertDraftEditable(status: PolicyStatus): void {
  if (status !== PolicyStatus.DRAFT) {
    throw new BadRequestException('Only DRAFT versions can be edited');
  }
}

export function assertImmutable(status: PolicyStatus, label = 'Version'): void {
  if (POLICY_IMMUTABLE_STATUSES.includes(status)) {
    throw new BadRequestException(`${label} is immutable (${status})`);
  }
}

export function nextStatus(from: PolicyStatus, action: PolicyWorkflowAction): PolicyStatus {
  const rule = TRANSITIONS[action];
  if (action === 'archive') {
    if (from === PolicyStatus.ARCHIVED) {
      throw new BadRequestException('Policy is already archived');
    }
    if (from === PolicyStatus.SUPERSEDED) {
      throw new BadRequestException('Superseded versions cannot be archived directly');
    }
    return PolicyStatus.ARCHIVED;
  }
  if (from !== rule.from) {
    throw new BadRequestException(
      `Invalid status transition: ${from} cannot ${action.replace('_', ' ')} (expected ${rule.from})`,
    );
  }
  return rule.to;
}

export function formatVersionLabel(major: number, minor: number): string {
  return `v${major}.${minor}`;
}

export function nextVersionNumbers(
  major: number,
  minor: number,
  bump: 'minor' | 'major',
): { versionMajor: number; versionMinor: number } {
  if (bump === 'major') {
    return { versionMajor: major + 1, versionMinor: 0 };
  }
  return { versionMajor: major, versionMinor: minor + 1 };
}
