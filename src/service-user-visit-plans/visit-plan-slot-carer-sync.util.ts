import {
  AllocationStatus,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
} from '@prisma/client';
import {
  employmentToPatternContext,
  isEmployeeAvailableForVisit,
  type EmployeePatternContext,
} from './visit-plan-carer-job-fit.util';

type VisitPlanSlotCarerSyncParams = {
  scheduledJobId: string;
  employeeId: string;
  scheduledVisitId?: string | null;
};

const ACTIVE_ALLOCATION_STATUSES: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const SYNCABLE_VISIT_STATUSES: ScheduledVisitStatus[] = [
  ScheduledVisitStatus.PLANNED,
  ScheduledVisitStatus.NEEDS_ATTENTION,
];

async function syncJobAllocationStatus(
  tx: Prisma.TransactionClient,
  scheduledJobId: string,
  userId: string,
): Promise<ScheduledJobStatus> {
  const job = await tx.scheduledJob.findUnique({ where: { id: scheduledJobId } });
  if (!job) return ScheduledJobStatus.UNALLOCATED;

  const count = await tx.jobAllocation.count({
    where: {
      scheduledJobId,
      deletedAt: null,
      isActive: true,
      status: { in: ACTIVE_ALLOCATION_STATUSES },
    },
  });

  let next: ScheduledJobStatus;
  if (count >= job.requiredCarers) {
    next = ScheduledJobStatus.ALLOCATED;
  } else if (count > 0) {
    next = ScheduledJobStatus.NEEDS_ATTENTION;
  } else {
    next = ScheduledJobStatus.UNALLOCATED;
  }

  if (next !== job.status) {
    await tx.scheduledJob.update({
      where: { id: scheduledJobId },
      data: { status: next, updatedById: userId },
    });
  }

  if (next === ScheduledJobStatus.NEEDS_ATTENTION) {
    await tx.scheduledVisit.updateMany({
      where: {
        scheduledJobId,
        deletedAt: null,
        status: { in: [ScheduledVisitStatus.PLANNED, ScheduledVisitStatus.NEEDS_ATTENTION] },
      },
      data: { status: ScheduledVisitStatus.NEEDS_ATTENTION },
    });
  } else if (next === ScheduledJobStatus.ALLOCATED) {
    await tx.scheduledVisit.updateMany({
      where: {
        scheduledJobId,
        deletedAt: null,
        status: ScheduledVisitStatus.NEEDS_ATTENTION,
      },
      data: { status: ScheduledVisitStatus.PLANNED },
    });
  }

  return next;
}

export type SyncVisitPlanSlotCarersParams = {
  visitPlanSlotId: string;
  assignedEmployeeIds: string[];
  requiredCarers: number;
  userId: string;
  scheduledVisitId?: string;
  /** Lower bound for bulk sync; ignored when `scheduledVisitId` is set. Defaults to start of today (UTC). */
  fromDateTime?: Date;
  /** When true (default), skip allocating carers on visits outside their working pattern. */
  respectWorkingPattern?: boolean;
};

export async function loadEmployeePatternContexts(
  tx: Prisma.TransactionClient,
  employeeIds: string[],
): Promise<Map<string, EmployeePatternContext>> {
  const uniqueIds = [...new Set(employeeIds.filter((id) => id.trim()))];
  if (!uniqueIds.length) return new Map();

  const employees = await tx.employee.findMany({
    where: { id: { in: uniqueIds }, deletedAt: null },
    include: {
      personalDetail: true,
      employment: true,
      workingPatterns: { where: { deletedAt: null, isActive: true } },
    },
  });

  return new Map(employees.map((row) => [row.id, employmentToPatternContext(row)]));
}

function visitEndDateTime(start: Date, end: Date | null): Date {
  if (end && end.getTime() > start.getTime()) return end;
  return new Date(start.getTime() + 60 * 60 * 1000);
}

export function targetEmployeeIdsForVisit(
  desired: string[],
  visit: { requiredCarers: number | null; scheduledStartDateTime: Date; scheduledEndDateTime: Date | null },
  required: number,
  respectWorkingPattern: boolean,
  patternByEmployee: Map<string, EmployeePatternContext>,
): string[] {
  const cap = Math.max(1, visit.requiredCarers || required);
  if (!respectWorkingPattern) {
    return desired.slice(0, cap);
  }

  const visitStart = visit.scheduledStartDateTime;
  const visitEnd = visitEndDateTime(visitStart, visit.scheduledEndDateTime);
  const filtered = desired.filter((employeeId) => {
    const ctx = patternByEmployee.get(employeeId);
    if (!ctx) return true;
    return isEmployeeAvailableForVisit(ctx.patterns, ctx.cycleConfig, visitStart, visitEnd);
  });
  return filtered.slice(0, cap);
}

export function countVisitsSkippedIfRespecting(
  visits: Array<{
    scheduledStartDateTime: Date;
    scheduledEndDateTime: Date | null;
    requiredCarers: number | null;
  }>,
  assignedEmployeeIds: string[],
  requiredCarers: number,
  patternByEmployee: Map<string, EmployeePatternContext>,
): number {
  const required = Math.max(1, requiredCarers);
  const desired = (assignedEmployeeIds ?? []).slice(0, required);
  let skipped = 0;
  for (const visit of visits) {
    const cap = Math.max(1, visit.requiredCarers || required);
    const target = targetEmployeeIdsForVisit(desired, visit, required, true, patternByEmployee);
    if (target.length < cap) skipped += 1;
  }
  return skipped;
}

export function visitPlanCarerEmployeeIds(
  carerWindows: Array<{ employeeId: string }>,
  assignedEmployeeIds: string[],
  requiredCarers: number,
): string[] {
  const fromWindows = carerWindows
    .map((c) => c.employeeId?.trim())
    .filter((id): id is string => Boolean(id));
  if (fromWindows.length) {
    return fromWindows.slice(0, Math.max(1, requiredCarers));
  }
  return (assignedEmployeeIds ?? [])
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id))
    .slice(0, Math.max(1, requiredCarers));
}

export function visitPlanCarerSyncFromDateTime(fromDate?: string): Date {
  if (fromDate) {
    const parsed = new Date(`${fromDate}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/** Push visit-plan slot carer defaults onto matching scheduled jobs. */
export async function syncVisitPlanSlotCarersToScheduledJobs(
  tx: Prisma.TransactionClient,
  params: SyncVisitPlanSlotCarersParams,
): Promise<{ jobsUpdated: number }> {
  const from = params.fromDateTime ?? visitPlanCarerSyncFromDateTime();
  const required = Math.max(1, params.requiredCarers);
  const desired = (params.assignedEmployeeIds ?? []).slice(0, required);
  const respectWorkingPattern = params.respectWorkingPattern !== false;

  const patternByEmployee = respectWorkingPattern
    ? await loadEmployeePatternContexts(tx, desired)
    : new Map<string, EmployeePatternContext>();

  const visits = await tx.scheduledVisit.findMany({
    where: {
      visitPlanSlotId: params.visitPlanSlotId,
      deletedAt: null,
      ...(params.scheduledVisitId
        ? { id: params.scheduledVisitId }
        : { scheduledStartDateTime: { gte: from } }),
      status: { in: SYNCABLE_VISIT_STATUSES },
      scheduledJob: { deletedAt: null },
    },
    select: {
      id: true,
      scheduledJobId: true,
      requiredCarers: true,
      scheduledStartDateTime: true,
      scheduledEndDateTime: true,
    },
  });

  let jobsUpdated = 0;

  for (const visit of visits) {
    const jobId = visit.scheduledJobId;
    const target = targetEmployeeIdsForVisit(
      desired,
      visit,
      required,
      respectWorkingPattern,
      patternByEmployee,
    );

    const activeAllocations = await tx.jobAllocation.findMany({
      where: {
        scheduledJobId: jobId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION_STATUSES },
      },
      select: { id: true, employeeId: true },
    });

    const currentIds = new Set(activeAllocations.map((row) => row.employeeId));
    const targetIds = new Set(target);
    const toRemove = activeAllocations.filter((row) => !targetIds.has(row.employeeId));
    const toAdd = target.filter((employeeId) => !currentIds.has(employeeId));

    if (toRemove.length === 0 && toAdd.length === 0) continue;

    for (const allocation of toRemove) {
      await tx.jobAllocation.update({
        where: { id: allocation.id },
        data: {
          status: AllocationStatus.UNALLOCATED,
          isActive: false,
          unallocatedAt: new Date(),
          unallocatedById: params.userId,
          unallocationReason: 'Synced from visit plan call pattern',
        },
      });
    }

    for (const employeeId of toAdd) {
      await tx.jobAllocation.create({
        data: {
          scheduledJobId: jobId,
          scheduledVisitId: visit.id,
          employeeId,
          status: AllocationStatus.CONFIRMED,
          requiresConfirmation: false,
          allocatedById: params.userId,
          confirmedAt: new Date(),
          confirmedById: params.userId,
        },
      });
    }

    await syncJobAllocationStatus(tx, jobId, params.userId);
    jobsUpdated += 1;
  }

  return { jobsUpdated };
}

async function linkedVisitPlanSlotIds(
  tx: Prisma.TransactionClient,
  { scheduledJobId, scheduledVisitId }: Pick<VisitPlanSlotCarerSyncParams, 'scheduledJobId' | 'scheduledVisitId'>,
): Promise<string[]> {
  const visits = await tx.scheduledVisit.findMany({
    where: {
      scheduledJobId,
      deletedAt: null,
      visitPlanSlotId: { not: null },
      ...(scheduledVisitId ? { id: scheduledVisitId } : {}),
    },
    select: { visitPlanSlotId: true },
  });

  const ids = visits
    .map((visit) => visit.visitPlanSlotId)
    .filter((id): id is string => Boolean(id));

  return [...new Set(ids)];
}

export async function removeCarerFromLinkedVisitPlanSlots(
  tx: Prisma.TransactionClient,
  params: VisitPlanSlotCarerSyncParams,
): Promise<void> {
  const slotIds = await linkedVisitPlanSlotIds(tx, params);

  for (const slotId of slotIds) {
    const slot = await tx.visitPlanSlot.findUnique({
      where: { id: slotId },
      select: { assignedEmployeeIds: true },
    });
    if (!slot) continue;

    const current = slot.assignedEmployeeIds ?? [];
    if (!current.includes(params.employeeId)) continue;

    await tx.visitPlanSlot.update({
      where: { id: slotId },
      data: { assignedEmployeeIds: current.filter((id) => id !== params.employeeId) },
    });
  }
}

export async function addCarerToLinkedVisitPlanSlots(
  tx: Prisma.TransactionClient,
  params: VisitPlanSlotCarerSyncParams,
): Promise<void> {
  const slotIds = await linkedVisitPlanSlotIds(tx, params);

  for (const slotId of slotIds) {
    const slot = await tx.visitPlanSlot.findUnique({
      where: { id: slotId },
      select: { assignedEmployeeIds: true, requiredCarers: true },
    });
    if (!slot) continue;

    const current = slot.assignedEmployeeIds ?? [];
    if (current.includes(params.employeeId)) continue;

    const required = Math.max(1, slot.requiredCarers);
    const next =
      required === 1
        ? [params.employeeId]
        : [...current, params.employeeId].slice(0, required);

    await tx.visitPlanSlot.update({
      where: { id: slotId },
      data: { assignedEmployeeIds: next },
    });
  }
}
