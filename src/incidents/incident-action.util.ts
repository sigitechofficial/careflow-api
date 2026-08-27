import { IncidentActionStatus, type IncidentAction } from '@prisma/client';

/**
 * Overdue is derived, never stored: an action is overdue when it is not yet
 * completed/cancelled and its due date has passed.
 */
export function isActionOverdue(
  action: Pick<IncidentAction, 'status' | 'dueDate'>,
  now: Date = new Date(),
): boolean {
  if (
    action.status === IncidentActionStatus.COMPLETED ||
    action.status === IncidentActionStatus.CANCELLED
  ) {
    return false;
  }
  return action.dueDate != null && action.dueDate.getTime() < now.getTime();
}

/** Display status folds the derived OVERDUE state over the stored status. */
export function effectiveActionStatus(
  action: Pick<IncidentAction, 'status' | 'dueDate'>,
  now: Date = new Date(),
): IncidentActionStatus | 'OVERDUE' {
  return isActionOverdue(action, now) ? 'OVERDUE' : action.status;
}

export const INCIDENT_ACTION_STATUS_LABELS: Record<
  IncidentActionStatus | 'OVERDUE',
  string
> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  OVERDUE: 'Overdue',
};

/** A mandatory action still counts as outstanding until completed or cancelled. */
export function isActionOutstanding(
  action: Pick<IncidentAction, 'status'>,
): boolean {
  return (
    action.status !== IncidentActionStatus.COMPLETED &&
    action.status !== IncidentActionStatus.CANCELLED
  );
}
