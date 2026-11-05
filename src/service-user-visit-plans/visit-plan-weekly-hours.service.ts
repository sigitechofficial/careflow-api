import { Injectable, Optional } from '@nestjs/common';
import {
  EmployeeHoursApprovalStatus,
  EmployeeHoursApprovalType,
  Prisma,
  ScheduledJobStatus,
  VisitPlanNightDuty,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { formatOrganisationIsoDate } from '../common/utils/organisation-display-format.util';
import { currentServiceUserWeeklyHours } from '../service-user-dom-care/service-user-weekly-hours-sync.util';
import { parseWeeklyContractedHours } from './visit-plan-contracted-hours.util';
import type { SlotWithRelations } from './visit-plan-generate-occurrence.util';
import { buildVisitPlanOccurrence } from './visit-plan-generate-occurrence.util';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
} from '../common/utils/operational-day.util';
import { clampRotaHorizonDays, parseRotaHorizonMode } from './visit-plan-rolling-rota.util';
import { resolveRollingRotaCatchUpWindow } from './visit-plan-rolling-rota-catchup.util';
import {
  ServiceUserTimebankLedgerService,
  TimebankBudget,
} from '../service-user-hours/service-user-timebank-ledger.service';
import {
  visitPlanOccurrenceMinutes,
  type MultiCarerHoursMode,
  type VisitPlanWeekHours,
  type VisitPlanWeeklyHoursSummary,
} from './visit-plan-weekly-hours.util';
import { trackHoursRequest } from '../common/request-context/super-admin-context';

type HoursClient = Prisma.TransactionClient | PrismaService;

/** A plan visit or special visit held over the weekly hours (request payload, kind PLAN_VISIT / SPECIAL_VISIT). */
export type ServiceUserVisitHoldPayload = {
  /** EXTRA_EDIT: an extra visit made longer — keeps its time until approved. PLAN_TIME: a plan visit made longer (amendment). */
  kind: 'PLAN_VISIT' | 'SPECIAL_VISIT' | 'EXTRA_EDIT' | 'PLAN_TIME';
  /** Visit day (org timezone) and start, for the list and for expiry. */
  date: string;
  startsAt: string;
  endsAt: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  requiredCarers: number;
  slotLabel: string;
  weekStart: string;
  /** Week minutes with this visit added, when it was held. */
  weekMinutes: number;
  limitWeeklyHours: number | null;
  /** Minutes the week's visits held from the timebank then (they count on top of the weekly hours). */
  timebankMinutes?: number;
  /** PLAN_VISIT: the plan slot; the visit is made by generating that day. */
  visitPlanSlotId?: string;
  /** SPECIAL_VISIT: the create request, replayed on approve. */
  specialVisit?: Record<string, unknown>;
  /** EXTRA_EDIT / PLAN_TIME: the time before the change (kept until approved). */
  fromStartTime?: string;
  fromEndTime?: string;
  /** Minutes each held visit adds to its week (EXTRA_EDIT / PLAN_TIME), for the auto-approve check. */
  heldDeltas?: Array<{ date: string; minutes: number }>;
  /** EXTRA_EDIT: the edit, replayed on approve. */
  pendingEdit?: Record<string, unknown>;
  /** PLAN_TIME: the slot time change and the rota visits keeping the old time until approved. */
  planTimeChange?: Record<string, unknown>;
  /** Set once approved: the rota job that was made. */
  createdJobId?: string;
};

/** "25h 50m" — same format as the plan page. */
/** Sleeping and waking nights are not billed hourly, so they never use the timebank. */
export function isNightDutyVisit(nightDuty: string | null | undefined): boolean {
  return nightDuty === VisitPlanNightDuty.SLEEPING_NIGHT || nightDuty === VisitPlanNightDuty.WAKING_NIGHT;
}

export function formatHoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function mondayOfIso(iso: string): string {
  const offset = (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysToOperationalIso(iso, -offset);
}

/**
 * Service user weekly hours (Monday–Sunday) counted from the visits on the rota, from this week's
 * Monday to the rota horizon (Settings → Dom Rules). A visit counts its full time for every carer it
 * needs (double-up = each carer's time, sleeping nights full hours); cancelled visits don't count,
 * called-off ones do; special visits follow the setting. Before visits exist (plan page while
 * editing, a draft) the plan's own visits are used for the days from today.
 */
@Injectable()
export class VisitPlanWeeklyHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    @Optional() private readonly timebankLedger?: ServiceUserTimebankLedgerService,
  ) {}

  /**
   * What the service user's timebank can pay for (docs/SU_TIMEBANK_USE_PLAN.md). Settles the bank
   * first. Without the setting it only carries the minutes visits already hold, so those weeks
   * are not counted as over again.
   */
  async timebankBudget(serviceUserId: string): Promise<TimebankBudget> {
    return this.timebankLedger ? this.timebankLedger.budget(serviceUserId) : TimebankBudget.none();
  }

  /** Writes RESERVED rows for visits whose hours over come from the timebank. */
  async reserveTimebank(
    client: HoursClient,
    rows: Parameters<ServiceUserTimebankLedgerService['reserve']>[1],
  ): Promise<void> {
    if (this.timebankLedger && rows.length) await this.timebankLedger.reserve(client, rows);
  }

  /** Settings shared by every count (timezone, date format, weekly hours rules). */
  async context() {
    const [display, rules] = await Promise.all([
      this.orgSettings.getOperationalDisplaySettings(),
      this.orgSettings.getServiceUserWeeklyHoursSettings(),
    ]);
    // A double-up always counts every carer's time (3 carers on a 1h visit = 3h of service).
    const mode: MultiCarerHoursMode = 'COMBINED';
    return {
      timeZone: display.timeZone,
      dateDisplayFormat: display.dateDisplayFormat,
      mode,
      rules,
    };
  }

  /** Days counted: this week's Monday → the rota horizon edge (FIXED_DAYS or end of month). */
  async window(timeZone?: string): Promise<{ today: string; monday: string; edge: string }> {
    const tz = timeZone ?? (await this.orgSettings.getOperationalTimezone());
    const today = dayKeyInTimeZone(new Date(), tz);
    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { domRotaHorizonDays: true, domRotaHorizonMode: true },
    });
    const { toDate } = resolveRollingRotaCatchUpWindow(
      today,
      parseRotaHorizonMode(settings?.domRotaHorizonMode ?? 'FIXED_DAYS'),
      clampRotaHorizonDays(settings?.domRotaHorizonDays ?? 28),
    );
    return { today, monday: mondayOfIso(today), edge: toDate };
  }

  /** The service user's weekly contracted hours (approved value), as a number. */
  async limit(
    client: HoursClient,
    serviceUserId: string,
    fallback?: string | null,
  ): Promise<number | null> {
    const current = await currentServiceUserWeeklyHours(client, serviceUserId);
    return parseWeeklyContractedHours(current ?? fallback ?? null);
  }

  /**
   * Minutes one rota job uses of the weekly hours: its time for every carer it needs. The visit's
   * window (end − start) comes first — a time change on the rota moves the window but leaves the
   * stored estimated duration as it was.
   */
  static jobMinutes(job: {
    scheduledStartDateTime: Date;
    scheduledEndDateTime: Date | null;
    estimatedDurationMinutes: number | null;
    requiredCarers: number | null;
  }): number {
    const minutes = job.scheduledEndDateTime
      ? Math.round((job.scheduledEndDateTime.getTime() - job.scheduledStartDateTime.getTime()) / 60000)
      : (job.estimatedDurationMinutes ?? 0);
    return Math.max(0, minutes) * Math.max(1, job.requiredCarers ?? 1);
  }

  /**
   * Rota visits of the service user per day (org timezone). `excludePlanFrom` leaves out one plan's
   * visits from a day on (they are replaced by the plan's own visits in a preview).
   */
  async rotaMinutesByDay(
    client: HoursClient,
    serviceUserId: string,
    fromIso: string,
    toIso: string,
    opts?: {
      timeZone?: string;
      specialVisitsCount?: boolean;
      excludePlanFrom?: { planId: string; fromIso: string };
    },
  ): Promise<Map<string, { minutes: number; visits: number; sleepIns: number }>> {
    const ctx = opts?.timeZone && opts.specialVisitsCount !== undefined ? null : await this.context();
    const timeZone = opts?.timeZone ?? ctx!.timeZone;
    const specialVisitsCount = opts?.specialVisitsCount ?? ctx!.rules.specialVisitsCount;
    const jobs = await client.scheduledJob.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        status: { not: ScheduledJobStatus.CANCELLED },
        // A day either side, then cut by the operational day below.
        scheduledStartDateTime: {
          gte: new Date(`${addDaysToOperationalIso(fromIso, -1)}T00:00:00Z`),
          lte: new Date(`${addDaysToOperationalIso(toIso, 1)}T23:59:59Z`),
        },
      },
      select: {
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        estimatedDurationMinutes: true,
        requiredCarers: true,
        metadata: true,
      },
    });
    const byDay = new Map<string, { minutes: number; visits: number; sleepIns: number }>();
    for (const job of jobs) {
      const day = dayKeyInTimeZone(job.scheduledStartDateTime, timeZone);
      if (day < fromIso || day > toIso) continue;
      const meta = (job.metadata ?? {}) as { special?: boolean; visitPlanId?: string; nightDuty?: string };
      if (meta.special === true && !specialVisitsCount) continue;
      if (
        opts?.excludePlanFrom &&
        meta.visitPlanId === opts.excludePlanFrom.planId &&
        day >= opts.excludePlanFrom.fromIso
      ) {
        continue;
      }
      const row = byDay.get(day) ?? { minutes: 0, visits: 0, sleepIns: 0 };
      row.minutes += VisitPlanWeeklyHoursService.jobMinutes(job);
      row.visits += 1;
      if (meta.nightDuty === VisitPlanNightDuty.SLEEPING_NIGHT) row.sleepIns += 1;
      byDay.set(day, row);
    }
    return byDay;
  }

  /**
   * Visits of the plan cancelled on the rota (from yesterday on), as "slotId|YYYY-MM-DD": they
   * don't use the weekly hours. A called-off visit still counts.
   */
  async cancelledOnRota(client: HoursClient, planId: string): Promise<Set<string>> {
    const jobs = await client.scheduledJob.findMany({
      where: {
        deletedAt: null,
        status: ScheduledJobStatus.CANCELLED,
        scheduledStartDateTime: { gte: new Date(Date.now() - 86400000) },
        metadata: { path: ['visitPlanId'], equals: planId },
      },
      select: { metadata: true },
    });
    const keys = new Set<string>();
    for (const job of jobs) {
      const m = job.metadata as { visitPlanSlotId?: string; date?: string } | null;
      if (m?.visitPlanSlotId && m.date) keys.add(`${m.visitPlanSlotId}|${m.date.slice(0, 10)}`);
    }
    return keys;
  }

  /**
   * Plan visits held over the weekly hours and not made: waiting for a manager, or rejected
   * ("slotId|YYYY-MM-DD"). Generation skips them; an approved one is made on approve.
   */
  async heldPlanVisits(client: HoursClient, planId: string): Promise<Set<string>> {
    const rows = await client.employeeHoursApproval.findMany({
      where: {
        visitPlanId: planId,
        requestType: EmployeeHoursApprovalType.SERVICE_USER_VISIT_OVER_HOURS,
        status: { in: [EmployeeHoursApprovalStatus.PENDING, EmployeeHoursApprovalStatus.REJECTED] },
      },
      select: { requestPayload: true },
    });
    const keys = new Set<string>();
    for (const r of rows) {
      const p = r.requestPayload as Partial<ServiceUserVisitHoldPayload> | null;
      if (p?.kind === 'PLAN_VISIT' && p.visitPlanSlotId && p.date) keys.add(`${p.visitPlanSlotId}|${p.date}`);
    }
    return keys;
  }

  /**
   * Weekly hours from this week to the rota edge. Plain = the rota as it is. With `planFromRows`
   * the plan's visits from today on come from its rows as `client` sees them (a preview inside a
   * rolled-back transaction, or a draft), minus the visits held over the hours.
   */
  async weeks(
    client: HoursClient,
    serviceUserId: string,
    opts?: { planFromRows?: string },
  ): Promise<VisitPlanWeeklyHoursSummary & { today: string; edge: string }> {
    const ctx = await this.context();
    const { today, monday, edge } = await this.window(ctx.timeZone);
    const planId = opts?.planFromRows;
    const rota = await this.rotaMinutesByDay(client, serviceUserId, monday, edge, {
      timeZone: ctx.timeZone,
      specialVisitsCount: ctx.rules.specialVisitsCount,
      excludePlanFrom: planId ? { planId, fromIso: today } : undefined,
    });
    let planDay: ((dayIso: string) => { minutes: number; visits: number; sleepIns: number }) | null = null;
    if (planId) {
      const plan = await client.serviceUserVisitPlan.findUniqueOrThrow({
        where: { id: planId },
        select: {
          effectiveFrom: true,
          effectiveTo: true,
          slots: { include: { carerAssignments: true, exceptions: true } },
        },
      });
      const cancelled = await this.cancelledOnRota(client, planId);
      const held = await this.heldPlanVisits(client, planId);
      const slots = plan.slots.filter((s) => s.isEnabled || s.exceptions.length);
      planDay = (dayIso) => {
        const row = { minutes: 0, visits: 0, sleepIns: 0 };
        for (const slot of slots) {
          if (held.has(`${slot.id}|${dayIso}`)) continue;
          const minutes = visitPlanOccurrenceMinutes({
            slot,
            dayIso,
            planAnchor: plan.effectiveFrom,
            planEffectiveTo: plan.effectiveTo,
            timeZone: ctx.timeZone,
            mode: ctx.mode,
            cancelledOnRota: cancelled,
          });
          if (minutes <= 0) continue;
          row.minutes += minutes;
          row.visits += 1;
          const occurrence = buildVisitPlanOccurrence(
            slot as SlotWithRelations,
            new Date(`${dayIso}T00:00:00Z`),
            plan.effectiveFrom,
            plan.effectiveTo,
            { timeZone: ctx.timeZone },
          );
          if (occurrence && !occurrence.isExtra && slot.nightDuty === VisitPlanNightDuty.SLEEPING_NIGHT) {
            row.sleepIns += 1;
          }
        }
        return row;
      };
    }
    const weeks: VisitPlanWeekHours[] = [];
    for (let weekStart = monday; weekStart <= edge; weekStart = addDaysToOperationalIso(weekStart, 7)) {
      const week: VisitPlanWeekHours = { weekStart, minutes: 0, visits: 0, sleepInNights: 0 };
      for (let d = 0; d < 7; d++) {
        const dayIso = addDaysToOperationalIso(weekStart, d);
        if (dayIso > edge) break;
        for (const row of [rota.get(dayIso), planDay && dayIso >= today ? planDay(dayIso) : undefined]) {
          if (!row) continue;
          week.minutes += row.minutes;
          week.visits += row.visits;
          week.sleepInNights += row.sleepIns;
        }
      }
      weeks.push(week);
    }
    const heaviestWeek = weeks.reduce<VisitPlanWeekHours | null>(
      (best, week) => (week.minutes > 0 && (!best || week.minutes > best.minutes) ? week : best),
      null,
    );
    return { mode: ctx.mode, weeks, heaviestWeek, today, edge };
  }

  /** Week minutes on the rota for the Monday–Sunday week holding `date` (whole week). */
  async weekMinutes(client: HoursClient, serviceUserId: string, date: string): Promise<{ weekStart: string; minutes: number }> {
    const weekStart = mondayOfIso(date);
    const byDay = await this.rotaMinutesByDay(client, serviceUserId, weekStart, addDaysToOperationalIso(weekStart, 6));
    let minutes = 0;
    for (const row of byDay.values()) minutes += row.minutes;
    return { weekStart, minutes };
  }

  /** Summary plus the limit and the weeks over it, as returned to the plan page. */
  withLimit(
    summary: VisitPlanWeeklyHoursSummary & { today?: string; edge?: string },
    limitWeeklyHours: number | null,
    visitsNeedApproval: boolean,
    /** Timebank: minutes visits hold from the bank count on top of the weekly hours. */
    timebank?: TimebankBudget,
  ) {
    const limitMinutes = limitWeeklyHours != null ? Math.round(limitWeeklyHours * 60) : null;
    const fromBank = (weekStart: string) => timebank?.reservedIn(weekStart) ?? 0;
    return {
      ...summary,
      weeks: summary.weeks.map((w) => ({ ...w, timebankMinutes: fromBank(w.weekStart) })),
      limitWeeklyHours,
      visitsNeedApproval,
      overLimitWeeks:
        limitMinutes == null
          ? []
          : summary.weeks.filter((w) => w.minutes > limitMinutes + fromBank(w.weekStart)),
      timebank: timebank
        ? { useTimebank: timebank.enabled, availableMinutes: timebank.availableMinutes }
        : null,
    };
  }

  /**
   * Which of these new visits fit the service user's weekly hours. Visits are taken in time order
   * and added to their week as they fit; once a week has no room, the rest of that week's new
   * visits are over (held when Settings → Dom Rules needs approval). A week already over keeps
   * what it has, but gets nothing new.
   */
  async classifyNewVisits<T extends { date: string; startsAt: string; minutes: number; noTimebank?: boolean }>(params: {
    client?: HoursClient;
    serviceUserId: string;
    fallbackHours?: string | null;
    visits: T[];
    /** Timebank: a week also has the minutes visits hold from the bank; the bank may pay for the hours over. */
    budget?: TimebankBudget;
  }): Promise<{
    limitWeeklyHours: number | null;
    visits: Array<T & { weekStart: string; weekMinutes: number; over: boolean; fromTimebankMinutes: number }>;
  }> {
    const client = params.client ?? this.prisma;
    const limit = await this.limit(client, params.serviceUserId, params.fallbackHours);
    const sorted = [...params.visits].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    if (limit == null) {
      return {
        limitWeeklyHours: null,
        visits: sorted.map((v) => ({
          ...v,
          weekStart: mondayOfIso(v.date),
          weekMinutes: 0,
          over: false,
          fromTimebankMinutes: 0,
        })),
      };
    }
    const limitMinutes = Math.round(limit * 60);
    const weekTotals = new Map<string, number>();
    const out: Array<T & { weekStart: string; weekMinutes: number; over: boolean; fromTimebankMinutes: number }> = [];
    for (const v of sorted) {
      const weekStart = mondayOfIso(v.date);
      if (!weekTotals.has(weekStart)) {
        weekTotals.set(weekStart, (await this.weekMinutes(client, params.serviceUserId, v.date)).minutes);
      }
      const before = weekTotals.get(weekStart)!;
      const after = before + v.minutes;
      const room = limitMinutes + (params.budget?.reservedIn(weekStart) ?? 0);
      let over = v.minutes > 0 && after > room;
      let fromTimebankMinutes = 0;
      // Night visits (sleeping / waking) never use the bank: their rate is not hourly
      // (docs/SU_TIMEBANK_INVOICE_PLAN.md T4).
      if (over && params.budget && !v.noTimebank) {
        const part = after - Math.max(before, room);
        if (params.budget.cover(weekStart, part)) {
          over = false;
          fromTimebankMinutes = part;
        }
      }
      if (!over) weekTotals.set(weekStart, after);
      out.push({ ...v, weekStart, weekMinutes: after, over, fromTimebankMinutes });
    }
    return { limitWeeklyHours: limit, visits: out };
  }

  /**
   * New extra visits on these dates (same time each): which fit the weekly hours. Taken in date
   * order, so two extras in one week are counted together.
   */
  async classifyExtraDates(params: {
    serviceUserId: string;
    fallbackHours?: string | null;
    dates: string[];
    startTime: string;
    durationMinutes: number;
    requiredCarers: number;
    budget?: TimebankBudget;
    /** Sleeping / waking night: never paid from the bank. */
    nightDuty?: string | null;
  }): Promise<{
    limitWeeklyHours: number | null;
    dates: Array<{
      date: string;
      weekStart: string;
      weekMinutes: number;
      needsApproval: boolean;
      fromTimebankMinutes: number;
    }>;
  }> {
    const result = await this.classifyNewVisits({
      serviceUserId: params.serviceUserId,
      fallbackHours: params.fallbackHours,
      budget: params.budget,
      visits: [...new Set(params.dates)].map((date) => ({
        date,
        startsAt: `${date}T${params.startTime}`,
        minutes: params.durationMinutes * Math.max(1, params.requiredCarers),
        noTimebank: isNightDutyVisit(params.nightDuty),
      })),
    });
    return {
      limitWeeklyHours: result.limitWeeklyHours,
      dates: result.visits.map((v) => ({
        date: v.date,
        weekStart: v.weekStart,
        weekMinutes: v.weekMinutes,
        needsApproval: v.over,
        fromTimebankMinutes: v.fromTimebankMinutes,
      })),
    };
  }

  /**
   * An extra visit being edited, with its new time: its week on the rota. `blocked` when it goes
   * over and Settings → Dom Rules needs approval (the edit waits for a manager, the visit keeps its
   * time); otherwise only a warning. Null when the extra visit is not on this plan.
   */
  async checkExtraEdit(params: {
    serviceUserId: string;
    planId: string;
    fallbackHours?: string | null;
    exceptionId: string;
    durationMinutes: number;
    requiredCarers: number;
    budget?: TimebankBudget;
    /** Sleeping / waking night: never paid from the bank. */
    nightDuty?: string | null;
  }): Promise<{
    limitWeeklyHours: number | null;
    weekStart: string;
    weekMinutes: number;
    over: boolean;
    blocked: boolean;
    fromTimebankMinutes: number;
  } | null> {
    const original = await this.prisma.visitPlanSlotException.findFirst({
      where: { id: params.exceptionId, visitPlanSlot: { visitPlanId: params.planId } },
      select: { exceptionDate: true, durationMinutes: true, requiredCarers: true },
    });
    if (!original) return null;
    const ctx = await this.context();
    const check = await this.checkLongerVisit({
      serviceUserId: params.serviceUserId,
      fallbackHours: params.fallbackHours,
      date: original.exceptionDate.toISOString().slice(0, 10),
      oldMinutes: (original.durationMinutes ?? 0) * Math.max(1, original.requiredCarers ?? 1),
      newMinutes: params.durationMinutes * Math.max(1, params.requiredCarers),
      budget: params.budget,
      noTimebank: isNightDutyVisit(params.nightDuty),
    });
    return { ...check, blocked: check.over && ctx.rules.visitsNeedApproval };
  }

  /**
   * An existing visit made longer (or given more carers): its week with the new time. `over` when
   * the week goes over the hours and above what it has now.
   */
  async checkLongerVisit(params: {
    serviceUserId: string;
    fallbackHours?: string | null;
    date: string;
    oldMinutes: number;
    newMinutes: number;
    budget?: TimebankBudget;
    /** Sleeping / waking night: never paid from the bank. */
    noTimebank?: boolean;
  }): Promise<{
    limitWeeklyHours: number | null;
    weekStart: string;
    weekMinutes: number;
    over: boolean;
    fromTimebankMinutes: number;
  }> {
    const limit = await this.limit(this.prisma, params.serviceUserId, params.fallbackHours);
    const week = await this.weekMinutes(this.prisma, params.serviceUserId, params.date);
    const after = week.minutes - params.oldMinutes + params.newMinutes;
    const room = limit != null ? Math.round(limit * 60) + (params.budget?.reservedIn(week.weekStart) ?? 0) : null;
    let over = room != null && params.newMinutes > params.oldMinutes && after > room;
    let fromTimebankMinutes = 0;
    if (over && room != null && params.budget && !params.noTimebank) {
      const part = after - Math.max(week.minutes, room);
      if (params.budget.cover(week.weekStart, part)) {
        over = false;
        fromTimebankMinutes = part;
      }
    }
    return { limitWeeklyHours: limit, weekStart: week.weekStart, weekMinutes: after, over, fromTimebankMinutes };
  }

  /**
   * Hold one visit over the weekly hours: a PENDING request on Hours approvals (the visit is not
   * made). One request per visit, so expiry and auto-approve work visit by visit.
   */
  async holdVisit(
    client: HoursClient,
    params: {
      userId: string;
      serviceUserId: string;
      visitPlanId: string | null;
      payload: ServiceUserVisitHoldPayload;
      reason?: string | null;
    },
  ): Promise<string> {
    const p = params.payload;
    const limitMinutes = p.limitWeeklyHours != null ? Math.round(p.limitWeeklyHours * 60) : null;
    const row = await client.employeeHoursApproval.create({
      data: {
        requestType: EmployeeHoursApprovalType.SERVICE_USER_VISIT_OVER_HOURS,
        status: EmployeeHoursApprovalStatus.PENDING,
        serviceUserId: params.serviceUserId,
        visitPlanId: params.visitPlanId,
        contractedWeeklyHours: p.limitWeeklyHours,
        projectedWeeklyHours: Math.round((p.weekMinutes / 60) * 10) / 10,
        extraHours: limitMinutes != null ? Math.round(((p.weekMinutes - limitMinutes) / 60) * 10) / 10 : null,
        requestPayload: p as unknown as Prisma.InputJsonValue,
        reason: params.reason ?? 'Over the service user\'s weekly hours',
        requestedById: params.userId,
      },
      select: { id: true },
    });
    trackHoursRequest(row.id);
    return row.id;
  }

  /** "the week of 26/10/2026 would have 26h of 25h (1h over)". */
  async describeWeek(weekStart: string, weekMinutes: number, limitWeeklyHours: number | null): Promise<string> {
    const { dateDisplayFormat } = await this.context();
    const week = `the week of ${formatOrganisationIsoDate(weekStart, dateDisplayFormat)}`;
    if (limitWeeklyHours == null) return `${week} would have ${formatHoursMinutes(weekMinutes)}`;
    const limitMinutes = Math.round(limitWeeklyHours * 60);
    return (
      `${week} would have ${formatHoursMinutes(weekMinutes)} of ${formatHoursMinutes(limitMinutes)}` +
      (weekMinutes > limitMinutes ? ` (${formatHoursMinutes(weekMinutes - limitMinutes)} over)` : '')
    );
  }
}
