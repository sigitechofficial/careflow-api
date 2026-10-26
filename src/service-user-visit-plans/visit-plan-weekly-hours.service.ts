import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
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

  /** Settings shared by every count (timezone, double-up mode, date format). */
  async context() {
    const [display, settings] = await Promise.all([
      this.orgSettings.getOperationalDisplaySettings(),
      this.prisma.organisationGeneralSettings.findFirst({
        select: { multiCarerFunderChargeMode: true },
      }),
    ]);
    const mode: MultiCarerHoursMode =
      settings?.multiCarerFunderChargeMode === 'FIXED' ? 'FIXED' : 'COMBINED';
    return {
      timeZone: display.timeZone,
      dateDisplayFormat: display.dateDisplayFormat,
      mode,
    };
  }

  /** Count a plan's weekly hours from its rows as `client` sees them (saved, or inside a transaction). */
  async count(
    client: HoursClient,
    planId: string,
    context?: { timeZone: string; mode: MultiCarerHoursMode },
  ): Promise<VisitPlanWeeklyHoursSummary> {
    const ctx = context ?? (await this.context());
    const plan = await client.serviceUserVisitPlan.findUniqueOrThrow({
      where: { id: planId },
      select: {
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
    });
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
  ) {
    const limitMinutes =
      limitWeeklyHours != null ? Math.round(limitWeeklyHours * 60) : null;
    return {
      ...summary,
      limitWeeklyHours,
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
   */
  async assertWithinLimit(
    tx: Prisma.TransactionClient,
    serviceUserId: string,
    planId: string,
    before: VisitPlanWeeklyHoursSummary | null,
    fallbackHours?: string | null,
  ): Promise<void> {
    const limit = await this.limit(tx, serviceUserId, fallbackHours);
    if (limit == null) return;
    const context = await this.context();
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
    const weekCount = (slots: SlotWithRelations[], date: string) =>
      this.weekOf(plan, slots, date, ctx);

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
    const before = this.weekOf(plan, plan.slots, date, ctx);
    const after = this.weekOf(plan, edited, date, ctx);
    const limitMinutes = limit != null ? Math.round(limit * 60) : null;
    return {
      limitWeeklyHours: limit,
      weekStart: after.weekStart,
      weekMinutes: after.minutes,
      blocked:
        limitMinutes != null &&
        after.minutes > limitMinutes &&
        after.minutes > before.minutes,
    };
  }

  /** Visit minutes in the Monday–Sunday week holding `date` (days already gone are skipped). */
  private weekOf(
    plan: { effectiveFrom: Date; effectiveTo: Date | null },
    slots: SlotWithRelations[],
    date: string,
    ctx: { timeZone: string; mode: MultiCarerHoursMode },
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
    });
    return { weekStart: monday, minutes: summary.weeks[0]?.minutes ?? 0 };
  }
}
