import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AllocationStatus, ScheduledJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertDateRangeMaxDays,
  utcMonthBounds,
} from '../scheduling/schedule-date-range.util';
import { parseScheduleDate, formatScheduleDate } from '../schedules/schedules-date.util';
import { mapTimelineJob, timelineJobInclude } from '../scheduling/schedule-timeline.mapper';
import { assessVisitDeliveryFromJobLike } from '../scheduling/visit-delivery-assessment.util';
import { resolveAllocationWindow } from '../job-allocations/allocation-window.util';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const EXCLUDED_JOB_STATUSES: ScheduledJobStatus[] = [ScheduledJobStatus.DRAFT];

/** Max span for custom dateFrom/dateTo queries (enterprise safety). */
const MAX_VISIT_RANGE_DAYS = 366;

export type EmployeeVisitBucket = 'completed' | 'ongoing' | 'upcoming' | 'other';

@Injectable()
export class EmployeeVisitsService {
  constructor(private readonly prisma: PrismaService) {}

  async getVisitsForMonth(employeeId: string, month: string) {
    const { monthStart, monthEnd, label } = utcMonthBounds(month);
    return this.getVisitsInRange(employeeId, {
      rangeStart: monthStart,
      rangeEnd: monthEnd,
      period: label,
      periodType: 'month',
      dateFrom: formatScheduleDate(monthStart),
      dateTo: formatScheduleDate(monthEnd),
    });
  }

  /**
   * Allocated visits for an employee in a UTC date range (inclusive).
   * Used by admin Employee → Visits and carer `GET /employee-app/me/visits`.
   */
  async getVisitsInRange(
    employeeId: string,
    opts: {
      rangeStart: Date;
      rangeEnd: Date;
      period: string;
      periodType: 'month' | 'custom';
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    assertDateRangeMaxDays(opts.rangeStart, opts.rangeEnd, MAX_VISIT_RANGE_DAYS);

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
            scheduledStartDateTime: { gte: opts.rangeStart, lte: opts.rangeEnd },
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
      const resolved = resolveAllocationWindow(allocation, allocation.scheduledJob);
      const scheduledStartDateTime = resolved.start.toISOString();
      const scheduledEndDateTime = resolved.end.toISOString();
      const plannedMinutes = resolved.durationMinutes;

      const deliveryAssessment = assessVisitDeliveryFromJobLike({
        status: baseJob.status,
        requiredCarers: baseJob.requiredCarers,
        allocatedCarers: baseJob.allocatedCarers,
        allocations: baseJob.allocations,
        scheduledStartDateTime,
        scheduledEndDateTime,
        actualStartDateTime: baseJob.actualStartDateTime,
        actualEndDateTime: baseJob.actualEndDateTime,
        visitPlan: baseJob.visitPlan,
        visits: baseJob.visits,
        orgLateAlertMinutes,
        orgGlobalToleranceMinutes,
        now,
      });

      // Overlay this carer's assignment window onto the job payload so admin
      // Employee → Visits (and carer me/visits) show assignment times, not the
      // full multi-carer visit envelope / visit-plan slot window.
      const job = {
        ...baseJob,
        scheduledStartDateTime,
        scheduledEndDateTime,
        durationMinutes: plannedMinutes,
        deliveryAssessment,
      };
      const primaryVisit = job.visits[0] ?? null;
      const bucket = classifyEmployeeVisit(job, now);
      const actualMinutes = minutesBetweenIso(job.actualStartDateTime, job.actualEndDateTime);
      const su = job.serviceUser;
      const serviceUserName =
        [su?.preferredName || su?.firstName, su?.lastName].filter(Boolean).join(' ').trim() ||
        'Service user';

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
        scheduledStartDateTime,
        scheduledEndDateTime,
        actualStartDateTime: job.actualStartDateTime,
        actualEndDateTime: job.actualEndDateTime,
        plannedMinutes,
        actualMinutes,
        hasExplicitTiming: resolved.hasExplicitTiming,
        deliveryAssessment,
        job,
      };
    });

    return {
      data: {
        employeeId,
        month: opts.period,
        period: opts.period,
        periodType: opts.periodType,
        dateFrom: opts.dateFrom ?? formatScheduleDate(opts.rangeStart),
        dateTo: opts.dateTo ?? formatScheduleDate(opts.rangeEnd),
        summary,
        visits,
      },
    };
  }

  /** Resolve month or custom range for carer / admin callers. */
  resolveVisitQuery(query: {
    month?: string;
    dateFrom?: string;
    dateTo?: string;
  }): {
    rangeStart: Date;
    rangeEnd: Date;
    period: string;
    periodType: 'month' | 'custom';
    dateFrom: string;
    dateTo: string;
  } {
    const dateFrom = query.dateFrom?.trim();
    const dateTo = query.dateTo?.trim();

    if (dateFrom || dateTo) {
      if (!dateFrom || !dateTo) {
        throw new BadRequestException('Provide both dateFrom and dateTo, or use month');
      }
      const rangeStart = parseScheduleDate(dateFrom);
      const rangeEnd = parseScheduleDate(dateTo);
      rangeEnd.setUTCHours(23, 59, 59, 999);
      if (rangeStart.getTime() > rangeEnd.getTime()) {
        throw new BadRequestException('dateFrom must be on or before dateTo');
      }
      assertDateRangeMaxDays(rangeStart, rangeEnd, MAX_VISIT_RANGE_DAYS);
      return {
        rangeStart,
        rangeEnd,
        period: `${dateFrom}_${dateTo}`,
        periodType: 'custom',
        dateFrom,
        dateTo,
      };
    }

    const month =
      query.month?.trim() ||
      (() => {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      })();
    const { monthStart, monthEnd, label } = utcMonthBounds(month);
    return {
      rangeStart: monthStart,
      rangeEnd: monthEnd,
      period: label,
      periodType: 'month',
      dateFrom: formatScheduleDate(monthStart),
      dateTo: formatScheduleDate(monthEnd),
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
