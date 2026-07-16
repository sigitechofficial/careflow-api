import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  VisitAttendanceEventType,
  VisitAttendanceVerificationMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
};

@Injectable()
export class VisitAttendanceService {
  private readonly logger = new Logger(VisitAttendanceService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      return await this.prisma.visitAttendanceEvent.create({
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
