import {
  AllocationStatus,
  Prisma,
  ScheduledJobStatus as PrismaJobStatus,
  ScheduledVisitStatus as PrismaVisitStatus,
} from '@prisma/client';
import {
  addDaysToOperationalIso,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import { weekdayIndexInTimeZone } from '../scheduling/schedule-date-range.util';

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
  jobsRescheduled?: number;
  jobIds: string[];
  planSkipExceptionsAdded?: number;
  truncated?: boolean;
};

export type JobImpactOutcome = 'CANCELLED' | 'CALLED_OFF';

export type ScheduleImpactSource =
  | 'service_user_absence'
  | 'visit_plan_suspend'
  | 'visit_plan_end'
  | 'visit_plan_amendment'
  | 'visit_plan_activate'
  | 'visit_plan_skip_exception'
  | 'employee_holiday'
  | 'employee_non_core_activity'
  | 'employee_inactive'
  | 'employee_hours_reduced';

export const SCHEDULE_IMPACT_PREVIEW_MAX = 500;

export type ScopedJobFilter = {
  visitPlanSlotId?: string;
  visitPlanSlotIds?: string[];
  visitPlanIds?: string[];
  weekdays?: number[];
};

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
  scope?: ScopedJobFilter,
): Prisma.ScheduledJobWhereInput {
  const base: Prisma.ScheduledJobWhereInput = {
    serviceUserId,
    deletedAt: null,
    isActive: true,
    status: { in: CANCELLABLE_JOB_STATUSES },
    scheduledStartDateTime: jobScheduledTimeWhere(from, to),
  };

  if (!scope) return base;

  const visitClauses: Prisma.ScheduledVisitWhereInput[] = [];
  if (scope.visitPlanSlotId) {
    visitClauses.push({ visitPlanSlotId: scope.visitPlanSlotId });
  } else if (scope.visitPlanSlotIds?.length) {
    visitClauses.push({ visitPlanSlotId: { in: scope.visitPlanSlotIds } });
  }
  if (scope.visitPlanIds?.length) {
    visitClauses.push({ visitPlanSlot: { visitPlanId: { in: scope.visitPlanIds } } });
  }
  if (visitClauses.length) {
    base.visits = {
      some: {
        deletedAt: null,
        isActive: true,
        AND: visitClauses,
      },
    };
  }

  return base;
}

/**
 * Keep jobs whose start falls on one of `weekdays` (0=Sun … 6=Sat) — the weekday of the
 * true-UTC start instant read in the organisation timezone (a 23:30 London BST Monday visit
 * is 22:30Z Monday; a 00:30 London BST Tuesday visit is 23:30Z Monday but is a Tuesday visit).
 */
export function filterJobsByWeekdays<T extends { scheduledStartDateTime: Date }>(
  jobs: T[],
  weekdays: number[] | undefined,
  timeZone: string,
): T[] {
  if (!weekdays?.length) return jobs;
  const set = new Set(weekdays);
  return jobs.filter((j) => set.has(weekdayIndexInTimeZone(j.scheduledStartDateTime, timeZone)));
}

/** YYYY-MM-DD of a date-only impact boundary (UTC date part of a midnight/noon-UTC label). */
export function impactDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * True-UTC instant window for an impact range of calendar days.
 * `fromDate`/`toDate` are calendar labels (@db.Date / parseVisitPlanDateOnly / noon-UTC) —
 * NOT instants. The window spans organisation-local midnight on `fromDate` to the last
 * millisecond of `toDate` (or `fromDate` + OPEN_ENDED_IMPACT_MAX_DAYS) in `timeZone`.
 */
export function resolveImpactWindow(
  fromDate: Date,
  toDate: Date | null | undefined,
  timeZone: string,
): { from: Date; to: Date } {
  const fromKey = impactDayKey(fromDate);
  const toKey = toDate
    ? impactDayKey(toDate)
    : addDaysToOperationalIso(fromKey, OPEN_ENDED_IMPACT_MAX_DAYS);
  return {
    from: operationalDayBounds(fromKey, timeZone).start,
    to: operationalDayBounds(toKey, timeZone).end,
  };
}

export function buildUnallocateEmployeeJobsWhere(
  employeeId: string,
  from: Date,
  to: Date,
  /** Only these allocation rows. */
  allocationIds?: string[],
): Prisma.JobAllocationWhereInput {
  return {
    ...(allocationIds ? { id: { in: allocationIds } } : {}),
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
