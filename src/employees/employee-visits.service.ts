import { Injectable, NotFoundException } from '@nestjs/common';
import { AllocationStatus, ScheduledJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { utcMonthBounds } from '../scheduling/schedule-date-range.util';
import { mapTimelineJob, timelineJobInclude } from '../scheduling/schedule-timeline.mapper';
import { assessVisitDeliveryFromJobLike } from '../scheduling/visit-delivery-assessment.util';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const EXCLUDED_JOB_STATUSES: ScheduledJobStatus[] = [
  ScheduledJobStatus.DRAFT,
];

export type EmployeeVisitBucket = 'completed' | 'ongoing' | 'upcoming' | 'other';

@Injectable()
export class EmployeeVisitsService {
  constructor(private readonly prisma: PrismaService) {}

  async getVisitsForMonth(employeeId: string, month: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const { monthStart, monthEnd, label } = utcMonthBounds(month);

    const [allocations, orgSettings] = await Promise.all([
      this.prisma.jobAllocation.findMany({
        where: {
          employeeId,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
          scheduledJob: {
            deletedAt: null,
            isActive: true,
            status: { notIn: EXCLUDED_JOB_STATUSES },
            scheduledStartDateTime: { gte: monthStart, lte: monthEnd },
          },
        },
        orderBy: { scheduledJob: { scheduledStartDateTime: 'asc' } },
        include: {
          scheduledJob: { include: timelineJobInclude },
        },
      }),
      this.prisma.organisationGeneralSettings.findFirst({
        select: {
          domLateVisitAlertMinutes: true,
          domGlobalToleranceMinutes: true,
        },
      }),
    ]);

    const now = new Date();
    const orgLateAlertMinutes = orgSettings?.domLateVisitAlertMinutes ?? null;
    const orgGlobalToleranceMinutes = orgSettings?.domGlobalToleranceMinutes ?? null;

    const summary = {
      total: 0,
      completed: 0,
      ongoing: 0,
      upcoming: 0,
      other: 0,
      totalPlannedMinutes: 0,
    };

    const visits = allocations.map((allocation) => {
      const baseJob = mapTimelineJob(allocation.scheduledJob);
      const deliveryAssessment = assessVisitDeliveryFromJobLike({
        status: baseJob.status,
        requiredCarers: baseJob.requiredCarers,
        allocatedCarers: baseJob.allocatedCarers,
        allocations: baseJob.allocations,
        scheduledStartDateTime: baseJob.scheduledStartDateTime,
        scheduledEndDateTime: baseJob.scheduledEndDateTime,
        actualStartDateTime: baseJob.actualStartDateTime,
        actualEndDateTime: baseJob.actualEndDateTime,
        visitPlan: baseJob.visitPlan,
        visits: baseJob.visits,
        orgLateAlertMinutes,
        orgGlobalToleranceMinutes,
        now,
      });

      const job = { ...baseJob, deliveryAssessment };
      const primaryVisit = job.visits[0] ?? null;
      const bucket = classifyEmployeeVisit(job, now);
      const plannedMinutes = job.durationMinutes;
      const actualMinutes = minutesBetweenIso(job.actualStartDateTime, job.actualEndDateTime);
      const su = job.serviceUser;
      const serviceUserName = [su?.preferredName || su?.firstName, su?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Service user';

      summary.total += 1;
      summary[bucket] += 1;
      summary.totalPlannedMinutes += plannedMinutes;

      return {
        jobId: job.id,
        visitId: primaryVisit?.id ?? job.id,
        allocationId: allocation.id,
        bucket,
        status: job.status,
        slotLabel: job.visitPlan?.label ?? primaryVisit?.visitName ?? job.jobName,
        serviceUser: {
          id: su.id,
          name: serviceUserName,
          preferredName: su.preferredName,
          firstName: su.firstName,
          lastName: su.lastName,
        },
        scheduledStartDateTime: job.scheduledStartDateTime,
        scheduledEndDateTime: job.scheduledEndDateTime,
        actualStartDateTime: job.actualStartDateTime,
        actualEndDateTime: job.actualEndDateTime,
        plannedMinutes,
        actualMinutes,
        deliveryAssessment,
        job,
      };
    });

    return {
      data: {
        employeeId,
        month: label,
        summary,
        visits,
      },
    };
  }
}

function classifyEmployeeVisit(
  job: {
    status: string;
    scheduledStartDateTime: string;
    scheduledEndDateTime: string | null;
    durationMinutes: number;
  },
  now: Date,
): EmployeeVisitBucket {
  const status = (job.status ?? '').toUpperCase();
  if (status === 'COMPLETED' || status === 'PARTIALLY_COMPLETED') return 'completed';
  if (status === 'IN_PROGRESS') return 'ongoing';
  if (status === 'MISSED' || status === 'CANCELLED' || status === 'CALLED_OFF') return 'other';

  const start = new Date(job.scheduledStartDateTime);
  if (Number.isNaN(start.getTime())) return 'other';
  const end = job.scheduledEndDateTime
    ? new Date(job.scheduledEndDateTime)
    : new Date(start.getTime() + (job.durationMinutes ?? 60) * 60_000);

  if (now >= start && now <= end) return 'ongoing';
  if (now > end) return 'other';
  return 'upcoming';
}

function minutesBetweenIso(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 60_000);
}
