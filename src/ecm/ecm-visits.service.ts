import { Injectable, NotFoundException } from '@nestjs/common';
import {
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
import type { EcmLiveDashboardQueryDto } from './dto/ecm-live-dashboard.dto';

const CLOSED_JOB: ScheduledJobStatus[] = [
  ScheduledJobStatus.COMPLETED,
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
  ScheduledJobStatus.MISSED,
  ScheduledJobStatus.DRAFT,
];

type DashboardBucket =
  | 'dueNow'
  | 'startingSoon'
  | 'inProgress'
  | 'lateArrival'
  | 'veryLateArrival'
  | 'potentialMissed'
  | 'confirmedMissed'
  | 'missingCheckout'
  | 'outsideGeofence'
  | 'manualAttendance';

export type EcmLiveVisitRow = {
  scheduledJobId: string;
  scheduledVisitId: string | null;
  jobName: string;
  serviceUserId: string;
  serviceUserName: string;
  plannedStartDateTime: string;
  plannedEndDateTime: string | null;
  actualCheckInAt: string | null;
  actualCheckOutAt: string | null;
  lifecycleStatus: string;
  arrivalClassification: string;
  durationClassification: string;
  missedClassification: string;
  confidence: string;
  criticality: string;
  startVarianceMinutes: number | null;
  durationVarianceMinutes: number | null;
  appliedSettingsLevel: string;
  operationalExceptionCodes: string[];
  buckets: DashboardBucket[];
};

@Injectable()
export class EcmVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluation: EcmEvaluationService,
    private readonly scheduleVersions: EcmScheduleVersionService,
  ) {}

  async getLiveDashboard(query: EcmLiveDashboardQueryDto) {
    const date = query.date ?? formatScheduleDate(new Date());
    const localDate = new Date(`${date}T00:00:00.000Z`);
    const limit = query.limit ?? 100;
    const now = new Date();
    const soonMs = 30 * 60_000;
    const dueWindowMs = 15 * 60_000;

    const where: Prisma.EcmVisitEvaluationWhereInput = {
      localVisitDate: localDate,
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
        ...(query.search?.trim()
          ? {
              OR: [
                { jobName: { contains: query.search.trim(), mode: 'insensitive' } },
                {
                  serviceUser: {
                    OR: [
                      { preferredName: { contains: query.search.trim(), mode: 'insensitive' } },
                      { firstName: { contains: query.search.trim(), mode: 'insensitive' } },
                      { lastName: { contains: query.search.trim(), mode: 'insensitive' } },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
    };

    const evaluations = await this.prisma.ecmVisitEvaluation.findMany({
      where,
      take: limit,
      orderBy: { plannedStartDateTime: 'asc' },
      include: {
        scheduledJob: {
          select: {
            id: true,
            jobName: true,
            serviceUserId: true,
            status: true,
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
          },
        },
      },
    });

    // Backfill: due jobs today without an evaluation yet (so dashboard is not empty on day 1).
    const evaluatedJobIds = new Set(evaluations.map((e) => e.scheduledJobId));
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    const missingJobs = await this.prisma.scheduledJob.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { notIn: CLOSED_JOB },
        scheduledStartDateTime: { gte: dayStart, lte: dayEnd },
        id: { notIn: [...evaluatedJobIds] },
        ...(query.scheduleAreaId ? { scheduleAreaId: query.scheduleAreaId } : {}),
        ...(query.serviceUserId ? { serviceUserId: query.serviceUserId } : {}),
      },
      take: Math.min(40, Math.max(0, limit - evaluations.length)),
      select: { id: true },
    });

    for (const job of missingJobs) {
      await this.evaluation.evaluateJobSafe(job.id, { now });
    }

    const refreshed =
      missingJobs.length > 0
        ? await this.prisma.ecmVisitEvaluation.findMany({
            where,
            take: limit,
            orderBy: { plannedStartDateTime: 'asc' },
            include: {
              scheduledJob: {
                select: {
                  id: true,
                  jobName: true,
                  serviceUserId: true,
                  status: true,
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
                },
              },
            },
          })
        : evaluations;

    const rows: EcmLiveVisitRow[] = refreshed.map((ev) => {
      const su = ev.scheduledJob.serviceUser;
      const name =
        su.preferredName?.trim() ||
        [su.firstName, su.lastName].filter(Boolean).join(' ').trim() ||
        'Service user';

      const buckets = this.classifyBuckets(ev, now, soonMs, dueWindowMs);

      return {
        scheduledJobId: ev.scheduledJobId,
        scheduledVisitId: ev.scheduledVisitId,
        jobName: ev.scheduledJob.jobName,
        serviceUserId: ev.scheduledJob.serviceUserId,
        serviceUserName: name,
        plannedStartDateTime: ev.plannedStartDateTime.toISOString(),
        plannedEndDateTime: ev.plannedEndDateTime?.toISOString() ?? null,
        actualCheckInAt: ev.actualCheckInAt?.toISOString() ?? null,
        actualCheckOutAt: ev.actualCheckOutAt?.toISOString() ?? null,
        lifecycleStatus: ev.lifecycleStatus,
        arrivalClassification: ev.arrivalClassification,
        durationClassification: ev.durationClassification,
        missedClassification: ev.missedClassification,
        confidence: ev.confidence,
        criticality: ev.criticality,
        startVarianceMinutes: ev.startVarianceMinutes,
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
      lateArrival: 0,
      veryLateArrival: 0,
      potentialMissed: 0,
      confirmedMissed: 0,
      missingCheckout: 0,
      outsideGeofence: 0,
      manualAttendance: 0,
      total: rows.length,
    };
    for (const row of rows) {
      for (const b of row.buckets) {
        counts[b] += 1;
      }
    }

    return {
      data: {
        date,
        refreshedAt: now.toISOString(),
        counts,
        visits: rows,
      },
    };
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
  ): DashboardBucket[] {
    const buckets: DashboardBucket[] = [];
    const start = ev.plannedStartDateTime.getTime();
    const hasIn = Boolean(ev.actualCheckInAt);
    const hasOut = Boolean(ev.actualCheckOutAt);

    if (
      !hasIn &&
      start <= now.getTime() + dueWindowMs &&
      start >= now.getTime() - dueWindowMs &&
      ev.missedClassification === EcmMissedClassification.NONE
    ) {
      buckets.push('dueNow');
    }
    if (!hasIn && start > now.getTime() && start <= now.getTime() + soonMs) {
      buckets.push('startingSoon');
    }
    if (
      ev.lifecycleStatus === EcmLifecycleStatus.IN_PROGRESS ||
      ev.lifecycleStatus === EcmLifecycleStatus.CHECKED_IN ||
      (hasIn && !hasOut)
    ) {
      buckets.push('inProgress');
    }
    if (ev.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL) {
      buckets.push('lateArrival');
    }
    if (ev.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL) {
      buckets.push('veryLateArrival');
    }
    if (ev.missedClassification === EcmMissedClassification.POTENTIAL_MISSED) {
      buckets.push('potentialMissed');
    }
    if (ev.missedClassification === EcmMissedClassification.CONFIRMED_MISSED) {
      buckets.push('confirmedMissed');
    }
    if (hasIn && !hasOut && ev.plannedEndDateTime && ev.plannedEndDateTime.getTime() < now.getTime()) {
      buckets.push('missingCheckout');
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
