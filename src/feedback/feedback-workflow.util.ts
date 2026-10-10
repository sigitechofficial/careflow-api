import type { FeedbackStatus, FeedbackType } from '@prisma/client';

/** Complaint handling targets (working days from when it was received). */
export const COMPLAINT_ACKNOWLEDGE_WORKING_DAYS = 3;
export const COMPLAINT_RESPONSE_WORKING_DAYS = 20;

export type FeedbackAction =
  | 'ACKNOWLEDGE'
  | 'START_INVESTIGATION'
  | 'RESPOND'
  | 'CLOSE'
  | 'REOPEN'
  | 'SHARE';

/** Adds Mon–Fri days, keeping the time of day (UTC calendar). */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d;
}

export function formatFeedbackReference(
  type: FeedbackType,
  year: number,
  sequence: number,
): string {
  const prefix = type === 'COMPLAINT' ? 'CMP' : 'CPL';
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
}

/** Statuses an action may start from, and where it leads. */
const COMPLAINT_TRANSITIONS: Record<
  Exclude<FeedbackAction, 'SHARE'>,
  { from: FeedbackStatus[]; to: FeedbackStatus }
> = {
  ACKNOWLEDGE: { from: ['RECEIVED'], to: 'ACKNOWLEDGED' },
  START_INVESTIGATION: {
    from: ['RECEIVED', 'ACKNOWLEDGED'],
    to: 'INVESTIGATING',
  },
  RESPOND: {
    from: ['RECEIVED', 'ACKNOWLEDGED', 'INVESTIGATING'],
    to: 'RESPONDED',
  },
  CLOSE: {
    from: ['RECEIVED', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESPONDED'],
    to: 'CLOSED',
  },
  REOPEN: { from: ['CLOSED', 'RESPONDED'], to: 'INVESTIGATING' },
};

const COMPLIMENT_TRANSITIONS: Partial<
  Record<FeedbackAction, { from: FeedbackStatus[]; to: FeedbackStatus }>
> = {
  SHARE: { from: ['RECEIVED'], to: 'CLOSED' },
  CLOSE: { from: ['RECEIVED'], to: 'CLOSED' },
  REOPEN: { from: ['CLOSED'], to: 'RECEIVED' },
};

/** Next status, or null when the action is not allowed from the current status. */
export function nextFeedbackStatus(
  type: FeedbackType,
  current: FeedbackStatus,
  action: FeedbackAction,
): FeedbackStatus | null {
  const rule =
    type === 'COMPLAINT'
      ? action === 'SHARE'
        ? undefined
        : COMPLAINT_TRANSITIONS[action]
      : COMPLIMENT_TRANSITIONS[action];
  if (!rule || !rule.from.includes(current)) return null;
  return rule.to;
}

/** Open complaint past its acknowledge or response target. */
export function complaintOverdue(
  row: {
    type: FeedbackType;
    status: FeedbackStatus;
    acknowledgeDueAt: Date | null;
    acknowledgedAt: Date | null;
    responseDueAt: Date | null;
    respondedAt: Date | null;
  },
  now: Date,
): { acknowledge: boolean; response: boolean } {
  if (row.type !== 'COMPLAINT' || row.status === 'CLOSED') {
    return { acknowledge: false, response: false };
  }
  return {
    acknowledge:
      !row.acknowledgedAt &&
      row.status === 'RECEIVED' &&
      Boolean(row.acknowledgeDueAt && row.acknowledgeDueAt < now),
    response:
      !row.respondedAt &&
      row.status !== 'RESPONDED' &&
      Boolean(row.responseDueAt && row.responseDueAt < now),
  };
}
