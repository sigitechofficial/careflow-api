import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  ScheduledJobStatus,
  VisitPlanNightDuty,
  VisitPlanSlotExceptionType,
  VisitPlanSlotKind,
  type VisitPlanSlotException,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { formatOrganisationIsoDate } from '../common/utils/organisation-display-format.util';
import { currentServiceUserWeeklyHours } from '../service-user-dom-care/service-user-weekly-hours-sync.util';
import { parseWeeklyContractedHours } from './visit-plan-contracted-hours.util';
import type { SuPlanOverLimit } from '../organisation-general-settings/service-user-weekly-hours-settings.util';
import type { SlotWithRelations } from './visit-plan-generate-occurrence.util';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
} from '../common/utils/operational-day.util';
import {
  computeVisitPlanWeeklyHours,
  type MultiCarerHoursMode,
  type VisitPlanWeeklyHoursSummary,
} from './visit-plan-weekly-hours.util';

type HoursClient = Prisma.TransactionClient | PrismaService;

/**
 * Planned visit hours per week for a visit plan, and the rule that no week may go over the
 * service user's weekly contracted hours. Used by the plan save and by extra visits.
 */
@Injectable()
export class VisitPlanWeeklyHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

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
      checkWeeks: rules.checkWeeks,
      rules,
    };
  }

  /** Count a plan's weekly hours from its rows as `client` sees them (saved, or inside a transaction). */
  async count(
    client: HoursClient,
    planId: string,
    context?: { timeZone: string; mode: MultiCarerHoursMode; checkWeeks: number },
  ): Promise<VisitPlanWeeklyHoursSummary> {
    const ctx = context ?? (await this.context());
    const plan = await client.serviceUserVisitPlan.findUniqueOrThrow({
      where: { id: planId },
      select: {
        serviceUserId: true,
        effectiveFrom: true,
        effectiveTo: true,
        slots: { include: { carerAssignments: true, exceptions: true } },
      },
    });
    return computeVisitPlanWeeklyHours({
      slots: plan.slots,
      planAnchor: plan.effectiveFrom,
      planEffectiveTo: plan.effectiveTo,
      timeZone: ctx.timeZone,
      mode: ctx.mode,
      weeks: ctx.checkWeeks,
      cancelledOnRota: await this.cancelledOnRota(client, planId),
      additionalMinutesByDay: await this.specialVisitMinutesByDay(client, plan.serviceUserId),
    });
  }

  /**
   * Special visits (Workforce → Special visits) of the service user from today, minutes per day.
   * Settings → Dom Rules decides whether they count; cancelled ones never do, called-off ones do.
   */
  async specialVisitMinutesByDay(client: HoursClient, serviceUserId: string): Promise<Map<string, number>> {
    const byDay = new Map<string, number>();
    const ctx = await this.context();
    if (!ctx.rules.specialVisitsCount) return byDay;
    const jobs = await client.scheduledJob.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        status: { not: ScheduledJobStatus.CANCELLED },
        scheduledStartDateTime: { gte: new Date(Date.now() - 86400000) },
        metadata: { path: ['special'], equals: true },
      },
      select: {
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        estimatedDurationMinutes: true,
        requiredCarers: true,
      },
    });
    for (const job of jobs) {
      const minutes =
        job.estimatedDurationMinutes ??
        (job.scheduledEndDateTime
          ? Math.round((job.scheduledEndDateTime.getTime() - job.scheduledStartDateTime.getTime()) / 60000)
          : 0);
      const day = dayKeyInTimeZone(job.scheduledStartDateTime, ctx.timeZone);
      byDay.set(day, (byDay.get(day) ?? 0) + minutes * Math.max(1, job.requiredCarers));
    }
    return byDay;
  }

  /**
   * Visits of the plan cancelled on the rota (from yesterday on), as "slotId|YYYY-MM-DD": they
   * don't use the weekly hours. A called-off visit still counts — the carer went to give the
   * service and the service user turned it down.
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

  /** The service user's weekly contracted hours (approved value), as a number. */
  async limit(
    client: HoursClient,
    serviceUserId: string,
    fallback?: string | null,
  ): Promise<number | null> {
    const current = await currentServiceUserWeeklyHours(client, serviceUserId);
    return parseWeeklyContractedHours(current ?? fallback ?? null);
  }

  /** Summary plus the limit and the weeks over it, as returned to the plan page. */
  withLimit(
    summary: VisitPlanWeeklyHoursSummary,
    limitWeeklyHours: number | null,
    /** Settings → Dom Rules: whether a save over the hours is blocked or only warned. */
    planOverLimit: SuPlanOverLimit | 'MANAGER_APPROVAL' = 'BLOCK',
  ) {
    const limitMinutes =
      limitWeeklyHours != null ? Math.round(limitWeeklyHours * 60) : null;
    return {
      ...summary,
      limitWeeklyHours,
      planOverLimit,
      overLimitWeeks:
        limitMinutes == null
          ? []
          : summary.weeks.filter((w) => w.minutes > limitMinutes),
    };
  }

  /**
   * Block a visit change that takes any week over the service user's weekly contracted hours.
   * A week already over the limit (older data, or hours lowered later) may stay as it is or go
   * down, but not up. `before` is the count before this change (null for a new plan).
   * Settings → Dom Rules can turn the block into a warning only (plan save, extra visit edit).
   */
  async assertWithinLimit(
    tx: Prisma.TransactionClient,
    serviceUserId: string,
    planId: string,
    before: VisitPlanWeeklyHoursSummary | null,
    fallbackHours?: string | null,
    kind: 'PLAN' | 'EXTRA_EDIT' | 'DRAFT' = 'PLAN',
  ): Promise<void> {
    const context = await this.context();
    // A draft on manager approval still saves; activation waits for the approval.
    const action =
      kind === 'DRAFT'
        ? context.rules.draftOverLimit === 'BLOCK'
          ? 'BLOCK'
          : 'WARN'
        : kind === 'PLAN'
          ? context.rules.planOverLimit
          : context.rules.extraEditOverLimit;
    if (action === 'WARN') return;
    const limit = await this.limit(tx, serviceUserId, fallbackHours);
    if (limit == null) return;
    const after = await this.count(tx, planId, context);
    const limitMinutes = Math.round(limit * 60);
    const beforeByWeek = new Map(
      (before?.weeks ?? []).map((w) => [w.weekStart, w.minutes]),
    );
    const worst = after.weeks
      .filter(
        (w) =>
          w.minutes > limitMinutes &&
          w.minutes > (beforeByWeek.get(w.weekStart) ?? 0),
      )
      .sort((a, b) => b.minutes - a.minutes)[0];
    if (!worst) return;
    // Same format as the plan page ("25h 50m"), so the numbers match the dialog.
    const hours = (minutes: number) => {
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes % 60);
      if (h === 0) return `${m}m`;
      return m === 0 ? `${h}h` : `${h}h ${m}m`;
    };
    throw new BadRequestException(
      `This goes over the service user's weekly contracted hours (${hours(limitMinutes)}): ` +
        `the week of ${formatOrganisationIsoDate(worst.weekStart, context.dateDisplayFormat)} would have ` +
        `${hours(worst.minutes)} of visits (${hours(worst.minutes - limitMinutes)} over). ` +
        "Increase the weekly contracted hours first (needs a manager's approval), then add the visits.",
    );
  }

  /** Weeks of this plan over the weekly hours (for a draft on manager approval). */
  async draftOverWeeks(
    serviceUserId: string,
    planId: string,
    fallbackHours?: string | null,
  ): Promise<{
    limitWeeklyHours: number | null;
    overWeeks: Array<{ weekStart: string; minutes: number }>;
    weekHoursLabel: string | null;
  }> {
    const context = await this.context();
    const limit = await this.limit(this.prisma, serviceUserId, fallbackHours);
    if (limit == null) return { limitWeeklyHours: null, overWeeks: [], weekHoursLabel: null };
    const limitMinutes = Math.round(limit * 60);
    const summary = await this.count(this.prisma, planId, context);
    const overWeeks = summary.weeks
      .filter((w) => w.minutes > limitMinutes)
      .map((w) => ({ weekStart: w.weekStart, minutes: w.minutes }));
    const heaviest = [...overWeeks].sort((a, b) => b.minutes - a.minutes)[0];
    const hours = (minutes: number) => {
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes % 60);
      if (h === 0) return `${m}m`;
      return m === 0 ? `${h}h` : `${h}h ${m}m`;
    };
    return {
      limitWeeklyHours: limit,
      overWeeks,
      weekHoursLabel: heaviest
        ? `week of ${formatOrganisationIsoDate(heaviest.weekStart, context.dateDisplayFormat)}: ` +
          `${hours(heaviest.minutes)} of ${hours(limitMinutes)}`
        : null,
    };
  }

  /**
   * Which of these extra-visit dates fit the service user's weekly hours. Dates are taken in
   * order, so two extras in one week are counted together. A date "needs approval" when its
   * week (Monday–Sunday) would go over the limit and above what it has today.
   */
  async classifyExtraDates(params: {
    serviceUserId: string;
    planId: string;
    fallbackHours?: string | null;
    dates: string[];
    startTime: string;
    endTime: string;
    durationMinutes: number;
    requiredCarers: number;
  }): Promise<{
    limitWeeklyHours: number | null;
    dates: Array<{
      date: string;
      weekStart: string;
      /** Week minutes with this extra (and earlier fitting ones) added. */
      weekMinutes: number;
      needsApproval: boolean;
    }>;
  }> {
    const limit = await this.limit(
      this.prisma,
      params.serviceUserId,
      params.fallbackHours,
    );
    const ctx = await this.context();
    const plan = await this.prisma.serviceUserVisitPlan.findUniqueOrThrow({
      where: { id: params.planId },
      select: {
        effectiveFrom: true,
        effectiveTo: true,
        slots: { include: { carerAssignments: true, exceptions: true } },
      },
    });
    const cancelled = await this.cancelledOnRota(this.prisma, params.planId);
    const specials = await this.specialVisitMinutesByDay(this.prisma, params.serviceUserId);
    const weekCount = (slots: SlotWithRelations[], date: string) =>
      this.weekOf(plan, slots, date, ctx, cancelled, specials);

    // A hidden host row holding the extra visits being checked (nothing is saved).
    const extraRow = (date: string) =>
      ({
        exceptionDate: new Date(`${date}T00:00:00Z`),
        exceptionType: VisitPlanSlotExceptionType.EXTRA,
        plannedStartTime: params.startTime,
        plannedEndTime: params.endTime,
        durationMinutes: params.durationMinutes,
        requiredCarers: params.requiredCarers,
      }) as VisitPlanSlotException;
    const template = plan.slots[0];
    const checkHost = (dates: string[]): SlotWithRelations => ({
      ...(template ?? {}),
      id: 'extra-hours-check',
      slotCode: 'EXTRA_HOURS_CHECK',
      daysOfWeek: [],
      isEnabled: false,
      slotKind: VisitPlanSlotKind.STANDARD,
      nightDuty: VisitPlanNightDuty.NONE,
      plannedStartTime: params.startTime,
      plannedEndTime: params.endTime,
      durationMinutes: params.durationMinutes,
      requiredCarers: params.requiredCarers,
      assignedEmployeeIds: [],
      slotEffectiveFrom: null,
      slotEffectiveTo: null,
      oneOffDate: null,
      carerAssignments: [],
      exceptions: dates.map(extraRow),
    });

    const accepted: string[] = [];
    const out: Array<{
      date: string;
      weekStart: string;
      weekMinutes: number;
      needsApproval: boolean;
    }> = [];
    for (const date of [...new Set(params.dates)].sort()) {
      const before = weekCount(plan.slots, date);
      const after = weekCount(
        [...plan.slots, checkHost([...accepted, date])],
        date,
      );
      const limitMinutes = limit != null ? Math.round(limit * 60) : null;
      const needsApproval =
        limitMinutes != null &&
        after.minutes > limitMinutes &&
        after.minutes > before.minutes;
      if (!needsApproval) accepted.push(date);
      out.push({
        date,
        weekStart: after.weekStart,
        weekMinutes: after.minutes,
        needsApproval,
      });
    }
    return { limitWeeklyHours: limit, dates: out };
  }

  /**
   * The week of an extra visit being edited, counted with the new time (nothing is saved).
   * `blocked` follows the save rule: over the limit and above what the week has today.
   * Null when the extra visit is not on this plan.
   */
  async checkExtraEdit(params: {
    serviceUserId: string;
    planId: string;
    fallbackHours?: string | null;
    exceptionId: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    requiredCarers: number;
  }): Promise<{
    limitWeeklyHours: number | null;
    weekStart: string;
    weekMinutes: number;
    /** The week goes over the hours and above what it has today. */
    over: boolean;
    /** Over, and Settings → Dom Rules blocks it (otherwise only a warning). */
    blocked: boolean;
  } | null> {
    const limit = await this.limit(
      this.prisma,
      params.serviceUserId,
      params.fallbackHours,
    );
    const ctx = await this.context();
    const plan = await this.prisma.serviceUserVisitPlan.findUniqueOrThrow({
      where: { id: params.planId },
      select: {
        effectiveFrom: true,
        effectiveTo: true,
        slots: { include: { carerAssignments: true, exceptions: true } },
      },
    });
    const original = plan.slots
      .flatMap((s) => s.exceptions)
      .find((e) => e.id === params.exceptionId);
    if (!original) return null;
    const date = original.exceptionDate.toISOString().slice(0, 10);
    const edited = plan.slots.map((s) => ({
      ...s,
      exceptions: s.exceptions.map((e) =>
        e.id === params.exceptionId
          ? {
              ...e,
              plannedStartTime: params.startTime,
              plannedEndTime: params.endTime,
              durationMinutes: params.durationMinutes,
              requiredCarers: params.requiredCarers,
            }
          : e,
      ),
    }));
    const cancelled = await this.cancelledOnRota(this.prisma, params.planId);
    const specials = await this.specialVisitMinutesByDay(this.prisma, params.serviceUserId);
    const before = this.weekOf(plan, plan.slots, date, ctx, cancelled, specials);
    const after = this.weekOf(plan, edited, date, ctx, cancelled, specials);
    const limitMinutes = limit != null ? Math.round(limit * 60) : null;
    const over =
      limitMinutes != null &&
      after.minutes > limitMinutes &&
      after.minutes > before.minutes;
    return {
      limitWeeklyHours: limit,
      weekStart: after.weekStart,
      weekMinutes: after.minutes,
      over,
      blocked: over && ctx.rules.extraEditOverLimit === 'BLOCK',
    };
  }

  /**
   * Weeks of a saved plan over the service user's weekly hours that overlap `fromIso`–`toIso`
   * (the dates a rota run makes). Extra visits a manager approved over the hours are left out,
   * so an approved week is not reported again.
   */
  async overLimitWeeksForRange(params: {
    serviceUserId: string;
    planId: string;
    fallbackHours?: string | null;
    fromIso: string;
    toIso: string;
  }): Promise<{
    limitWeeklyHours: number | null;
    weeks: Array<{ weekStart: string; minutes: number }>;
  }> {
    const limit = await this.limit(this.prisma, params.serviceUserId, params.fallbackHours);
    if (limit == null) return { limitWeeklyHours: null, weeks: [] };
    const ctx = await this.context();
    const [plan, approved] = await Promise.all([
      this.prisma.serviceUserVisitPlan.findUniqueOrThrow({
        where: { id: params.planId },
        select: {
          effectiveFrom: true,
          effectiveTo: true,
          slots: { include: { carerAssignments: true, exceptions: true } },
        },
      }),
      this.prisma.employeeHoursApproval.findMany({
        where: {
          visitPlanId: params.planId,
          requestType: 'EXTRA_VISIT_OVER_HOURS',
          status: 'APPROVED',
        },
        select: { requestPayload: true },
      }),
    ]);
    const approvedExtraIds = new Set(
      approved
        .map((a) => (a.requestPayload as { createdExceptionId?: string } | null)?.createdExceptionId)
        .filter((id): id is string => Boolean(id)),
    );
    const slots = plan.slots.map((slot) => ({
      ...slot,
      exceptions: slot.exceptions.filter((ex) => !approvedExtraIds.has(ex.id)),
    }));
    const today = dayKeyInTimeZone(new Date(), ctx.timeZone);
    const from = params.fromIso > today ? params.fromIso : today;
    const firstMonday = addDaysToOperationalIso(
      from,
      -((new Date(`${from}T12:00:00Z`).getUTCDay() + 6) % 7),
    );
    const days = Math.max(
      0,
      Math.round(
        (new Date(`${params.toIso}T12:00:00Z`).getTime() - new Date(`${firstMonday}T12:00:00Z`).getTime()) /
          86400000,
      ),
    );
    const summary = computeVisitPlanWeeklyHours({
      slots,
      planAnchor: plan.effectiveFrom,
      planEffectiveTo: plan.effectiveTo,
      timeZone: ctx.timeZone,
      mode: ctx.mode,
      fromIso: from,
      weeks: Math.floor(days / 7) + 1,
      cancelledOnRota: await this.cancelledOnRota(this.prisma, params.planId),
      additionalMinutesByDay: await this.specialVisitMinutesByDay(this.prisma, params.serviceUserId),
    });
    const limitMinutes = Math.round(limit * 60);
    return {
      limitWeeklyHours: limit,
      weeks: summary.weeks
        .filter((w) => w.minutes > limitMinutes)
        .map((w) => ({ weekStart: w.weekStart, minutes: w.minutes })),
    };
  }

  /**
   * A rota run over the hours, in words: "over the weekly contracted hours (14h) — week of
   * 26/10/2026 has 43h 30m; …". Null when no week is over.
   */
  async describeOverLimit(over: {
    limitWeeklyHours: number | null;
    weeks: Array<{ weekStart: string; minutes: number }>;
  }): Promise<string | null> {
    if (!over.weeks.length || over.limitWeeklyHours == null) return null;
    const { dateDisplayFormat } = await this.context();
    const hours = (minutes: number) => {
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes % 60);
      if (h === 0) return `${m}m`;
      return m === 0 ? `${h}h` : `${h}h ${m}m`;
    };
    return `over the weekly contracted hours (${hours(Math.round(over.limitWeeklyHours * 60))}) — ${over.weeks
      .map((w) => `week of ${formatOrganisationIsoDate(w.weekStart, dateDisplayFormat)} has ${hours(w.minutes)}`)
      .join('; ')}`;
  }

  /**
   * A new special visit for the service user: would its week go over the weekly contracted
   * hours (and above what it has now)? Null when special visits don't count (Settings → Dom
   * Rules), there is no limit, or the visit is in the past. `blocked` follows the setting.
   */
  async checkSpecialVisit(params: {
    serviceUserId: string;
    start: Date;
    end: Date;
  }): Promise<{ blocked: boolean; message: string } | null> {
    const ctx = await this.context();
    if (!ctx.rules.specialVisitsCount) return null;
    const plan = await this.prisma.serviceUserVisitPlan.findFirst({
      where: { serviceUserId: params.serviceUserId, status: 'ACTIVE', deletedAt: null, isActive: true },
      select: {
        id: true,
        weeklyContractedHours: true,
        effectiveFrom: true,
        effectiveTo: true,
        slots: { include: { carerAssignments: true, exceptions: true } },
      },
    });
    const limit = await this.limit(this.prisma, params.serviceUserId, plan?.weeklyContractedHours ?? null);
    if (limit == null) return null;
    const date = dayKeyInTimeZone(params.start, ctx.timeZone);
    const today = dayKeyInTimeZone(new Date(), ctx.timeZone);
    if (date < today) return null;
    const specials = await this.specialVisitMinutesByDay(this.prisma, params.serviceUserId);
    const offset = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const monday = addDaysToOperationalIso(date, -offset);
    let before: number;
    if (plan) {
      const cancelled = await this.cancelledOnRota(this.prisma, plan.id);
      before = this.weekOf(plan, plan.slots, date, ctx, cancelled, specials).minutes;
    } else {
      before = 0;
      for (let d = 0; d < 7; d++) {
        const day = addDaysToOperationalIso(monday, d);
        if (day >= today) before += specials.get(day) ?? 0;
      }
    }
    const visitMinutes = Math.round((params.end.getTime() - params.start.getTime()) / 60000);
    const after = before + visitMinutes;
    const limitMinutes = Math.round(limit * 60);
    if (after <= limitMinutes) return null;
    const hours = (minutes: number) => {
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes % 60);
      if (h === 0) return `${m}m`;
      return m === 0 ? `${h}h` : `${h}h ${m}m`;
    };
    return {
      blocked: ctx.rules.specialVisitOverLimit === 'BLOCK',
      message: `This special visit takes the service user's week of ${formatOrganisationIsoDate(
        monday,
        ctx.dateDisplayFormat,
      )} to ${hours(after)} of ${hours(limitMinutes)} weekly contracted hours (${hours(after - limitMinutes)} over)`,
    };
  }

  /** Visit minutes in the Monday–Sunday week holding `date` (days already gone are skipped). */
  private weekOf(
    plan: { effectiveFrom: Date; effectiveTo: Date | null },
    slots: SlotWithRelations[],
    date: string,
    ctx: { timeZone: string; mode: MultiCarerHoursMode },
    cancelledOnRota?: Set<string>,
    additionalMinutesByDay?: Map<string, number>,
  ) {
    const today = dayKeyInTimeZone(new Date(), ctx.timeZone);
    const offset = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const monday = addDaysToOperationalIso(date, -offset);
    const summary = computeVisitPlanWeeklyHours({
      slots,
      planAnchor: plan.effectiveFrom,
      planEffectiveTo: plan.effectiveTo,
      timeZone: ctx.timeZone,
      mode: ctx.mode,
      fromIso: monday > today ? monday : today,
      weeks: 1,
      cancelledOnRota,
      additionalMinutesByDay,
    });
    return { weekStart: monday, minutes: summary.weeks[0]?.minutes ?? 0 };
  }
}
