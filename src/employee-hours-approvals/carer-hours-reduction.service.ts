import { Injectable } from '@nestjs/common';
import { AllocationStatus, Prisma, ScheduledJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { deriveDurationFromTimes } from '../service-user-visit-plans/visit-plan-slot-window.util';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
  formatHmInTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import { weekdayIndexInTimeZone } from '../scheduling/schedule-date-range.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import { extraMinutesByWeek } from './carer-weekly-hours.service';

const round1 = (n: number) => Math.round(n * 10) / 10;
const HOURS_EPSILON = 0.01;

/** Mon → Sun (0 = Sun … 6 = Sat). */
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];
/** Visits that count towards a week but are not happening are left out. */
const NOT_HAPPENING_JOB: ScheduledJobStatus[] = [
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
];

export type ContractedHoursPlanChange = {
  visitPlanSlotId: string;
  visitPlanId: string;
  serviceUserId: string;
  serviceUserName: string;
  slotCode: string;
  plannedStartTime: string;
  plannedEndTime: string;
  /** Days the carer is taken off this visit (0 = Sun … 6 = Sat). */
  removedDays: number[];
  /** Days the carer keeps on this visit. */
  keptDays: number[];
  weeklyHoursRemoved: number;
};

export type ContractedHoursUnassignedVisit = {
  /** Org-timezone day, YYYY-MM-DD. */
  date: string;
  /** Org-timezone HH:mm. */
  startTime: string;
  endTime: string;
  serviceUserName: string;
};

export type ContractedHoursWeekImpact = {
  /** Monday of the week (org timezone), YYYY-MM-DD. */
  weekStart: string;
  isCurrentWeek: boolean;
  bookedHours: number;
  hoursAfter: number;
  visitsToUnassign: number;
  hoursToUnassign: number;
  /** The visits that would be unassigned, in time order. */
  visits: ContractedHoursUnassignedVisit[];
};

export type ContractedHoursImpact = {
  previousContractedWeeklyHours: number | null;
  requestedContractedWeeklyHours: number;
  /** Limit used for the cut: active approved extra hours, else the requested hours. */
  limitWeeklyHours: number;
  isDecrease: boolean;
  /** Visit-plan (recurring) hours a week, before and after. */
  planWeeklyHours: number;
  planWeeklyHoursAfter: number;
  planChanges: ContractedHoursPlanChange[];
  /** Rota weeks from the current week on that have this carer's visits. */
  weeks: ContractedHoursWeekImpact[];
  rotaVisitsToUnassign: number;
};

type Occurrence = { slotId: string; day: number; start: string; hours: number };

/**
 * Applies a lower contracted-hours limit to a carer.
 * - Rota: each week (Monday–Sunday, org timezone) from the current week on, the carer's
 *   visits are added up in time order (done and booked). The visit that would take the
 *   total over the limit, and every later visit of that week, is unassigned — but only
 *   visits that start after the moment this runs.
 * - Visit plan: the same cut is made on one typical week of the carer's recurring visits,
 *   and the carer is taken off those visits on those days only, so newly generated rota
 *   stays within the limit. Other carers on a double-up visit keep their place.
 */
@Injectable()
export class CarerHoursReductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly scheduleImpact: ScheduleLifecycleImpactService,
  ) {}

  private mondayKey(at: Date, timeZone: string): string {
    const dayKey = dayKeyInTimeZone(at, timeZone);
    const offset = (weekdayIndexInTimeZone(at, timeZone) + 6) % 7;
    return addDaysToOperationalIso(dayKey, -offset);
  }

  private async rotaImpact(
    client: Prisma.TransactionClient | PrismaService,
    employeeId: string,
    limit: number,
    now: Date,
  ): Promise<{ weeks: ContractedHoursWeekImpact[]; allocationIds: string[] }> {
    const [timeZone, rule] = await Promise.all([
      this.orgSettings.getOperationalTimezone(),
      this.orgSettings.getCarerWeeklyHoursRule(),
    ]);
    const currentWeekKey = this.mondayKey(now, timeZone);
    const currentWeekStart = operationalDayBounds(
      currentWeekKey,
      timeZone,
    ).start;
    const rows = await client.jobAllocation.findMany({
      where: {
        employeeId,
        deletedAt: null,
        isActive: true,
        // Called-off visits keep the carer's row with status CANCELLED (counted per setting).
        OR: [
          { status: { in: ACTIVE_ALLOCATION } },
          ...(rule.countCalledOff
            ? [
                {
                  status: AllocationStatus.CANCELLED,
                  scheduledJob: { status: ScheduledJobStatus.CALLED_OFF },
                },
              ]
            : []),
        ],
        scheduledJob: {
          deletedAt: null,
          isActive: true,
          // Called-off visits count when Settings → Dom Rules says so; cancelled ones never do.
          status: {
            notIn: rule.countCalledOff ? [ScheduledJobStatus.CANCELLED] : NOT_HAPPENING_JOB,
          },
          scheduledStartDateTime: { gte: currentWeekStart },
        },
      },
      select: {
        id: true,
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        scheduledJob: {
          select: {
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            status: true,
            serviceUser: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    const byWeek = new Map<
      string,
      Array<{
        id: string;
        start: Date;
        end: Date;
        hours: number;
        canUnassign: boolean;
        serviceUserName: string;
      }>
    >();
    for (const row of rows) {
      const start =
        row.scheduledStartDateTime ?? row.scheduledJob.scheduledStartDateTime;
      const end =
        row.scheduledEndDateTime ??
        row.scheduledJob.scheduledEndDateTime ??
        start;
      const hours = Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
      const key = this.mondayKey(start, timeZone);
      const list = byWeek.get(key) ?? [];
      const su = row.scheduledJob.serviceUser;
      list.push({
        id: row.id,
        start,
        end,
        hours,
        serviceUserName: `${su?.firstName ?? ''} ${su?.lastName ?? ''}`.trim(),
        canUnassign:
          start.getTime() > now.getTime() &&
          row.scheduledJob.status !== ScheduledJobStatus.COMPLETED &&
          row.scheduledJob.status !== ScheduledJobStatus.IN_PROGRESS &&
          row.scheduledJob.status !== ScheduledJobStatus.CALLED_OFF,
      });
      byWeek.set(key, list);
    }

    const weeks: ContractedHoursWeekImpact[] = [];
    const allocationIds: string[] = [];
    const weekKeys = [...byWeek.keys()].sort();
    // Extra weekly hours given for a week (Add extra hours) raise that week's limit.
    const extraByWeek = weekKeys.length
      ? ((await extraMinutesByWeek(client, [employeeId], weekKeys[0], weekKeys[weekKeys.length - 1])).get(
          employeeId,
        ) ?? new Map<string, number>())
      : new Map<string, number>();
    for (const key of weekKeys) {
      const visits = byWeek
        .get(key)!
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      // Contracted + extra for that week + grace minutes (Settings → Dom Rules) is not over.
      const weekLimit = limit + (extraByWeek.get(key) ?? 0) / 60 + rule.graceMinutes / 60;
      let total = 0;
      let over = false;
      let hoursToUnassign = 0;
      let visitsToUnassign = 0;
      const unassigned: ContractedHoursUnassignedVisit[] = [];
      for (const visit of visits) {
        if (!over && total + visit.hours > weekLimit + HOURS_EPSILON) over = true;
        if (over && visit.canUnassign) {
          allocationIds.push(visit.id);
          visitsToUnassign += 1;
          hoursToUnassign += visit.hours;
          unassigned.push({
            date: dayKeyInTimeZone(visit.start, timeZone),
            startTime: formatHmInTimeZone(visit.start, timeZone),
            endTime: formatHmInTimeZone(visit.end, timeZone),
            serviceUserName: visit.serviceUserName,
          });
        }
        total += visit.hours;
      }
      weeks.push({
        weekStart: key,
        isCurrentWeek: key === currentWeekKey,
        bookedHours: round1(total),
        hoursAfter: round1(total - hoursToUnassign),
        visitsToUnassign,
        hoursToUnassign: round1(hoursToUnassign),
        visits: unassigned,
      });
    }
    return { weeks, allocationIds };
  }

  private async planImpact(
    client: Prisma.TransactionClient | PrismaService,
    employeeId: string,
    limit: number,
  ): Promise<{
    planWeeklyHours: number;
    changes: ContractedHoursPlanChange[];
  }> {
    const slots = await client.visitPlanSlot.findMany({
      where: {
        isActive: true,
        isEnabled: true,
        visitPlan: { status: { in: ['ACTIVE', 'DRAFT'] } },
        carerAssignments: { some: { employeeId } },
      },
      select: {
        id: true,
        slotCode: true,
        daysOfWeek: true,
        plannedStartTime: true,
        plannedEndTime: true,
        durationMinutes: true,
        slotKind: true,
        carerAssignments: true,
        visitPlan: {
          select: {
            id: true,
            serviceUserId: true,
            serviceUser: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    const occurrences: Occurrence[] = [];
    for (const slot of slots) {
      const daysWithDayRows = new Set(
        slot.carerAssignments
          .filter((a) => a.dayOfWeek != null)
          .map((a) => a.dayOfWeek!),
      );
      for (const row of slot.carerAssignments.filter(
        (a) => a.employeeId === employeeId,
      )) {
        // A day with day-specific rows ignores the all-days rows (same as rota generation).
        const days =
          row.dayOfWeek != null
            ? slot.daysOfWeek.includes(row.dayOfWeek)
              ? [row.dayOfWeek]
              : []
            : slot.daysOfWeek.filter((d) => !daysWithDayRows.has(d));
        const minutes =
          row.durationMinutes ??
          slot.durationMinutes ??
          deriveDurationFromTimes(
            row.plannedStartTime ?? slot.plannedStartTime,
            row.plannedEndTime ?? slot.plannedEndTime,
            slot.slotKind ?? undefined,
          );
        for (const day of days) {
          occurrences.push({
            slotId: slot.id,
            day,
            start: row.plannedStartTime ?? slot.plannedStartTime,
            hours: minutes / 60,
          });
        }
      }
    }
    occurrences.sort(
      (a, b) =>
        MONDAY_FIRST.indexOf(a.day) - MONDAY_FIRST.indexOf(b.day) ||
        a.start.localeCompare(b.start),
    );

    let total = 0;
    let over = false;
    const removed = new Map<string, { days: Set<number>; hours: number }>();
    const kept = new Map<string, Set<number>>();
    for (const occ of occurrences) {
      if (!over && total + occ.hours > limit + HOURS_EPSILON) over = true;
      if (over) {
        const entry = removed.get(occ.slotId) ?? {
          days: new Set<number>(),
          hours: 0,
        };
        entry.days.add(occ.day);
        entry.hours += occ.hours;
        removed.set(occ.slotId, entry);
      } else {
        const set = kept.get(occ.slotId) ?? new Set<number>();
        set.add(occ.day);
        kept.set(occ.slotId, set);
      }
      total += occ.hours;
    }

    const changes: ContractedHoursPlanChange[] = [];
    for (const slot of slots) {
      const entry = removed.get(slot.id);
      if (!entry) continue;
      const su = slot.visitPlan.serviceUser;
      changes.push({
        visitPlanSlotId: slot.id,
        visitPlanId: slot.visitPlan.id,
        serviceUserId: slot.visitPlan.serviceUserId,
        serviceUserName: `${su?.firstName ?? ''} ${su?.lastName ?? ''}`.trim(),
        slotCode: slot.slotCode,
        plannedStartTime: slot.plannedStartTime,
        plannedEndTime: slot.plannedEndTime,
        removedDays: MONDAY_FIRST.filter((d) => entry.days.has(d)),
        keptDays: MONDAY_FIRST.filter((d) => kept.get(slot.id)?.has(d)),
        weeklyHoursRemoved: round1(entry.hours),
      });
    }
    return { planWeeklyHours: round1(total), changes };
  }

  /** What approving this contracted-hours value would change (nothing is written). */
  async preview(
    employeeId: string,
    requestedContractedWeeklyHours: number,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
    now: Date = new Date(),
  ): Promise<ContractedHoursImpact & { allocationIds: string[] }> {
    const employment = await client.employeeEmployment.findUnique({
      where: { employeeId },
      select: { contractedWeeklyHours: true },
    });
    const previous = employment?.contractedWeeklyHours ?? null;
    // The carer's limit is their contracted weekly hours (+ the grace in Settings → Dom Rules).
    const { graceMinutes } = await this.orgSettings.getCarerWeeklyHoursRule();
    const limit = requestedContractedWeeklyHours + graceMinutes / 60;
    const isDecrease =
      previous != null &&
      requestedContractedWeeklyHours < previous - HOURS_EPSILON;

    if (!isDecrease) {
      const plan = await this.planImpact(
        client,
        employeeId,
        Number.POSITIVE_INFINITY,
      );
      return {
        previousContractedWeeklyHours: previous,
        requestedContractedWeeklyHours,
        limitWeeklyHours: limit,
        isDecrease,
        planWeeklyHours: plan.planWeeklyHours,
        planWeeklyHoursAfter: plan.planWeeklyHours,
        planChanges: [],
        weeks: [],
        rotaVisitsToUnassign: 0,
        allocationIds: [],
      };
    }

    const [plan, rota] = await Promise.all([
      this.planImpact(client, employeeId, limit),
      this.rotaImpact(client, employeeId, limit, now),
    ]);
    const removedHours = plan.changes.reduce(
      (sum, c) => sum + c.weeklyHoursRemoved,
      0,
    );
    return {
      previousContractedWeeklyHours: previous,
      requestedContractedWeeklyHours,
      limitWeeklyHours: limit,
      isDecrease,
      planWeeklyHours: plan.planWeeklyHours,
      planWeeklyHoursAfter: round1(plan.planWeeklyHours - removedHours),
      planChanges: plan.changes,
      weeks: rota.weeks.filter(
        (w) => w.visitsToUnassign > 0 || w.bookedHours > limit,
      ),
      rotaVisitsToUnassign: rota.allocationIds.length,
      allocationIds: rota.allocationIds,
    };
  }

  /**
   * Make the cut for real (inside the approval transaction): take the carer off the plan
   * days, then unassign the rota visits over the limit from now on.
   */
  async apply(
    tx: Prisma.TransactionClient,
    userId: string,
    employeeId: string,
    requestedContractedWeeklyHours: number,
    meta?: RequestAuditMeta,
  ): Promise<ContractedHoursImpact> {
    const impact = await this.preview(
      employeeId,
      requestedContractedWeeklyHours,
      tx,
    );
    const { allocationIds, ...summary } = impact;
    if (!impact.isDecrease) return summary;

    for (const change of impact.planChanges) {
      await this.removeCarerFromSlotDays(
        tx,
        employeeId,
        change.visitPlanSlotId,
        change.removedDays,
      );
    }
    const rota = await this.scheduleImpact.unallocateEmployeeAllocations(
      userId,
      employeeId,
      allocationIds,
      'Contracted weekly hours reduced',
      'employee_hours_reduced',
      meta,
      tx,
    );
    return { ...summary, rotaVisitsToUnassign: rota.jobsUnallocated };
  }

  /**
   * Take the carer off a recurring visit on some days only. An all-days row is split into
   * per-day rows for the days they keep; because per-day rows replace the all-days rows on
   * that day, the other carers' all-days rows are copied onto those days too.
   */
  async removeCarerFromSlotDays(
    tx: Prisma.TransactionClient,
    employeeId: string,
    slotId: string,
    removedDays: number[],
  ): Promise<void> {
    const slot = await tx.visitPlanSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        daysOfWeek: true,
        assignedEmployeeIds: true,
        carerAssignments: true,
      },
    });
    if (!slot) return;
    const removed = new Set(removedDays);
    const rows = slot.carerAssignments;
    const daysWithDayRows = new Set(
      rows.filter((r) => r.dayOfWeek != null).map((r) => r.dayOfWeek!),
    );

    // Day-specific rows of this carer on removed days.
    const dayRowIds = rows
      .filter(
        (r) =>
          r.employeeId === employeeId &&
          r.dayOfWeek != null &&
          removed.has(r.dayOfWeek),
      )
      .map((r) => r.id);
    if (dayRowIds.length) {
      await tx.visitPlanSlotCarerAssignment.deleteMany({
        where: { id: { in: dayRowIds } },
      });
    }

    const globalRow = rows.find(
      (r) => r.employeeId === employeeId && r.dayOfWeek == null,
    );
    if (globalRow) {
      const globalDays = slot.daysOfWeek.filter((d) => !daysWithDayRows.has(d));
      const keptDays = globalDays.filter((d) => !removed.has(d));
      const otherGlobalRows = rows.filter(
        (r) => r.dayOfWeek == null && r.employeeId !== employeeId,
      );
      await tx.visitPlanSlotCarerAssignment.delete({
        where: { id: globalRow.id },
      });
      const copy = (row: (typeof rows)[number], dayOfWeek: number) => ({
        visitPlanSlotId: slot.id,
        dayOfWeek,
        employeeId: row.employeeId,
        role: row.role,
        requiredCarers: row.requiredCarers,
        durationMinutes: row.durationMinutes,
        plannedStartTime: row.plannedStartTime,
        plannedEndTime: row.plannedEndTime,
        sortOrder: row.sortOrder,
      });
      const data = keptDays.flatMap((day) => [
        copy(globalRow, day),
        ...otherGlobalRows.map((other) => copy(other, day)),
      ]);
      if (data.length)
        await tx.visitPlanSlotCarerAssignment.createMany({ data });
    }

    // The legacy list is the last fallback for days without rows — keep the carer out of it.
    if (slot.assignedEmployeeIds.includes(employeeId)) {
      await tx.visitPlanSlot.update({
        where: { id: slot.id },
        data: {
          assignedEmployeeIds: slot.assignedEmployeeIds.filter(
            (id) => id !== employeeId,
          ),
        },
      });
    }
  }
}
