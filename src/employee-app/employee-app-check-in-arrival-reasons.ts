/**
 * Check-in early/late arrival reason catalogues for employee-app visit details.
 * Codes are sent back on POST check-in as `timingExceptionReasonCode`.
 * Distinct from clock-out / complete timing exception reasons.
 */

export type EmployeeAppArrivalReasonOption = {
  code: string;
  label: string;
  requiresNotes?: boolean;
  enabled?: boolean;
  sortOrder?: number;
};

/** Stable codes accepted on POST /employee-app/visits/{jobId}/check-in */
export const EMPLOYEE_APP_CHECK_IN_ARRIVAL_REASON_CODES = [
  'PREVIOUS_VISIT_OVERRAN',
  'TRAVEL_OR_TRAFFIC',
  'CLIENT_REQUESTED_EARLIER',
  'EMERGENCY',
  'SCHEDULING_CHANGE',
  'OTHER',
] as const;

export type EmployeeAppCheckInArrivalReasonCode =
  (typeof EMPLOYEE_APP_CHECK_IN_ARRIVAL_REASON_CODES)[number];

const CHECK_IN_CODE_SET = new Set<string>(EMPLOYEE_APP_CHECK_IN_ARRIVAL_REASON_CODES);

export function isEmployeeAppCheckInArrivalReasonCode(
  value: string | null | undefined,
): value is EmployeeAppCheckInArrivalReasonCode {
  return Boolean(value && CHECK_IN_CODE_SET.has(value));
}

/** Shown when timingStatus would be "early". */
export const EMPLOYEE_APP_EARLY_ARRIVAL_REASONS: EmployeeAppArrivalReasonOption[] = [
  {
    code: 'CLIENT_REQUESTED_EARLIER',
    label: 'Client requested earlier arrival',
    requiresNotes: false,
    enabled: true,
    sortOrder: 10,
  },
  {
    code: 'SCHEDULING_CHANGE',
    label: 'Scheduling change',
    requiresNotes: false,
    enabled: true,
    sortOrder: 20,
  },
  {
    code: 'EMERGENCY',
    label: 'Emergency',
    requiresNotes: false,
    enabled: true,
    sortOrder: 30,
  },
  {
    code: 'OTHER',
    label: 'Other',
    requiresNotes: true,
    enabled: true,
    sortOrder: 99,
  },
];

/** Shown when timingStatus would be "late". */
export const EMPLOYEE_APP_LATE_ARRIVAL_REASONS: EmployeeAppArrivalReasonOption[] = [
  {
    code: 'PREVIOUS_VISIT_OVERRAN',
    label: 'Previous visit overran',
    requiresNotes: false,
    enabled: true,
    sortOrder: 10,
  },
  {
    code: 'TRAVEL_OR_TRAFFIC',
    label: 'Traffic or travel delay',
    requiresNotes: false,
    enabled: true,
    sortOrder: 20,
  },
  {
    code: 'EMERGENCY',
    label: 'Emergency',
    requiresNotes: false,
    enabled: true,
    sortOrder: 30,
  },
  {
    code: 'SCHEDULING_CHANGE',
    label: 'Scheduling change',
    requiresNotes: false,
    enabled: true,
    sortOrder: 40,
  },
  {
    code: 'OTHER',
    label: 'Other',
    requiresNotes: true,
    enabled: true,
    sortOrder: 99,
  },
];

function sortEnabledReasons(
  reasons: EmployeeAppArrivalReasonOption[],
): EmployeeAppArrivalReasonOption[] {
  return [...reasons]
    .filter((r) => r.enabled !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function employeeAppEarlyArrivalReasons(): EmployeeAppArrivalReasonOption[] {
  return sortEnabledReasons(EMPLOYEE_APP_EARLY_ARRIVAL_REASONS);
}

export function employeeAppLateArrivalReasons(): EmployeeAppArrivalReasonOption[] {
  return sortEnabledReasons(EMPLOYEE_APP_LATE_ARRIVAL_REASONS);
}
