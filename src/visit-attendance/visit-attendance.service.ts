import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  Prisma,
  VisitAttendanceEventType,
  VisitAttendanceVerificationMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VisitTimelineService } from '../employee-app/visit-timeline.service';
import { officeClockTimelineEntry } from './office-clock-timeline.util';

export type RecordAttendanceEventInput = {
  scheduledJobId: string;
  scheduledVisitId?: string | null;
  jobAllocationId?: string | null;
  employeeId: string;
  eventType: VisitAttendanceEventType;
  verificationMethod?: VisitAttendanceVerificationMethod;
  occurredAt?: Date;
  deviceCapturedAt?: Date | null;
  clientEventId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  isMockLocation?: boolean;
  outsideGeofence?: boolean;
  outsideGeofenceReason?: string | null;
  distanceMeters?: number | null;
  identityConfirmed?: boolean;
  notes?: string | null;
  /** Office user who entered the time (MANUAL_OFFICE); shown as Office + name in the visit Log. */
  recordedByUserId?: string | null;
};

@Injectable()
export class VisitAttendanceService {
  private readonly logger = new Logger(VisitAttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly visitTimeline?: VisitTimelineService,
  ) {}

  /**
   * Clock times the office records (completing a visit, or a manual attendance entry) go to the visit Log
   * too, so the Log shows when the carer arrived and left however the time was captured. The carer app
   * writes its own Log rows for its clock-ins; office rows use their own key so neither replaces the other.
   */
  private async logOfficeClockTime(event: {
    scheduledJobId: string;
    scheduledVisitId: string | null;
    employeeId: string;
    eventType: VisitAttendanceEventType;
    verificationMethod: VisitAttendanceVerificationMethod;
    occurredAt: Date;
    notes: string | null;
  }, recordedByUserId?: string | null): Promise<void> {
    if (!this.visitTimeline) return;
    const entry = officeClockTimelineEntry(event);
    if (!entry) return;
    await this.visitTimeline.upsertEvent({
      scheduledJobId: event.scheduledJobId,
      scheduledVisitId: event.scheduledVisitId,
      ...entry,
      occurredAt: event.occurredAt,
      createdByEmployeeId: event.employeeId,
      actorKind: 'office',
      createdByUserId: recordedByUserId ?? null,
    });
  }

  async recordEvent(input: RecordAttendanceEventInput) {
    const clientEventId = input.clientEventId?.trim() || null;
    if (clientEventId) {
      const existing = await this.prisma.visitAttendanceEvent.findFirst({
        where: {
          scheduledJobId: input.scheduledJobId,
          employeeId: input.employeeId,
          eventType: input.eventType,
          clientEventId,
        },
      });
      if (existing) return existing;
    }

    try {
      const created = await this.prisma.visitAttendanceEvent.create({
        data: {
          scheduledJobId: input.scheduledJobId,
          scheduledVisitId: input.scheduledVisitId ?? null,
          jobAllocationId: input.jobAllocationId ?? null,
          employeeId: input.employeeId,
          eventType: input.eventType,
          verificationMethod:
            input.verificationMethod ?? VisitAttendanceVerificationMethod.MOBILE_GPS,
          occurredAt: input.occurredAt ?? new Date(),
          deviceCapturedAt: input.deviceCapturedAt ?? null,
          clientEventId,
          latitude:
            input.latitude != null ? new Prisma.Decimal(input.latitude) : null,
          longitude:
            input.longitude != null ? new Prisma.Decimal(input.longitude) : null,
          accuracyMeters:
            input.accuracyMeters != null
              ? new Prisma.Decimal(input.accuracyMeters)
              : null,
          isMockLocation: input.isMockLocation ?? false,
          outsideGeofence: input.outsideGeofence ?? false,
          outsideGeofenceReason: input.outsideGeofenceReason?.trim() || null,
          distanceMeters: input.distanceMeters ?? null,
          identityConfirmed: input.identityConfirmed ?? false,
          notes: input.notes?.trim() || null,
        },
      });
      await this.logOfficeClockTime(created, input.recordedByUserId);
      return created;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        clientEventId
      ) {
        const existing = await this.prisma.visitAttendanceEvent.findFirst({
          where: {
            scheduledJobId: input.scheduledJobId,
            employeeId: input.employeeId,
            eventType: input.eventType,
            clientEventId,
          },
        });
        if (existing) return existing;
      }
      this.logger.error(`Failed to record attendance event: ${String(err)}`);
      throw err;
    }
  }

  async assertGeofencePolicy(params: {
    outsideGeofence: boolean;
    outsideGeofenceReason?: string | null;
    restrictOutside: boolean;
  }) {
    if (!params.outsideGeofence) return;

    if (params.restrictOutside) {
      throw new BadRequestException(
        'Check-in is outside the allowed geofence for this visit. Move closer to the service user address or contact the office.',
      );
    }

    if (!params.outsideGeofenceReason?.trim()) {
      throw new BadRequestException(
        'You are outside the visit geofence. Provide a reason before checking in.',
      );
    }
  }
}
