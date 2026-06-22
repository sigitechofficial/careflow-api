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
import {
  resolvePatternForDateTime,
  type WorkingPatternRow,
} from '../employee-working-patterns/working-pattern-cycle.util';
import {
  hmFromJobDate,
  visitPatternTimeMismatch,
  formatVisitPatternTimeMismatchMessage,
} from '../employee-working-patterns/working-pattern-time.util';
import {
  findRotaConflictsByEmployee,
  filterEmployeeIdsWithoutRotaConflict,
  visitWindowFromSchedule,
  CARER_ROTA_CONFLICT_MESSAGE,
} from './visit-carer-rota-conflict.util';
import { DAY_LABEL, type CarerPatternRow } from './visit-plan-carer-suggest.util';

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

export async function syncJobAllocationStatus(
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
  /** When true (default), only assign carers on days/times that match their working pattern. */
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

function toWorkingPatternRows(patterns: CarerPatternRow[]): WorkingPatternRow[] {
  return patterns.map((p) => ({
    weekInCycle: p.weekInCycle ?? 1,
    dayOfWeek: p.dayOfWeek,
    startTime: p.startTime,
    endTime: p.endTime,
    isAvailable: p.isAvailable,
    notes: p.notes,
  }));
}

/** Human-readable warnings when assigned carers are outside their working pattern. */
export function visitCarerPatternMismatchWarnings(
  employeeIds: string[],
  visit: { scheduledStartDateTime: Date; scheduledEndDateTime: Date | null },
  patternByEmployee: Map<string, EmployeePatternContext>,
): string[] {
  const visitStart = visit.scheduledStartDateTime;
  const visitEnd = visitEndDateTime(visitStart, visit.scheduledEndDateTime);
  const startHm = hmFromJobDate(visitStart);
  const endHm = hmFromJobDate(visitEnd);
  const dayLabel = DAY_LABEL[visitStart.getUTCDay()] ?? 'this day';
  const messages: string[] = [];

  for (const employeeId of employeeIds) {
    const ctx = patternByEmployee.get(employeeId);
    if (!ctx) continue;
    if (isEmployeeAvailableForVisit(ctx.patterns, ctx.cycleConfig, visitStart, visitEnd)) continue;

    const resolved = resolvePatternForDateTime(
      toWorkingPatternRows(ctx.patterns),
      ctx.cycleConfig,
      visitStart,
    );

    if (!resolved || !resolved.isAvailable) {
      messages.push(`${ctx.employeeName}: not available on ${dayLabel} — assigned with warning`);
      continue;
    }

    if (resolved.notes === 'partial') {
      messages.push(`${ctx.employeeName}: partial availability on ${dayLabel} — assigned with warning`);
      continue;
    }

    if (resolved.startTime && resolved.endTime) {
      const mismatch = visitPatternTimeMismatch(startHm, endHm, resolved.startTime, resolved.endTime);
      if (mismatch) {
        const detail = formatVisitPatternTimeMismatchMessage(
          dayLabel,
          mismatch,
          resolved.startTime,
          resolved.endTime,
        );
        messages.push(`${ctx.employeeName}: ${detail} — assigned with warning`);
        continue;
      }
    }

    messages.push(`${ctx.employeeName}: visit is outside working pattern on ${dayLabel} — assigned with warning`);
  }

  return messages;
}

/** Planned carers to allocate on a visit, optionally filtered by working pattern. */
export function targetEmployeeIdsForVisit(
  desired: string[],
  visit: { requiredCarers: number | null; scheduledStartDateTime: Date; scheduledEndDateTime: Date | null },
  required: number,
  respectWorkingPattern?: boolean,
  patternByEmployee?: Map<string, EmployeePatternContext>,
): string[] {
  const cap = Math.max(1, visit.requiredCarers || required);
  const base = desired.slice(0, cap);

  if (!respectWorkingPattern || !patternByEmployee?.size) {
    return base;
  }

  return base.filter(
    (employeeId) =>
      visitCarerPatternMismatchWarnings([employeeId], visit, patternByEmployee).length === 0,
  );
}

export async function resolveVisitCarerAssignment(
  tx: Prisma.TransactionClient,
  desired: string[],
  visit: {
    scheduledStartDateTime: Date;
    scheduledEndDateTime: Date | null;
    requiredCarers: number | null;
  },
  required: number,
  options: {
    respectWorkingPattern: boolean;
    patternByEmployee: Map<string, EmployeePatternContext>;
    excludeScheduledJobId?: string;
  },
): Promise<{
  employeeIds: string[];
  patternWarnings: string[];
  rotaConflictWarnings: string[];
}> {
  const employeeIds = targetEmployeeIdsForVisit(
    desired,
    visit,
    required,
    options.respectWorkingPattern,
    options.patternByEmployee,
  );
  const patternWarnings: string[] = [];

  if (!options.respectWorkingPattern && options.patternByEmployee.size) {
    patternWarnings.push(
      ...visitCarerPatternMismatchWarnings(employeeIds, visit, options.patternByEmployee),
    );
  }

  const { jobStart, jobEnd } = visitWindowFromSchedule(
    visit.scheduledStartDateTime,
    visit.scheduledEndDateTime,
  );
  const conflicts = await findRotaConflictsByEmployee(
    tx,
    employeeIds,
    jobStart,
    jobEnd,
    options.excludeScheduledJobId,
  );
  const nameById = new Map(
    [...options.patternByEmployee.entries()].map(([id, ctx]) => [id, ctx.employeeName]),
  );
  const withoutConflict = filterEmployeeIdsWithoutRotaConflict(employeeIds, conflicts, nameById);

  return {
    employeeIds: withoutConflict.employeeIds,
    patternWarnings,
    rotaConflictWarnings: withoutConflict.warnings,
  };
}

export { CARER_ROTA_CONFLICT_MESSAGE };

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
    const ids = desired.slice(0, cap);
    if (visitCarerPatternMismatchWarnings(ids, visit, patternByEmployee).length > 0) {
      skipped += 1;
    }
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

  const patternByEmployee = await loadEmployeePatternContexts(tx, desired);

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
    const resolved = await resolveVisitCarerAssignment(tx, desired, visit, required, {
      respectWorkingPattern,
      patternByEmployee,
      excludeScheduledJobId: jobId,
    });
    const target = resolved.employeeIds;

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
