import { AllocationStatus, Prisma } from '@prisma/client';

export const CARER_ROTA_CONFLICT_MESSAGE =
  'Carer has already a visit, please use another slot';

const ACTIVE_ALLOCATION_STATUSES: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

type RotaConflictDb = {
  jobAllocation: {
    findMany: Prisma.TransactionClient['jobAllocation']['findMany'];
  };
};

export function visitWindowFromSchedule(
  scheduledStartDateTime: Date,
  scheduledEndDateTime: Date | null,
): { jobStart: Date; jobEnd: Date } {
  const jobStart = scheduledStartDateTime;
  let jobEnd = scheduledEndDateTime;
  if (!jobEnd || jobEnd.getTime() <= jobStart.getTime()) {
    jobEnd = new Date(jobStart.getTime() + 60 * 60 * 1000);
  }
  return { jobStart, jobEnd };
}

export async function findRotaConflictsByEmployee(
  db: RotaConflictDb,
  employeeIds: string[],
  jobStart: Date,
  jobEnd: Date,
  excludeScheduledJobId?: string,
): Promise<Map<string, string[]>> {
  const conflicts = new Map<string, string[]>();
  const uniqueIds = [...new Set(employeeIds.filter((id) => id.trim()))];
  if (!uniqueIds.length) return conflicts;

  const rows = await db.jobAllocation.findMany({
    where: {
      employeeId: { in: uniqueIds },
      deletedAt: null,
      isActive: true,
      status: { in: ACTIVE_ALLOCATION_STATUSES },
      ...(excludeScheduledJobId ? { scheduledJobId: { not: excludeScheduledJobId } } : {}),
      scheduledJob: {
        deletedAt: null,
        isActive: true,
        AND: [
          { scheduledStartDateTime: { lt: jobEnd } },
          {
            OR: [{ scheduledEndDateTime: { gt: jobStart } }, { scheduledEndDateTime: null }],
          },
        ],
      },
    },
    select: {
      employeeId: true,
      scheduledJob: { select: { jobName: true } },
    },
    take: 500,
  });

  for (const row of rows) {
    const jobName = row.scheduledJob.jobName;
    const list = conflicts.get(row.employeeId) ?? [];
    if (!list.includes(jobName)) list.push(jobName);
    conflicts.set(row.employeeId, list);
  }

  return conflicts;
}

export function formatCarerRotaConflictWarning(
  employeeName: string,
  conflictingJobNames: string[] = [],
): string {
  if (!conflictingJobNames.length) {
    return `${employeeName}: ${CARER_ROTA_CONFLICT_MESSAGE}`;
  }
  return `${employeeName}: ${CARER_ROTA_CONFLICT_MESSAGE} (${conflictingJobNames.join(', ')})`;
}

export function filterEmployeeIdsWithoutRotaConflict(
  employeeIds: string[],
  conflictsByEmployee: Map<string, string[]>,
  employeeNameById: Map<string, string>,
): { employeeIds: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const allowed: string[] = [];

  for (const employeeId of employeeIds) {
    const conflictingJobs = conflictsByEmployee.get(employeeId);
    if (conflictingJobs?.length) {
      const name = employeeNameById.get(employeeId) ?? employeeId;
      warnings.push(formatCarerRotaConflictWarning(name, conflictingJobs));
      continue;
    }
    allowed.push(employeeId);
  }

  return { employeeIds: allowed, warnings };
}
