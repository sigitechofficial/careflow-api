import { BadRequestException, Injectable } from '@nestjs/common';
import { AllocationStatus, Prisma } from '@prisma/client';
import { DataAccessType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  loadScheduleAreaByLocationMap,
  resolveBranchFromLocation,
  type ScheduleAreaBranchLookup,
} from '../location-management/service-user-branch.util';
import {
  assertDateRangeMaxDays,
  utcDayBounds,
  utcMonthBounds,
  utcWeekBounds,
  jobDurationMinutes,
} from '../scheduling/schedule-date-range.util';
import { mapEmployeeBrief, mapTimelineJob, timelineJobInclude } from '../scheduling/schedule-timeline.mapper';
import { attachVisitRefsToJobs } from '../scheduling/visit-ref-lookup.util';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import {
  employmentToCycleConfig,
  mapPatternToDayPattern,
  resolvePatternForDate,
  type WorkingPatternRow,
} from '../employee-working-patterns/working-pattern-cycle.util';
import { calendarDayUtc } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';
import { JobsDayTimelineQueryDto } from './dto/jobs-day-timeline-query.dto';
import { EmployeeTimelineQueryDto } from './dto/employee-timeline-query.dto';
import { ServiceUserTimelineQueryDto } from './dto/service-user-timeline-query.dto';
import { EmployeeCapacityQueryDto } from './dto/employee-capacity-query.dto';

const ACTIVE_ALLOCATION = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const DOW_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

@Injectable()
export class ScheduleTimelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly scheduleImpact: ScheduleLifecycleImpactService,
  ) {}

  private async logView(
    userId: string,
    view: string,
    meta: RequestAuditMeta | undefined,
    extra?: Record<string, unknown>,
  ) {
    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.SCHEDULE_TIMELINE_VIEWED,
      metadata: { view, ...extra },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.SCHEDULING,
      recordType: 'ScheduleTimeline',
      accessType: DataAccessType.VIEW,
      metadata: { view, ...extra },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }

  private jobWhereForRange(
    start: Date,
    end: Date,
    opts: { scheduleBatchId?: string; scheduleAreaId?: string; serviceUserIds?: string[] },
  ): Prisma.ScheduledJobWhereInput {
    const where: Prisma.ScheduledJobWhereInput = {
      deletedAt: null,
      isActive: true,
      scheduledStartDateTime: { gte: start, lte: end },
    };
    if (opts.scheduleBatchId) where.scheduleBatchId = opts.scheduleBatchId;
    if (opts.scheduleAreaId) where.scheduleAreaId = opts.scheduleAreaId;
    if (opts.serviceUserIds?.length) where.serviceUserId = { in: opts.serviceUserIds };
    return where;
  }

  private applyBranchLabelsToTimelineJobs<T extends ReturnType<typeof mapTimelineJob>>(
    jobs: T[],
    scheduleAreaByLocation: Map<string, ScheduleAreaBranchLookup>,
  ): T[] {
    return jobs.map((job) => {
      const locationId = job.serviceUser.locationId ?? job.scheduleArea?.locationId ?? null;
      const branch = resolveBranchFromLocation(
        locationId,
        job.serviceUser.location?.name ?? null,
        scheduleAreaByLocation,
      );
      const resolvedLocationId = branch.locationId ?? job.serviceUser.locationId;
      const locationName =
        branch.displayLabel || branch.locationName || job.serviceUser.location?.name || '';
      return {
        ...job,
        serviceUser: {
          ...job.serviceUser,
          locationId: resolvedLocationId,
          zoneName: branch.zoneName,
          branchName: branch.branchName,
          branchLayers: branch.branchLayers,
          displayLabel: branch.displayLabel,
          location: resolvedLocationId
            ? { id: resolvedLocationId, name: locationName }
            : job.serviceUser.location,
        },
      };
    });
  }

  private async enrichTimelineJobs<T extends ReturnType<typeof mapTimelineJob>>(
    jobs: T[],
    day: string,
  ): Promise<Array<T & { visitRef: string | null }>> {
    if (!jobs.length) return [];
    const scheduleAreaByLocation = await loadScheduleAreaByLocationMap(this.prisma);
    const withBranches = this.applyBranchLabelsToTimelineJobs(jobs, scheduleAreaByLocation);
    const dayDate = utcDayBounds(day).start;
    const flags = await this.scheduleImpact.loadTimelineOperationalFlags(withBranches, dayDate);
    const withFlags = withBranches.map((job) => {
      const f = flags.get(job.id);
      return f ? { ...job, ...f } : job;
    });
    return attachVisitRefsToJobs(this.prisma, withFlags);
  }

  private async fetchJobs(
    where: Prisma.ScheduledJobWhereInput,
    page: number,
    limit: number,
    enrichDay?: string,
  ) {
    const skip = (page - 1) * limit;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduledJob.count({ where }),
      this.prisma.scheduledJob.findMany({
        where,
        orderBy: { scheduledStartDateTime: 'asc' },
        skip,
        take: limit,
        include: timelineJobInclude,
      }),
    ]);
    let jobs = rows.map(mapTimelineJob);
    if (enrichDay) {
      jobs = await this.enrichTimelineJobs(jobs, enrichDay);
    }
    return { jobs, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async jobsDayRuns(userId: string, query: JobsDayTimelineQueryDto, meta?: RequestAuditMeta) {
    const { start, end, date } = utcDayBounds(query.date);
    const { jobs } = await this.fetchJobs(
      this.jobWhereForRange(start, end, query),
      query.page ?? 1,
      query.limit ?? 100,
      date,
    );
    const runsMap = new Map<string, { run: NonNullable<(typeof jobs)[0]['scheduleRun']>; jobs: typeof jobs }>();
    const unassignedJobs: typeof jobs = [];
    for (const job of jobs) {
      if (job.scheduleRunId && job.scheduleRun) {
        const key = job.scheduleRunId;
        if (!runsMap.has(key)) runsMap.set(key, { run: job.scheduleRun, jobs: [] });
        runsMap.get(key)!.jobs.push(job);
      } else {
        unassignedJobs.push(job);
      }
    }
    await this.logView(userId, 'jobs_day_runs', meta, { date });
    return {
      data: {
        date,
        runs: [...runsMap.values()],
        unassignedJobs,
      },
      meta: { totalJobs: jobs.length },
    };
  }

  async jobsDayTimeline(userId: string, query: JobsDayTimelineQueryDto, meta?: RequestAuditMeta) {
    const { start, end, date } = utcDayBounds(query.date);
    const result = await this.fetchJobs(this.jobWhereForRange(start, end, query), query.page ?? 1, query.limit ?? 100, date);
    await this.logView(userId, 'jobs_day_timeline', meta, { date });
    return { data: { date, jobs: result.jobs }, meta: result.meta };
  }

  async employeesDayRuns(userId: string, query: JobsDayTimelineQueryDto, meta?: RequestAuditMeta) {
    const { start, end, date } = utcDayBounds(query.date);
    const allocations = await this.prisma.jobAllocation.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
        scheduledJob: {
          ...this.jobWhereForRange(start, end, query),
        },
      },
      include: {
        employee: { include: { personalDetail: true, employment: { include: { role: true, jobTitle: true } } } },
        scheduledJob: { include: timelineJobInclude },
      },
    });

    const byEmployee = new Map<string, {
      employee: ReturnType<typeof mapEmployeeBrief>;
      runs: Map<string, { run: unknown; jobs: ReturnType<typeof mapTimelineJob>[] }>;
    }>();

    const mappedJobs = allocations.map((a) => mapTimelineJob(a.scheduledJob));
    const enrichedJobs = await this.enrichTimelineJobs(mappedJobs, date);
    const jobById = new Map(enrichedJobs.map((j) => [j.id, j]));

    for (const a of allocations) {
      const empId = a.employeeId;
      if (!byEmployee.has(empId)) {
        byEmployee.set(empId, { employee: mapEmployeeBrief(a.employee), runs: new Map() });
      }
      const bucket = byEmployee.get(empId)!;
      const job = jobById.get(a.scheduledJob.id) ?? mapTimelineJob(a.scheduledJob);
      const runKey = job.scheduleRunId ?? '__none__';
      if (!bucket.runs.has(runKey)) {
        bucket.runs.set(runKey, { run: job.scheduleRun, jobs: [] });
      }
      bucket.runs.get(runKey)!.jobs.push(job);
    }

    await this.logView(userId, 'employees_day_runs', meta, { date });
    return {
      data: {
        date,
        employees: [...byEmployee.values()].map((e) => ({
          employee: e.employee,
          runs: [...e.runs.values()],
        })),
      },
    };
  }

  async jobCarerDayStarts(userId: string, query: JobsDayTimelineQueryDto, meta?: RequestAuditMeta) {
    const { start, end, date } = utcDayBounds(query.date);
    const allocations = await this.prisma.jobAllocation.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
        scheduledJob: this.jobWhereForRange(start, end, query),
      },
      include: {
        employee: { include: { personalDetail: true } },
        scheduledJob: { include: timelineJobInclude },
      },
      orderBy: { scheduledJob: { scheduledStartDateTime: 'asc' } },
      take: query.limit ?? 200,
    });

    const mappedJobs = allocations.map((a) => mapTimelineJob(a.scheduledJob));
    const enrichedJobs = await this.enrichTimelineJobs(mappedJobs, date);
    const jobById = new Map(enrichedJobs.map((j) => [j.id, j]));

    await this.logView(userId, 'job_carer_day_starts', meta, { date });
    return {
      data: {
        date,
        starts: allocations.map((a) => ({
          allocationId: a.id,
          allocationStatus: a.status,
          scheduledStartDateTime: a.scheduledJob.scheduledStartDateTime.toISOString(),
          employee: mapEmployeeBrief(a.employee),
          job: jobById.get(a.scheduledJob.id) ?? mapTimelineJob(a.scheduledJob),
        })),
      },
    };
  }

  private async buildEmployeeTimeline(
    start: Date,
    end: Date,
    query: EmployeeTimelineQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const empWhere: Prisma.EmployeeWhereInput = { deletedAt: null, isActive: true };
    if (query.employeeIds?.length) empWhere.id = { in: query.employeeIds };

    const [total, employees] = await this.prisma.$transaction([
      this.prisma.employee.count({ where: empWhere }),
      this.prisma.employee.findMany({
        where: empWhere,
        skip,
        take: limit,
        orderBy: { personalDetail: { lastName: 'asc' } },
        include: {
          personalDetail: true,
          employment: { include: { role: true, jobTitle: true } },
          workingPatterns: { where: { deletedAt: null, isActive: true } },
        },
      }),
    ]);

    const jobWhere = this.jobWhereForRange(start, end, {
      scheduleBatchId: query.scheduleBatchId,
    });

    const timelineDate = query.date ?? query.weekStart ?? (query.month ? `${query.month}-01` : null);
    const holidayEndByEmployeeId = new Map<string, string>();
    if (timelineDate) {
      const dayNoon = calendarDayUtc(new Date(`${timelineDate}T12:00:00.000Z`));
      const holidayRows = await this.prisma.employeeHoliday.findMany({
        where: {
          employeeId: { in: employees.map((e) => e.id) },
          deletedAt: null,
          isActive: true,
          startDate: { lte: dayNoon },
          endDate: { gte: dayNoon },
        },
        select: { employeeId: true, endDate: true },
      });
      for (const holiday of holidayRows) {
        holidayEndByEmployeeId.set(holiday.employeeId, holiday.endDate.toISOString());
      }
    }

    const rows = await Promise.all(
      employees.map(async (emp) => {
        const allocations = await this.prisma.jobAllocation.findMany({
          where: {
            employeeId: emp.id,
            deletedAt: null,
            isActive: true,
            status: { in: ACTIVE_ALLOCATION },
            scheduledJob: jobWhere,
          },
          include: { scheduledJob: { include: timelineJobInclude } },
        });
        const jobs = allocations.map((a) => mapTimelineJob(a.scheduledJob));
        const totalMinutes = jobs.reduce((s, j) => s + j.durationMinutes, 0);
        const holidayEndDate = holidayEndByEmployeeId.get(emp.id);
        const row: {
          employee: ReturnType<typeof mapEmployeeBrief>;
          allocations: Array<{ id: string; status: AllocationStatus; job: ReturnType<typeof mapTimelineJob> }>;
          totalMinutes: number;
          dayPattern?: ReturnType<typeof mapPatternToDayPattern>;
          onHoliday?: boolean;
          holidayEndDate?: string;
        } = {
          employee: mapEmployeeBrief(emp),
          allocations: allocations.map((a) => ({
            id: a.id,
            status: a.status,
            job: mapTimelineJob(a.scheduledJob),
          })),
          totalMinutes,
          ...(holidayEndDate
            ? { onHoliday: true, holidayEndDate }
            : {}),
        };

        if (timelineDate) {
          const patternRows: WorkingPatternRow[] = emp.workingPatterns.map((p) => ({
            weekInCycle: p.weekInCycle,
            dayOfWeek: p.dayOfWeek,
            startTime: p.startTime,
            endTime: p.endTime,
            isAvailable: p.isAvailable,
            notes: p.notes,
          }));
          const cycleConfig = employmentToCycleConfig(emp.employment, emp.createdAt);
          const resolved = resolvePatternForDate(patternRows, cycleConfig, timelineDate);
          row.dayPattern = mapPatternToDayPattern(resolved);
        }

        return row;
      }),
    );

    const enrichDay = query.date ?? query.weekStart ?? (query.month ? `${query.month}-01` : null);
    if (enrichDay) {
      const allJobs = rows.flatMap((row) => row.allocations.map((allocation) => allocation.job));
      const enrichedJobs = await this.enrichTimelineJobs(allJobs, enrichDay);
      const jobById = new Map(enrichedJobs.map((job) => [job.id, job]));
      for (const row of rows) {
        row.allocations = row.allocations.map((allocation) => ({
          ...allocation,
          job: jobById.get(allocation.job.id) ?? allocation.job,
        }));
      }
    }

    return { employees: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async employeesDay(userId: string, query: EmployeeTimelineQueryDto, meta?: RequestAuditMeta) {
    if (!query.date) throw new BadRequestException('date is required');
    const { start, end, date } = utcDayBounds(query.date);
    const { employees, meta: pagination } = await this.buildEmployeeTimeline(start, end, query);
    await this.logView(userId, 'employees_day', meta, { date });
    return { data: { date, employees }, meta: pagination };
  }

  async employeesWeek(userId: string, query: EmployeeTimelineQueryDto, meta?: RequestAuditMeta) {
    if (!query.weekStart) throw new BadRequestException('weekStart is required');
    const { weekStart, weekEnd, weekStartLabel, weekEndLabel } = utcWeekBounds(query.weekStart);
    const { employees, meta: pagination } = await this.buildEmployeeTimeline(weekStart, weekEnd, query);
    await this.logView(userId, 'employees_week', meta, { weekStart: weekStartLabel, weekEnd: weekEndLabel });
    return {
      data: { weekStart: weekStartLabel, weekEnd: weekEndLabel, employees },
      meta: pagination,
    };
  }

  async employeesMonth(userId: string, query: EmployeeTimelineQueryDto, meta?: RequestAuditMeta) {
    if (!query.month) throw new BadRequestException('month is required (YYYY-MM)');
    const { monthStart, monthEnd, label } = utcMonthBounds(query.month);
    const { employees, meta: pagination } = await this.buildEmployeeTimeline(monthStart, monthEnd, query);
    await this.logView(userId, 'employees_month', meta, { month: label });
    return { data: { month: label, employees }, meta: pagination };
  }

  private async buildServiceUserTimeline(
    start: Date,
    end: Date,
    query: ServiceUserTimelineQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const result = await this.fetchJobs(
      this.jobWhereForRange(start, end, {
        scheduleBatchId: query.scheduleBatchId,
        serviceUserIds: query.serviceUserIds,
      }),
      page,
      limit,
      query.date,
    );

    const bySu = new Map<string, { serviceUser: (typeof result.jobs)[0]['serviceUser']; jobs: typeof result.jobs }>();
    for (const job of result.jobs) {
      const suId = job.serviceUserId;
      if (!bySu.has(suId)) bySu.set(suId, { serviceUser: job.serviceUser, jobs: [] });
      bySu.get(suId)!.jobs.push(job);
    }

    return {
      serviceUsers: [...bySu.values()],
      meta: result.meta,
    };
  }

  async serviceUsersDay(userId: string, query: ServiceUserTimelineQueryDto, meta?: RequestAuditMeta) {
    if (!query.date) throw new BadRequestException('date is required');
    const { start, end, date } = utcDayBounds(query.date);
    const { serviceUsers, meta: paginationMeta } = await this.buildServiceUserTimeline(start, end, query);
    await this.logView(userId, 'service_users_day', meta, { date });
    return { data: { date, serviceUsers }, meta: paginationMeta };
  }

  async serviceUsersWeek(userId: string, query: ServiceUserTimelineQueryDto, meta?: RequestAuditMeta) {
    if (!query.weekStart) throw new BadRequestException('weekStart is required');
    const { weekStart, weekEnd, weekStartLabel, weekEndLabel } = utcWeekBounds(query.weekStart);
    const { serviceUsers, meta: paginationMeta } = await this.buildServiceUserTimeline(weekStart, weekEnd, query);
    await this.logView(userId, 'service_users_week', meta, { weekStart: weekStartLabel });
    return {
      data: { weekStart: weekStartLabel, weekEnd: weekEndLabel, serviceUsers },
      meta: paginationMeta,
    };
  }

  async employeeCapacity(userId: string, query: EmployeeCapacityQueryDto, meta?: RequestAuditMeta) {
    const from = utcDayBounds(query.dateFrom).start;
    const to = utcDayBounds(query.dateTo).end;
    assertDateRangeMaxDays(from, to, 31);

    const page = query.page ?? 1;
    const limit = query.limit ?? 100;
    const skip = (page - 1) * limit;
    const empWhere: Prisma.EmployeeWhereInput = { deletedAt: null, isActive: true };
    if (query.employeeIds?.length) empWhere.id = { in: query.employeeIds };

    const [total, employees] = await this.prisma.$transaction([
      this.prisma.employee.count({ where: empWhere }),
      this.prisma.employee.findMany({
        where: empWhere,
        skip,
        take: limit,
        orderBy: { personalDetail: { lastName: 'asc' } },
        include: { personalDetail: true, employment: true },
      }),
    ]);

    const jobWhere: Prisma.ScheduledJobWhereInput = {
      deletedAt: null,
      isActive: true,
      scheduledStartDateTime: { gte: from, lte: to },
    };
    if (query.scheduleBatchId) jobWhere.scheduleBatchId = query.scheduleBatchId;

    const rows = await Promise.all(
      employees.map(async (emp) => {
        const allocations = await this.prisma.jobAllocation.findMany({
          where: {
            employeeId: emp.id,
            deletedAt: null,
            isActive: true,
            status: { in: ACTIVE_ALLOCATION },
            scheduledJob: jobWhere,
          },
          include: { scheduledJob: true },
        });

        const dayHours: Record<string, number> = {
          monday: 0,
          tuesday: 0,
          wednesday: 0,
          thursday: 0,
          friday: 0,
          saturday: 0,
          sunday: 0,
        };
        let weeklyMinutes = 0;
        for (const a of allocations) {
          const mins = jobDurationMinutes(a.scheduledJob);
          weeklyMinutes += mins;
          const dowKey = DOW_KEYS[a.scheduledJob.scheduledStartDateTime.getUTCDay()];
          if (dowKey in dayHours) dayHours[dowKey] += mins / 60;
        }

        const empRow = emp.personalDetail;
        const name = empRow ? `${empRow.firstName} ${empRow.lastName}`.trim() : emp.id;
        const employment = emp.employment;

        return {
          employeeId: emp.id,
          employeeName: name,
          contractedHours: employment?.contractedWeeklyHours ?? null,
          maximumHours: employment?.maximumWeeklyHours ?? null,
          weeklyHours: Math.round((weeklyMinutes / 60) * 100) / 100,
          monday: Math.round(dayHours.monday * 100) / 100,
          tuesday: Math.round(dayHours.tuesday * 100) / 100,
          wednesday: Math.round(dayHours.wednesday * 100) / 100,
          thursday: Math.round(dayHours.thursday * 100) / 100,
          friday: Math.round(dayHours.friday * 100) / 100,
          saturday: Math.round(dayHours.saturday * 100) / 100,
          sunday: Math.round(dayHours.sunday * 100) / 100,
        };
      }),
    );

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.EMPLOYEE_CAPACITY_VIEWED,
      metadata: { dateFrom: query.dateFrom, dateTo: query.dateTo },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.SCHEDULING,
      recordType: 'EmployeeCapacity',
      accessType: DataAccessType.VIEW,
      metadata: { dateFrom: query.dateFrom, dateTo: query.dateTo },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        rows,
      },
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }
}
