import { BadRequestException, Injectable } from '@nestjs/common';
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
import {
  DEFAULT_CARER_MAX_WEEKLY_HOURS,
  type DomAllocationRuleBehavior,
  type WeeklyHoursOverMax,
} from '../organisation-general-settings/dom-care-allocation-rules.util';
import { buildVisitPlanOccurrence } from '../service-user-visit-plans/visit-plan-generate-occurrence.util';
import { EmployeeHoursApprovalNotificationHook } from './employee-hours-approval-notification.hook';
import { trackHoursRequest } from '../common/request-context/super-admin-context';

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
  /** Waiting for a manager on Hours approvals (counted as if approved). */
  pendingApprovalId?: string;
  /** A plan visit counted at a new time that waits for a manager (the request's id). */
  pendingTimeApprovalId?: string;
};

/**
 * A plan visit's new time waiting for a manager (Hours approvals): the plan and the rota keep
 * the old time until it is approved. Kept on the carer's plan request as `pendingTimes`.
 */
export type PendingPlanTimeChange = {
  slotId: string;
  slotLabel: string;
  fromStart: string;
  fromEnd: string;
  fromMinutes: number;
  toStart: string;
  toEnd: string;
  toMinutes: number;
  /** The slot's own duration field (may be empty), put back exactly. */
  fromDurationMinutes?: number | null;
  toDurationMinutes?: number | null;
};

/** HH:MM (or HH:MM:SS) as minutes from midnight. */
export function hmMinutes(time: string): number {
  const [h, m] = time.split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

export function samePlanTime(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && hmMinutes(a) === hmMinutes(b);
}

export type CarerHoursWeek = {
  /** Monday, YYYY-MM-DD. */
  weekStart: string;
  minutes: number;
  /** That week's limit in minutes: contracted + extra weekly hours given for it (null: no limit set). */
  limitMinutes: number | null;
  /** Extra weekly hours given for that week (Add extra hours), in minutes. */
  extraMinutes: number;
  visits: CarerHoursVisit[];
  /** Visits from the one that crosses the limit (+ grace) to the end of the week. */
  overVisits: CarerHoursVisit[];
};

export type CarerHoursCount = {
  /** Contracted weekly hours in minutes (null: none set — the carer can't be given visits). Each week's own limit is on the week. */
  limitMinutes: number | null;
  /** The carer's maximum weekly hours in minutes (Employment; blank = 60h). */
  maxMinutes: number;
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

/** "That week would have 66.5h — above the carer's 60h weekly maximum …" (stopped: Settings → Dom Rules doesn't allow it). */
export function carerOverMaxMessage(weekMinutes: number, maxMinutes: number): string {
  const h = (m: number) => `${Math.round((m / 60) * 10) / 10}h`;
  return `That week would have ${h(weekMinutes)} — above the carer's ${h(maxMinutes)} weekly maximum (Employment → Working hours)`;
}

/** "That week would have 66.5h — above the carer's 60h weekly maximum, so a manager must approve …". */
export function carerOverMaxApprovalMessage(weekMinutes: number, maxMinutes: number): string {
  const h = (m: number) => `${Math.round((m / 60) * 10) / 10}h`;
  return `That week would have ${h(weekMinutes)} — above the carer's ${h(maxMinutes)} weekly maximum, so a manager must approve`;
}

/** Shown wherever a carer with no contracted weekly hours would be given visits. */
export const CARER_NO_CONTRACTED_HOURS_MESSAGE =
  "This carer has no contracted weekly hours. Set their weekly hours first (Employment → Working hours), then give them visits.";

/** Error code the admin uses to open a dialog with a link to the carer's working hours. */
export const CARER_NO_CONTRACTED_HOURS_CODE = 'CARER_NO_CONTRACTED_HOURS';
/** Error code the admin uses to show "above the carer's maximum" in a dialog. */
export const CARER_OVER_MAX_CODE = 'CARER_OVER_MAX_WEEKLY_HOURS';

/** 400 for a carer with no contracted weekly hours (the admin shows a dialog with a link to them). */
export function carerNoContractedHoursError(employeeId: string, name?: string | null): BadRequestException {
  return new BadRequestException({
    code: CARER_NO_CONTRACTED_HOURS_CODE,
    employeeId,
    message: name ? `${name}: ${CARER_NO_CONTRACTED_HOURS_MESSAGE}` : CARER_NO_CONTRACTED_HOURS_MESSAGE,
  });
}

/** 400 for visits above the carer's maximum weekly hours when Settings → Dom Rules doesn't allow it. */
export function carerOverMaxError(employeeId: string, message: string): BadRequestException {
  return new BadRequestException({ code: CARER_OVER_MAX_CODE, employeeId, message });
}

/** Visits over a carer's weekly hours wait for a manager (Settings → Dom Rules); otherwise they are assigned with a warning. */
export function visitsNeedApproval(rule: { behavior: DomAllocationRuleBehavior }): boolean {
  return rule.behavior !== 'REQUEST_CONFIRMATION';
}

/** Settings → Dom Rules "Allow over a carer's maximum weekly hours". */
export function overMaxAllowed(rule: { allowOverMax: WeeklyHoursOverMax }): boolean {
  return rule.allowOverMax === 'YES';
}

/**
 * Above the carer's maximum weekly hours the visit goes to a manager only when Settings → Dom
 * Rules allows going over the maximum and visits over the hours need approval.
 */
export function overMaxNeedsApproval(rule: {
  allowOverMax: WeeklyHoursOverMax;
  behavior: DomAllocationRuleBehavior;
}): boolean {
  return overMaxAllowed(rule) && visitsNeedApproval(rule);
}

/** Minutes from a carer's Employment "Maximum weekly hours" (blank = 60h). */
export function carerMaxMinutes(maximumWeeklyHours: number | null | undefined): number {
  return Math.round(
    (maximumWeeklyHours != null && maximumWeeklyHours > 0 ? maximumWeeklyHours : DEFAULT_CARER_MAX_WEEKLY_HOURS) * 60,
  );
}

/** Monday–Sunday weeks (Mondays, YYYY-MM-DD) that the days from `startIso` to `endIso` touch. */
export function weeksTouched(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  for (let w = mondayOf(startIso); w <= endIso; w = addDaysToOperationalIso(w, 7)) out.push(w);
  return out;
}

/**
 * Extra weekly hours given to carers (Add extra hours), in minutes per carer per week (Monday),
 * for the weeks from `firstWeek` to `lastWeek`. Extras on the same week add up.
 */
export async function extraMinutesByWeek(
  client: Client,
  employeeIds: string[],
  firstWeek: string,
  lastWeek: string,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (!employeeIds.length) return out;
  const rows = await client.employeeExtraWeeklyHours.findMany({
    where: {
      employeeId: { in: employeeIds },
      cancelledAt: null,
      startDate: { lte: utcDay(addDaysToOperationalIso(lastWeek, 6)) },
      endDate: { gte: utcDay(firstWeek) },
    },
    select: { employeeId: true, startDate: true, endDate: true, extraHours: true },
  });
  for (const r of rows) {
    const byWeek = out.get(r.employeeId) ?? new Map<string, number>();
    const minutes = Math.round(r.extraHours * 60);
    for (const w of weeksTouched(r.startDate.toISOString().slice(0, 10), r.endDate.toISOString().slice(0, 10))) {
      byWeek.set(w, (byWeek.get(w) ?? 0) + minutes);
    }
    out.set(r.employeeId, byWeek);
  }
  return out;
}

function utcDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * A carer's weekly hours (Monday–Sunday) against their contracted weekly hours, the same
 * count everywhere a carer is put on visits:
 * - days with a rota: the rota visits allocated to the carer (plan, extra and special visits);
 * - days without a rota yet: the carer's visits on active visit plans;
 * - visits waiting for a manager on Hours approvals (rota, extra, special and plan visits).
 * Cancelled and missed visits never count; called-off ones count when Settings → Dom Rules says so.
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
      /** Requests waiting for a manager left out (e.g. the one being replaced). */
      excludeApprovalIds?: string[];
      /** Only these weeks (Mondays); default: this week and the next ones. */
      weekStarts?: string[];
      /** Rota allocations left out (e.g. the one being replaced). */
      excludeAllocationIds?: string[];
      /** "slotId|YYYY-MM-DD" plan visits the carer will not do (a manager rejected them). */
      skipPlanVisits?: Set<string>;
      /** Extra weekly hours not saved yet (a preview), minutes per carer per week. */
      addExtraMinutes?: Map<string, Map<string, number>>;
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
      excludeApprovalIds?: string[];
      /** Extra weekly hours not saved yet (a preview), minutes per carer per week. */
      addExtraMinutes?: Map<string, Map<string, number>>;
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
        select: { employeeId: true, contractedWeeklyHours: true, maximumWeeklyHours: true },
      }),
    ]);
    const maxById = new Map(employments.map((e) => [e.employeeId, carerMaxMinutes(e.maximumWeeklyHours)]));
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
    const extraByWeek = await extraMinutesByWeek(
      client,
      ids,
      firstDay,
      weekStarts[weekStarts.length - 1],
    );
    for (const [id, byWeek] of options.addExtraMinutes ?? []) {
      const merged = extraByWeek.get(id) ?? new Map<string, number>();
      for (const [week, minutes] of byWeek) merged.set(week, (merged.get(week) ?? 0) + minutes);
      extraByWeek.set(id, merged);
    }
    const from = operationalDayBounds(firstDay, timeZone).start;
    const to = operationalDayBounds(
      addDaysToOperationalIso(lastDay, 1),
      timeZone,
    ).start;
    const notHappening: ScheduledJobStatus[] = rule.countCalledOff
      ? [ScheduledJobStatus.CANCELLED, ScheduledJobStatus.MISSED]
      : [ScheduledJobStatus.CANCELLED, ScheduledJobStatus.MISSED, ScheduledJobStatus.CALLED_OFF];

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
    const rotaJobBySlotDay = new Map<
      string,
      {
        id: string;
        scheduledStartDateTime: Date;
        scheduledEndDateTime: Date | null;
        estimatedDurationMinutes: number | null;
      }
    >();
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
        select: {
          id: true,
          status: true,
          metadata: true,
          scheduledStartDateTime: true,
          scheduledEndDateTime: true,
          estimatedDurationMinutes: true,
        },
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
        else rotaJobBySlotDay.set(key, job);
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

    // 3) Visits waiting for a manager count as if approved, so several requests in one week
    // can't each look within the hours on their own.
    const allocatedJobs = new Set(
      allocations.map((a) => `${a.employeeId}|${a.scheduledJob.id}`),
    );
    const pendingRows = await client.employeeHoursApproval.findMany({
      where: {
        employeeId: { in: ids },
        status: EmployeeHoursApprovalStatus.PENDING,
        requestType: {
          in: [
            EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS,
            EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
          ],
        },
        ...(options.excludeApprovalIds?.length
          ? { id: { notIn: options.excludeApprovalIds } }
          : {}),
      },
      select: {
        id: true,
        employeeId: true,
        requestType: true,
        visitPlanId: true,
        serviceUserId: true,
        requestPayload: true,
      },
    });
    const pendingJobIds = pendingRows
      .filter((r) => r.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS)
      .map((r) => (r.requestPayload as { scheduledJobId?: string } | null)?.scheduledJobId)
      .filter((id): id is string => Boolean(id));
    const pendingJobs = new Map(
      (pendingJobIds.length
        ? await client.scheduledJob.findMany({
            where: {
              id: { in: pendingJobIds },
              deletedAt: null,
              isActive: true,
              status: { notIn: notHappening },
            },
            select: { id: true, serviceUserId: true, metadata: true },
          })
        : []
      ).map((j) => [j.id, j]),
    );
    for (const r of pendingRows) {
      if (!r.employeeId) continue;
      const list = visitsById.get(r.employeeId);
      if (!list) continue;
      if (r.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS) {
        const p = r.requestPayload as {
          scheduledJobId?: string;
          start?: string;
          end?: string;
        } | null;
        const job = p?.scheduledJobId ? pendingJobs.get(p.scheduledJobId) : undefined;
        if (!job || !p?.start || !p.end) continue;
        if (excludeJobs.has(job.id)) continue;
        if (allocatedJobs.has(`${r.employeeId}|${job.id}`)) {
          // A held edit of a visit the carer is on: counted at the new time.
          if (!(r.requestPayload as { pendingEdit?: unknown } | null)?.pendingEdit) continue;
          const onIt = list.find((v) => v.scheduledJobId === job.id && v.allocationId);
          if (!onIt) continue;
          const start = new Date(p.start);
          onIt.start = start;
          onIt.minutes = Math.max(0, Math.round((new Date(p.end).getTime() - start.getTime()) / 60000));
          onIt.pendingApprovalId = r.id;
          continue;
        }
        const meta = job.metadata as { visitPlanId?: string; visitPlanSlotId?: string } | null;
        // The plan being saved is counted from its rows.
        if (options.planOverride && meta?.visitPlanId === options.planOverride) continue;
        const start = new Date(p.start);
        const end = new Date(p.end);
        if (start < from || start >= to) continue;
        list.push({
          date: dayKeyInTimeZone(start, timeZone),
          start,
          minutes: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)),
          serviceUserId: job.serviceUserId,
          scheduledJobId: job.id,
          visitPlanId: meta?.visitPlanId,
          visitPlanSlotId: meta?.visitPlanSlotId,
          pendingApprovalId: r.id,
        });
        continue;
      }
      // Plan visits held back: days without a rota already count from the plan (above), so
      // only the rota visits the carer is not on yet are added.
      if (options.planOverride && r.visitPlanId === options.planOverride) continue;
      for (const key of (r.requestPayload as { withheld?: string[] } | null)?.withheld ?? []) {
        const [slotId, day] = key.split('|');
        if (!slotId || !day || day < firstDay || day > lastDay) continue;
        if (excludeSlots.has(slotId)) continue;
        const job = rotaJobBySlotDay.get(key);
        if (!job || excludeJobs.has(job.id) || allocatedJobs.has(`${r.employeeId}|${job.id}`)) continue;
        const minutes = job.scheduledEndDateTime
          ? Math.max(
              0,
              Math.round(
                (job.scheduledEndDateTime.getTime() - job.scheduledStartDateTime.getTime()) / 60000,
              ),
            )
          : (job.estimatedDurationMinutes ?? 0);
        list.push({
          date: day,
          start: job.scheduledStartDateTime,
          minutes,
          serviceUserId: r.serviceUserId,
          scheduledJobId: job.id,
          visitPlanId: r.visitPlanId ?? undefined,
          visitPlanSlotId: slotId,
          pendingApprovalId: r.id,
        });
      }
    }

    // 4) Plan visit times waiting for a manager count at the new time, while the plan still
    // has the old one (inside a save it may already have the new time).
    const timeRows = await client.employeeHoursApproval.findMany({
      where: {
        status: EmployeeHoursApprovalStatus.PENDING,
        requestType: EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
        ...(options.excludeApprovalIds?.length
          ? { id: { notIn: options.excludeApprovalIds } }
          : {}),
      },
      select: { id: true, requestPayload: true },
    });
    const timeChanges = new Map<string, PendingPlanTimeChange & { approvalId: string }>();
    for (const r of timeRows) {
      for (const c of (r.requestPayload as { pendingTimes?: PendingPlanTimeChange[] } | null)?.pendingTimes ?? []) {
        if (c?.slotId && !excludeSlots.has(c.slotId)) timeChanges.set(c.slotId, { ...c, approvalId: r.id });
      }
    }
    if (timeChanges.size) {
      const slotsNow = await client.visitPlanSlot.findMany({
        where: { id: { in: [...timeChanges.keys()] } },
        select: { id: true, plannedStartTime: true, plannedEndTime: true },
      });
      for (const slot of slotsNow) {
        const c = timeChanges.get(slot.id)!;
        if (!samePlanTime(slot.plannedStartTime, c.fromStart) || !samePlanTime(slot.plannedEndTime, c.fromEnd)) {
          timeChanges.delete(slot.id);
        }
      }
      for (const slotId of [...timeChanges.keys()]) {
        if (!slotsNow.some((s) => s.id === slotId)) timeChanges.delete(slotId);
      }
      for (const list of visitsById.values()) {
        for (const v of list) {
          const c = v.visitPlanSlotId ? timeChanges.get(v.visitPlanSlotId) : undefined;
          if (!c || v.date < today) continue;
          v.start = new Date(v.start.getTime() + (hmMinutes(c.toStart) - hmMinutes(c.fromStart)) * 60000);
          v.minutes = Math.max(0, v.minutes + c.toMinutes - c.fromMinutes);
          v.pendingTimeApprovalId = c.approvalId;
        }
      }
    }

    const graceMinutes = rule.graceMinutes;
    for (const id of ids) {
      const limitMinutes = limitById.get(id) ?? null;
      const visits = visitsById.get(id) ?? [];
      const weeks: CarerHoursWeek[] = weekStarts.map((weekStart) => {
        const weekEnd = addDaysToOperationalIso(weekStart, 6);
        // Extra weekly hours raise that week's limit (only for a carer with contracted hours).
        const extraMinutes = extraByWeek.get(id)?.get(weekStart) ?? 0;
        const weekLimit = limitMinutes != null ? limitMinutes + extraMinutes : null;
        const threshold = weekLimit != null ? weekLimit + graceMinutes : null;
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
        return {
          weekStart,
          minutes: total,
          limitMinutes: weekLimit,
          extraMinutes,
          visits: list,
          overVisits,
        };
      });
      const overWeeks = weeks.filter((w) => w.overVisits.length > 0);
      result.set(id, {
        limitMinutes,
        maxMinutes: maxById.get(id) ?? carerMaxMinutes(null),
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
   * contracted weekly hours (+ grace), and which take it over the carer's maximum weekly hours
   * (Employment; blank = 60h). In a week over, the new visits are picked
   * latest first until the week fits — visits the carer already has never count as "over".
   */
  async checkNewVisits(
    client: Client,
    employeeId: string,
    newVisits: Array<{ start: Date; end: Date; serviceUserId?: string | null }>,
    options: { excludeAllocationIds?: string[] } = {},
  ): Promise<{
    /** The first week's limit (contracted + extra for that week); each week has its own below. */
    limitMinutes: number | null;
    /** Contracted weekly hours in minutes (without extra hours). */
    contractedMinutes: number | null;
    graceMinutes: number;
    /** Indexes of `newVisits` over the hours. */
    over: number[];
    /** The carer's maximum weekly hours, in minutes. */
    maxMinutes: number;
    /** The carer has no contracted weekly hours: they can't be given visits. */
    noContractedHours: boolean;
    /** Indexes of `newVisits` that take a week over `maxMinutes`. */
    overMax: number[];
    weeks: Array<{ weekStart: string; minutes: number; limitMinutes: number | null; extraMinutes: number }>;
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
    const newOver = (thresholdOf: (week: CarerHoursWeek) => number | null): number[] => {
      const out: number[] = [];
      for (const week of count.weeks) {
        const threshold = thresholdOf(week);
        if (threshold == null) continue;
        let excess = week.minutes - threshold;
        if (excess <= 0) continue;
        const fresh = week.visits
          .filter((v) => v.isNew)
          .sort((a, b) => b.start.getTime() - a.start.getTime());
        for (const v of fresh) {
          if (excess <= 0) break;
          out.push(Number(v.allocationId!.slice(4)));
          excess -= v.minutes;
        }
      }
      return out.sort((a, b) => a - b);
    };
    return {
      limitMinutes: count.weeks[0]?.limitMinutes ?? count.limitMinutes,
      contractedMinutes: count.limitMinutes,
      graceMinutes: count.graceMinutes,
      over: newOver((w) => (w.limitMinutes != null ? w.limitMinutes + count.graceMinutes : null)),
      maxMinutes: count.maxMinutes,
      noContractedHours: count.limitMinutes == null,
      overMax: newOver(() => count.maxMinutes),
      weeks: count.weeks.map((w) => ({
        weekStart: w.weekStart,
        minutes: w.minutes,
        limitMinutes: w.limitMinutes,
        extraMinutes: w.extraMinutes,
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
      /** An extra visit edit held until approved (applied when every carer it waits on is). */
      pendingEdit?: Record<string, unknown>;
      /** Carers taken off the visit when this is approved (a run carer taking it over). */
      replaceEmployeeIds?: string[];
      replaceEmployeeNames?: string[];
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
      select: { id: true, requestPayload: true },
    });
    if (open && params.pendingEdit) {
      // A newer edit of the same visit replaces the one waiting.
      await client.employeeHoursApproval.update({
        where: { id: open.id },
        data: {
          requestPayload: {
            ...((open.requestPayload ?? {}) as Record<string, unknown>),
            start: params.start.toISOString(),
            end: params.end.toISOString(),
            weekMinutes: params.weekMinutes,
            pendingEdit: params.pendingEdit,
          } as Prisma.InputJsonValue,
        },
      });
    }
    if (open) {
      trackHoursRequest(open.id);
      return { id: open.id };
    }
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
          ...(params.pendingEdit ? { pendingEdit: params.pendingEdit } : {}),
          ...(params.replaceEmployeeIds?.length
            ? { replaceEmployeeIds: params.replaceEmployeeIds, replaceEmployeeNames: params.replaceEmployeeNames ?? [] }
            : {}),
        } as Prisma.InputJsonValue,
        reason: "Rota visit over the carer's contracted weekly hours",
        requestedById: params.requestedById,
      },
      select: { id: true },
    });
    trackHoursRequest(row.id);
    const display = await this.orgSettings.getOperationalDisplaySettings();
    const visitLabel = `${formatOrganisationIsoDate(
      dayKeyInTimeZone(params.start, display.timeZone),
      display.dateDisplayFormat,
    )} ${formatOrganisationHm(formatHmInTimeZone(params.start, display.timeZone), display.timeDisplayFormat)}–${formatOrganisationHm(formatHmInTimeZone(params.end, display.timeZone), display.timeDisplayFormat)}`;
    const editBefore = (params.pendingEdit as { before?: { startTime?: string; endTime?: string } } | undefined)?.before;
    const heldEditFrom =
      editBefore?.startTime && editBefore.endTime
        ? `${formatOrganisationHm(editBefore.startTime.slice(0, 5), display.timeDisplayFormat)}–${formatOrganisationHm(editBefore.endTime.slice(0, 5), display.timeDisplayFormat)}`
        : undefined;
    setImmediate(() => {
      void this.notificationHook.notifyRotaVisitRequested({
        approvalId: row.id,
        employeeId: params.employeeId,
        serviceUserId: params.serviceUserId,
        visitLabel,
        projectedWeeklyHours: projected,
        contractedWeeklyHours: contracted,
        requestedById: params.requestedById,
        heldEditFrom,
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
