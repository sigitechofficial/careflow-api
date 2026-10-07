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

/** Measure types that change an existing record (or need a new one). */
const RECORD_MEASURE_TYPES = ['CARE_PLAN_UPDATE', 'RISK_ASSESSMENT_UPDATE', 'POLICY_UPDATE'];
/** Measure types about named staff. */
const STAFF_MEASURE_TYPES = ['COMPETENCY_CHECK', 'SUPERVISION'];
/** Measure types with nothing to link, so the description says what will change. */
const DESCRIBED_MEASURE_TYPES = ['VISIT_PLAN_CHANGE', 'OTHER'];

export type MeasureState = {
  measureType: string | null;
  assignedEmployeeId: string | null;
  dueDate: Date | string | null;
  linkedRecords: { id: string; label: string }[];
  newRecordNeeded: boolean;
  description: string | null;
};

/**
 * What a typed corrective measure still needs (SMART: who, by when, what it changes).
 * Measures without a type (added before types existed) are not checked.
 */
export function missingMeasureFields(m: MeasureState): string[] {
  if (!m.measureType) return [];
  const missing: string[] = [];
  if (!m.assignedEmployeeId) missing.push('responsible person');
  if (!m.dueDate) missing.push('due date');
  if (RECORD_MEASURE_TYPES.includes(m.measureType) && !m.linkedRecords.length && !m.newRecordNeeded) {
    missing.push('the record to update (or say a new one is needed)');
  }
  if (STAFF_MEASURE_TYPES.includes(m.measureType) && !m.linkedRecords.length) {
    missing.push('the staff member');
  }
  if (DESCRIBED_MEASURE_TYPES.includes(m.measureType) && !m.description?.trim()) {
    missing.push('a description of what will change');
  }
  return missing;
}

/**
 * Record-changing measures are completed by naming the record that was actually updated or
 * added (the evidence the change was made).
 */
export function needsCompletedRecord(measureType: string | null): boolean {
  return !!measureType && RECORD_MEASURE_TYPES.includes(measureType);
}

/** "New record needed" only applies to record-changing measures. */
export function canNeedNewRecord(measureType: string | null): boolean {
  return !!measureType && RECORD_MEASURE_TYPES.includes(measureType);
}
