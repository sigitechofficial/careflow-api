import { createHash } from 'crypto';
import { ServiceUserCarePlanDraftApprovalStatus as ApprovalStatus } from '@prisma/client';

export type CarePlanApprovalAction =
  | 'submit'
  | 'approve'
  | 'request_changes'
  | 'publish';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** SHA-256 of the draft values (key order ignored): the exact content a manager reviewed. */
export function carePlanDraftContentHash(values: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(values ?? {})))
    .digest('hex');
}

/** Allowed approval moves for a working draft: DRAFT → PENDING_APPROVAL → APPROVED | DRAFT. */
const ALLOWED_FROM: Record<
  Exclude<CarePlanApprovalAction, 'publish'>,
  ApprovalStatus
> = {
  submit: ApprovalStatus.DRAFT,
  approve: ApprovalStatus.PENDING_APPROVAL,
  request_changes: ApprovalStatus.PENDING_APPROVAL,
};

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  DRAFT: 'a draft',
  PENDING_APPROVAL: 'awaiting approval',
  APPROVED: 'already approved',
};

/** Error message when `action` is not allowed from `status`, otherwise null. */
export function carePlanApprovalTransitionError(
  status: ApprovalStatus,
  action: CarePlanApprovalAction,
): string | null {
  if (action === 'publish') {
    return status === ApprovalStatus.APPROVED
      ? null
      : 'This care plan must be approved by a manager before it can be published';
  }
  if (status === ALLOWED_FROM[action]) return null;
  if (action === 'submit') {
    return status === ApprovalStatus.PENDING_APPROVAL
      ? 'This care plan has already been submitted for approval'
      : 'This care plan is already approved — publish it, or edit it to start a new review';
  }
  return `This care plan is ${STATUS_LABEL[status]}, not awaiting approval`;
}
