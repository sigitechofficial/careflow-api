import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AllocationStatus,
  Prisma,
  ServiceUserOverCareReviewStatus,
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
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';
import { CarerVisitPushKind } from '@prisma/client';
import {
  VisitPlanDateChangesService,
  type HoursDecreaseVisit,
} from './visit-plan-date-changes.service';
import {
  VisitPlanWeeklyHoursService,
  formatHoursMinutes,
} from './visit-plan-weekly-hours.service';
import {
  loadVisitCareChecks,
  type VisitCareChecks,
} from './over-care-visit-checks.util';

/** Over care in one week: what was given, what is left out and what is taken back. */
export type OverCareWeek = {
  weeklyMinutes: number;
  /** Delivered + done + charged cancellations (a week not finished adds what is still to come). */
  careGivenMinutes: number;
  /** Over minutes paid from the timebank, left out. */
  excludedMinutes: number;
  overMinutes: number;
  /** The week has not finished: the numbers include visits still to come. */
  projected: boolean;
};

/**
 * Timebank "See visits" status for one over week:
 * - DONE: action taken (visits cancelled), by a manager or by the old nightly run
 * - PENDING_REVIEW: waiting in Workforce › Over care reviews
 * - NO_ACTION: a manager marked it "no action needed"
 * - WILL_REVIEW: over care, the weekly check raises a review once the week has finished
 * - NOTHING: no over care once hours paid from the timebank are left out
 * - NOT_ELIGIBLE: before over care started being checked
 */
export type OverCareStatus =
  | 'DONE'
  | 'PENDING_REVIEW'
  | 'NO_ACTION'
  | 'WILL_REVIEW'
  | 'NOTHING'
  | 'NOT_ELIGIBLE';

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

/** A future visit the manager can cancel, with what to check first. */
export type OverCareUpcomingVisit = OverCareVisit & {
  kind: HoursDecreaseVisit['kind'];
  checks: VisitCareChecks;
};

function utcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Same as the timebank: preferred name, else first name, then last name. */
function serviceUserName(su: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}): string {
  return `${su.preferredName?.trim() || su.firstName} ${su.lastName}`.trim();
}

function personName(
  p: { firstName?: string | null; lastName?: string | null } | null | undefined,
): string {
  return `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim();
}

/**
 * Over care (docs/SU_OVER_CARE_ADJUST_PLAN.md): care given in a finished week (every delivered or
 * done visit, manager-approved extra visits included, and cancellations the service user is charged
 * for) above the weekly hours, less only the hours
 * paid from the timebank (visits made with them never count, even when delivered). Since 10 Nov 2026 nothing is cancelled by itself: the weekly check raises a review request
 * (one ServiceUserOverCareAdjustment row per service user per over week, Workforce › Over care
 * reviews) and a manager cancels any future visits of their choice ("Action taken", no charge,
 * carers notified) or marks it "No action needed" with a reason. Who raised and who decided, and
 * when, are kept on the row.
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
    @Optional() private readonly carerPush?: CarerVisitPushHook,
  ) {}

  /**
   * Nightly (rolling rota job): last week's over care raises a review request for every service
   * user (once per week). The first run ever only records the start day (nothing before it).
   */
  async runWeekly(): Promise<{ raised: number }> {
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    const display = await this.orgSettings.getOperationalDisplaySettings();
    const today = dayKeyInTimeZone(new Date(), display.timeZone);
    if (!rules.adjustOverCareFrom) {
      await this.orgSettings.setAdjustOverCareFrom(today);
      return { raised: 0 };
    }
    const overWeek = addDaysToOperationalIso(mondayOfOperationalIso(today), -7);
    if (overWeek < rules.adjustOverCareFrom) return { raised: 0 };

    const list = await this.timebank.list({ weekStart: overWeek });
    const existing = new Set(
      (
        await this.prisma.serviceUserOverCareAdjustment.findMany({
          where: { overWeekStart: utcDay(overWeek) },
          select: { serviceUserId: true },
        })
      ).map((r) => r.serviceUserId),
    );
    const raised: Array<{ name: string; overMinutes: number }> = [];
    for (const row of list.rows.filter(
      (r) => r.overMinutes > 0 && !existing.has(r.id),
    )) {
      try {
        const found = await this.overIn(row.id, overWeek);
        if (!found || found.over.overMinutes <= 0 || found.over.projected)
          continue;
        await this.prisma.serviceUserOverCareAdjustment.create({
          data: {
            serviceUserId: row.id,
            overWeekStart: utcDay(overWeek),
            status: ServiceUserOverCareReviewStatus.PENDING,
            raisedByUserId: null,
            weeklyMinutes: found.over.weeklyMinutes,
            careGivenMinutes: found.over.careGivenMinutes,
            excludedMinutes: found.over.excludedMinutes,
            overMinutes: found.over.overMinutes,
            cancelledMinutes: 0,
            takenBackMinutes: 0,
            notTakenBackMinutes: 0,
            cancelledJobIds: [],
          },
        });
        raised.push({ name: row.name, overMinutes: found.over.overMinutes });
      } catch (err) {
        // A second run the same day hits the unique (service user, week): already raised.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        )
          continue;
        this.logger.warn(
          `Over care review ${row.id} week ${overWeek}: ${(err as Error).message}`,
        );
      }
    }
    if (raised.length) {
      await this.notificationHook?.notifyOverCareReviewsRaised({
        overWeekLabel: formatOrganisationIsoDate(
          overWeek,
          display.dateDisplayFormat,
        ),
        rows: raised.map((r) => ({
          label: `${r.name}: ${formatHoursMinutes(r.overMinutes)} over`,
        })),
      });
    }
    return { raised: raised.length };
  }

  /** Workforce › Over care reviews: one tab's requests, newest week first. */
  async listReviews(status: ServiceUserOverCareReviewStatus) {
    const rows = await this.prisma.serviceUserOverCareAdjustment.findMany({
      where: { status, serviceUser: { deletedAt: null } },
      orderBy:
        status === ServiceUserOverCareReviewStatus.PENDING
          ? [{ overWeekStart: 'desc' }, { createdAt: 'desc' }]
          : [{ decidedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        serviceUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
          },
        },
      },
    });
    const counts = await this.prisma.serviceUserOverCareAdjustment.groupBy({
      by: ['status'],
      where: { serviceUser: { deletedAt: null } },
      _count: { _all: true },
    });
    return {
      counts: Object.fromEntries(
        Object.values(ServiceUserOverCareReviewStatus).map((s) => [
          s,
          counts.find((c) => c.status === s)?._count._all ?? 0,
        ]),
      ) as Record<ServiceUserOverCareReviewStatus, number>,
      rows: rows.map((r) => ({
        id: r.id,
        serviceUserId: r.serviceUserId,
        serviceUserName: serviceUserName(r.serviceUser),
        weekStart: isoDay(r.overWeekStart)!,
        weeklyMinutes: r.weeklyMinutes,
        careGivenMinutes: r.careGivenMinutes,
        overMinutes: r.overMinutes,
        status: r.status,
        raisedAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        cancelledVisits: r.cancelledJobIds.length,
        cancelledMinutes: r.cancelledMinutes,
      })),
    };
  }

  /**
   * One review: the week's numbers, the visits of the over week, and (pending) every future rota
   * visit the manager can cancel, grouped by week with what to check first; or (decided) the record.
   */
  async getReview(id: string) {
    const row = await this.prisma.serviceUserOverCareAdjustment.findUnique({
      where: { id },
      include: {
        serviceUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Over care review not found');
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const overWeek = isoDay(row.overWeekStart)!;
    const userIds = [row.raisedByUserId, row.decidedByUserId].filter(
      (x): x is string => Boolean(x),
    );
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const userName = (uid: string | null) => {
      if (!uid) return null;
      const u = users.find((x) => x.id === uid);
      return u ? personName(u) || u.email : 'Unknown user';
    };

    const tb = await this.timebank.weeksForServiceUser(row.serviceUserId);
    const week = tb?.weeks.find((w) => w.weekStart === overWeek) ?? null;
    // The visits care given counts: delivered, done, and cancellations charged to the service user.
    const overWeekVisits = (week?.allVisits ?? [])
      .filter(
        (v) =>
          v.outcome === 'DELIVERED' ||
          v.outcome === 'PENDING' ||
          v.outcome === 'CHARGEABLE_CANCELLATION',
      )
      .map((v) => {
        const charged = v.outcome === 'CHARGEABLE_CANCELLATION';
        return {
          jobId: v.jobId,
          label: v.jobName || 'Visit',
          day: v.day,
          start: v.start,
          end: v.end,
          plannedMinutes: v.plannedMinutes,
          givenMinutes: charged
            ? v.plannedMinutes
            : v.deliveredMinutes + v.pendingMinutes,
          chargeableCancellation: charged,
        };
      });

    const pending = row.status === ServiceUserOverCareReviewStatus.PENDING;
    const upcoming = pending
      ? await this.upcomingVisits(row.serviceUserId, timeZone)
      : [];
    return {
      id: row.id,
      status: row.status,
      serviceUser: {
        id: row.serviceUserId,
        name: serviceUserName(row.serviceUser),
      },
      weekStart: overWeek,
      weeklyMinutes: row.weeklyMinutes,
      careGivenMinutes: row.careGivenMinutes,
      excludedMinutes: row.excludedMinutes,
      overMinutes: row.overMinutes,
      raisedAt: row.createdAt.toISOString(),
      raisedBy: row.raisedByUserId
        ? { kind: 'USER' as const, name: userName(row.raisedByUserId) }
        : { kind: 'SYSTEM' as const, name: 'System (weekly over care check)' },
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decidedBy: row.decidedAutomatically
        ? {
            kind: 'SYSTEM' as const,
            name: 'System (nightly run, before reviews)',
          }
        : row.decidedByUserId
          ? { kind: 'USER' as const, name: userName(row.decidedByUserId) }
          : null,
      decisionNote: row.decisionNote,
      cancelledMinutes: row.cancelledMinutes,
      takenBackMinutes: row.takenBackMinutes,
      notTakenBackMinutes: row.notTakenBackMinutes,
      cancelledVisits: pending
        ? []
        : await this.visitsOf(row.cancelledJobIds, timeZone),
      overWeekVisits,
      upcomingWeeks: groupByWeek(upcoming),
    };
  }

  /** Every future rota visit the manager can cancel (tomorrow to the rota edge), with checks. */
  private async upcomingVisits(
    serviceUserId: string,
    timeZone: string,
  ): Promise<OverCareUpcomingVisit[]> {
    const planId = await this.activePlanId(serviceUserId);
    const candidates = await this.dateChanges.listCutCandidates(
      serviceUserId,
      planId,
    );
    if (!candidates.length) return [];
    const details = new Map(
      (
        await this.visitsOf(
          candidates.map((c) => c.scheduledJobId),
          timeZone,
        )
      ).map((v) => [v.scheduledJobId, v]),
    );
    const checks = await loadVisitCareChecks(
      this.prisma,
      candidates.map((c) => ({
        id: c.scheduledJobId,
        serviceUserId,
        start: new Date(c.startDateTime),
        end: new Date(c.endDateTime),
      })),
      timeZone,
    );
    return candidates
      .map((c) => {
        const d = details.get(c.scheduledJobId);
        return {
          scheduledJobId: c.scheduledJobId,
          date: c.date,
          start: c.startDateTime,
          end: c.endDateTime,
          label: c.slotLabel,
          minutes: c.minutes,
          status: d?.status ?? 'SCHEDULED',
          carers: d?.carers ?? [],
          kind: c.kind,
          checks: {
            ...(checks.get(c.scheduledJobId) ?? {
              medicationDue: false,
              criticalTasks: [],
              timeCriticalTasks: [],
            }),
            // A time-critical plan visit counts as a time-critical task too.
            timeCriticalTasks: [
              ...(checks.get(c.scheduledJobId)?.timeCriticalTasks ?? []),
              ...(c.timeCritical ? ['Time-critical visit'] : []),
            ],
          },
        };
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  private async activePlanId(serviceUserId: string): Promise<string | null> {
    const active = await this.prisma.serviceUserVisitPlan.findFirst({
      where: {
        serviceUserId,
        status: VisitPlanStatus.ACTIVE,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    return active?.id ?? null;
  }

  /**
   * "Cancel visits": cancels the chosen future visits (no charge, reason on each visit, only those
   * dates — the plan is not changed), tells their carers, and records the decision. Choosing more
   * than the over care is allowed (the screen warns); the over care is taken back week by week from
   * the earliest cancelled visit, and anything cancelled above it stays as care owed.
   */
  async cancelVisits(
    id: string,
    userId: string,
    input: { scheduledJobIds: string[]; note?: string | null },
  ) {
    const jobIds = [...new Set(input.scheduledJobIds)];
    if (!jobIds.length)
      throw new BadRequestException('Choose at least one visit to cancel.');
    const row = await this.prisma.serviceUserOverCareAdjustment.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Over care review not found');
    if (row.status !== ServiceUserOverCareReviewStatus.PENDING)
      throw new ConflictException('This review has already been decided.');

    const planId = await this.activePlanId(row.serviceUserId);
    const candidates = await this.dateChanges.listCutCandidates(
      row.serviceUserId,
      planId,
    );
    const chosen = candidates.filter((c) => jobIds.includes(c.scheduledJobId));
    if (chosen.length !== jobIds.length)
      throw new BadRequestException(
        'Some of these visits can no longer be cancelled. Close and open the review again.',
      );

    // Claim the review first, so two managers cannot both act on it.
    const claimed = await this.prisma.serviceUserOverCareAdjustment.updateMany({
      where: { id, status: ServiceUserOverCareReviewStatus.PENDING },
      data: {
        status: ServiceUserOverCareReviewStatus.ACTION_TAKEN,
        decidedByUserId: userId,
        decidedAt: new Date(),
      },
    });
    if (!claimed.count)
      throw new ConflictException('This review has already been decided.');

    const display = await this.orgSettings.getOperationalDisplaySettings();
    const managerNote = input.note?.trim() || null;
    const reason =
      `${OVER_CARE_NOTE_PREFIX} — week of ${formatOrganisationIsoDate(isoDay(row.overWeekStart)!, display.dateDisplayFormat)} had ${formatHoursMinutes(row.overMinutes)} over` +
      (managerNote ? `: ${managerNote}` : '');
    // Special visits are cancelled on the rota without the carer push: tell their carers here.
    const specialIds = chosen
      .filter((c) => c.kind === 'SPECIAL')
      .map((c) => c.scheduledJobId);
    const specialJobs = specialIds.length
      ? await this.prisma.scheduledJob.findMany({
          where: { id: { in: specialIds } },
          select: {
            id: true,
            jobName: true,
            serviceUserId: true,
            allocations: {
              where: { deletedAt: null, isActive: true },
              select: { employeeId: true },
            },
          },
        })
      : [];
    try {
      await this.dateChanges.applyVisitCut(
        userId,
        row.serviceUserId,
        {
          planId,
          limitMinutes: 0,
          overWeeks: [],
          toCancel: chosen,
          stillOverWeeks: [],
        },
        reason,
        `${reason}; over care taken back, so no charge.`,
      );
    } catch (err) {
      await this.prisma.serviceUserOverCareAdjustment.updateMany({
        where: { id, status: ServiceUserOverCareReviewStatus.ACTION_TAKEN },
        data: {
          status: ServiceUserOverCareReviewStatus.PENDING,
          decidedByUserId: null,
          decidedAt: null,
        },
      });
      throw err;
    }
    for (const job of specialJobs) {
      const employeeIds = [
        ...new Set(job.allocations.map((a) => a.employeeId)),
      ];
      if (!employeeIds.length) continue;
      this.carerPush?.notify({
        employeeIds,
        kind: CarerVisitPushKind.VISIT_CALLED_OFF,
        title: 'Visit cancelled',
        body: `Your visit "${job.jobName}" has been cancelled.`,
        scheduledJobId: job.id,
        serviceUserId: job.serviceUserId,
      });
    }

    const takenBackWeeks = takeBackByWeek(chosen, row.overMinutes);
    const cancelledMinutes = chosen.reduce((s, v) => s + v.minutes, 0);
    const takenBackMinutes = takenBackWeeks.reduce((s, w) => s + w.minutes, 0);
    await this.prisma.serviceUserOverCareAdjustment.update({
      where: { id },
      data: {
        decisionNote: managerNote,
        cancelledJobIds: chosen.map((c) => c.scheduledJobId),
        cancelledMinutes,
        takenBackMinutes,
        notTakenBackMinutes: Math.max(0, row.overMinutes - takenBackMinutes),
        takenBackWeeks,
        adjustWeekStart: takenBackWeeks[0]
          ? utcDay(takenBackWeeks[0].weekStart)
          : null,
      },
    });
    return this.getReview(id);
  }

  /** "No action needed": closes the review with the manager's reason; nothing is cancelled. */
  async markNoActionNeeded(id: string, userId: string, reason: string) {
    const text = reason?.trim();
    if (!text) throw new BadRequestException('Enter a reason.');
    const updated = await this.prisma.serviceUserOverCareAdjustment.updateMany({
      where: { id, status: ServiceUserOverCareReviewStatus.PENDING },
      data: {
        status: ServiceUserOverCareReviewStatus.NO_ACTION_NEEDED,
        decidedByUserId: userId,
        decidedAt: new Date(),
        decisionNote: text,
      },
    });
    if (!updated.count) {
      const exists = await this.prisma.serviceUserOverCareAdjustment.count({
        where: { id },
      });
      if (!exists) throw new NotFoundException('Over care review not found');
      throw new ConflictException('This review has already been decided.');
    }
    return this.getReview(id);
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
    // Care given: delivered + done + cancellations the service user is charged for (10 Nov 2026).
    const careGivenMinutes =
      week.deliveredMinutes +
      week.pendingMinutes +
      week.chargeableCancelMinutes +
      (projected ? week.scheduledMinutes + week.awaitingMinutes : 0);
    const raw = careGivenMinutes - week.setMinutes;
    const { reservedByWeek } = await this.ledger.balance(serviceUserId);
    // Only hours paid from the timebank are left out (the service user's own banked hours, 10 Nov
    // 2026): every delivered or done visit counts, manager-approved extra visits included.
    const leftOut = reservedByWeek.get(weekStart) ?? 0;
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

  /**
   * Timebank "See visits": over care in the week holding `anyDay`, its review status, and the
   * visits cancelled for it (action taken).
   */
  async forWeek(serviceUserId: string, anyDay: string) {
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = dayKeyInTimeZone(new Date(), timeZone);
    const overWeek = mondayOfOperationalIso(anyDay);
    const base = {
      overWeekStart: overWeek,
      // Always on since 10 Nov 2026 (no setting): `from` is the first week checked.
      setting: { on: true, from: rules.adjustOverCareFrom },
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
      const status: OverCareStatus =
        row.status === ServiceUserOverCareReviewStatus.ACTION_TAKEN
          ? 'DONE'
          : row.status === ServiceUserOverCareReviewStatus.NO_ACTION_NEEDED
            ? 'NO_ACTION'
            : 'PENDING_REVIEW';
      return {
        ...base,
        reviewId: row.id,
        status,
        adjustWeekStart: isoDay(row.adjustWeekStart),
        weeklyMinutes: row.weeklyMinutes,
        careGivenMinutes: row.careGivenMinutes,
        excludedMinutes: row.excludedMinutes,
        overMinutes: row.overMinutes,
        projected: false,
        cancelledMinutes: row.cancelledMinutes,
        takenBackMinutes: row.takenBackMinutes,
        notTakenBackMinutes: row.notTakenBackMinutes,
        adjustedAt: row.decidedAt?.toISOString() ?? null,
        decisionNote: row.decisionNote,
        visits: await this.visitsOf(row.cancelledJobIds, timeZone),
      };
    }

    const found = await this.overIn(serviceUserId, overWeek);
    const over = found?.over ?? null;
    const from = rules.adjustOverCareFrom ?? today;
    const status: OverCareStatus =
      !over || over.overMinutes <= 0
        ? 'NOTHING'
        : overWeek < from
          ? 'NOT_ELIGIBLE'
          : 'WILL_REVIEW';
    return {
      ...base,
      reviewId: null,
      status,
      adjustWeekStart: null,
      weeklyMinutes: over?.weeklyMinutes ?? 0,
      careGivenMinutes: over?.careGivenMinutes ?? 0,
      excludedMinutes: over?.excludedMinutes ?? 0,
      overMinutes: over?.overMinutes ?? 0,
      projected: over?.projected ?? false,
      cancelledMinutes: 0,
      takenBackMinutes: 0,
      notTakenBackMinutes: 0,
      adjustedAt: null,
      decisionNote: null,
      visits: [] as OverCareVisit[],
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

function weekStartOf(dayIso: string): string {
  return mondayOfOperationalIso(dayIso);
}

/** Upcoming visits grouped by week (Monday), in time order. */
function groupByWeek(visits: OverCareUpcomingVisit[]): Array<{
  weekStart: string;
  minutes: number;
  visits: OverCareUpcomingVisit[];
}> {
  const byWeek = new Map<string, OverCareUpcomingVisit[]>();
  for (const v of visits) {
    const wk = weekStartOf(v.date);
    byWeek.set(wk, [...(byWeek.get(wk) ?? []), v]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, list]) => ({
      weekStart,
      minutes: list.reduce((s, v) => s + v.minutes, 0),
      visits: list,
    }));
}

/**
 * Over care taken back per week: the cancelled visits from the earliest, until the over care is
 * used up. What is cancelled above the over care is not taken back (it stays as care owed).
 */
export function takeBackByWeek(
  cancelled: Array<{ date: string; startDateTime: string; minutes: number }>,
  overMinutes: number,
): Array<{ weekStart: string; minutes: number }> {
  let left = Math.max(0, overMinutes);
  const byWeek = new Map<string, number>();
  for (const v of [...cancelled].sort((a, b) =>
    a.startDateTime.localeCompare(b.startDateTime),
  )) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, v.minutes));
    if (!take) continue;
    left -= take;
    const wk = weekStartOf(v.date);
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + take);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, minutes]) => ({ weekStart, minutes }));
}
