import { Injectable, NotFoundException } from '@nestjs/common';
import { AllocationStatus, Prisma, ScheduledJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import {
  mondayOfOperationalIso,
  timebankCancelParty,
  timebankCareNotDelivered,
  type TimebankHoursChange,
} from '../service-user-hours/service-user-timebank.util';
import { reconciliationPayableMinutes } from './employee-hours.service';
import type {
  CarerTimebankDetailQueryDto,
  CarerTimebankQueryDto,
} from './dto/carer-timebank-query.dto';
import {
  CARER_TIMEBANK_PENDING_RECON,
  CARER_TIMEBANK_REJECTED_RECON,
  CARER_TIMEBANK_WORKED_RECON,
  computeCarerTimebankWeeks,
  type CarerTimebankAbsence,
  type CarerTimebankRecon,
  type CarerTimebankVisit,
  type CarerTimebankWeek,
} from './carer-timebank.util';

/** Allocations that still stand (the carer is on the visit). */
const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const CANCELLED_JOB: ScheduledJobStatus[] = [
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
];

const carerSelect = {
  id: true,
  createdAt: true,
  personalDetail: { select: { firstName: true, lastName: true } },
  employment: {
    select: {
      id: true,
      employeeNumber: true,
      contractedWeeklyHours: true,
      startDate: true,
      endDate: true,
      location: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.EmployeeSelect;

type TimebankCarer = Prisma.EmployeeGetPayload<{ select: typeof carerSelect }>;

type TimebankContext = {
  timeZone: string;
  now: Date;
  today: string;
  currentMonday: string;
};

@Injectable()
export class CarerTimebankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  /** Carers with contracted hours and how their chosen week went (current week: so far, with visits to come). */
  async list(query: CarerTimebankQueryDto) {
    const ctx = await this.context();
    const selectedMonday = query.weekStart
      ? mondayOfOperationalIso(query.weekStart)
      : ctx.currentMonday;
    const search = query.search?.trim();
    const carers = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        employment: {
          deletedAt: null,
          contractedWeeklyHours: { gt: 0 },
          ...(query.locationId ? { locationId: query.locationId } : {}),
        },
        ...(search
          ? {
              personalDetail: {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      select: carerSelect,
      orderBy: [
        { personalDetail: { lastName: 'asc' } },
        { personalDetail: { firstName: 'asc' } },
      ],
    });

    const weeksByCarer = await this.weeksFor(carers, ctx, selectedMonday);
    const rows = carers.flatMap((c) => {
      const weeks = weeksByCarer.get(c.id);
      const week = weeks?.find((w) => w.weekStart === selectedMonday);
      // Not employed yet (or left) that week: nothing to show.
      if (!weeks || !week || week.contractedMinutes <= 0) return [];
      return [
        {
          ...this.carerRow(c),
          weekStatus: week.status,
          contractedMinutes: week.contractedMinutes,
          absenceMinutes: week.absenceMinutes,
          setMinutes: week.setMinutes,
          assignedMinutes: week.assignedMinutes,
          workedMinutes: week.workedMinutes,
          pendingMinutes: week.pendingMinutes,
          scheduledMinutes: week.scheduledMinutes,
          cancelledMinutes: week.cancelledMinutes,
          notGivenMinutes: week.notGivenMinutes,
          notWorkedMinutes: week.notWorkedMinutes,
          freeMinutes: week.freeMinutes,
          // Total short up to the end of the chosen week (a week not finished adds nothing yet).
          balanceMinutes: week.balanceMinutes,
        },
      ];
    });

    const locations = await this.prisma.location.findMany({
      where: {
        locationEmployments: {
          some: { deletedAt: null, contractedWeeklyHours: { gt: 0 } },
        },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return {
      weekStart: selectedMonday,
      weekEnd: addDaysToOperationalIso(selectedMonday, 6),
      currentWeekStart: ctx.currentMonday,
      isCurrentWeek: selectedMonday === ctx.currentMonday,
      rows,
      facets: { locations },
    };
  }

  /** One carer: totals since the start, every week to the end of their rota, newest first. */
  async detail(employeeId: string, query: CarerTimebankDetailQueryDto) {
    const ctx = await this.context();
    const carer = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: carerSelect,
    });
    if (!carer) throw new NotFoundException('Carer not found');
    const selectedMonday = query.weekStart
      ? mondayOfOperationalIso(query.weekStart)
      : ctx.currentMonday;
    const weeks =
      (await this.weeksFor([carer], ctx, selectedMonday)).get(carer.id) ?? [];
    const finished = weeks.filter(
      (w) => w.status === 'complete' || w.status === 'short',
    );
    // Totals run to the end of this week (it has started); the bank only takes finished weeks.
    const counted = weeks.filter((w) => w.status !== 'upcoming');
    const thisWeek = weeks.find((w) => w.status === 'current') ?? null;

    return {
      carer: this.carerRow(carer),
      startDate: this.startIso(carer, ctx.timeZone),
      currentWeekStart: ctx.currentMonday,
      totals: {
        weeks: finished.length,
        includesCurrentWeek: thisWeek != null,
        contractedMinutes: sum(counted, (w) => w.contractedMinutes),
        absenceMinutes: sum(counted, (w) => w.absenceMinutes),
        setMinutes: sum(counted, (w) => w.setMinutes),
        assignedMinutes: sum(counted, (w) => w.assignedMinutes),
        workedMinutes: sum(counted, (w) => w.workedMinutes),
        pendingMinutes: sum(counted, (w) => w.pendingMinutes),
        notGivenMinutes: sum(finished, (w) => w.notGivenMinutes),
        notWorkedMinutes: sum(finished, (w) => w.notWorkedMinutes),
        cancelledMinutes: sum(finished, (w) => w.cancelledMinutes),
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
      /** Every visit not fully worked, newest first, with its week. */
      shortVisits: [...weeks].reverse().flatMap((w) =>
        [...w.allVisits]
          .reverse()
          .filter((v) => v.shortMinutes > 0)
          .map((v) => ({ ...v, weekStart: w.weekStart })),
      ),
      weeks: [...weeks].reverse(),
    };
  }

  private async context(): Promise<TimebankContext> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const now = new Date();
    const today = dayKeyInTimeZone(now, timeZone);
    return {
      timeZone,
      now,
      today,
      currentMonday: mondayOfOperationalIso(today),
    };
  }

  private carerRow(c: TimebankCarer) {
    return {
      id: c.id,
      name:
        [c.personalDetail?.firstName, c.personalDetail?.lastName]
          .filter(Boolean)
          .join(' ') || 'Carer',
      employeeNumber: c.employment?.employeeNumber ?? null,
      location: c.employment?.location ?? null,
      weeklyHours: c.employment?.contractedWeeklyHours ?? null,
    };
  }

  /**
   * First day counted: the later of the employment start date and the day the carer was added to
   * the system (rota data only exists from then on).
   */
  private startIso(c: TimebankCarer, timeZone: string): string {
    const added = dayKeyInTimeZone(c.createdAt, timeZone);
    const start = c.employment?.startDate
      ? c.employment.startDate.toISOString().slice(0, 10)
      : null;
    return start && start > added ? start : added;
  }

  /** Bank as it stands: the last finished week's balance. */
  private bankNow(weeks: CarerTimebankWeek[]): number {
    const finished = weeks.filter(
      (w) => w.status === 'complete' || w.status === 'short',
    );
    return finished.length ? finished[finished.length - 1].balanceMinutes : 0;
  }

  private async weeksFor(
    carers: TimebankCarer[],
    ctx: TimebankContext,
    selectedMonday: string,
  ): Promise<Map<string, CarerTimebankWeek[]>> {
    const result = new Map<string, CarerTimebankWeek[]>();
    if (!carers.length) return result;
    const ids = carers.map((c) => c.id);
    const starts = carers.map((c) => this.startIso(c, ctx.timeZone)).sort();
    const from = operationalDayBounds(
      mondayOfOperationalIso(starts[0]),
      ctx.timeZone,
    ).start;
    const employmentIds = carers.flatMap((c) =>
      c.employment ? [c.employment.id] : [],
    );

    const [allocations, recons, absences, audits] = await Promise.all([
      this.prisma.jobAllocation.findMany({
        where: {
          employeeId: { in: ids },
          deletedAt: null,
          scheduledJob: {
            deletedAt: null,
            scheduledStartDateTime: { gte: from },
          },
          OR: [
            { isActive: true, status: { in: ACTIVE_ALLOCATION } },
            // Cancelled with the visit: the carer was given it, then it was taken away.
            {
              status: AllocationStatus.CANCELLED,
              scheduledJob: { status: { in: CANCELLED_JOB } },
            },
          ],
        },
        select: {
          id: true,
          employeeId: true,
          scheduledStartDateTime: true,
          scheduledEndDateTime: true,
          durationMinutes: true,
          scheduledJob: {
            select: {
              id: true,
              jobName: true,
              status: true,
              scheduledStartDateTime: true,
              scheduledEndDateTime: true,
              estimatedDurationMinutes: true,
              metadata: true,
              serviceUser: {
                select: {
                  firstName: true,
                  lastName: true,
                  preferredName: true,
                },
              },
              cancellation: {
                select: {
                  cancelledByParty: true,
                  reasonCode: true,
                  reasonNotes: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.visitReconciliation.findMany({
        where: {
          employeeId: { in: ids },
          plannedStartDateTime: { gte: from },
          status: {
            in: [
              ...CARER_TIMEBANK_WORKED_RECON,
              ...CARER_TIMEBANK_PENDING_RECON,
              ...CARER_TIMEBANK_REJECTED_RECON,
            ],
          },
        },
        select: {
          employeeId: true,
          scheduledJobId: true,
          status: true,
          payableMinutes: true,
          approvedPayStart: true,
          approvedPayEnd: true,
          actualStartDateTime: true,
          actualEndDateTime: true,
        },
      }),
      this.prisma.employeeAbsenceRecord.findMany({
        where: {
          employeeId: { in: ids },
          deletedAt: null,
          isActive: true,
          toDateTime: { gte: from },
        },
        select: {
          employeeId: true,
          fromDateTime: true,
          toDateTime: true,
          absenceType: true,
          sicknessFlag: true,
        },
      }),
      employmentIds.length
        ? this.prisma.auditLog.findMany({
            where: {
              recordType: 'EmployeeEmployment',
              recordId: { in: employmentIds },
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

    const visitsByCarer = groupBy(
      allocations.map((a) => {
        const job = a.scheduledJob;
        const start = a.scheduledStartDateTime ?? job.scheduledStartDateTime;
        const end = a.scheduledEndDateTime ?? job.scheduledEndDateTime;
        const minutes = end
          ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
          : (a.durationMinutes ?? job.estimatedDurationMinutes ?? 0);
        const su = job.serviceUser;
        return {
          employeeId: a.employeeId,
          visit: {
            allocationId: a.id,
            jobId: job.id,
            jobName: job.jobName,
            serviceUserName:
              `${su.preferredName?.trim() || su.firstName} ${su.lastName}`.trim(),
            start,
            end,
            minutes,
            jobStatus: job.status,
            cancelled: CANCELLED_JOB.includes(job.status),
            cancellation: job.cancellation
              ? {
                  party: timebankCancelParty(
                    job.cancellation.cancelledByParty,
                    job.cancellation.reasonCode,
                  ),
                  reasonCode: job.cancellation.reasonCode,
                  notes: job.cancellation.reasonNotes?.trim() || null,
                }
              : null,
            careNotDelivered: timebankCareNotDelivered(job.metadata),
          } satisfies CarerTimebankVisit,
        };
      }),
      (x) => x.employeeId,
    );
    const reconsByCarer = groupBy(
      recons.flatMap((r) =>
        r.employeeId
          ? [
              {
                employeeId: r.employeeId,
                recon: {
                  scheduledJobId: r.scheduledJobId,
                  status: r.status,
                  minutes: reconciliationPayableMinutes(r),
                } satisfies CarerTimebankRecon,
              },
            ]
          : [],
      ),
      (x) => x.employeeId,
    );
    const absencesByCarer = groupBy(
      absences.map((a) => ({
        employeeId: a.employeeId,
        absence: {
          from: a.fromDateTime,
          to: a.toDateTime,
          type: a.absenceType,
          sickness: a.sicknessFlag,
        } satisfies CarerTimebankAbsence,
      })),
      (x) => x.employeeId,
    );
    const changesByEmployment = new Map<string, TimebankHoursChange[]>();
    for (const a of audits) {
      const next = jsonHours(a.newValues);
      if (next === undefined || !a.recordId) continue;
      const list = changesByEmployment.get(a.recordId) ?? [];
      list.push({
        at: a.createdAt,
        previous: jsonHours(a.oldValues) ?? null,
        value: next,
      });
      changesByEmployment.set(a.recordId, list);
    }

    for (const c of carers) {
      const visits = (visitsByCarer.get(c.id) ?? []).map((x) => x.visit);
      const latestDay = visits.reduce<string | null>((max, v) => {
        const day = dayKeyInTimeZone(v.start, ctx.timeZone);
        return !max || day > max ? day : max;
      }, null);
      const lastWeekStart = [
        ctx.currentMonday,
        selectedMonday,
        latestDay ? mondayOfOperationalIso(latestDay) : '',
      ]
        .sort()
        .pop()!;
      result.set(
        c.id,
        computeCarerTimebankWeeks({
          timeZone: ctx.timeZone,
          now: ctx.now,
          startIso: this.startIso(c, ctx.timeZone),
          endIso: c.employment?.endDate
            ? c.employment.endDate.toISOString().slice(0, 10)
            : null,
          lastWeekStart,
          visits,
          recons: (reconsByCarer.get(c.id) ?? []).map((x) => x.recon),
          absences: (absencesByCarer.get(c.id) ?? []).map((x) => x.absence),
          hoursChanges: c.employment
            ? (changesByEmployment.get(c.employment.id) ?? [])
            : [],
          currentWeeklyHours: c.employment?.contractedWeeklyHours ?? null,
          dayBounds: (iso) => operationalDayBounds(iso, ctx.timeZone),
        }),
      );
    }
    return result;
  }
}

/** Contracted weekly hours in an employment audit snapshot: undefined when the snapshot doesn't carry it. */
function jsonHours(values: Prisma.JsonValue): number | null | undefined {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    return undefined;
  if (!('contractedWeeklyHours' in values)) return undefined;
  const raw = (values as Record<string, unknown>).contractedWeeklyHours;
  if (raw == null) return null;
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number.parseFloat(raw)
        : NaN;
  return Number.isFinite(n) ? n : null;
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
