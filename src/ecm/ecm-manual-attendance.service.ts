import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EcmAuditEventType,
  VisitAttendanceEventType,
  VisitAttendanceVerificationMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VisitAttendanceService } from '../visit-attendance/visit-attendance.service';
import { EcmAuditService } from './ecm-audit.service';
import { EcmEvaluationService } from './ecm-evaluation.service';

export type ManualAttendanceInput = {
  scheduledJobId: string;
  employeeId: string;
  eventType: 'CHECK_IN' | 'CHECK_OUT';
  occurredAt: string;
  reasonCode: string;
  note?: string;
  approvedByUserId: string;
  overrideGeofence?: boolean;
};

/**
 * Office manual attendance + amendments (BE1.10).
 * Append-only: never mutate prior VisitAttendanceEvent rows.
 */
@Injectable()
export class EcmManualAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: VisitAttendanceService,
    private readonly evaluation: EcmEvaluationService,
    private readonly audit: EcmAuditService,
  ) {}

  async recordManual(input: ManualAttendanceInput) {
    if (!input.reasonCode?.trim()) {
      throw new BadRequestException('reasonCode is required for manual attendance');
    }
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: input.scheduledJobId, deletedAt: null },
      include: {
        visits: {
          where: { deletedAt: null, isActive: true },
          orderBy: { scheduledStartDateTime: 'asc' },
          take: 1,
        },
        allocations: {
          where: {
            deletedAt: null,
            isActive: true,
            unallocatedAt: null,
            employeeId: input.employeeId,
          },
          take: 1,
        },
      },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');

    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException('occurredAt must be a valid ISO datetime');
    }

    const eventType =
      input.eventType === 'CHECK_OUT'
        ? VisitAttendanceEventType.CHECK_OUT
        : VisitAttendanceEventType.CHECK_IN;

    const notes = [
      `MANUAL:${input.reasonCode.trim()}`,
      input.note?.trim() || null,
      `approvedBy:${input.approvedByUserId}`,
      input.overrideGeofence ? 'geofenceOverride:true' : null,
    ]
      .filter(Boolean)
      .join(' | ');

    const event = await this.attendance.recordEvent({
      scheduledJobId: job.id,
      scheduledVisitId: job.visits[0]?.id ?? null,
      jobAllocationId: job.allocations[0]?.id ?? null,
      employeeId: input.employeeId,
      eventType,
      verificationMethod: VisitAttendanceVerificationMethod.MANUAL_OFFICE,
      occurredAt,
      outsideGeofence: Boolean(input.overrideGeofence),
      outsideGeofenceReason: input.overrideGeofence
        ? 'Office manual entry with geofence override'
        : null,
      identityConfirmed: true,
      notes,
    });

    await this.audit.append({
      eventType: EcmAuditEventType.ATTENDANCE_AMENDED,
      scheduledJobId: job.id,
      actorUserId: input.approvedByUserId,
      summary: `Manual ${eventType} recorded (${input.reasonCode.trim()})`,
      detail: {
        eventId: event.id,
        eventType,
        reasonCode: input.reasonCode.trim(),
        note: input.note ?? null,
        occurredAt: occurredAt.toISOString(),
        employeeId: input.employeeId,
        overrideGeofence: Boolean(input.overrideGeofence),
      },
    });

    await this.evaluation.evaluateJobSafe(job.id);
    return { data: { eventId: event.id, eventType, confidenceImpact: 'MANUALLY_VERIFIED' } };
  }

  async amendAttendance(input: ManualAttendanceInput & { originalEventId?: string }) {
    const result = await this.recordManual(input);
    if (input.originalEventId) {
      await this.audit.append({
        eventType: EcmAuditEventType.ATTENDANCE_AMENDED,
        scheduledJobId: input.scheduledJobId,
        actorUserId: input.approvedByUserId,
        summary: `Amendment supersedes event ${input.originalEventId}`,
        detail: {
          originalEventId: input.originalEventId,
          newEventId: result.data.eventId,
          reasonCode: input.reasonCode.trim(),
        },
      });
    }
    return result;
  }
}
