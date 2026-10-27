import { Injectable } from '@nestjs/common';
import {
  AllocationStatus,
  EmployeeHoursApprovalStatus,
  EmployeeHoursApprovalType,
  Prisma,
  ScheduledJobStatus,
  VisitPlanStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
  formatHmInTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import {
  formatOrganisationHm,
  formatOrganisationIsoDate,
} from '../common/utils/organisation-display-format.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { buildVisitPlanOccurrence } from '../service-user-visit-plans/visit-plan-generate-occurrence.util';
import { EmployeeHoursApprovalNotificationHook } from './employee-hours-approval-notification.hook';

type Client = Prisma.TransactionClient | PrismaService;

/** Weeks counted from this week on (the rota is generated well inside this). */
export const CARER_HOURS_CHECK_WEEKS = 12;

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

/** One visit of the carer that uses their weekly hours. */
export type CarerHoursVisit = {
  /** Org-local day, YYYY-MM-DD. */
  date: string;
  start: Date;
  minutes: number;
  serviceUserId: string | null;
  /** Rota visit already allocated to the carer. */
  allocationId?: string;
  scheduledJobId?: string;
  /** Visit plan visit (from the rota or, before the rota exists, from the plan). */
  visitPlanId?: string;
  visitPlanSlotId?: string;
  /** Not saved yet: the visit being checked. */
  isNew?: boolean;
};

export type CarerHoursWeek = {
  /** Monday, YYYY-MM-DD. */
  weekStart: string;
  minutes: number;
  visits: CarerHoursVisit[];
  /** Visits from the one that crosses the limit (+ grace) to the end of the week. */
  overVisits: CarerHoursVisit[];
};

export type CarerHoursCount = {
  /** Contracted weekly hours in minutes (null: no limit set). */
  limitMinutes: number | null;
  graceMinutes: number;
  weeks: CarerHoursWeek[];
  /** Weeks over the limit + grace. */
  overWeeks: CarerHoursWeek[];
  heaviestMinutes: number;
};

/** Monday (YYYY-MM-DD) of the week a day (YYYY-MM-DD) is in. */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const offset = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDaysToOperationalIso(iso, -offset);
}

function utcDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * A carer's weekly hours (Monday–Sunday) against their contracted weekly hours, the same
 * count everywhere a carer is put on visits:
 * - days with a rota: the rota visits allocated to the carer (plan, extra and special visits);
 * - days without a rota yet: the carer's visits on active visit plans.
 * Cancelled visits never count; called-off ones count when Settings → Dom Rules says so.
 * `planOverride` counts that plan from its rows (as `client` sees them, e.g. inside a save)
 * instead of the rota, so a change being saved is counted before the rota is updated.
 */
@Injectable()
export class CarerWeeklyHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly notificationHook: EmployeeHoursApprovalNotificationHook,
  ) {}

  rule() {
    return this.orgSettings.getCarerWeeklyHoursRule();
  }

  async count(
    client: Client,
    employeeId: string,
    options: {
      planOverride?: string;
      /** Visits not saved yet (e.g. the rota visit being allocated). */
      extra?: CarerHoursVisit[];
      /** Only these weeks (Mondays); default: this week and the next ones. */
      weekStarts?: string[];
      /** Rota allocations left out (e.g. the one being replaced). */
      excludeAllocationIds?: string[];
      /** "slotId|YYYY-MM-DD" plan visits the carer will not do (a manager rejected them). */
      skipPlanVisits?: Set<string>;
    } = {},
  ): Promise<CarerHoursCount> {
    const { extra, ...rest } = options;
    const all = await this.countMany(client, [employeeId], {
      ...rest,
      extraByEmployee: extra ? new Map([[employeeId, extra]]) : undefined,
    });
    return all.get(employeeId)!;
  }

  /**
   * The same count for several carers at once (one set of queries), e.g. the carer picker.
   * `excludeSlotIds` / `excludeScheduledJobIds` leave out the visit being chosen for.
   */
  async countMany(
    client: Client,
    employeeIds: string[],
    options: {
      planOverride?: string;
      extraByEmployee?: Map<string, CarerHoursVisit[]>;
      weekStarts?: string[];
      excludeAllocationIds?: string[];
      skipPlanVisits?: Set<string>;
      /** Plan slots left out on the rota and in the plan (the slot being edited). */
      excludeSlotIds?: string[];
      /** Rota visits left out (the visit being allocated). */
      excludeScheduledJobIds?: string[];
    } = {},
  ): Promise<Map<string, CarerHoursCount>> {
    const ids = [...new Set(employeeIds)];
    const result = new Map<string, CarerHoursCount>();
    if (!ids.length) return result;
    const [timeZone, rule, employments] = await Promise.all([
      this.orgSettings.getOperationalTimezone(),
      this.rule(),
      client.employeeEmployment.findMany({
        where: { employeeId: { in: ids }, deletedAt: null },
        select: { employeeId: true, contractedWeeklyHours: true },
      }),
    ]);
    const limitById = new Map(
      employments.map((e) => [
        e.employeeId,
        e.contractedWeeklyHours != null && e.contractedWeeklyHours > 0
          ? Math.round(e.contractedWeeklyHours * 60)
          : null,
      ]),
    );
    const excludeSlots = new Set(options.excludeSlotIds ?? []);
    const excludeJobs = new Set(options.excludeScheduledJobIds ?? []);
    const today = dayKeyInTimeZone(new Date(), timeZone);
    const weekStarts = options.weekStarts?.length
      ? [...new Set(options.weekStarts)].sort()
      : Array.from({ length: CARER_HOURS_CHECK_WEEKS }, (_, i) =>
          addDaysToOperationalIso(mondayOf(today), i * 7),
        );
    const firstDay = weekStarts[0];
    const lastDay = addDaysToOperationalIso(
      weekStarts[weekStarts.length - 1],
      6,
    );
    const from = operationalDayBounds(firstDay, timeZone).start;
    const to = operationalDayBounds(
      addDaysToOperationalIso(lastDay, 1),
      timeZone,
    ).start;
    const notHappening: ScheduledJobStatus[] = rule.countCalledOff
      ? [ScheduledJobStatus.CANCELLED]
      : [ScheduledJobStatus.CANCELLED, ScheduledJobStatus.CALLED_OFF];

    const visitsById = new Map<string, CarerHoursVisit[]>(
      ids.map((id) => [id, [...(options.extraByEmployee?.get(id) ?? [])]]),
    );

    // 1) Rota visits allocated to the carers.
    const allocations = await client.jobAllocation.findMany({
      where: {
        employeeId: { in: ids },
        deletedAt: null,
        isActive: true,
        // A called-off visit keeps the carer's row with status CANCELLED; it counts when the
        // setting says so (the job status filter below drops cancelled visits).
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
        ...(options.excludeAllocationIds?.length
          ? { id: { notIn: options.excludeAllocationIds } }
          : {}),
        scheduledJob: {
          deletedAt: null,
          isActive: true,
          status: { notIn: notHappening },
          scheduledStartDateTime: { gte: from, lt: to },
        },
      },
      select: {
        id: true,
        employeeId: true,
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        scheduledJob: {
          select: {
            id: true,
            serviceUserId: true,
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            estimatedDurationMinutes: true,
            metadata: true,
          },
        },
      },
    });
    for (const a of allocations) {
      const job = a.scheduledJob;
      const meta = job.metadata as {
        visitPlanId?: string;
        visitPlanSlotId?: string;
      } | null;
      if (options.planOverride && meta?.visitPlanId === options.planOverride)
        continue;
      if (excludeJobs.has(job.id)) continue;
      if (meta?.visitPlanSlotId && excludeSlots.has(meta.visitPlanSlotId)) continue;
      const start = a.scheduledStartDateTime ?? job.scheduledStartDateTime;
      const end = a.scheduledEndDateTime ?? job.scheduledEndDateTime;
      const minutes = end
        ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
        : (job.estimatedDurationMinutes ?? 0);
      visitsById.get(a.employeeId)?.push({
        date: dayKeyInTimeZone(start, timeZone),
        start,
        minutes,
        serviceUserId: job.serviceUserId,
        allocationId: a.id,
        scheduledJobId: job.id,
        visitPlanId: meta?.visitPlanId,
        visitPlanSlotId: meta?.visitPlanSlotId,
      });
    }

    // 2) Visit plan visits on days the rota does not have yet (or the plan being saved).
    const plans = await client.serviceUserVisitPlan.findMany({
      where: {
        deletedAt: null,
        OR: [
          { status: VisitPlanStatus.ACTIVE },
          ...(options.planOverride ? [{ id: options.planOverride }] : []),
        ],
        slots: {
          some: {
            isActive: true,
            carerAssignments: { some: { employeeId: { in: ids } } },
          },
        },
      },
      select: {
        id: true,
        serviceUserId: true,
        effectiveFrom: true,
        effectiveTo: true,
        slots: {
          where: {
            isActive: true,
            carerAssignments: { some: { employeeId: { in: ids } } },
          },
          include: { carerAssignments: true, exceptions: true },
        },
      },
    });
    const slotIds = plans
      .flatMap((p) => p.slots.map((s) => s.id))
      .filter((id) => !excludeSlots.has(id));
    const onRota = new Set<string>();
    const cancelled = new Set<string>();
    if (slotIds.length) {
      const jobs = await client.scheduledJob.findMany({
        where: {
          deletedAt: null,
          scheduledStartDateTime: {
            gte: operationalDayBounds(
              addDaysToOperationalIso(firstDay, -1),
              timeZone,
            ).start,
            lt: to,
          },
          OR: slotIds.map((id) => ({
            metadata: { path: ['visitPlanSlotId'], equals: id },
          })),
        },
        select: { status: true, metadata: true },
      });
      for (const job of jobs) {
        const m = job.metadata as {
          visitPlanSlotId?: string;
          date?: string;
        } | null;
        if (!m?.visitPlanSlotId || !m.date) continue;
        const key = `${m.visitPlanSlotId}|${m.date.slice(0, 10)}`;
        onRota.add(key);
        if (notHappening.includes(job.status)) cancelled.add(key);
      }
    }
    // Plan visits a manager rejected for a carer stay off them ("slotId|date" per carer).
    const rejected = await client.employeeHoursApproval.findMany({
      where: {
        employeeId: { in: ids },
        requestType: EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
        status: EmployeeHoursApprovalStatus.REJECTED,
      },
      select: { employeeId: true, requestPayload: true },
    });
    const rejectedById = new Map<string, Set<string>>();
    for (const r of rejected) {
      if (!r.employeeId) continue;
      const set = rejectedById.get(r.employeeId) ?? new Set<string>();
      for (const key of (r.requestPayload as { withheld?: string[] } | null)?.withheld ?? []) {
        set.add(key);
      }
      rejectedById.set(r.employeeId, set);
    }
    // Days already gone get no new visits from a plan.
    const planFrom = today > firstDay ? today : firstDay;
    for (const plan of plans) {
      const fromRows = plan.id === options.planOverride;
      for (
        let day = planFrom;
        day <= lastDay;
        day = addDaysToOperationalIso(day, 1)
      ) {
        for (const slot of plan.slots) {
          if (excludeSlots.has(slot.id)) continue;
          const key = `${slot.id}|${day}`;
          if (fromRows ? cancelled.has(key) : onRota.has(key)) continue;
          if (options.skipPlanVisits?.has(key)) continue;
          const occurrence = buildVisitPlanOccurrence(
            slot,
            utcDay(day),
            plan.effectiveFrom,
            plan.effectiveTo,
            { timeZone },
          );
          if (!occurrence) continue;
          for (const window of occurrence.carerWindows) {
            if (rejectedById.get(window.employeeId)?.has(key)) continue;
            visitsById.get(window.employeeId)?.push({
              date: day,
              start: window.start,
              minutes: window.durationMinutes,
              serviceUserId: plan.serviceUserId,
              visitPlanId: plan.id,
              visitPlanSlotId: slot.id,
            });
          }
        }
      }
    }

    const graceMinutes = rule.graceMinutes;
    for (const id of ids) {
      const limitMinutes = limitById.get(id) ?? null;
      const visits = visitsById.get(id) ?? [];
      const threshold =
        limitMinutes != null ? limitMinutes + graceMinutes : null;
      const weeks: CarerHoursWeek[] = weekStarts.map((weekStart) => {
        const weekEnd = addDaysToOperationalIso(weekStart, 6);
        const list = visits
          .filter((v) => v.date >= weekStart && v.date <= weekEnd)
          .sort((a, b) => a.start.getTime() - b.start.getTime());
        let total = 0;
        let over = false;
        const overVisits: CarerHoursVisit[] = [];
        for (const v of list) {
          if (threshold != null && !over && total + v.minutes > threshold)
            over = true;
          if (over) overVisits.push(v);
          total += v.minutes;
        }
        return { weekStart, minutes: total, visits: list, overVisits };
      });
      const overWeeks = weeks.filter((w) => w.overVisits.length > 0);
      result.set(id, {
        limitMinutes,
        graceMinutes,
        weeks,
        overWeeks,
        heaviestMinutes: Math.max(0, ...weeks.map((w) => w.minutes)),
      });
    }
    return result;
  }

  /**
   * New rota visits for a carer (in the order given): which of them take a week over the
   * contracted weekly hours (+ grace). In a week over, the new visits are picked latest first
   * until the week fits — visits the carer already has never count as "over".
   */
  async checkNewVisits(
    client: Client,
    employeeId: string,
    newVisits: Array<{ start: Date; end: Date; serviceUserId?: string | null }>,
    options: { excludeAllocationIds?: string[] } = {},
  ): Promise<{
    limitMinutes: number | null;
    graceMinutes: number;
    /** Indexes of `newVisits` over the hours. */
    over: number[];
    weeks: Array<{ weekStart: string; minutes: number }>;
  }> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const extra: CarerHoursVisit[] = newVisits.map((v, i) => ({
      date: dayKeyInTimeZone(v.start, timeZone),
      start: v.start,
      minutes: Math.max(
        0,
        Math.round((v.end.getTime() - v.start.getTime()) / 60000),
      ),
      serviceUserId: v.serviceUserId ?? null,
      isNew: true,
      allocationId: `new:${i}`,
    }));
    const count = await this.count(client, employeeId, {
      extra,
      weekStarts: extra.map((v) => mondayOf(v.date)),
      excludeAllocationIds: options.excludeAllocationIds,
    });
    const over: number[] = [];
    if (count.limitMinutes != null) {
      const threshold = count.limitMinutes + count.graceMinutes;
      for (const week of count.weeks) {
        let excess = week.minutes - threshold;
        if (excess <= 0) continue;
        const fresh = week.visits
          .filter((v) => v.isNew)
          .sort((a, b) => b.start.getTime() - a.start.getTime());
        for (const v of fresh) {
          if (excess <= 0) break;
          over.push(Number(v.allocationId!.slice(4)));
          excess -= v.minutes;
        }
      }
    }
    return {
      limitMinutes: count.limitMinutes,
      graceMinutes: count.graceMinutes,
      over: over.sort((a, b) => a - b),
      weeks: count.weeks.map((w) => ({
        weekStart: w.weekStart,
        minutes: w.minutes,
      })),
    };
  }

  /**
   * Hold a rota visit back from a carer over their weekly hours until a manager approves
   * (Hours approvals). Approving allocates the carer with the details saved here.
   */
  async requestRotaVisitApproval(
    client: Client,
    params: {
      employeeId: string;
      scheduledJobId: string;
      serviceUserId: string | null;
      requestedById: string;
      start: Date;
      end: Date;
      weekStart: string;
      weekMinutes: number;
      limitMinutes: number;
      /** Where it came from: rota board, extra visit, special visit. */
      source: 'ROTA' | 'EXTRA_VISIT' | 'SPECIAL_VISIT';
      allocation: Record<string, unknown>;
    },
  ): Promise<{ id: string }> {
    const open = await client.employeeHoursApproval.findFirst({
      where: {
        requestType: EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS,
        employeeId: params.employeeId,
        status: EmployeeHoursApprovalStatus.PENDING,
        requestPayload: {
          path: ['scheduledJobId'],
          equals: params.scheduledJobId,
        },
      },
      select: { id: true },
    });
    if (open) return open;
    const contracted = Math.round((params.limitMinutes / 60) * 10) / 10;
    const projected = Math.round((params.weekMinutes / 60) * 10) / 10;
    const row = await client.employeeHoursApproval.create({
      data: {
        requestType: EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS,
        status: EmployeeHoursApprovalStatus.PENDING,
        employeeId: params.employeeId,
        serviceUserId: params.serviceUserId,
        contractedWeeklyHours: contracted,
        projectedWeeklyHours: projected,
        extraHours: Math.round((projected - contracted) * 10) / 10,
        requestPayload: {
          kind: 'ROTA_VISIT',
          source: params.source,
          scheduledJobId: params.scheduledJobId,
          start: params.start.toISOString(),
          end: params.end.toISOString(),
          weekStart: params.weekStart,
          weekMinutes: params.weekMinutes,
          allocation: params.allocation,
        } as Prisma.InputJsonValue,
        reason: "Rota visit over the carer's contracted weekly hours",
        requestedById: params.requestedById,
      },
      select: { id: true },
    });
    const display = await this.orgSettings.getOperationalDisplaySettings();
    const visitLabel = `${formatOrganisationIsoDate(
      dayKeyInTimeZone(params.start, display.timeZone),
      display.dateDisplayFormat,
    )} ${formatOrganisationHm(formatHmInTimeZone(params.start, display.timeZone), display.timeDisplayFormat)}–${formatOrganisationHm(formatHmInTimeZone(params.end, display.timeZone), display.timeDisplayFormat)}`;
    setImmediate(() => {
      void this.notificationHook.notifyRotaVisitRequested({
        approvalId: row.id,
        employeeId: params.employeeId,
        serviceUserId: params.serviceUserId,
        visitLabel,
        projectedWeeklyHours: projected,
        contractedWeeklyHours: contracted,
        requestedById: params.requestedById,
      });
    });
    return row;
  }

  /** Monday (YYYY-MM-DD) of the org-local week a moment falls in. */
  async weekStartOf(at: Date): Promise<string> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    return mondayOf(dayKeyInTimeZone(at, timeZone));
  }

  async dayOf(at: Date): Promise<string> {
    return dayKeyInTimeZone(
      at,
      await this.orgSettings.getOperationalTimezone(),
    );
  }
}
