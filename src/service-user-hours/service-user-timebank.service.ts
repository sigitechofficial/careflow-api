import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import { OPEN_VISIT_PLAN_STATUSES } from '../service-user-dom-care/service-user-weekly-hours-sync.util';
import { parseWeeklyContractedHours } from '../service-user-visit-plans/visit-plan-contracted-hours.util';
import { reconciliationBillableMinutes } from './service-user-hours.service';
import type {
  ServiceUserTimebankDetailQueryDto,
  ServiceUserTimebankQueryDto,
} from './dto/service-user-timebank-query.dto';
import {
  computeTimebankWeeks,
  mondayOfOperationalIso,
  timebankCancelParty,
  timebankCareNotDelivered,
  TIMEBANK_DELIVERED_RECON,
  TIMEBANK_PENDING_RECON,
  TIMEBANK_REJECTED_RECON,
  type TimebankHoursChange,
  type TimebankJob,
  type TimebankRecon,
  type TimebankWeek,
} from './service-user-timebank.util';

const serviceUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  serviceUserNumber: true,
  serviceStartDate: true,
  createdAt: true,
  location: { select: { id: true, name: true } },
  fundingType: { select: { id: true, name: true } },
  domCare: { select: { id: true, weeklyContractedHours: true } },
  visitPlans: {
    where: {
      deletedAt: null,
      status: { in: OPEN_VISIT_PLAN_STATUSES },
      weeklyContractedHours: { not: null },
    },
    select: { weeklyContractedHours: true },
    orderBy: { updatedAt: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.ServiceUserSelect;

type TimebankServiceUser = Prisma.ServiceUserGetPayload<{
  select: typeof serviceUserSelect;
}>;

type TimebankContext = {
  timeZone: string;
  now: Date;
  today: string;
  currentMonday: string;
  specialVisitsCount: boolean;
};

@Injectable()
export class ServiceUserTimebankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  /** Service users whose chosen week got fewer hours than set (current week: so far, with visits still to come). */
  async list(query: ServiceUserTimebankQueryDto) {
    const ctx = await this.context();
    const selectedMonday = query.weekStart
      ? mondayOfOperationalIso(query.weekStart)
      : ctx.currentMonday;
    const search = query.search?.trim();

    const serviceUsers = await this.prisma.serviceUser.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.fundingTypeId ? { fundingTypeId: query.fundingTypeId } : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { preferredName: { contains: search, mode: 'insensitive' } },
                {
                  serviceUserNumber: { contains: search, mode: 'insensitive' },
                },
              ],
            }
          : {}),
      },
      select: serviceUserSelect,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const weeksBySu = await this.weeksFor(serviceUsers, ctx, selectedMonday);
    const rows = serviceUsers.flatMap((su) => {
      const weeks = weeksBySu.get(su.id);
      const week = weeks?.find((w) => w.weekStart === selectedMonday);
      // Short, a visit still waiting for its clock-out (the office has to close it), or over the
      // weekly hours. The page splits them into Short and Over contract.
      if (
        !weeks ||
        !week ||
        (week.freeMinutes <= 0 &&
          week.awaitingMinutes <= 0 &&
          week.overMinutes <= 0)
      )
        return [];
      return [
        {
          ...this.serviceUserRow(su),
          weekStatus: week.status,
          setMinutes: week.setMinutes,
          createdMinutes: week.createdMinutes,
          deliveredMinutes: week.deliveredMinutes,
          pendingMinutes: week.pendingMinutes,
          scheduledMinutes: week.scheduledMinutes,
          awaitingMinutes: week.awaitingMinutes,
          awaitingVisits: week.visits.awaiting,
          // Visits to close (clocked in, never clocked out), for the office to finish from the list.
          awaitingVisitList: week.allVisits
            .filter((v) => v.outcome === 'AWAITING_CLOCK_OUT')
            .map((v) => ({
              jobId: v.jobId,
              jobName: v.jobName,
              day: v.day,
              start: v.start,
              end: v.end,
              plannedMinutes: v.plannedMinutes,
            })),
          freeMinutes: week.freeMinutes,
          // Covered with hours to spare: the visits came to more than the weekly hours.
          overMinutes: week.overMinutes,
          pendingVisits: week.visits.pending,
          // Why the week is short (missed, shorter, cancelled, no visit on the rota).
          reasons: week.reasons,
          // Total short up to the end of the chosen week (a week not finished adds nothing yet).
          balanceMinutes: week.balanceMinutes,
        },
      ];
    });

    const facets = await this.facets();
    return {
      weekStart: selectedMonday,
      weekEnd: addDaysToOperationalIso(selectedMonday, 6),
      currentWeekStart: ctx.currentMonday,
      isCurrentWeek: selectedMonday === ctx.currentMonday,
      rows,
      facets,
    };
  }

  /** One service user: totals since the start, the chosen week and every week to the end of the rota. */
  async detail(
    serviceUserId: string,
    query: ServiceUserTimebankDetailQueryDto,
  ) {
    const ctx = await this.context();
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: serviceUserSelect,
    });
    if (!su) throw new NotFoundException('Service user not found');
    const selectedMonday = query.weekStart
      ? mondayOfOperationalIso(query.weekStart)
      : ctx.currentMonday;
    const weeks =
      (await this.weeksFor([su], ctx, selectedMonday)).get(su.id) ?? [];
    const finished = weeks.filter(
      (w) => w.status === 'complete' || w.status === 'short',
    );
    // Totals run to the end of this week (it has started); the bank only takes finished weeks.
    const counted = weeks.filter((w) => w.status !== 'upcoming');
    const thisWeek = weeks.find((w) => w.status === 'current') ?? null;
    const week = weeks.find((w) => w.weekStart === selectedMonday) ?? null;
    const current = this.currentWeeklyHours(su);

    return {
      serviceUser: { ...this.serviceUserRow(su), weeklyHours: current },
      startDate: this.startIso(su, ctx.timeZone),
      currentWeekStart: ctx.currentMonday,
      totals: {
        weeks: finished.length,
        includesCurrentWeek: thisWeek != null,
        setMinutes: sum(counted, (w) => w.setMinutes),
        deliveredMinutes: sum(counted, (w) => w.deliveredMinutes),
        invoicedMinutes: sum(counted, (w) => w.invoicedMinutes),
        pendingMinutes: sum(counted, (w) => w.pendingMinutes),
        bankMinutes: this.bankNow(weeks),
        thisWeek: thisWeek
          ? {
              weekStart: thisWeek.weekStart,
              weekEnd: thisWeek.weekEnd,
              scheduledMinutes: thisWeek.scheduledMinutes,
              scheduledVisits: thisWeek.visits.scheduled,
              freeMinutes: thisWeek.freeMinutes,
            }
          : null,
      },
      selectedWeek: week,
      /** Every visit not fully delivered, newest first, with its week. */
      shortVisits: [...weeks]
        .reverse()
        .flatMap((w) =>
          [...w.shortVisits]
            .reverse()
            .map((v) => ({ ...v, weekStart: w.weekStart })),
        ),
      // Short visits are listed above; every visit is in allVisits.
      weeks: weeks.map((w) => withoutShortVisits(w)).reverse(),
    };
  }

  /**
   * One service user's weeks from the start date to the last week with a rota visit, with the bank
   * earned so far (finished weeks only). Used by the timebank ledger (docs/SU_TIMEBANK_USE_PLAN.md).
   */
  async weeksForServiceUser(serviceUserId: string): Promise<{
    weeks: TimebankWeek[];
    earnedMinutes: number;
    currentWeeklyHours: number | null;
    currentMonday: string;
    timeZone: string;
  } | null> {
    const ctx = await this.context();
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: serviceUserSelect,
    });
    if (!su) return null;
    const weeks = (await this.weeksFor([su], ctx, ctx.currentMonday)).get(su.id) ?? [];
    return {
      weeks,
      earnedMinutes: this.bankNow(weeks),
      currentWeeklyHours: this.currentWeeklyHours(su),
      currentMonday: ctx.currentMonday,
      timeZone: ctx.timeZone,
    };
  }

  private async context(): Promise<TimebankContext> {
    const [timeZone, rules] = await Promise.all([
      this.orgSettings.getOperationalTimezone(),
      this.orgSettings.getServiceUserWeeklyHoursSettings(),
    ]);
    const now = new Date();
    const today = dayKeyInTimeZone(now, timeZone);
    return {
      timeZone,
      now,
      today,
      currentMonday: mondayOfOperationalIso(today),
      specialVisitsCount: rules.specialVisitsCount,
    };
  }

  private serviceUserRow(su: TimebankServiceUser) {
    const name =
      `${su.preferredName?.trim() || su.firstName} ${su.lastName}`.trim();
    return {
      id: su.id,
      name,
      serviceUserNumber: su.serviceUserNumber,
      location: su.location,
      fundingType: su.fundingType,
      weeklyHours: this.currentWeeklyHours(su),
    };
  }

  /** Same source as the weekly hours limit: DOM Care, else the newest open visit plan. */
  private currentWeeklyHours(su: TimebankServiceUser): number | null {
    const dom = su.domCare?.weeklyContractedHours?.trim();
    return parseWeeklyContractedHours(
      dom || su.visitPlans[0]?.weeklyContractedHours || null,
    );
  }

  private startIso(su: TimebankServiceUser, timeZone: string): string {
    return su.serviceStartDate
      ? su.serviceStartDate.toISOString().slice(0, 10)
      : dayKeyInTimeZone(su.createdAt, timeZone);
  }

  /** Bank as it stands: the last finished week's balance. */
  private bankNow(weeks: TimebankWeek[]): number {
    const finished = weeks.filter(
      (w) => w.status === 'complete' || w.status === 'short',
    );
    return finished.length ? finished[finished.length - 1].balanceMinutes : 0;
  }

  private async weeksFor(
    serviceUsers: TimebankServiceUser[],
    ctx: TimebankContext,
    selectedMonday: string,
  ): Promise<Map<string, TimebankWeek[]>> {
    const result = new Map<string, TimebankWeek[]>();
    if (!serviceUsers.length) return result;
    const ids = serviceUsers.map((s) => s.id);
    const starts = serviceUsers
      .map((s) => this.startIso(s, ctx.timeZone))
      .sort();
    const from = operationalDayBounds(
      mondayOfOperationalIso(starts[0]),
      ctx.timeZone,
    ).start;
    const domIds = serviceUsers.flatMap((s) =>
      s.domCare ? [s.domCare.id] : [],
    );

    const [jobs, recons, audits] = await Promise.all([
      this.prisma.scheduledJob.findMany({
        where: {
          serviceUserId: { in: ids },
          deletedAt: null,
          scheduledStartDateTime: { gte: from },
        },
        select: {
          id: true,
          serviceUserId: true,
          jobName: true,
          scheduledStartDateTime: true,
          scheduledEndDateTime: true,
          estimatedDurationMinutes: true,
          requiredCarers: true,
          status: true,
          metadata: true,
          visits: {
            where: {
              deletedAt: null,
              isActive: true,
              actualStartDateTime: { not: null },
            },
            select: { id: true },
            take: 1,
          },
          cancellation: {
            select: {
              cancelledByParty: true,
              reasonCode: true,
              reasonNotes: true,
            },
          },
        },
      }),
      this.prisma.visitReconciliation.findMany({
        where: {
          serviceUserId: { in: ids },
          plannedStartDateTime: { gte: from },
          status: {
            in: [
              ...TIMEBANK_DELIVERED_RECON,
              ...TIMEBANK_PENDING_RECON,
              ...TIMEBANK_REJECTED_RECON,
            ],
          },
        },
        select: {
          serviceUserId: true,
          scheduledJobId: true,
          status: true,
          billableMinutes: true,
          approvedBillStart: true,
          approvedBillEnd: true,
          actualStartDateTime: true,
          actualEndDateTime: true,
          includedInInvoiceRunId: true,
        },
      }),
      domIds.length
        ? this.prisma.auditLog.findMany({
            where: {
              recordType: 'ServiceUserDomCare',
              recordId: { in: domIds },
            },
            select: {
              recordId: true,
              createdAt: true,
              oldValues: true,
              newValues: true,
            },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const jobsBySu = groupBy(
      jobs.map((j) => ({
        serviceUserId: j.serviceUserId,
        job: {
          id: j.id,
          jobName: j.jobName,
          start: j.scheduledStartDateTime,
          end: j.scheduledEndDateTime,
          estimatedDurationMinutes: j.estimatedDurationMinutes,
          requiredCarers: j.requiredCarers,
          status: j.status,
          special:
            ((j.metadata ?? {}) as { special?: boolean }).special === true,
          careNotDelivered: timebankCareNotDelivered(j.metadata),
          clockedIn: j.visits.length > 0,
          cancellation: j.cancellation
            ? {
                party: timebankCancelParty(
                  j.cancellation.cancelledByParty,
                  j.cancellation.reasonCode,
                ),
                reasonCode: j.cancellation.reasonCode,
                notes: j.cancellation.reasonNotes?.trim() || null,
              }
            : null,
        } satisfies TimebankJob,
      })),
      (x) => x.serviceUserId,
    );
    const reconsBySu = groupBy(
      recons.map((r) => ({
        serviceUserId: r.serviceUserId,
        recon: {
          scheduledJobId: r.scheduledJobId,
          status: r.status,
          minutes: reconciliationBillableMinutes(r),
          invoiced: r.includedInInvoiceRunId != null,
        } satisfies TimebankRecon,
      })),
      (x) => x.serviceUserId,
    );
    const changesByDom = new Map<string, TimebankHoursChange[]>();
    for (const a of audits) {
      const next = jsonHours(a.newValues);
      if (next === undefined || !a.recordId) continue;
      const list = changesByDom.get(a.recordId) ?? [];
      list.push({
        at: a.createdAt,
        previous: jsonHours(a.oldValues) ?? null,
        value: next,
      });
      changesByDom.set(a.recordId, list);
    }

    for (const su of serviceUsers) {
      const suJobs = (jobsBySu.get(su.id) ?? []).map((x) => x.job);
      const latestJobDay = suJobs.reduce<string | null>((max, j) => {
        const day = dayKeyInTimeZone(j.start, ctx.timeZone);
        return !max || day > max ? day : max;
      }, null);
      const lastWeekStart = [
        ctx.currentMonday,
        selectedMonday,
        latestJobDay ? mondayOfOperationalIso(latestJobDay) : '',
      ]
        .sort()
        .pop()!;
      result.set(
        su.id,
        computeTimebankWeeks({
          timeZone: ctx.timeZone,
          now: ctx.now,
          startIso: this.startIso(su, ctx.timeZone),
          lastWeekStart,
          jobs: suJobs,
          recons: (reconsBySu.get(su.id) ?? []).map((x) => x.recon),
          hoursChanges: su.domCare
            ? (changesByDom.get(su.domCare.id) ?? [])
            : [],
          currentWeeklyHours: this.currentWeeklyHours(su),
          specialVisitsCount: ctx.specialVisitsCount,
          weekStartInstant: (iso) =>
            operationalDayBounds(iso, ctx.timeZone).start,
        }),
      );
    }
    return result;
  }

  private async facets() {
    const [locations, fundingTypes] = await Promise.all([
      this.prisma.location.findMany({
        where: { serviceUsers: { some: { deletedAt: null, isActive: true } } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.serviceUserFundingType.findMany({
        where: { serviceUsers: { some: { deletedAt: null, isActive: true } } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { locations, fundingTypes };
  }
}

/** Weekly hours in an audit snapshot: undefined when the snapshot doesn't carry the field. */
function jsonHours(values: Prisma.JsonValue): number | null | undefined {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    return undefined;
  if (!('weeklyContractedHours' in values)) return undefined;
  const raw = (values as Record<string, unknown>).weeklyContractedHours;
  if (raw == null) return parseWeeklyContractedHours(null);
  return parseWeeklyContractedHours(
    typeof raw === 'string' || typeof raw === 'number' ? String(raw) : null,
  );
}

function withoutShortVisits(
  week: TimebankWeek,
): Omit<TimebankWeek, 'shortVisits'> {
  const rest: Partial<TimebankWeek> = { ...week };
  delete rest.shortVisits;
  return rest as Omit<TimebankWeek, 'shortVisits'>;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((s, item) => s + pick(item), 0);
}
