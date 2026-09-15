import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AllocationStatus, ScheduledJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertDateRangeMaxDays,
  operationalScheduleMonthBounds,
  utcMonthBounds,
} from '../scheduling/schedule-date-range.util';
import { formatScheduleDate } from '../schedules/schedules-date.util';
import { mapTimelineJob, timelineJobInclude } from '../scheduling/schedule-timeline.mapper';
import { assessVisitDeliveryFromJobLike } from '../scheduling/visit-delivery-assessment.util';
import { resolveAllocationWindow } from '../job-allocations/allocation-window.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async getVisitsForMonth(employeeId: string, month: string) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const { monthStart, monthEnd, label } = operationalScheduleMonthBounds(month, timeZone);
    const civil = utcMonthBounds(month);
    return this.getVisitsInRange(employeeId, {
      rangeStart: monthStart,
      rangeEnd: monthEnd,
      period: label,
      periodType: 'month',
      dateFrom: formatScheduleDate(civil.monthStart),
      dateTo: formatScheduleDate(civil.monthEnd),
      organisationTimezone: timeZone,
    });
  }

  /**
   * Allocated visits for an employee in an inclusive datetime range.
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
      organisationTimezone?: string;
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

    const scheduledVisitIds = [
      ...new Set(
        allocations
          .map((allocation) => {
            const visits = allocation.scheduledJob?.visits ?? [];
            return visits[0]?.id as string | undefined;
          })
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const reconciliationRows =
      scheduledVisitIds.length > 0
        ? await this.prisma.visitReconciliation.findMany({
            where: { scheduledVisitId: { in: scheduledVisitIds } },
            select: {
              scheduledVisitId: true,
              jobAllocationId: true,
              visitRef: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
          })
        : [];

    /** Prefer allocation-matched ref; fall back to any ref for the scheduled visit. */
    const visitRefByAllocation = new Map<string, string>();
    const visitRefByScheduledVisit = new Map<string, string>();
    for (const row of reconciliationRows) {
      const ref = row.visitRef?.trim();
      if (!ref) continue;
      if (!visitRefByScheduledVisit.has(row.scheduledVisitId)) {
        visitRefByScheduledVisit.set(row.scheduledVisitId, ref);
      }
      if (row.jobAllocationId && !visitRefByAllocation.has(row.jobAllocationId)) {
        visitRefByAllocation.set(row.jobAllocationId, ref);
      }
    }

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
      const visitRef =
        visitRefByAllocation.get(allocation.id) ??
        (primaryVisit?.id ? visitRefByScheduledVisit.get(primaryVisit.id) : undefined) ??
        null;
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
        visitRef,
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
        organisationTimezone: opts.organisationTimezone ?? null,
        summary,
        visits,
      },
    };
  }

  /** Resolve month or custom range for carer / admin callers. */
  async resolveVisitQuery(query: {
    month?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<{
    rangeStart: Date;
    rangeEnd: Date;
    period: string;
    periodType: 'month' | 'custom';
    dateFrom: string;
    dateTo: string;
    organisationTimezone: string;
  }> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const dateFrom = query.dateFrom?.trim();
    const dateTo = query.dateTo?.trim();

    if (dateFrom || dateTo) {
      if (!dateFrom || !dateTo) {
        throw new BadRequestException('Provide both dateFrom and dateTo, or use month');
      }
      const rangeStart = operationalDayBounds(dateFrom, timeZone).start;
      const rangeEnd = operationalDayBounds(dateTo, timeZone).end;
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
        organisationTimezone: timeZone,
      };
    }

    const month =
      query.month?.trim() ||
      (() => {
        const today = operationalTodayIso(new Date(), timeZone);
        return today.slice(0, 7);
      })();
    const { monthStart, monthEnd, label } = operationalScheduleMonthBounds(month, timeZone);
    const civil = utcMonthBounds(month);
    return {
      rangeStart: monthStart,
      rangeEnd: monthEnd,
      period: label,
      periodType: 'month',
      dateFrom: formatScheduleDate(civil.monthStart),
      dateTo: formatScheduleDate(civil.monthEnd),
      organisationTimezone: timeZone,
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
