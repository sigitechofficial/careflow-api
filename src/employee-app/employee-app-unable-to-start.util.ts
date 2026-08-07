import {
  VISIT_CARE_NOT_DELIVERED_REASONS,
  isVisitCareNotDeliveredReasonCode,
  visitCareNotDeliveredReasonLabel,
  type VisitCareNotDeliveredReasonCode,
} from '../scheduling/visit-care-not-delivered-reason.util';

export type EmployeeAppUnableToStartReason = {
  code: VisitCareNotDeliveredReasonCode;
  label: string;
  description: string;
  notesRequired: boolean;
};

/** Server-driven reasons for POST /employee-app/visits/{jobId}/unable-to-start */
export function employeeAppUnableToStartReasons(): EmployeeAppUnableToStartReason[] {
  return VISIT_CARE_NOT_DELIVERED_REASONS.map((r) => ({
    code: r.code,
    label: r.label,
    description: r.description,
    notesRequired: Boolean(r.requiresNotes),
  }));
}

export function isEmployeeAppUnableToStartReasonCode(
  value: string | null | undefined,
): value is VisitCareNotDeliveredReasonCode {
  return isVisitCareNotDeliveredReasonCode(value);
}

export function employeeAppUnableToStartReasonLabel(
  code: string | null | undefined,
): string | null {
  return visitCareNotDeliveredReasonLabel(code);
}

export type UnableToStartSummary = {
  reasonCode: string;
  reasonLabel: string;
  notes: string | null;
  recordedAt: string;
  attemptedAt?: string | null;
  auditRecordId?: string | null;
};

export function buildUnableToStartBlock(input: {
  isCheckedIn: boolean;
  visitClosed: boolean;
  existing: UnableToStartSummary | null;
}): {
  canReport: boolean;
  alreadyReported: boolean;
  summary: UnableToStartSummary | null;
  reasons: EmployeeAppUnableToStartReason[];
} {
  const alreadyReported = Boolean(input.existing);
  const canReport = input.isCheckedIn && !input.visitClosed && !alreadyReported;
  return {
    canReport,
    alreadyReported,
    summary: input.existing,
    reasons: employeeAppUnableToStartReasons(),
  };
}
