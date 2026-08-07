import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AllocationStatus,
  EcmArrivalClassification,
  EcmLifecycleStatus,
  EcmMissedClassification,
  Prisma,
  ScheduledJobStatus,
  VisitAttendanceEventType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatScheduleDate } from '../schedules/schedules-date.util';
import { EcmEvaluationService } from './ecm-evaluation.service';
import { EcmScheduleVersionService } from './ecm-schedule-version.service';
import { EcmThresholdLookupsService } from './ecm-threshold-lookups.service';
import type { EcmLiveDashboardQueryDto } from './dto/ecm-live-dashboard.dto';
import { localVisitDateFromStart } from './ecm-evaluation.mapper';
import { scheduledJobLocationScope } from './ecm-location-scope.util';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  addDaysToOperationalIso,
  operationalTodayIso,
} from '../common/utils/operational-day.util';

function resolveLiveDateRange(query: EcmLiveDashboardQueryDto): {
  dateFrom: string;
  dateTo: string;
} {
  if (query.dateFrom) {
    const dateFrom = query.dateFrom.slice(0, 10);
    const dateTo = (query.dateTo ?? query.dateFrom).slice(0, 10);
    return dateFrom <= dateTo
      ? { dateFrom, dateTo }
      : { dateFrom: dateTo, dateTo: dateFrom };
  }
  const day = (query.date ?? operationalTodayIso()).slice(0, 10);
  return { dateFrom: day, dateTo: day };
}

function plannedOperationalDayKey(plannedStart: Date): string {
  return formatScheduleDate(
    localVisitDateFromStart(plannedStart, DEFAULT_OPERATIONAL_TIMEZONE),
  );
}

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const EVAL_INCLUDE = {
  scheduledJob: {
    select: {
      id: true,
      jobName: true,
      serviceUserId: true,
      status: true,
      address: true,
      postcode: true,
      scheduledStartDateTime: true,
      scheduledEndDateTime: true,
      serviceUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
        },
      },
      visits: {
        where: { deletedAt: null, isActive: true },
        orderBy: { scheduledStartDateTime: 'asc' as const },
        take: 1,
        select: {
          visitName: true,
          visitPlanSlot: {
            select: { slotCode: true, medicationRoundCode: true },
          },
        },
      },
      allocations: {
        where: {
          deletedAt: null,
          isActive: true,
          unallocatedAt: null,
          status: { in: ACTIVE_ALLOCATION },
        },
        select: {
          isLeadCarer: true,
          employee: {
            select: {
              id: true,
              personalDetail: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** Jobs excluded from ECM live-dashboard backfill (not operational visits). */
const SKIP_BACKFILL_JOB: ScheduledJobStatus[] = [
  ScheduledJobStatus.DRAFT,
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
];

type DashboardBucket =
  | 'dueNow'
  | 'startingSoon'
  | 'inProgress'
  | 'earlyArrival'
  | 'lateArrival'
  | 'veryLateArrival'
  | 'potentialMissed'
  | 'confirmedMissed'
  | 'missingCheckout'
  | 'outsideGeofence'
  | 'manualAttendance'
  | 'completed'
  | 'completedOnTime'
  | 'completedLate';

const COMPLETED_LIFECYCLES: ReadonlySet<EcmLifecycleStatus> = new Set([
  EcmLifecycleStatus.COMPLETED,
  EcmLifecycleStatus.COMPLETED_WITH_EXCEPTION,
  EcmLifecycleStatus.CHECKED_OUT,
  EcmLifecycleStatus.CLOSED,
]);

export type EcmLiveVisitRow = {
  scheduledJobId: string;
  scheduledVisitId: string | null;
  jobName: string;
  /** Call-slot label (Morning / Midday / …) when known. */
  slotLabel: string | null;
  serviceUserId: string;
  serviceUserName: string;
  carers: Array<{ employeeId: string; name: string; isLeadCarer: boolean }>;
  address: string | null;
  postcode: string | null;
  plannedStartDateTime: string;
  plannedEndDateTime: string | null;
  actualCheckInAt: string | null;
  actualCheckOutAt: string | null;
  plannedDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  lifecycleStatus: string;
  arrivalClassification: string;
  departureClassification: string;
  durationClassification: string;
  missedClassification: string;
  confidence: string;
  criticality: string;
  startVarianceMinutes: number | null;
  endVarianceMinutes: number | null;
  durationVarianceMinutes: number | null;
  appliedSettingsLevel: string;
  operationalExceptionCodes: string[];
  buckets: DashboardBucket[];
};

export type EcmLiveDashboardSummary = {
  total: number;
  completed: number;
  completedOnTime: number;
  completedLate: number;
  /** Share of completed with assessed on-time/early arrival (null when none completed). */
  completedOnTimePct: number | null;
  outstanding: number;
  inProgress: number;
  potentialMissed: number;
  confirmedMissed: number;
  missingCheckout: number;
  /** Past planned start, no check-in, not confirmed missed. */
  missingCheckIn: number;
};

@Injectable()
export class EcmVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluation: EcmEvaluationService,
    private readonly scheduleVersions: EcmScheduleVersionService,
    private readonly thresholdLookups: EcmThresholdLookupsService,
  ) {}

  async getLiveDashboard(query: EcmLiveDashboardQueryDto) {
    const { dateFrom, dateTo } = resolveLiveDateRange(query);
    const singleDay = dateFrom === dateTo;
    const date = singleDay ? dateFrom : dateTo;
    const pageLimit = query.limit ?? 150;
    const now = new Date();
    const operationalToday = operationalTodayIso(now);
    const windows = await this.thresholdLookups.getDashboardWindows();
    const soonMs = windows.startingSoonMinutes * 60_000;
    const dueWindowMs = windows.dueNowWindowMinutes * 60_000;

    const scheduledJobAnd: Prisma.ScheduledJobWhereInput[] = [];
    if (query.locationId) {
      scheduledJobAnd.push(scheduledJobLocationScope(query.locationId));
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      scheduledJobAnd.push({
        OR: [
          { jobName: { contains: q, mode: 'insensitive' } },
          {
            serviceUser: {
              OR: [
                { preferredName: { contains: q, mode: 'insensitive' } },
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
              ],
            },
          },
        ],
      });
    }

    const localDateFilter: Prisma.DateTimeFilter = singleDay
      ? { equals: new Date(`${dateFrom}T00:00:00.000Z`) }
      : {
          gte: new Date(`${dateFrom}T00:00:00.000Z`),
          lte: new Date(`${dateTo}T00:00:00.000Z`),
        };

    const where: Prisma.EcmVisitEvaluationWhereInput = {
      localVisitDate: localDateFilter,
      ...(query.arrivalClassification
        ? { arrivalClassification: query.arrivalClassification }
        : {}),
      ...(query.missedClassification
        ? { missedClassification: query.missedClassification }
        : {}),
      ...(query.lifecycleStatus ? { lifecycleStatus: query.lifecycleStatus } : {}),
      scheduledJob: {
        deletedAt: null,
        isActive: true,
        ...(query.scheduleAreaId ? { scheduleAreaId: query.scheduleAreaId } : {}),
        ...(query.serviceUserId ? { serviceUserId: query.serviceUserId } : {}),
        ...(scheduledJobAnd.length ? { AND: scheduledJobAnd } : {}),
      },
    };

    // Catch-up only: today ±1 intersected with the requested range (not full YTD on read).
    const catchFrom = addDaysToOperationalIso(operationalToday, -1);
    const catchTo = addDaysToOperationalIso(operationalToday, 1);
    const ensureFrom = catchFrom > dateFrom ? catchFrom : dateFrom;
    const ensureTo = catchTo < dateTo ? catchTo : dateTo;
    if (ensureFrom <= ensureTo) {
      await this.ensureEvaluationsForDateRange({
        dateFrom: ensureFrom,
        dateTo: ensureTo,
        now,
        evaluateBudget: 120,
        candidateLimit: 400,
        scheduleAreaId: query.scheduleAreaId,
        serviceUserId: query.serviceUserId,
        locationId: query.locationId,
      });
    }

    const total = await this.prisma.ecmVisitEvaluation.count({ where });

    // Light rows for period-wide tiles/summary (no heavy includes).
    const lightEvals = await this.prisma.ecmVisitEvaluation.findMany({
      where,
      take: 10_000,
      orderBy: [{ plannedStartDateTime: 'asc' }, { scheduledJobId: 'asc' }],
      select: {
        scheduledJobId: true,
        plannedStartDateTime: true,
        plannedEndDateTime: true,
        actualCheckInAt: true,
        actualCheckOutAt: true,
        lifecycleStatus: true,
        arrivalClassification: true,
        departureClassification: true,
        durationClassification: true,
        missedClassification: true,
        operationalExceptionCodes: true,
        localVisitDate: true,
        startVarianceMinutes: true,
        endVarianceMinutes: true,
        durationVarianceMinutes: true,
        scheduledJob: { select: { status: true } },
      },
    });

    const summaryRows: EcmLiveVisitRow[] = lightEvals.map((ev) => {
      const visitOperationalDay = formatScheduleDate(ev.localVisitDate);
      const buckets = this.classifyBuckets(
        ev as never,
        now,
        soonMs,
        dueWindowMs,
        visitOperationalDay === operationalToday,
      );
      return {
        scheduledJobId: ev.scheduledJobId,
        scheduledVisitId: null,
        jobName: '',
        slotLabel: null,
        serviceUserId: '',
        serviceUserName: '',
        carers: [],
        address: null,
        postcode: null,
        plannedStartDateTime: ev.plannedStartDateTime.toISOString(),
        plannedEndDateTime: ev.plannedEndDateTime?.toISOString() ?? null,
        actualCheckInAt: ev.actualCheckInAt?.toISOString() ?? null,
        actualCheckOutAt: ev.actualCheckOutAt?.toISOString() ?? null,
        plannedDurationMinutes: null,
        actualDurationMinutes: null,
        lifecycleStatus: ev.lifecycleStatus,
        arrivalClassification: ev.arrivalClassification,
        departureClassification: ev.departureClassification,
        durationClassification: ev.durationClassification,
        missedClassification: ev.missedClassification,
        confidence: '',
        criticality: '',
        startVarianceMinutes: ev.startVarianceMinutes,
        endVarianceMinutes: ev.endVarianceMinutes,
        durationVarianceMinutes: ev.durationVarianceMinutes,
        appliedSettingsLevel: '',
        operationalExceptionCodes: ev.operationalExceptionCodes,
        buckets,
      };
    });

    const cursor = this.parseLiveCursor(query.cursor);
    const pageWhere: Prisma.EcmVisitEvaluationWhereInput = cursor
      ? {
          AND: [
            where,
            {
              OR: [
                { plannedStartDateTime: { gt: cursor.plannedStart } },
                {
                  plannedStartDateTime: cursor.plannedStart,
                  scheduledJobId: { gt: cursor.scheduledJobId },
                },
              ],
            },
          ],
        }
      : where;

    let pageEvals = await this.prisma.ecmVisitEvaluation.findMany({
      where: pageWhere,
      take: pageLimit,
      orderBy: [{ plannedStartDateTime: 'asc' }, { scheduledJobId: 'asc' }],
      include: EVAL_INCLUDE,
    });

    const staleEvaluations = pageEvals
      .filter((ev) => {
        const jobStatus = ev.scheduledJob.status;
        const evalCompleted = this.isCompletedEvaluation(ev);

        if (
          jobStatus === ScheduledJobStatus.COMPLETED &&
          (!ev.actualCheckOutAt || !evalCompleted)
        ) {
          return true;
        }
        if (jobStatus === ScheduledJobStatus.IN_PROGRESS && evalCompleted) {
          return true;
        }
        if (
          jobStatus === ScheduledJobStatus.MISSED &&
          ev.missedClassification === EcmMissedClassification.NONE
        ) {
          return true;
        }
        return (
          !ev.actualCheckInAt &&
          ev.plannedStartDateTime.getTime() < now.getTime() &&
          (ev.missedClassification === EcmMissedClassification.NONE ||
            ev.missedClassification === EcmMissedClassification.POTENTIAL_MISSED)
        );
      })
      .slice(0, 40);

    if (staleEvaluations.length > 0) {
      await this.evaluateJobsInChunks(
        staleEvaluations.map((e) => e.scheduledJobId),
        now,
      );
      pageEvals = await this.prisma.ecmVisitEvaluation.findMany({
        where: pageWhere,
        take: pageLimit,
        orderBy: [{ plannedStartDateTime: 'asc' }, { scheduledJobId: 'asc' }],
        include: EVAL_INCLUDE,
      });
    }

    const refreshed = pageEvals;
    const last = refreshed[refreshed.length - 1];
    const nextCursor =
      refreshed.length === pageLimit && last
        ? `${last.plannedStartDateTime.toISOString()}|${last.scheduledJobId}`
        : null;

    const rows: EcmLiveVisitRow[] = refreshed.map((ev) => {
      const su = ev.scheduledJob.serviceUser;
      const name =
        su.preferredName?.trim() ||
        [su.firstName, su.lastName].filter(Boolean).join(' ').trim() ||
        'Service user';

      const visitOperationalDay = formatScheduleDate(ev.localVisitDate);
      const buckets = this.classifyBuckets(
        ev,
        now,
        soonMs,
        dueWindowMs,
        visitOperationalDay === operationalToday,
      );
      const primaryVisit = ev.scheduledJob.visits?.[0];
      const slotFromPlan =
        primaryVisit?.visitPlanSlot?.medicationRoundCode ??
        primaryVisit?.visitPlanSlot?.slotCode ??
        null;
      const slotLabel =
        primaryVisit?.visitName?.trim() ||
        (slotFromPlan
          ? slotFromPlan
              .replace(/_/g, ' ')
              .toLowerCase()
              .replace(/\b\w/g, (c) => c.toUpperCase())
          : null) ||
        this.slotLabelFromJobName(ev.scheduledJob.jobName);

      const carers = ev.scheduledJob.allocations.map((a) => {
        const carerName = [
          a.employee.personalDetail?.firstName,
          a.employee.personalDetail?.lastName,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();
        return {
          employeeId: a.employee.id,
          name: carerName || a.employee.id,
          isLeadCarer: a.isLeadCarer,
        };
      });

      return {
        scheduledJobId: ev.scheduledJobId,
        scheduledVisitId: ev.scheduledVisitId,
        jobName: ev.scheduledJob.jobName,
        slotLabel,
        serviceUserId: ev.scheduledJob.serviceUserId,
        serviceUserName: name,
        carers,
        address: ev.scheduledJob.address ?? null,
        postcode: ev.scheduledJob.postcode ?? null,
        plannedStartDateTime: ev.plannedStartDateTime.toISOString(),
        plannedEndDateTime: ev.plannedEndDateTime?.toISOString() ?? null,
        actualCheckInAt: ev.actualCheckInAt?.toISOString() ?? null,
        actualCheckOutAt: ev.actualCheckOutAt?.toISOString() ?? null,
        plannedDurationMinutes: ev.plannedDurationMinutes ?? null,
        actualDurationMinutes: ev.actualDurationMinutes ?? null,
        lifecycleStatus: ev.lifecycleStatus,
        arrivalClassification: ev.arrivalClassification,
        departureClassification: ev.departureClassification,
        durationClassification: ev.durationClassification,
        missedClassification: ev.missedClassification,
        confidence: ev.confidence,
        criticality: ev.criticality,
        startVarianceMinutes: ev.startVarianceMinutes,
        endVarianceMinutes: ev.endVarianceMinutes,
        durationVarianceMinutes: ev.durationVarianceMinutes,
        appliedSettingsLevel: ev.appliedSettingsLevel,
        operationalExceptionCodes: ev.operationalExceptionCodes,
        buckets,
      };
    });

    const counts = {
      dueNow: 0,
      startingSoon: 0,
      inProgress: 0,
      earlyArrival: 0,
      lateArrival: 0,
      veryLateArrival: 0,
      potentialMissed: 0,
      confirmedMissed: 0,
      missingCheckout: 0,
      outsideGeofence: 0,
      manualAttendance: 0,
      completed: 0,
      completedOnTime: 0,
      completedLate: 0,
      total,
    };
    for (const row of summaryRows) {
      for (const b of row.buckets) {
        counts[b] += 1;
      }
    }

    const summary = this.buildSummary(summaryRows, now);

    return {
      data: {
        date,
        dateFrom,
        dateTo,
        operationalToday,
        operationalTimezone: DEFAULT_OPERATIONAL_TIMEZONE,
        refreshedAt: now.toISOString(),
        windows,
        counts,
        summary,
        total,
        nextCursor,
        visits: rows,
      },
    };
  }

  private parseLiveCursor(
    cursor: string | undefined,
  ): { plannedStart: Date; scheduledJobId: string } | null {
    if (!cursor?.trim()) return null;
    const sep = cursor.indexOf('|');
    if (sep <= 0) return null;
    const plannedStart = new Date(cursor.slice(0, sep));
    const scheduledJobId = cursor.slice(sep + 1).trim();
    if (Number.isNaN(plannedStart.getTime()) || !scheduledJobId) return null;
    return { plannedStart, scheduledJobId };
  }

  /**
   * Ensure every active scheduled job in [dateFrom, dateTo] (Europe/London day)
   * has an ECM evaluation row. Period filters must not silently omit days.
   */
  private async ensureEvaluationsForDateRange(params: {
    dateFrom: string;
    dateTo: string;
    now: Date;
    evaluateBudget: number;
    candidateLimit: number;
    scheduleAreaId?: string;
    serviceUserId?: string;
    locationId?: string;
  }): Promise<void> {
    const padStart = new Date(`${params.dateFrom}T00:00:00.000Z`);
    padStart.setUTCDate(padStart.getUTCDate() - 1);
    const padEnd = new Date(`${params.dateTo}T23:59:59.999Z`);
    padEnd.setUTCDate(padEnd.getUTCDate() + 1);

    const candidateJobs = await this.prisma.scheduledJob.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { notIn: SKIP_BACKFILL_JOB },
        scheduledStartDateTime: { gte: padStart, lte: padEnd },
        ...(params.scheduleAreaId ? { scheduleAreaId: params.scheduleAreaId } : {}),
        ...(params.serviceUserId ? { serviceUserId: params.serviceUserId } : {}),
        ...(params.locationId ? scheduledJobLocationScope(params.locationId) : {}),
      },
      take: params.candidateLimit,
      orderBy: { scheduledStartDateTime: 'asc' },
      select: {
        id: true,
        scheduledStartDateTime: true,
        visits: {
          where: { deletedAt: null, isActive: true },
          orderBy: { scheduledStartDateTime: 'asc' },
          take: 1,
          select: { scheduledStartDateTime: true },
        },
      },
    });

    const jobsInPeriod = candidateJobs.filter((job) => {
      const plannedStart =
        job.visits[0]?.scheduledStartDateTime ?? job.scheduledStartDateTime;
      const day = plannedOperationalDayKey(plannedStart);
      return day >= params.dateFrom && day <= params.dateTo;
    });
    if (jobsInPeriod.length === 0) return;

    const existing = await this.prisma.ecmVisitEvaluation.findMany({
      where: { scheduledJobId: { in: jobsInPeriod.map((j) => j.id) } },
      select: { scheduledJobId: true },
    });
    const haveEval = new Set(existing.map((e) => e.scheduledJobId));
    const missingIds = jobsInPeriod
      .filter((j) => !haveEval.has(j.id))
      .map((j) => j.id)
      .slice(0, params.evaluateBudget);

    await this.evaluateJobsInChunks(missingIds, params.now);
  }

  private async evaluateJobsInChunks(
    jobIds: string[],
    now: Date,
    chunkSize = 8,
  ): Promise<void> {
    const unique = [...new Set(jobIds)];
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((jobId) => this.evaluation.evaluateJobSafe(jobId, { now })),
      );
    }
  }

  async getVisitDetail(scheduledJobId: string, opts?: { refresh?: boolean }) {
    if (opts?.refresh !== false) {
      await this.evaluation.evaluateJobSafe(scheduledJobId);
    }

    const evaluation = await this.prisma.ecmVisitEvaluation.findUnique({
      where: { scheduledJobId },
    });

    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: scheduledJobId, deletedAt: null },
      include: {
        serviceUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
          },
        },
        visits: {
          where: { deletedAt: null, isActive: true },
          orderBy: { scheduledStartDateTime: 'asc' },
          take: 1,
          include: {
            visitPlanSlot: {
              select: {
                id: true,
                timeCritical: true,
                timeToleranceMinutes: true,
                slotKind: true,
              },
            },
          },
        },
        allocations: {
          where: { deletedAt: null, isActive: true, unallocatedAt: null },
          select: {
            id: true,
            employeeId: true,
            isLeadCarer: true,
            status: true,
            employee: {
              select: {
                id: true,
                personalDetail: {
                  select: { firstName: true, lastName: true },
                },
              },
            },
          },
        },
        attendanceEvents: {
          orderBy: { occurredAt: 'asc' },
          select: {
            id: true,
            eventType: true,
            verificationMethod: true,
            occurredAt: true,
            deviceCapturedAt: true,
            latitude: true,
            longitude: true,
            accuracyMeters: true,
            isMockLocation: true,
            outsideGeofence: true,
            outsideGeofenceReason: true,
            distanceMeters: true,
            identityConfirmed: true,
            employeeId: true,
            clientEventId: true,
            createdAt: true,
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`Scheduled job ${scheduledJobId} not found`);
    }

    if (!evaluation) {
      // Evaluate once more synchronously so detail always has ECM payload when possible.
      const result = await this.evaluation.evaluateJob(scheduledJobId);
      return this.shapeDetailWithHistory(job, result.evaluation, result.timing.timingSummary);
    }

    const timingSummary = [
      evaluation.arrivalClassification,
      evaluation.durationClassification,
      evaluation.departureClassification,
    ]
      .filter((c) => c !== 'NOT_ASSESSED' && c !== 'ON_TIME')
      .join('; ') || 'On time / not assessed';

    return this.shapeDetailWithHistory(job, evaluation, timingSummary);
  }

  private async shapeDetailWithHistory(
    job: Parameters<EcmVisitsService['shapeDetail']>[0],
    evaluation: Parameters<EcmVisitsService['shapeDetail']>[1],
    timingSummary: string,
  ) {
    const shaped = this.shapeDetail(job, evaluation, timingSummary);
    try {
      const history = await this.scheduleVersions.listForJob(job.id);
      return {
        ...shaped,
        data: {
          ...shaped.data,
          scheduleHistory: history.data,
        },
      };
    } catch {
      return shaped;
    }
  }

  private shapeDetail(
    job: {
      id: string;
      jobName: string;
      status: ScheduledJobStatus;
      serviceUserId: string;
      scheduledStartDateTime: Date;
      scheduledEndDateTime: Date | null;
      requiredCarers: number;
      address: string | null;
      postcode: string | null;
      serviceUser: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        preferredName: string | null;
      };
      visits: Array<{
        id: string;
        status: string;
        actualStartDateTime: Date | null;
        actualEndDateTime: Date | null;
        visitPlanSlot: {
          id: string;
          timeCritical: boolean;
          timeToleranceMinutes: number;
          slotKind: string;
        } | null;
      }>;
      allocations: Array<{
        id: string;
        employeeId: string;
        isLeadCarer: boolean;
        status: string;
        employee: {
          id: string;
          personalDetail: { firstName: string | null; lastName: string | null } | null;
        };
      }>;
      attendanceEvents: Array<{
        id: string;
        eventType: VisitAttendanceEventType;
        verificationMethod: string;
        occurredAt: Date;
        deviceCapturedAt: Date | null;
        latitude: unknown;
        longitude: unknown;
        accuracyMeters: unknown;
        isMockLocation: boolean;
        outsideGeofence: boolean;
        outsideGeofenceReason: string | null;
        distanceMeters: number | null;
        identityConfirmed: boolean;
        employeeId: string;
        clientEventId: string | null;
        createdAt: Date;
      }>;
    },
    evaluation: {
      id: string;
      plannedStartDateTime: Date;
      plannedEndDateTime: Date | null;
      plannedDurationMinutes: number | null;
      earliestPermittedStart: Date | null;
      latestPermittedStart: Date | null;
      actualCheckInAt: Date | null;
      actualCheckOutAt: Date | null;
      actualDurationMinutes: number | null;
      startVarianceMinutes: number | null;
      endVarianceMinutes: number | null;
      durationVarianceMinutes: number | null;
      arrivalClassification: string;
      departureClassification: string;
      durationClassification: string;
      lifecycleStatus: string;
      missedClassification: string;
      confidence: string;
      criticality: string;
      operationalExceptionCodes: string[];
      appliedSettingsLevel: string;
      lateArrivalToleranceMinutes: number;
      veryLateThresholdMinutes: number;
      shortVisitToleranceMinutes: number;
      longVisitToleranceMinutes: number;
      excessiveOverrunMinutes: number;
      missedVisitThresholdMinutes: number;
      geofenceRadiusMeters: number | null;
      thresholdRuleVersion: string | null;
      localVisitDate: Date;
      timezone: string;
      evaluatedAt: Date;
      requiredCarers: number;
    },
    timingSummary: string,
  ) {
    const su = job.serviceUser;
    const serviceUserName =
      su.preferredName?.trim() ||
      [su.firstName, su.lastName].filter(Boolean).join(' ').trim() ||
      'Service user';

    return {
      data: {
        scheduledJobId: job.id,
        jobName: job.jobName,
        jobStatus: job.status,
        serviceUser: {
          id: job.serviceUserId,
          name: serviceUserName,
        },
        location: {
          address: job.address,
          postcode: job.postcode,
        },
        allocatedCarers: job.allocations.map((a) => ({
          allocationId: a.id,
          employeeId: a.employeeId,
          isLeadCarer: a.isLeadCarer,
          status: a.status,
          name: [a.employee.personalDetail?.firstName, a.employee.personalDetail?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim(),
        })),
        visit: job.visits[0]
          ? {
              id: job.visits[0].id,
              status: job.visits[0].status,
              actualStartDateTime: job.visits[0].actualStartDateTime?.toISOString() ?? null,
              actualEndDateTime: job.visits[0].actualEndDateTime?.toISOString() ?? null,
              visitPlanSlot: job.visits[0].visitPlanSlot,
            }
          : null,
        ecm: {
          evaluationId: evaluation.id,
          lifecycleStatus: evaluation.lifecycleStatus,
          criticality: evaluation.criticality,
          confidence: evaluation.confidence,
          missedClassification: evaluation.missedClassification,
          operationalExceptionCodes: evaluation.operationalExceptionCodes,
          planned: {
            start: evaluation.plannedStartDateTime.toISOString(),
            end: evaluation.plannedEndDateTime?.toISOString() ?? null,
            durationMinutes: evaluation.plannedDurationMinutes,
            earliestPermittedStart: evaluation.earliestPermittedStart?.toISOString() ?? null,
            latestPermittedStart: evaluation.latestPermittedStart?.toISOString() ?? null,
            localVisitDate: evaluation.localVisitDate.toISOString().slice(0, 10),
            timezone: evaluation.timezone,
            requiredCarers: evaluation.requiredCarers,
          },
          actual: {
            checkInAt: evaluation.actualCheckInAt?.toISOString() ?? null,
            checkOutAt: evaluation.actualCheckOutAt?.toISOString() ?? null,
            durationMinutes: evaluation.actualDurationMinutes,
          },
          timing: {
            startVarianceMinutes: evaluation.startVarianceMinutes,
            endVarianceMinutes: evaluation.endVarianceMinutes,
            durationVarianceMinutes: evaluation.durationVarianceMinutes,
            arrivalClassification: evaluation.arrivalClassification,
            departureClassification: evaluation.departureClassification,
            durationClassification: evaluation.durationClassification,
            summary: timingSummary,
          },
          appliedSettings: {
            level: evaluation.appliedSettingsLevel,
            thresholdRuleVersion: evaluation.thresholdRuleVersion,
            lateArrivalToleranceMinutes: evaluation.lateArrivalToleranceMinutes,
            veryLateThresholdMinutes: evaluation.veryLateThresholdMinutes,
            shortVisitToleranceMinutes: evaluation.shortVisitToleranceMinutes,
            longVisitToleranceMinutes: evaluation.longVisitToleranceMinutes,
            excessiveOverrunMinutes: evaluation.excessiveOverrunMinutes,
            missedVisitThresholdMinutes: evaluation.missedVisitThresholdMinutes,
            geofenceRadiusMeters: evaluation.geofenceRadiusMeters,
          },
          evaluatedAt: evaluation.evaluatedAt.toISOString(),
        },
        attendanceEvents: job.attendanceEvents.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          verificationMethod: e.verificationMethod,
          occurredAt: e.occurredAt.toISOString(),
          deviceCapturedAt: e.deviceCapturedAt?.toISOString() ?? null,
          latitude: e.latitude != null ? Number(e.latitude) : null,
          longitude: e.longitude != null ? Number(e.longitude) : null,
          accuracyMeters: e.accuracyMeters != null ? Number(e.accuracyMeters) : null,
          isMockLocation: e.isMockLocation,
          outsideGeofence: e.outsideGeofence,
          outsideGeofenceReason: e.outsideGeofenceReason,
          distanceMeters: e.distanceMeters,
          identityConfirmed: e.identityConfirmed,
          employeeId: e.employeeId,
          clientEventId: e.clientEventId,
          createdAt: e.createdAt.toISOString(),
        })),
      },
    };
  }

  /** Prefer left side of "Morning — Name" job titles when visit-plan slot is missing. */
  private slotLabelFromJobName(jobName: string | null | undefined): string | null {
    const raw = (jobName ?? '').trim();
    if (!raw) return null;
    const sep = ' — ';
    const idx = raw.indexOf(sep);
    if (idx > 0) {
      const left = raw.slice(0, idx).trim();
      if (left) return left;
    }
    return null;
  }

  private isCompletedEvaluation(ev: {
    actualCheckOutAt: Date | null;
    lifecycleStatus: EcmLifecycleStatus;
  }): boolean {
    return Boolean(ev.actualCheckOutAt) || COMPLETED_LIFECYCLES.has(ev.lifecycleStatus);
  }

  /**
   * Completion punctuality from arrival classification (same basis as daily-ops punctuality).
   * Early counts as on time; late / very late as not on time; NOT_ASSESSED is neither.
   */
  private completionPunctuality(
    arrival: EcmArrivalClassification,
  ): 'onTime' | 'late' | null {
    if (
      arrival === EcmArrivalClassification.ON_TIME ||
      arrival === EcmArrivalClassification.EARLY_ARRIVAL
    ) {
      return 'onTime';
    }
    if (
      arrival === EcmArrivalClassification.LATE_ARRIVAL ||
      arrival === EcmArrivalClassification.VERY_LATE_ARRIVAL
    ) {
      return 'late';
    }
    return null;
  }

  private buildSummary(
    rows: EcmLiveVisitRow[],
    now: Date,
  ): EcmLiveDashboardSummary {
    let completed = 0;
    let completedOnTime = 0;
    let completedLate = 0;
    let outstanding = 0;
    let inProgress = 0;
    let potentialMissed = 0;
    let confirmedMissed = 0;
    let missingCheckout = 0;
    let missingCheckIn = 0;

    for (const row of rows) {
      const hasIn = Boolean(row.actualCheckInAt);
      const isCompleted = row.buckets.includes('completed');
      const isConfirmedMissed = row.buckets.includes('confirmedMissed');

      if (isCompleted) {
        completed += 1;
        if (row.buckets.includes('completedOnTime')) completedOnTime += 1;
        if (row.buckets.includes('completedLate')) completedLate += 1;
      } else if (!isConfirmedMissed) {
        outstanding += 1;
      }

      if (row.buckets.includes('inProgress')) inProgress += 1;
      if (row.buckets.includes('potentialMissed')) potentialMissed += 1;
      if (isConfirmedMissed) confirmedMissed += 1;
      if (row.buckets.includes('missingCheckout')) missingCheckout += 1;

      const startMs = new Date(row.plannedStartDateTime).getTime();
      if (
        !isCompleted &&
        !isConfirmedMissed &&
        !hasIn &&
        Number.isFinite(startMs) &&
        startMs < now.getTime()
      ) {
        missingCheckIn += 1;
      }
    }

    const assessed = completedOnTime + completedLate;
    return {
      total: rows.length,
      completed,
      completedOnTime,
      completedLate,
      completedOnTimePct:
        assessed > 0 ? Math.round((completedOnTime / assessed) * 1000) / 10 : null,
      outstanding,
      inProgress,
      potentialMissed,
      confirmedMissed,
      missingCheckout,
      missingCheckIn,
    };
  }

  private classifyBuckets(
    ev: {
      plannedStartDateTime: Date;
      plannedEndDateTime: Date | null;
      actualCheckInAt: Date | null;
      actualCheckOutAt: Date | null;
      arrivalClassification: EcmArrivalClassification;
      lifecycleStatus: EcmLifecycleStatus;
      missedClassification: EcmMissedClassification;
      operationalExceptionCodes: string[];
    },
    now: Date,
    soonMs: number,
    dueWindowMs: number,
    /** Due now / starting soon only for visits whose operational day is today. */
    includeUrgencyTiles = true,
  ): DashboardBucket[] {
    const buckets: DashboardBucket[] = [];
    const start = ev.plannedStartDateTime.getTime();
    const hasIn = Boolean(ev.actualCheckInAt);
    const hasOut = Boolean(ev.actualCheckOutAt);
    const completed = this.isCompletedEvaluation(ev);

    if (completed) {
      buckets.push('completed');
      const punctuality = this.completionPunctuality(ev.arrivalClassification);
      if (punctuality === 'onTime') buckets.push('completedOnTime');
      if (punctuality === 'late') buckets.push('completedLate');
      // Finished visits stay out of live ops tiles (due/soon/in-progress/active late).
      // Missed / geofence / manual still surface for completed-with-exception review.
    } else {
      if (
        includeUrgencyTiles &&
        !hasIn &&
        start <= now.getTime() + dueWindowMs &&
        start >= now.getTime() - dueWindowMs &&
        ev.missedClassification === EcmMissedClassification.NONE
      ) {
        buckets.push('dueNow');
      }
      if (
        includeUrgencyTiles &&
        !hasIn &&
        start > now.getTime() &&
        start <= now.getTime() + soonMs
      ) {
        buckets.push('startingSoon');
      }
      if (
        ev.lifecycleStatus === EcmLifecycleStatus.IN_PROGRESS ||
        ev.lifecycleStatus === EcmLifecycleStatus.CHECKED_IN ||
        (hasIn && !hasOut)
      ) {
        buckets.push('inProgress');
      }
      // Open early check-in (beyond earlyArrivalTolerance) — parity with late open tiles.
      if (ev.arrivalClassification === EcmArrivalClassification.EARLY_ARRIVAL) {
        buckets.push('earlyArrival');
      }
      if (ev.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL) {
        buckets.push('lateArrival');
      }
      if (ev.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL) {
        buckets.push('veryLateArrival');
      }
      if (
        hasIn &&
        !hasOut &&
        ev.plannedEndDateTime &&
        ev.plannedEndDateTime.getTime() < now.getTime()
      ) {
        buckets.push('missingCheckout');
      }
    }

    if (ev.missedClassification === EcmMissedClassification.POTENTIAL_MISSED) {
      buckets.push('potentialMissed');
    }
    if (ev.missedClassification === EcmMissedClassification.CONFIRMED_MISSED) {
      buckets.push('confirmedMissed');
    }
    if (ev.operationalExceptionCodes.includes('OUTSIDE_GEOFENCE')) {
      buckets.push('outsideGeofence');
    }
    if (ev.operationalExceptionCodes.includes('MANUAL_ATTENDANCE')) {
      buckets.push('manualAttendance');
    }
    return buckets;
  }
}
