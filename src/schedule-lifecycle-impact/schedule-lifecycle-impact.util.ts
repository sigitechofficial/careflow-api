import {
  AllocationStatus,
  Prisma,
  ScheduledJobStatus as PrismaJobStatus,
  ScheduledVisitStatus as PrismaVisitStatus,
} from '@prisma/client';

/** Jobs that can be cancelled or have carers removed automatically. */
export const CANCELLABLE_JOB_STATUSES: PrismaJobStatus[] = [
  PrismaJobStatus.DRAFT,
  PrismaJobStatus.UNALLOCATED,
  PrismaJobStatus.ALLOCATED,
  PrismaJobStatus.NEEDS_ATTENTION,
];

export const ACTIVE_ALLOCATION_STATUSES: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

/** Cap open-ended absence impact to avoid unbounded scans. */
export const OPEN_ENDED_IMPACT_MAX_DAYS = 365;

export type ScheduleImpactResult = {
  jobsCancelled: number;
  jobsUnallocated: number;
  jobIds: string[];
  planSkipExceptionsAdded?: number;
};

export type JobImpactOutcome = 'CANCELLED' | 'CALLED_OFF';

export type ScheduleImpactSource =
  | 'service_user_absence'
  | 'visit_plan_suspend'
  | 'visit_plan_end'
  | 'employee_holiday'
  | 'employee_non_core_activity'
  | 'employee_inactive';

export function calendarDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0, 0));
}

export function resolveImpactEndDate(start: Date, end: Date | null | undefined): Date {
  if (end) {
    return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999));
  }
  const capped = new Date(start);
  capped.setUTCDate(capped.getUTCDate() + OPEN_ENDED_IMPACT_MAX_DAYS);
  capped.setUTCHours(23, 59, 59, 999);
  return capped;
}

export function jobScheduledTimeWhere(from: Date, to: Date): Prisma.DateTimeFilter {
  return { gte: from, lte: to };
}

export function buildCancellableServiceUserJobsWhere(
  serviceUserId: string,
  from: Date,
  to: Date,
): Prisma.ScheduledJobWhereInput {
  return {
    serviceUserId,
    deletedAt: null,
    isActive: true,
    status: { in: CANCELLABLE_JOB_STATUSES },
    scheduledStartDateTime: jobScheduledTimeWhere(from, to),
  };
}

export function buildUnallocateEmployeeJobsWhere(
  employeeId: string,
  from: Date,
  to: Date,
): Prisma.JobAllocationWhereInput {
  return {
    employeeId,
    deletedAt: null,
    isActive: true,
    status: { in: ACTIVE_ALLOCATION_STATUSES },
    scheduledJob: {
      deletedAt: null,
      isActive: true,
      status: { in: CANCELLABLE_JOB_STATUSES },
      scheduledStartDateTime: jobScheduledTimeWhere(from, to),
    },
  };
}

export function normalizeImpactStartDate(fromDate: Date): Date {
  return new Date(
    Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate(), 0, 0, 0, 0),
  );
}

export function datesOverlap(
  aStart: Date,
  aEnd: Date | null,
  bStart: Date,
  bEnd: Date,
): boolean {
  const startA = calendarDayUtc(aStart).getTime();
  const endA = (aEnd ? calendarDayUtc(aEnd) : calendarDayUtc(bEnd)).getTime();
  const startB = calendarDayUtc(bStart).getTime();
  const endB = calendarDayUtc(bEnd).getTime();
  return startA <= endB && endA >= startB;
}

/** Enterprise policy: planned/hospital absences cancel; unplanned short-notice are call-offs. */
export function resolveServiceUserAbsenceJobOutcome(
  absenceType: 'PLANNED' | 'UNPLANNED' | 'NOT_APPLICABLE',
  reasonName?: string | null,
): JobImpactOutcome {
  if (absenceType === 'UNPLANNED') return 'CALLED_OFF';
  const reason = reasonName?.trim() ?? '';
  if (/hospital|admit|inpatient|respite/i.test(reason)) return 'CANCELLED';
  if (absenceType === 'PLANNED') return 'CANCELLED';
  return 'CALLED_OFF';
}
