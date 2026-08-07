import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EcmMissedClassification,
  Prisma,
  ScheduledJobStatus,
  VisitAttendanceEventType,
  VisitAttendanceVerificationMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_OPERATIONAL_TIMEZONE } from '../common/utils/operational-day.util';
import {
  deriveArrivalWindow,
  evaluateEcmTiming,
  localVisitDateFromStart,
  mapConfidence,
  mapToEcmLifecycle,
  orgSettingsToEcmLayer,
  resolveEcmSettings,
  toPrismaArrival,
  toPrismaCriticality,
  toPrismaDeparture,
  toPrismaDuration,
  toPrismaMissed,
  toPrismaSettingsLevel,
  type EcmSettingsLayer,
} from './ecm-evaluation.mapper';
import { EcmExceptionsService } from './ecm-exceptions.service';
import { EcmScheduleVersionService } from './ecm-schedule-version.service';
import { EcmThresholdLookupsService } from './ecm-threshold-lookups.service';

export type EvaluateJobOptions = {
  visitOverride?: EcmSettingsLayer | null;
  serviceUserOverride?: EcmSettingsLayer | null;
  contractOverride?: EcmSettingsLayer | null;
  branchOverride?: EcmSettingsLayer | null;
  confirmedMissed?: boolean;
  attendanceClaimedWithoutEvidence?: boolean;
  falseEcmAlert?: boolean;
  disputed?: boolean;
  now?: Date;
};

@Injectable()
export class EcmEvaluationService {
  private readonly logger = new Logger(EcmEvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exceptions: EcmExceptionsService,
    private readonly scheduleVersions: EcmScheduleVersionService,
    private readonly thresholdLookups: EcmThresholdLookupsService,
  ) {}

  /**
   * Idempotent upsert of ECM evaluation for a scheduled job.
   * Safe to call after check-in, check-out, cron, or cancellation.
   * Does not mutate ScheduledJobStatus — ECM lifecycle is parallel.
   */
  async evaluateJob(scheduledJobId: string, options: EvaluateJobOptions = {}) {
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: scheduledJobId, deletedAt: null },
      include: {
        visits: {
          where: { deletedAt: null, isActive: true },
          orderBy: { scheduledStartDateTime: 'asc' },
          take: 1,
          include: {
            visitPlanSlot: {
              select: {
                timeCritical: true,
                timeToleranceMinutes: true,
              },
            },
          },
        },
        allocations: {
          where: { deletedAt: null, isActive: true, unallocatedAt: null },
          select: {
            id: true,
            actualStartDateTime: true,
            actualEndDateTime: true,
          },
        },
        attendanceEvents: {
          orderBy: { occurredAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`Scheduled job ${scheduledJobId} not found`);
    }

    const visit = job.visits[0] ?? null;
    const plannedStart = visit?.scheduledStartDateTime ?? job.scheduledStartDateTime;
    const plannedEnd =
      visit?.scheduledEndDateTime ?? job.scheduledEndDateTime ?? null;

    try {
      await this.scheduleVersions.ensureOriginal({
        scheduledJobId: job.id,
        plannedStartDateTime: plannedStart,
        plannedEndDateTime: plannedEnd,
      });
    } catch (err) {
      this.logger.warn(`ECM schedule original capture failed for ${job.id}: ${String(err)}`);
    }

    const checkInEvent = [...job.attendanceEvents]
      .reverse()
      .find((e) => e.eventType === VisitAttendanceEventType.CHECK_IN);
    const checkOutEvent = [...job.attendanceEvents]
      .reverse()
      .find((e) => e.eventType === VisitAttendanceEventType.CHECK_OUT);

    const allocationStarts = job.allocations
      .map((a) => a.actualStartDateTime)
      .filter((d): d is Date => d != null);
    const allocationEnds = job.allocations
      .map((a) => a.actualEndDateTime)
      .filter((d): d is Date => d != null);
    const earliestAllocationStart =
      allocationStarts.length > 0
        ? new Date(Math.min(...allocationStarts.map((d) => d.getTime())))
        : null;
    const latestAllocationEnd =
      allocationEnds.length > 0
        ? new Date(Math.max(...allocationEnds.map((d) => d.getTime())))
        : null;

    // Prefer attendance events, then visit office actuals, then carer allocation actuals
    // (completeJob may write carerActuals even when a visit row is missing).
    const actualStart =
      checkInEvent?.occurredAt ??
      visit?.actualStartDateTime ??
      earliestAllocationStart ??
      null;
    const visitStatus = String(visit?.status ?? '').toUpperCase();
    const completedOutcome =
      job.status === ScheduledJobStatus.COMPLETED ||
      visitStatus === 'COMPLETED' ||
      visitStatus === 'PARTIALLY_COMPLETED';
    // Checkout actuals only for completed outcomes (or a real mobile CHECK_OUT event).
    // Draft/planned ends left on STARTED/IN_PROGRESS must not drive ECM classifications.
    const actualEnd =
      checkOutEvent?.occurredAt ??
      (completedOutcome
        ? (visit?.actualEndDateTime ?? latestAllocationEnd ?? null)
        : null);

    const platform = await this.thresholdLookups.toPlatformLayer();
    const org = await this.prisma.organisationGeneralSettings.findFirst({
      select: {
        domLateVisitAlertMinutes: true,
        domGlobalToleranceMinutes: true,
        domGeofenceDistanceMeters: true,
        domGeofenceToleranceMeters: true,
      },
    });

    const slot = visit?.visitPlanSlot;
    const resolved = resolveEcmSettings({
      platform,
      organisation: orgSettingsToEcmLayer(org),
      branch: options.branchOverride,
      contract: options.contractOverride,
      serviceUser: options.serviceUserOverride,
      visit: options.visitOverride,
      slotTimeCritical: slot?.timeCritical,
      slotTimeToleranceMinutes: slot?.timeToleranceMinutes,
    });

    const window = deriveArrivalWindow(
      plannedStart,
      resolved.earlyArrivalToleranceMinutes,
      resolved.lateArrivalToleranceMinutes,
    );

    const timing = evaluateEcmTiming({
      plannedStart,
      plannedEnd,
      actualStart,
      actualEnd,
      earliestPermittedStart: window.earliest,
      latestPermittedStart: window.latest,
      thresholds: resolved,
      now: options.now,
      confirmedMissed:
        options.confirmedMissed ?? job.status === ScheduledJobStatus.MISSED,
      attendanceClaimedWithoutEvidence: options.attendanceClaimedWithoutEvidence,
      falseEcmAlert: options.falseEcmAlert,
      disputed: options.disputed,
    });

    const operationalExceptionCodes: string[] = [];
    if (checkInEvent?.outsideGeofence) {
      operationalExceptionCodes.push('OUTSIDE_GEOFENCE');
    }
    if (checkInEvent?.isMockLocation) {
      operationalExceptionCodes.push('MOCK_LOCATION');
    }
    if (
      checkInEvent?.verificationMethod === VisitAttendanceVerificationMethod.MANUAL_OFFICE
    ) {
      operationalExceptionCodes.push('MANUAL_ATTENDANCE');
    }

    const hasTimingException =
      timing.arrivalClassification === 'LATE_ARRIVAL' ||
      timing.arrivalClassification === 'VERY_LATE_ARRIVAL' ||
      timing.arrivalClassification === 'EARLY_ARRIVAL' ||
      timing.departureClassification === 'EARLY_DEPARTURE' ||
      timing.departureClassification === 'LATE_DEPARTURE' ||
      timing.durationClassification === 'SHORT_VISIT' ||
      timing.durationClassification === 'LONG_VISIT' ||
      timing.durationClassification === 'EXCESSIVE_OVERRUN' ||
      timing.missedClassification !== 'NONE';

    const latestAttendance = job.attendanceEvents[0]?.eventType ?? null;
    const lifecycleStatus = mapToEcmLifecycle({
      jobStatus: job.status,
      visitStatus: visit?.status,
      allocatedCarers: job.allocations.length,
      hasCheckIn: Boolean(actualStart),
      hasCheckOut: Boolean(actualEnd),
      latestAttendanceEventType: latestAttendance,
      hasTimingOrOperationalException:
        hasTimingException || operationalExceptionCodes.length > 0,
    });

    const confidence = mapConfidence({
      verificationMethod: checkInEvent?.verificationMethod,
      outsideGeofence: checkInEvent?.outsideGeofence,
      isMockLocation: checkInEvent?.isMockLocation,
      manual:
        checkInEvent?.verificationMethod ===
        VisitAttendanceVerificationMethod.MANUAL_OFFICE,
      hasCheckIn: Boolean(actualStart),
      hasCheckOut: Boolean(actualEnd),
      accuracyMeters:
        checkInEvent?.accuracyMeters != null
          ? Number(checkInEvent.accuracyMeters)
          : null,
      identityConfirmed: checkInEvent?.identityConfirmed,
      disputed: options.disputed,
    });
    if (
      checkInEvent?.accuracyMeters != null &&
      Number(checkInEvent.accuracyMeters) > 100 &&
      !operationalExceptionCodes.includes('LOW_GPS_ACCURACY')
    ) {
      operationalExceptionCodes.push('LOW_GPS_ACCURACY');
    }

    const timezone = DEFAULT_OPERATIONAL_TIMEZONE;
    const data: Prisma.EcmVisitEvaluationUncheckedCreateInput = {
      scheduledJobId: job.id,
      scheduledVisitId: visit?.id ?? null,
      plannedStartDateTime: plannedStart,
      plannedEndDateTime: plannedEnd,
      plannedDurationMinutes: timing.plannedDurationMinutes,
      earliestPermittedStart: window.earliest,
      latestPermittedStart: window.latest,
      minPermittedDurationMinutes: null,
      maxPermittedDurationMinutes: null,
      criticality: toPrismaCriticality(resolved.criticality),
      requiredCarers: visit?.requiredCarers ?? job.requiredCarers,
      localVisitDate: localVisitDateFromStart(plannedStart, timezone),
      timezone,
      actualCheckInAt: actualStart,
      actualCheckOutAt: actualEnd,
      actualDurationMinutes: timing.actualDurationMinutes,
      startVarianceMinutes: timing.startVarianceMinutes,
      endVarianceMinutes: timing.endVarianceMinutes,
      durationVarianceMinutes: timing.durationVarianceMinutes,
      arrivalClassification: toPrismaArrival(timing.arrivalClassification),
      departureClassification: toPrismaDeparture(timing.departureClassification),
      durationClassification: toPrismaDuration(timing.durationClassification),
      lifecycleStatus,
      missedClassification: toPrismaMissed(timing.missedClassification),
      operationalExceptionCodes,
      confidence,
      appliedSettingsLevel: toPrismaSettingsLevel(resolved.appliedSettingsLevel),
      lateArrivalToleranceMinutes: resolved.lateArrivalToleranceMinutes,
      veryLateThresholdMinutes: resolved.veryLateThresholdMinutes,
      shortVisitToleranceMinutes: resolved.shortVisitToleranceMinutes,
      longVisitToleranceMinutes: resolved.longVisitToleranceMinutes,
      excessiveOverrunMinutes: resolved.excessiveOverrunMinutes,
      missedVisitThresholdMinutes: resolved.missedVisitThresholdMinutes,
      geofenceRadiusMeters: resolved.geofenceRadiusMeters,
      thresholdRuleVersion: resolved.thresholdRuleVersion,
      evaluatedAt: options.now ?? new Date(),
    };

    const { scheduledJobId: _jobId, createdAt: _created, ...updateData } = data;

    const evaluation = await this.prisma.ecmVisitEvaluation.upsert({
      where: { scheduledJobId: job.id },
      create: data,
      update: updateData,
    });

    this.logger.debug(
      `ECM evaluated job=${job.id} lifecycle=${lifecycleStatus} arrival=${timing.arrivalClassification} level=${resolved.appliedSettingsLevel}`,
    );

    try {
      await this.exceptions.syncFromEvaluation(evaluation.id);
    } catch (err) {
      this.logger.warn(`ECM exception sync failed for ${job.id}: ${String(err)}`);
    }

    return { evaluation, timing, resolved };
  }

  /**
   * Fire-and-forget safe evaluate — never fails the caller (check-in/out).
   */
  async evaluateJobSafe(scheduledJobId: string, options: EvaluateJobOptions = {}) {
    try {
      return await this.evaluateJob(scheduledJobId, options);
    } catch (err) {
      this.logger.warn(
        `ECM evaluateJobSafe failed for ${scheduledJobId}: ${String(err)}`,
      );
      return null;
    }
  }

  async getEvaluation(scheduledJobId: string) {
    return this.prisma.ecmVisitEvaluation.findUnique({
      where: { scheduledJobId },
    });
  }

  /**
   * Mark potential missed → confirmed / false alert / disputed (GAP4).
   */
  async setMissedTriage(
    scheduledJobId: string,
    classification: EcmMissedClassification,
  ) {
    await this.evaluateJob(scheduledJobId, {
      confirmedMissed: classification === EcmMissedClassification.CONFIRMED_MISSED,
      falseEcmAlert: classification === EcmMissedClassification.FALSE_ECM_ALERT,
      disputed: classification === EcmMissedClassification.DISPUTED,
      attendanceClaimedWithoutEvidence:
        classification === EcmMissedClassification.ATTENDANCE_VERIFICATION_PENDING,
    });
    return this.getEvaluation(scheduledJobId);
  }
}
