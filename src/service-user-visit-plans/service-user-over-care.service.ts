import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AllocationStatus,
  EmployeeHoursApprovalStatus,
  ScheduledJobStatus,
  VisitPlanStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { ServiceUserTimebankService } from '../service-user-hours/service-user-timebank.service';
import { ServiceUserTimebankLedgerService } from '../service-user-hours/service-user-timebank-ledger.service';
import {
  OVER_CARE_NOTE_PREFIX,
  mondayOfOperationalIso,
  type TimebankWeek,
} from '../service-user-hours/service-user-timebank.util';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
} from '../common/utils/operational-day.util';
import { formatOrganisationIsoDate } from '../common/utils/organisation-display-format.util';
import { EmployeeHoursApprovalNotificationHook } from '../employee-hours-approvals/employee-hours-approval-notification.hook';
import { VisitPlanDateChangesService } from './visit-plan-date-changes.service';
import {
  VisitPlanWeeklyHoursService,
  formatHoursMinutes,
} from './visit-plan-weekly-hours.service';

/**
 * Over care the next week could not take back: what is still over the lower limit after the cut,
 * plus any over care above the whole next week's hours (the limit cannot go below 0).
 */
function notTakenBack(
  overMinutes: number,
  adjustSetMinutes: number,
  stillOverMinutes: number,
  limitMinutes: number,
): number {
  const aboveWeek = Math.max(0, overMinutes - adjustSetMinutes);
  return Math.min(
    overMinutes,
    aboveWeek + Math.max(0, stillOverMinutes - limitMinutes),
  );
}

/** Over care in one week: what was given, what is left out and what is taken back. */
export type OverCareWeek = {
  weeklyMinutes: number;
  /** Delivered + done, not approved yet (a week not finished adds what is still to come). */
  careGivenMinutes: number;
  /** Timebank-paid and manager-approved over minutes, left out. */
  excludedMinutes: number;
  overMinutes: number;
  /** The week has not finished: the numbers include visits still to come. */
  projected: boolean;
};

export type OverCareStatus =
  | 'DONE'
  | 'WILL_CANCEL'
  | 'NOTHING'
  | 'OFF'
  | 'NOT_ELIGIBLE'
  | 'NOT_ADJUSTED'
  | 'NO_PLAN';

export type OverCareVisit = {
  scheduledJobId: string;
  date: string;
  start: string;
  end: string;
  label: string;
  minutes: number;
  status: string;
  carers: string[];
};

function utcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Over care taken back the next week (docs/SU_OVER_CARE_ADJUST_PLAN.md, Settings → Dom Rules).
 * Over care = care given in a finished week (delivered + done) above the weekly hours, less what
 * the timebank paid for and visits a manager approved over the hours. The next week's weekly
 * hours are lowered by it: its latest visits from tomorrow are cancelled (no charge, reason
 * "Over care adjustment …") and the week is recorded once in ServiceUserOverCareAdjustment.
 */
@Injectable()
export class ServiceUserOverCareService {
  private readonly logger = new Logger(ServiceUserOverCareService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly timebank: ServiceUserTimebankService,
    private readonly ledger: ServiceUserTimebankLedgerService,
    private readonly dateChanges: VisitPlanDateChangesService,
    @Optional()
    private readonly notificationHook?: EmployeeHoursApprovalNotificationHook,
  ) {}

  /**
   * Nightly (rolling rota job): last week's over care is taken back this week for every service
   * user. The first run with the setting on only records the start day (nothing before it).
   */
  async runWeekly(
    userId: string,
  ): Promise<{ adjusted: number; cancelledVisits: number }> {
    const none = { adjusted: 0, cancelledVisits: 0 };
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    if (!rules.adjustOverCareNextWeek) return none;
    const display = await this.orgSettings.getOperationalDisplaySettings();
    const today = dayKeyInTimeZone(new Date(), display.timeZone);
    if (!rules.adjustOverCareFrom) {
      await this.orgSettings.setAdjustOverCareFrom(today);
      return none;
    }
    const adjustWeek = mondayOfOperationalIso(today);
    const overWeek = addDaysToOperationalIso(adjustWeek, -7);
    if (overWeek < rules.adjustOverCareFrom) return none;

    const list = await this.timebank.list({ weekStart: overWeek });
    const done: Array<{
      name: string;
      overMinutes: number;
      cancelled: number;
      notTakenBackMinutes: number;
    }> = [];
    for (const row of list.rows.filter(
      (r) => r.overMinutes > 0 && !r.overCareAdjustment,
    )) {
      try {
        const res = await this.adjust(
          userId,
          row.id,
          overWeek,
          adjustWeek,
          display.dateDisplayFormat,
        );
        if (res) done.push({ name: row.name, ...res });
      } catch (err) {
        this.logger.warn(
          `Over care ${row.id} week ${overWeek}: ${(err as Error).message}`,
        );
      }
    }
    if (done.length) {
      await this.notificationHook?.notifyOverCareTakenBack({
        overWeekLabel: formatOrganisationIsoDate(
          overWeek,
          display.dateDisplayFormat,
        ),
        overWeekStart: overWeek,
        rows: done.map((d) => ({
          label:
            `${d.name}: ${formatHoursMinutes(d.overMinutes)} over, ${d.cancelled} visit${d.cancelled === 1 ? '' : 's'} cancelled` +
            (d.notTakenBackMinutes > 0
              ? ` (${formatHoursMinutes(d.notTakenBackMinutes)} not taken back)`
              : ''),
        })),
      });
    }
    return {
      adjusted: done.length,
      cancelledVisits: done.reduce((s, d) => s + d.cancelled, 0),
    };
  }

  /** One service user's over week taken back in `adjustWeek` (once; null when nothing to do). */
  private async adjust(
    userId: string,
    serviceUserId: string,
    overWeek: string,
    adjustWeek: string,
    dateFormat: Parameters<typeof formatOrganisationIsoDate>[1],
  ): Promise<{
    overMinutes: number;
    cancelled: number;
    notTakenBackMinutes: number;
  } | null> {
    const exists = await this.prisma.serviceUserOverCareAdjustment.findUnique({
      where: {
        serviceUserId_overWeekStart: {
          serviceUserId,
          overWeekStart: utcDay(overWeek),
        },
      },
      select: { id: true },
    });
    if (exists) return null;
    const active = await this.prisma.serviceUserVisitPlan.findFirst({
      where: {
        serviceUserId,
        status: VisitPlanStatus.ACTIVE,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    if (!active) return null;
    const found = await this.overIn(serviceUserId, overWeek);
    if (!found || found.over.overMinutes <= 0 || found.over.projected)
      return null;
    const { over } = found;
    const adjustSet =
      found.weeks.find((w) => w.weekStart === adjustWeek)?.setMinutes ??
      over.weeklyMinutes;
    const limit = Math.max(0, adjustSet - over.overMinutes);
    const plan = await this.dateChanges.planVisitCut(serviceUserId, limit, {
      onlyWeek: adjustWeek,
    });
    const note = `${OVER_CARE_NOTE_PREFIX} — week of ${formatOrganisationIsoDate(overWeek, dateFormat)} had ${formatHoursMinutes(over.overMinutes)} over`;
    await this.dateChanges.applyVisitCut(
      userId,
      serviceUserId,
      plan,
      note,
      `${note}; taken back from the next week, so no charge.`,
    );
    const cancelledMinutes = plan.toCancel.reduce((s, v) => s + v.minutes, 0);
    const stillOver =
      plan.stillOverWeeks.find((w) => w.weekStart === adjustWeek)?.minutes ?? 0;
    const notTakenBackMinutes = notTakenBack(
      over.overMinutes,
      adjustSet,
      stillOver,
      limit,
    );
    await this.prisma.serviceUserOverCareAdjustment.create({
      data: {
        serviceUserId,
        overWeekStart: utcDay(overWeek),
        adjustWeekStart: utcDay(adjustWeek),
        weeklyMinutes: over.weeklyMinutes,
        careGivenMinutes: over.careGivenMinutes,
        excludedMinutes: over.excludedMinutes,
        overMinutes: over.overMinutes,
        cancelledMinutes,
        takenBackMinutes: over.overMinutes - notTakenBackMinutes,
        notTakenBackMinutes,
        cancelledJobIds: plan.toCancel.map((v) => v.scheduledJobId),
      },
    });
    return {
      overMinutes: over.overMinutes,
      cancelled: plan.toCancel.length,
      notTakenBackMinutes,
    };
  }

  /** Over care in `weekStart` for one service user, with all their timebank weeks. */
  private async overIn(
    serviceUserId: string,
    weekStart: string,
  ): Promise<{
    over: OverCareWeek;
    weeks: TimebankWeek[];
    timeZone: string;
  } | null> {
    const tb = await this.timebank.weeksForServiceUser(serviceUserId);
    const week = tb?.weeks.find((w) => w.weekStart === weekStart);
    if (!tb || !week || week.weeklyHours == null) return null;
    const projected = week.status === 'current' || week.status === 'upcoming';
    const careGivenMinutes =
      week.deliveredMinutes +
      week.pendingMinutes +
      (projected ? week.scheduledMinutes + week.awaitingMinutes : 0);
    const raw = careGivenMinutes - week.setMinutes;
    const { reservedByWeek } = await this.ledger.balance(serviceUserId);
    const leftOut =
      (reservedByWeek.get(weekStart) ?? 0) +
      (await this.approvedOverMinutes(serviceUserId, weekStart, tb.timeZone));
    const excludedMinutes = Math.min(Math.max(0, raw), leftOut);
    return {
      over: {
        weeklyMinutes: week.setMinutes,
        careGivenMinutes,
        excludedMinutes,
        overMinutes: Math.max(0, raw - leftOut),
        projected,
      },
      weeks: tb.weeks,
      timeZone: tb.timeZone,
    };
  }

  /** Minutes of visits in the week a manager approved over the service user's weekly hours. */
  private async approvedOverMinutes(
    serviceUserId: string,
    weekStart: string,
    timeZone: string,
  ): Promise<number> {
    const approved = await this.prisma.employeeHoursApproval.findMany({
      where: { serviceUserId, status: EmployeeHoursApprovalStatus.APPROVED },
      select: { requestPayload: true },
    });
    // Held visits / specials store the visit made (createdJobId): the whole visit was approved.
    // Visit plan extra visits store the plan exception (createdExceptionId), whose rota visit
    // carries it as metadata.visitPlanExceptionId: the whole visit too. A longer visit (a plan
    // visit's new time, PLAN_TIME, or a longer extra visit, EXTRA_EDIT) approves only the extra
    // minutes, per visit.
    type Payload = {
      kind?: string;
      createdJobId?: string;
      createdExceptionId?: string;
      heldDeltas?: Array<{ date: string; minutes: number }>;
      planTimeChange?: { held?: Array<{ jobId?: string; minutes?: number }> };
    };
    const jobIds = new Set<string>();
    const exceptionIds = new Set<string>();
    const extraByJob = new Map<string, number>();
    const addExtra = (jobId: string | undefined, minutes: number) => {
      if (!jobId || minutes <= 0) return;
      extraByJob.set(jobId, (extraByJob.get(jobId) ?? 0) + minutes);
    };
    for (const a of approved) {
      const p = (a.requestPayload ?? {}) as Payload;
      if (p.kind === 'PLAN_TIME') {
        for (const h of p.planTimeChange?.held ?? [])
          addExtra(h.jobId, h.minutes ?? 0);
      } else if (p.kind === 'EXTRA_EDIT') {
        addExtra(
          p.createdJobId,
          (p.heldDeltas ?? []).reduce((sum, d) => sum + (d.minutes ?? 0), 0),
        );
      } else {
        if (p.createdJobId) jobIds.add(p.createdJobId);
        if (p.createdExceptionId) exceptionIds.add(p.createdExceptionId);
      }
    }
    if (!jobIds.size && !exceptionIds.size && !extraByJob.size) return 0;
    const weekEnd = addDaysToOperationalIso(weekStart, 6);
    // A day either side covers any time zone; the week is checked by day below.
    const from = new Date(
      `${addDaysToOperationalIso(weekStart, -1)}T00:00:00Z`,
    );
    const to = new Date(`${addDaysToOperationalIso(weekEnd, 2)}T00:00:00Z`);
    const jobs = await this.prisma.scheduledJob.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        status: { not: ScheduledJobStatus.CANCELLED },
        scheduledStartDateTime: { gte: from, lt: to },
      },
      select: {
        id: true,
        metadata: true,
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        estimatedDurationMinutes: true,
        requiredCarers: true,
      },
    });
    let total = 0;
    for (const j of jobs) {
      const day = dayKeyInTimeZone(j.scheduledStartDateTime, timeZone);
      if (day < weekStart || day > weekEnd) continue;
      const minutes = VisitPlanWeeklyHoursService.jobMinutes(j);
      const exceptionId = (
        j.metadata as { visitPlanExceptionId?: string } | null
      )?.visitPlanExceptionId;
      if (jobIds.has(j.id) || (exceptionId && exceptionIds.has(exceptionId))) {
        total += minutes;
      } else if (extraByJob.has(j.id)) {
        total += Math.min(minutes, extraByJob.get(j.id)!);
      }
    }
    return total;
  }

  /**
   * "See visits": over care in the week holding `anyDay` and the next week's visits it took (done)
   * or would take (preview: from the Tuesday, as the run keeps the day it runs).
   */
  async forWeek(serviceUserId: string, anyDay: string) {
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    const display = await this.orgSettings.getOperationalDisplaySettings();
    const today = dayKeyInTimeZone(new Date(), display.timeZone);
    const currentMonday = mondayOfOperationalIso(today);
    const overWeek = mondayOfOperationalIso(anyDay);
    const adjustWeek = addDaysToOperationalIso(overWeek, 7);
    const base = {
      overWeekStart: overWeek,
      adjustWeekStart: adjustWeek,
      setting: {
        on: rules.adjustOverCareNextWeek,
        from: rules.adjustOverCareFrom,
      },
    };

    const row = await this.prisma.serviceUserOverCareAdjustment.findUnique({
      where: {
        serviceUserId_overWeekStart: {
          serviceUserId,
          overWeekStart: utcDay(overWeek),
        },
      },
    });
    if (row) {
      return {
        ...base,
        status: 'DONE' as OverCareStatus,
        weeklyMinutes: row.weeklyMinutes,
        careGivenMinutes: row.careGivenMinutes,
        excludedMinutes: row.excludedMinutes,
        overMinutes: row.overMinutes,
        projected: false,
        cancelledMinutes: row.cancelledMinutes,
        takenBackMinutes: row.takenBackMinutes,
        notTakenBackMinutes: row.notTakenBackMinutes,
        adjustedAt: row.createdAt.toISOString(),
        visits: await this.visitsOf(row.cancelledJobIds, display.timeZone),
      };
    }

    const found = await this.overIn(serviceUserId, overWeek);
    const over = found?.over ?? null;
    const empty = {
      cancelledMinutes: 0,
      takenBackMinutes: 0,
      notTakenBackMinutes: 0,
      adjustedAt: null,
      visits: [] as OverCareVisit[],
    };
    const counts = {
      weeklyMinutes: over?.weeklyMinutes ?? 0,
      careGivenMinutes: over?.careGivenMinutes ?? 0,
      excludedMinutes: over?.excludedMinutes ?? 0,
      overMinutes: over?.overMinutes ?? 0,
      projected: over?.projected ?? false,
    };
    if (!over || over.overMinutes <= 0)
      return {
        ...base,
        status: 'NOTHING' as OverCareStatus,
        ...counts,
        ...empty,
      };
    if (!rules.adjustOverCareNextWeek)
      return { ...base, status: 'OFF' as OverCareStatus, ...counts, ...empty };
    const from = rules.adjustOverCareFrom ?? today;
    if (overWeek < from)
      return {
        ...base,
        status: 'NOT_ELIGIBLE' as OverCareStatus,
        ...counts,
        ...empty,
      };
    if (adjustWeek < currentMonday)
      return {
        ...base,
        status: 'NOT_ADJUSTED' as OverCareStatus,
        ...counts,
        ...empty,
      };
    // Only plan visits and special visits can be taken back, and only with an active plan.
    const active = await this.prisma.serviceUserVisitPlan.findFirst({
      where: {
        serviceUserId,
        status: VisitPlanStatus.ACTIVE,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    if (!active)
      return {
        ...base,
        status: 'NO_PLAN' as OverCareStatus,
        ...counts,
        ...empty,
      };

    const adjustSet =
      found!.weeks.find((w) => w.weekStart === adjustWeek)?.setMinutes ??
      over.weeklyMinutes;
    const limit = Math.max(0, adjustSet - over.overMinutes);
    const plan = await this.dateChanges.planVisitCut(serviceUserId, limit, {
      onlyWeek: adjustWeek,
      // The run keeps the day it runs (the Monday); this week's run is still to come.
      ...(adjustWeek > currentMonday
        ? { fromDate: addDaysToOperationalIso(adjustWeek, 1) }
        : {}),
    });
    const stillOver =
      plan.stillOverWeeks.find((w) => w.weekStart === adjustWeek)?.minutes ?? 0;
    const notTakenBackMinutes = notTakenBack(
      over.overMinutes,
      adjustSet,
      stillOver,
      limit,
    );
    return {
      ...base,
      status: 'WILL_CANCEL' as OverCareStatus,
      ...counts,
      cancelledMinutes: plan.toCancel.reduce((s, v) => s + v.minutes, 0),
      takenBackMinutes: over.overMinutes - notTakenBackMinutes,
      notTakenBackMinutes,
      adjustedAt: null,
      visits: await this.visitsOf(
        plan.toCancel.map((v) => v.scheduledJobId),
        display.timeZone,
      ),
    };
  }

  private async visitsOf(
    jobIds: string[],
    timeZone: string,
  ): Promise<OverCareVisit[]> {
    if (!jobIds.length) return [];
    const jobs = await this.prisma.scheduledJob.findMany({
      where: { id: { in: jobIds } },
      select: {
        id: true,
        jobName: true,
        status: true,
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        estimatedDurationMinutes: true,
        requiredCarers: true,
        allocations: {
          // Carers on the visit now, or taken off by its cancellation (not earlier ones).
          where: {
            deletedAt: null,
            OR: [{ isActive: true }, { status: AllocationStatus.CANCELLED }],
          },
          orderBy: { allocatedAt: 'desc' },
          select: {
            employee: {
              select: {
                personalDetail: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
      orderBy: { scheduledStartDateTime: 'asc' },
    });
    return jobs.map((j) => {
      const minutes = VisitPlanWeeklyHoursService.jobMinutes(j);
      const end =
        j.scheduledEndDateTime ??
        new Date(j.scheduledStartDateTime.getTime() + minutes * 60000);
      const carers = [
        ...new Set(
          j.allocations
            .map((a) =>
              `${a.employee.personalDetail?.firstName ?? ''} ${a.employee.personalDetail?.lastName ?? ''}`.trim(),
            )
            .filter(Boolean),
        ),
      ];
      return {
        scheduledJobId: j.id,
        date: dayKeyInTimeZone(j.scheduledStartDateTime, timeZone),
        start: j.scheduledStartDateTime.toISOString(),
        end: end.toISOString(),
        label: j.jobName || 'Visit',
        minutes,
        status: j.status,
        carers,
      };
    });
  }
}
