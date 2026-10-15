import { isVisitPlanExtraJobMetadata } from './visit-plan-extra-visit.util';
import {
  AllocationStatus,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitPlanSlotCarerRole,
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
import {
  resolveCarerAssignmentsForDay,
  resolveRequiredCarersForDay,
  type VisitPlanSlotCarerAssignmentShape,
} from './visit-plan-slot-carer-resolve.util';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { weekdayIndexInTimeZone } from '../scheduling/schedule-date-range.util';

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

/** Rota visits a plan change may still update: not started, not finished, not cancelled. */
export const SYNCABLE_VISIT_STATUSES: ScheduledVisitStatus[] = [
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
  /**
   * Day-specific + global (dayOfWeek null) assignments from the visit plan slot.
   * When present, each visit is synced to carers for that calendar day — not a flat list.
   */
  carerAssignments?: VisitPlanSlotCarerAssignmentShape[];
  requiredCarers: number;
  userId: string;
  scheduledVisitId?: string;
  /** Lower bound for bulk sync; ignored when `scheduledVisitId` is set. Defaults to start of ops today. */
  fromDateTime?: Date;
  /**
   * Organisation timezone (OrganisationGeneralSettings.timezone) for day-of-week carer
   * assignment, working-pattern checks and the default "from ops today" bound.
   */
  timeZone: string;
  /** When true (default), only assign carers on days/times that match their working pattern. */
  respectWorkingPattern?: boolean;
  /** Optional per-carer windows; when present, new allocations inherit these times. */
  carerWindows?: Array<{
    employeeId: string;
    start: Date;
    end: Date;
    durationMinutes: number;
    isLeadCarer?: boolean;
  }>;
};

/** Resolve which employees should be on a visit for sync (day-specific assignments win). */
export function desiredEmployeeIdsForVisitSync(params: {
  visitStart: Date;
  requiredCarers: number;
  assignedEmployeeIds: string[];
  carerAssignments?: VisitPlanSlotCarerAssignmentShape[] | null;
  carerWindows?: Array<{ employeeId: string }> | null;
  timeZone?: string;
}): string[] {
  const required = Math.max(1, params.requiredCarers);
  if (params.carerWindows?.length) {
    const fromWindows = visitPlanCarerEmployeeIds(
      params.carerWindows,
      params.assignedEmployeeIds,
      required,
    );
    if (fromWindows.length) return fromWindows;
  }
  if (params.carerAssignments?.length) {
    const tz = params.timeZone?.trim() || DEFAULT_OPERATIONAL_TIMEZONE;
    const resolved = resolveCarerAssignmentsForDay(
      params.carerAssignments,
      weekdayIndexInTimeZone(params.visitStart, tz),
      required,
      params.assignedEmployeeIds,
    );
    const ids = resolved
      .map((row) => row.employeeId?.trim())
      .filter((id): id is string => Boolean(id));
    if (ids.length) return ids.slice(0, required);
  }
  return (params.assignedEmployeeIds ?? [])
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id))
    .slice(0, required);
}

export function mapDbCarerAssignmentsForSync(
  rows: Array<{
    dayOfWeek: number | null;
    employeeId: string;
    role: VisitPlanSlotCarerRole | string;
    requiredCarers?: number | null;
    durationMinutes: number | null;
    plannedStartTime: string | null;
    plannedEndTime: string | null;
    sortOrder: number;
  }>,
): VisitPlanSlotCarerAssignmentShape[] {
  return rows.map((row) => ({
    dayOfWeek: row.dayOfWeek,
    employeeId: row.employeeId,
    role:
      row.role === VisitPlanSlotCarerRole.LEAD || row.role === 'LEAD'
        ? VisitPlanSlotCarerRole.LEAD
        : VisitPlanSlotCarerRole.SECONDARY,
    requiredCarers: row.requiredCarers ?? null,
    durationMinutes: row.durationMinutes,
    plannedStartTime: row.plannedStartTime,
    plannedEndTime: row.plannedEndTime,
    sortOrder: row.sortOrder,
  }));
}

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

/**
 * Human-readable warnings when assigned carers are outside their working pattern.
 * Weekday and HH:mm of the (true-UTC) visit are read in the organisation `timeZone`.
 */
export function visitCarerPatternMismatchWarnings(
  employeeIds: string[],
  visit: { scheduledStartDateTime: Date; scheduledEndDateTime: Date | null },
  patternByEmployee: Map<string, EmployeePatternContext>,
  timeZone: string,
): string[] {
  const visitStart = visit.scheduledStartDateTime;
  const visitEnd = visitEndDateTime(visitStart, visit.scheduledEndDateTime);
  const startHm = hmFromJobDate(visitStart, timeZone);
  const endHm = hmFromJobDate(visitEnd, timeZone);
  const dayLabel = DAY_LABEL[weekdayIndexInTimeZone(visitStart, timeZone)] ?? 'this day';
  const messages: string[] = [];

  for (const employeeId of employeeIds) {
    const ctx = patternByEmployee.get(employeeId);
    if (!ctx) continue;
    if (isEmployeeAvailableForVisit(ctx.patterns, ctx.cycleConfig, visitStart, visitEnd, timeZone)) {
      continue;
    }

    const resolved = resolvePatternForDateTime(
      toWorkingPatternRows(ctx.patterns),
      ctx.cycleConfig,
      visitStart,
      timeZone,
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
  respectWorkingPattern: boolean | undefined,
  patternByEmployee: Map<string, EmployeePatternContext> | undefined,
  timeZone: string,
): string[] {
  const cap = Math.max(1, visit.requiredCarers || required);
  const base = desired.slice(0, cap);

  if (!respectWorkingPattern || !patternByEmployee?.size) {
    return base;
  }

  return base.filter(
    (employeeId) =>
      visitCarerPatternMismatchWarnings([employeeId], visit, patternByEmployee, timeZone).length ===
      0,
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
    /** Organisation timezone for working-pattern weekday / HH:mm checks. */
    timeZone: string;
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
    options.timeZone,
  );
  const patternWarnings: string[] = [];

  if (!options.respectWorkingPattern && options.patternByEmployee.size) {
    patternWarnings.push(
      ...visitCarerPatternMismatchWarnings(
        employeeIds,
        visit,
        options.patternByEmployee,
        options.timeZone,
      ),
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
  timeZone: string,
): number {
  const required = Math.max(1, requiredCarers);
  const desired = (assignedEmployeeIds ?? []).slice(0, required);
  let skipped = 0;
  for (const visit of visits) {
    const cap = Math.max(1, visit.requiredCarers || required);
    const ids = desired.slice(0, cap);
    if (visitCarerPatternMismatchWarnings(ids, visit, patternByEmployee, timeZone).length > 0) {
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

export function visitPlanCarerSyncFromDateTime(
  fromDate: string | undefined,
  timeZone: string,
): Date {
  const day = fromDate?.trim() || operationalTodayIso(new Date(), timeZone);
  return operationalDayBounds(day, timeZone).start;
}

/** Push visit-plan slot carer defaults onto matching scheduled jobs. */
export async function syncVisitPlanSlotCarersToScheduledJobs(
  tx: Prisma.TransactionClient,
  params: SyncVisitPlanSlotCarersParams,
): Promise<{ jobsUpdated: number }> {
  const from = params.fromDateTime ?? visitPlanCarerSyncFromDateTime(undefined, params.timeZone);
  const required = Math.max(1, params.requiredCarers);
  const respectWorkingPattern = params.respectWorkingPattern !== false;
  const legacyAssigned = (params.assignedEmployeeIds ?? [])
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id));
  const assignmentIds = (params.carerAssignments ?? [])
    .map((row) => row.employeeId?.trim())
    .filter((id): id is string => Boolean(id));
  const windowIds = (params.carerWindows ?? [])
    .map((row) => row.employeeId?.trim())
    .filter((id): id is string => Boolean(id));
  const patternByEmployee = await loadEmployeePatternContexts(tx, [
    ...new Set([...legacyAssigned, ...assignmentIds, ...windowIds]),
  ]);

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
      scheduledJob: { select: { metadata: true } },
    },
  });

  let jobsUpdated = 0;

  const timeZone = params.timeZone?.trim() || DEFAULT_OPERATIONAL_TIMEZONE;

  for (const visit of visits) {
    // Extra visits keep the carers chosen when they were added.
    if (isVisitPlanExtraJobMetadata(visit.scheduledJob.metadata)) continue;
    const jobId = visit.scheduledJobId;
    // The visit plan is the source of truth for how many carers a visit needs: a single
    // regenerated visit passes its day-specific count; bulk sync resolves it per weekday.
    // (Using the count already stored on the visit kept a 1-carer visit at 1 carer forever.)
    const visitRequired = params.scheduledVisitId
      ? required
      : resolveRequiredCarersForDay(
          params.carerAssignments ?? [],
          weekdayIndexInTimeZone(visit.scheduledStartDateTime, timeZone),
          required,
        );
    const requiredChanged = visit.requiredCarers !== visitRequired;
    // Prefer day-specific carerWindows (single-visit regenerate). Otherwise resolve
    // Mon/Wed/… from carerAssignments so bulk sync does not flatten every day to one carer.
    const desiredForVisit = desiredEmployeeIdsForVisitSync({
      visitStart: visit.scheduledStartDateTime,
      requiredCarers: visitRequired,
      assignedEmployeeIds: legacyAssigned,
      carerAssignments: params.carerAssignments,
      carerWindows: params.carerWindows,
      timeZone: params.timeZone,
    });

    const resolved = await resolveVisitCarerAssignment(
      tx,
      desiredForVisit,
      { ...visit, requiredCarers: visitRequired },
      visitRequired,
      {
        respectWorkingPattern,
        patternByEmployee,
        excludeScheduledJobId: jobId,
        timeZone: params.timeZone,
      },
    );
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

    if (toRemove.length === 0 && toAdd.length === 0 && !requiredChanged) continue;

    if (requiredChanged) {
      await tx.scheduledVisit.update({
        where: { id: visit.id },
        data: { requiredCarers: visitRequired, updatedById: params.userId },
      });
      await tx.scheduledJob.update({
        where: { id: jobId },
        data: { requiredCarers: visitRequired, updatedById: params.userId },
      });
    }

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
      const carerWindow = params.carerWindows?.find((c) => c.employeeId === employeeId);
      const start = carerWindow?.start ?? visit.scheduledStartDateTime;
      const end =
        carerWindow?.end ??
        visitEndDateTime(visit.scheduledStartDateTime, visit.scheduledEndDateTime);
      const durationMinutes =
        carerWindow?.durationMinutes ??
        Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
      if (carerWindow?.isLeadCarer) {
        // Exactly one lead per visit: the slot's lead replaces any existing lead.
        await tx.jobAllocation.updateMany({
          where: {
            scheduledJobId: jobId,
            deletedAt: null,
            isActive: true,
            status: { in: ACTIVE_ALLOCATION_STATUSES },
            isLeadCarer: true,
          },
          data: { isLeadCarer: false },
        });
      }
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
          scheduledStartDateTime: start,
          scheduledEndDateTime: end,
          durationMinutes,
          isLeadCarer: carerWindow?.isLeadCarer ?? false,
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
