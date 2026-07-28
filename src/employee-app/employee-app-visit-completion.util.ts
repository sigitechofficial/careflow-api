import { ScheduledVisitStatus } from '../scheduled-visits/enums/scheduled-visit-status.enum';
import { VISIT_TIMING_EXCEPTION_REASONS } from '../scheduling/visit-timing-exception-reason.util';

/** Outcomes carers may set via `POST /employee-app/visits/:jobId/complete`. */
export const EMPLOYEE_APP_COMPLETION_STATUSES = [
  ScheduledVisitStatus.COMPLETED,
  ScheduledVisitStatus.PARTIALLY_COMPLETED,
  ScheduledVisitStatus.MISSED,
  ScheduledVisitStatus.NEEDS_ATTENTION,
] as const;

export type EmployeeAppCompletionStatus =
  (typeof EMPLOYEE_APP_COMPLETION_STATUSES)[number];

const ALLOWED = new Set<string>(EMPLOYEE_APP_COMPLETION_STATUSES);

export function isEmployeeAppCompletionStatus(
  value: string | null | undefined,
): value is EmployeeAppCompletionStatus {
  return Boolean(value && ALLOWED.has(value));
}

export type EmployeeAppCompletionOutcomeMeta = {
  status: EmployeeAppCompletionStatus;
  label: string;
  shortLabel: string;
  description: string;
  /** Actual start + end ISO times required (same as schedule-jobs Record visit). */
  requiresActualTimes: boolean;
  /** Notes strongly recommended for audit (required for NEEDS_ATTENTION). */
  requiresNotes: boolean;
};

export const EMPLOYEE_APP_COMPLETION_OUTCOMES: EmployeeAppCompletionOutcomeMeta[] = [
  {
    status: ScheduledVisitStatus.COMPLETED,
    label: 'Completed',
    shortLabel: 'Completed',
    description: 'Visit finished as planned / with recorded times',
    requiresActualTimes: true,
    requiresNotes: false,
  },
  {
    status: ScheduledVisitStatus.PARTIALLY_COMPLETED,
    label: 'Partially completed',
    shortLabel: 'Partial',
    description: 'Some care delivered but visit not fully completed',
    requiresActualTimes: true,
    requiresNotes: true,
  },
  {
    status: ScheduledVisitStatus.MISSED,
    label: 'Did not attend',
    shortLabel: 'Missed',
    description: 'Carer could not attend this visit',
    requiresActualTimes: false,
    requiresNotes: true,
  },
  {
    status: ScheduledVisitStatus.NEEDS_ATTENTION,
    label: 'Needs attention',
    shortLabel: 'Attention',
    description: 'Outcome needs office / clinical follow-up',
    requiresActualTimes: false,
    requiresNotes: true,
  },
];

export function employeeAppTimingExceptionReasons() {
  return VISIT_TIMING_EXCEPTION_REASONS.map((r) => ({
    code: r.code,
    label: r.label,
    description: r.description,
    requiresNotes: Boolean(r.requiresNotes),
  }));
}
