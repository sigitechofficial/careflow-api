import { ScheduledJobStatus as PrismaJobStatus, ScheduledVisitStatus } from '@prisma/client';
import { ScheduledJobStatus } from '../scheduled-jobs/enums/scheduled-job-status.enum';

/** Derive job status from active visits (simple Phase 2 rules). */
export function deriveJobStatusFromVisits(
  visits: { status: ScheduledVisitStatus }[],
  fallback: PrismaJobStatus = PrismaJobStatus.UNALLOCATED,
): PrismaJobStatus {
  if (!visits.length) return fallback;

  const statuses = visits.map((v) => v.status);
  if (statuses.every((s) => s === ScheduledVisitStatus.COMPLETED)) {
    return PrismaJobStatus.COMPLETED;
  }
  if (statuses.some((s) => s === ScheduledVisitStatus.NEEDS_ATTENTION)) {
    return PrismaJobStatus.NEEDS_ATTENTION;
  }
  if (statuses.some((s) => s === ScheduledVisitStatus.PARTIALLY_COMPLETED)) {
    return PrismaJobStatus.PARTIALLY_COMPLETED;
  }
  if (statuses.some((s) => s === ScheduledVisitStatus.STARTED)) {
    return PrismaJobStatus.IN_PROGRESS;
  }
  if (statuses.some((s) => s === ScheduledVisitStatus.MISSED)) {
    return PrismaJobStatus.MISSED;
  }
  if (statuses.some((s) => s === ScheduledVisitStatus.CANCELLED) && statuses.every(
    (s) => s === ScheduledVisitStatus.CANCELLED || s === ScheduledVisitStatus.COMPLETED,
  )) {
    return PrismaJobStatus.CANCELLED;
  }
  if (statuses.some((s) => s === ScheduledVisitStatus.CALLED_OFF)) {
    return PrismaJobStatus.CALLED_OFF;
  }
  if (statuses.every((s) => s === ScheduledVisitStatus.PLANNED)) {
    return PrismaJobStatus.UNALLOCATED;
  }
  return fallback;
}

/** Map a single visit outcome to job status while preserving allocation state for planned visits. */
export function mapSingleVisitStatusToJobStatus(
  visitStatus: ScheduledVisitStatus,
  fallback: PrismaJobStatus = PrismaJobStatus.UNALLOCATED,
): PrismaJobStatus {
  switch (visitStatus) {
    case ScheduledVisitStatus.PLANNED:
      return fallback;
    case ScheduledVisitStatus.STARTED:
      return PrismaJobStatus.IN_PROGRESS;
    case ScheduledVisitStatus.COMPLETED:
      return PrismaJobStatus.COMPLETED;
    case ScheduledVisitStatus.PARTIALLY_COMPLETED:
      return PrismaJobStatus.PARTIALLY_COMPLETED;
    case ScheduledVisitStatus.MISSED:
      return PrismaJobStatus.MISSED;
    case ScheduledVisitStatus.CANCELLED:
      return PrismaJobStatus.CANCELLED;
    case ScheduledVisitStatus.CALLED_OFF:
      return PrismaJobStatus.CALLED_OFF;
    case ScheduledVisitStatus.NEEDS_ATTENTION:
      return PrismaJobStatus.NEEDS_ATTENTION;
    default:
      return fallback;
  }
}

export { ScheduledJobStatus };
