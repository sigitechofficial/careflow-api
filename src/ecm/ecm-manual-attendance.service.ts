import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EcmAuditEventType,
  ScheduledVisitStatus,
  VisitAttendanceEventType,
  VisitAttendanceVerificationMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VisitReconciliationsService } from '../billing/visit-reconciliations.service';
import { recordOfficeAttendanceTime } from '../visit-attendance/visit-attendance-verification.store';
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
    private readonly reconciliations: VisitReconciliationsService,
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
    const pay = await this.carryIntoPay(job, input, occurredAt);
    return { data: { eventId: event.id, eventType, confidenceImpact: 'MANUALLY_VERIFIED', pay } };
  }

  /**
   * VW-15: an office-verified time on a completed visit becomes the recorded attendance of that
   * carer, and pay follows it: draft pay is repriced, pay already settled gets a pay correction
   * (see VisitReconciliationsService.applyAttendanceCorrection). The original events stay as they
   * are; this is a new, attributed fact on top of them.
   * A visit that is not completed yet is left alone: its times are settled when it completes.
   */
  private async carryIntoPay(
    job: {
      id: string;
      metadata: unknown;
      visits: Array<{ id: string; status: ScheduledVisitStatus; actualStartDateTime: Date | null; actualEndDateTime: Date | null }>;
      allocations: Array<{ id: string; actualStartDateTime: Date | null; actualEndDateTime: Date | null }>;
    },
    input: ManualAttendanceInput,
    occurredAt: Date,
  ) {
    const visit = job.visits[0];
    const allocation = job.allocations[0];
    if (!visit) return null;
    const reason = [input.reasonCode.trim(), input.note?.trim()].filter(Boolean).join(': ');

    // R-04: the visit is still open. The carer's live record is left alone (a correction must not
    // overwrite what the carer is doing on the device); the office time is recorded for this carer
    // and becomes the recorded time when the visit completes. If the carer then reports something
    // different, the difference is flagged for review rather than one side silently winning.
    if (
      visit.status !== ScheduledVisitStatus.COMPLETED &&
      visit.status !== ScheduledVisitStatus.PARTIALLY_COMPLETED
    ) {
      await recordOfficeAttendanceTime(this.prisma, {
        scheduledJobId: job.id,
        employeeId: input.employeeId,
        jobAllocationId: allocation?.id,
        eventType: input.eventType,
        occurredAt,
        byUserId: input.approvedByUserId,
        reason,
        verified: false,
      });
      return [
        {
          reconciliationId: null,
          visitRef: null,
          outcome: 'RECORDED_FOR_COMPLETION' as const,
          message:
            'The visit is still open. This time is recorded and will be used as the time for this carer when the visit is completed.',
          payableBefore: null,
          payableAfter: null,
        },
      ];
    }

    const isStart = input.eventType === 'CHECK_IN';
    const current = allocation ?? visit;
    const start = isStart ? occurredAt : (current.actualStartDateTime ?? visit.actualStartDateTime);
    const end = isStart ? (current.actualEndDateTime ?? visit.actualEndDateTime) : occurredAt;
    if (start && end && start.getTime() >= end.getTime()) {
      throw new BadRequestException(
        'The corrected time would put the start at or after the finish. Correct the other time first.',
      );
    }
    const timeField = isStart ? { actualStartDateTime: occurredAt } : { actualEndDateTime: occurredAt };

    const otherCarers = await this.prisma.jobAllocation.count({
      where: {
        scheduledJobId: job.id,
        deletedAt: null,
        isActive: true,
        unallocatedAt: null,
        employeeId: { not: input.employeeId },
      },
    });
    await this.prisma.$transaction(async (tx) => {
      if (allocation) {
        await tx.jobAllocation.update({ where: { id: allocation.id }, data: timeField });
      }
      // On a single-carer visit the visit carries the same times as its carer.
      if (!allocation || otherCarers === 0) {
        await tx.scheduledVisit.update({ where: { id: visit.id }, data: timeField });
      }
      // The office has now verified this carer's times: they no longer need review. Another
      // carer on the same visit keeps their own record (R-03).
      await recordOfficeAttendanceTime(tx, {
        scheduledJobId: job.id,
        employeeId: input.employeeId,
        jobAllocationId: allocation?.id,
        eventType: input.eventType,
        occurredAt,
        byUserId: input.approvedByUserId,
        reason,
        verified: true,
      });
    });

    const result = await this.reconciliations.applyAttendanceCorrection(visit.id, {
      userId: input.approvedByUserId,
      reason,
      jobAllocationId: allocation?.id ?? null,
    });
    return result.data;
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
