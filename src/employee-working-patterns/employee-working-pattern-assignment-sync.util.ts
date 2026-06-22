import {
  AllocationStatus,
  Prisma,
  ScheduledVisitStatus,
  type PrismaClient,
} from '@prisma/client';
import {
  employmentToPatternContext,
  isEmployeeAvailableForVisit,
  type EmployeePatternContext,
} from '../service-user-visit-plans/visit-plan-carer-job-fit.util';
import { syncJobAllocationStatus } from '../service-user-visit-plans/visit-plan-slot-carer-sync.util';

const ACTIVE_ALLOCATION_STATUSES: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const SYNCABLE_VISIT_STATUSES: ScheduledVisitStatus[] = [
  ScheduledVisitStatus.PLANNED,
  ScheduledVisitStatus.NEEDS_ATTENTION,
];

function visitEndDateTime(start: Date, end: Date | null): Date {
  if (end && end.getTime() > start.getTime()) return end;
  return new Date(start.getTime() + 60 * 60 * 1000);
}

function assignmentSyncFromDateTime(fromDate?: Date): Date {
  const start = fromDate ? new Date(fromDate) : new Date();
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

type AllocationVisitRow = {
  id: string;
  scheduledJobId: string;
  scheduledStartDateTime: Date;
  scheduledEndDateTime: Date | null;
};

async function loadFutureAllocationsForEmployee(
  prisma: PrismaClient | Prisma.TransactionClient,
  employeeId: string,
  from: Date,
): Promise<Array<{ id: string; scheduledVisit: AllocationVisitRow | null }>> {
  return prisma.jobAllocation.findMany({
    where: {
      employeeId,
      deletedAt: null,
      isActive: true,
      status: { in: ACTIVE_ALLOCATION_STATUSES },
      scheduledVisit: {
        deletedAt: null,
        scheduledStartDateTime: { gte: from },
        status: { in: SYNCABLE_VISIT_STATUSES },
        scheduledJob: { deletedAt: null },
      },
    },
    select: {
      id: true,
      scheduledVisit: {
        select: {
          id: true,
          scheduledJobId: true,
          scheduledStartDateTime: true,
          scheduledEndDateTime: true,
        },
      },
    },
  });
}

function visitOutsidePattern(
  patternContext: EmployeePatternContext,
  visit: AllocationVisitRow,
): boolean {
  return !isEmployeeAvailableForVisit(
    patternContext.patterns,
    patternContext.cycleConfig,
    visit.scheduledStartDateTime,
    visitEndDateTime(visit.scheduledStartDateTime, visit.scheduledEndDateTime),
  );
}

export async function countScheduledVisitsToUnassignForPattern(
  prisma: PrismaClient | Prisma.TransactionClient,
  employeeId: string,
  patternContext: EmployeePatternContext,
  fromDateTime?: Date,
): Promise<number> {
  const from = assignmentSyncFromDateTime(fromDateTime);
  const allocations = await loadFutureAllocationsForEmployee(prisma, employeeId, from);
  let count = 0;
  for (const allocation of allocations) {
    const visit = allocation.scheduledVisit;
    if (!visit) continue;
    if (visitOutsidePattern(patternContext, visit)) count += 1;
  }
  return count;
}

export async function loadEmployeePatternContext(
  prisma: PrismaClient | Prisma.TransactionClient,
  employeeId: string,
): Promise<EmployeePatternContext | null> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    include: {
      personalDetail: true,
      employment: true,
      workingPatterns: { where: { deletedAt: null, isActive: true } },
    },
  });
  if (!employee) return null;
  return employmentToPatternContext(employee);
}

export async function syncEmployeeJobAllocationsAfterPatternChange(
  tx: Prisma.TransactionClient,
  params: {
    employeeId: string;
    userId: string;
    respectWorkingPattern: boolean;
    fromDateTime?: Date;
  },
): Promise<{ visitsUpdated: number; allocationsRemoved: number }> {
  if (!params.respectWorkingPattern) {
    return { visitsUpdated: 0, allocationsRemoved: 0 };
  }

  const patternContext = await loadEmployeePatternContext(tx, params.employeeId);
  if (!patternContext) return { visitsUpdated: 0, allocationsRemoved: 0 };

  const from = assignmentSyncFromDateTime(params.fromDateTime);
  const allocations = await loadFutureAllocationsForEmployee(tx, params.employeeId, from);

  let allocationsRemoved = 0;
  const touchedJobs = new Set<string>();

  for (const allocation of allocations) {
    const visit = allocation.scheduledVisit;
    if (!visit || !visitOutsidePattern(patternContext, visit)) continue;

    await tx.jobAllocation.update({
      where: { id: allocation.id },
      data: {
        status: AllocationStatus.UNALLOCATED,
        isActive: false,
        unallocatedAt: new Date(),
        unallocatedById: params.userId,
        unallocationReason: 'Working pattern updated — visit outside new availability',
      },
    });
    allocationsRemoved += 1;
    touchedJobs.add(visit.scheduledJobId);
  }

  for (const jobId of touchedJobs) {
    await syncJobAllocationStatus(tx, jobId, params.userId);
  }

  return { visitsUpdated: touchedJobs.size, allocationsRemoved };
}
