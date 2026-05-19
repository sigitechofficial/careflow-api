import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  AllocationStatus,
  ExportType,
  Prisma,
  ScheduledVisitStatus as PrismaVisitStatus,
} from '@prisma/client';
import { DataAccessType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  assertDateRangeMaxDays,
  jobDurationMinutes,
} from '../scheduling/schedule-date-range.util';
import {
  buildCallOffVisitReportWhere,
  buildScheduledJobReportWhere,
  buildScheduledVisitReportWhere,
  parseReportDateRange,
} from '../scheduling/schedule-report-query.util';
import { mapEmployeeBrief } from '../scheduling/schedule-timeline.mapper';
import {
  SCHEDULE_REPORT_TYPE_CATALOG,
  ScheduleReportType,
} from './enums/schedule-report-type.enum';
import { ScheduleReportExportHook } from './schedule-report-export.hook';
import type { ScheduleReportQueryDto } from './dto/schedule-report-query.dto';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const DOW_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const visitDetailInclude = {
  serviceUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      serviceUserNumber: true,
    },
  },
  scheduledJob: {
    select: {
      id: true,
      jobName: true,
      status: true,
      notes: true,
      scheduleRun: { select: { id: true, name: true } },
      scheduleArea: { select: { id: true, name: true, code: true } },
    },
  },
  allocations: {
    where: { deletedAt: null, isActive: true, status: { in: ACTIVE_ALLOCATION } },
    include: {
      employee: {
        select: {
          id: true,
          personalDetail: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  },
} satisfies Prisma.ScheduledVisitInclude;

@Injectable()
export class ScheduleReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly exportHook: ScheduleReportExportHook,
  ) {}

  reportTypes() {
    return {
      data: SCHEDULE_REPORT_TYPE_CATALOG.map((r) => ({
        type: r.type,
        name: r.name,
        supported: r.supported,
        endpoint: r.endpoint ?? null,
        message: r.supported ? null : (r.message ?? 'This report requires future module integration.'),
      })),
    };
  }

  private assertExportPermission(query: ScheduleReportQueryDto, userPermissions?: string[]) {
    if (!query.export) return;
    if (userPermissions && !userPermissions.includes('schedule_reports.export')) {
      throw new ForbiddenException('schedule_reports.export permission required for export');
    }
  }

  private async logReportAccess(
    userId: string,
    reportType: ScheduleReportType,
    query: ScheduleReportQueryDto,
    meta: RequestAuditMeta | undefined,
    recordCount: number,
  ) {
    const filters = { ...query };
    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.SCHEDULE_REPORT_VIEWED,
      recordType: 'ScheduleReport',
      metadata: { reportType, filters, recordCount },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.SCHEDULE_REPORT_GENERATED,
      recordType: 'ScheduleReport',
      metadata: { reportType, filters, recordCount },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.SCHEDULING,
      recordType: 'ScheduleReport',
      accessType: DataAccessType.VIEW,
      metadata: { reportType, filters },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    if (query.export) {
      await this.audit.logAudit({
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_REPORT_EXPORTED,
        recordType: 'ScheduleReport',
        metadata: { reportType, filters, recordCount },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      await this.audit.logExport({
        userId,
        module: AuditModule.SCHEDULING,
        exportType: ExportType.CSV,
        filters: { reportType, ...filters },
        fileName: `${reportType.toLowerCase()}-report.json`,
        recordCount,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        metadata: { note: 'JSON export placeholder; file generation pending' },
      });
    }
  }

  private visitOrderBy(
    query: ScheduleReportQueryDto,
  ): Prisma.ScheduledVisitOrderByWithRelationInput {
    const field = query.sortBy ?? 'scheduledStartDateTime';
    const allowed = ['scheduledStartDateTime', 'status', 'visitName'];
    if (!allowed.includes(field)) {
      throw new BadRequestException(`sortBy must be one of: ${allowed.join(', ')}`);
    }
    return { [field]: query.sortOrder ?? 'asc' };
  }

  private jobOrderBy(query: ScheduleReportQueryDto): Prisma.ScheduledJobOrderByWithRelationInput {
    const field = query.sortBy ?? 'scheduledStartDateTime';
    const allowed = ['scheduledStartDateTime', 'status', 'jobName'];
    if (!allowed.includes(field)) {
      throw new BadRequestException(`sortBy must be one of: ${allowed.join(', ')}`);
    }
    return { [field]: query.sortOrder ?? 'asc' };
  }

  async visitDetail(
    userId: string,
    query: ScheduleReportQueryDto,
    meta?: RequestAuditMeta,
    userPermissions?: string[],
  ) {
    this.assertExportPermission(query, userPermissions);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const where = buildScheduledVisitReportWhere(query);

    const [total, visits] = await this.prisma.$transaction([
      this.prisma.scheduledVisit.count({ where }),
      this.prisma.scheduledVisit.findMany({
        where,
        orderBy: this.visitOrderBy(query),
        skip,
        take: limit,
        include: visitDetailInclude,
      }),
    ]);

    const rows = visits.map((v) => ({
      scheduledVisitId: v.id,
      scheduledJobId: v.scheduledJobId,
      visitName: v.visitName,
      jobName: v.scheduledJob.jobName,
      serviceUser: v.serviceUser,
      scheduledStartDateTime: v.scheduledStartDateTime.toISOString(),
      scheduledEndDateTime: v.scheduledEndDateTime?.toISOString() ?? null,
      actualStartDateTime: v.actualStartDateTime?.toISOString() ?? null,
      actualEndDateTime: v.actualEndDateTime?.toISOString() ?? null,
      status: v.status,
      jobStatus: v.scheduledJob.status,
      notes: v.notes ?? v.scheduledJob.notes,
      scheduleRun: v.scheduledJob.scheduleRun,
      scheduleArea: v.scheduledJob.scheduleArea,
      assignedEmployees: v.allocations.map((a) => ({
        allocationId: a.id,
        status: a.status,
        employee: mapEmployeeBrief(a.employee),
      })),
    }));

    await this.logReportAccess(userId, ScheduleReportType.VISIT_DETAIL, query, meta, total);
    const exportMeta = query.export
      ? await this.exportHook.generateExportFile({
          reportType: ScheduleReportType.VISIT_DETAIL,
          format: 'CSV',
          rows,
        })
      : undefined;

    return {
      data: {
        reportType: ScheduleReportType.VISIT_DETAIL,
        supported: true,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        rows,
      },
      meta: buildPaginationMeta({ page, limit, total }),
      export: exportMeta,
    };
  }

  async dailyCarerAllocation(
    userId: string,
    query: ScheduleReportQueryDto,
    meta?: RequestAuditMeta,
    userPermissions?: string[],
  ) {
    this.assertExportPermission(query, userPermissions);
    parseReportDateRange(query);
    const jobWhere = buildScheduledJobReportWhere(query);

    const allocations = await this.prisma.jobAllocation.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
        scheduledJob: jobWhere,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            personalDetail: { select: { firstName: true, lastName: true, email: true } },
          },
        },
        scheduledJob: {
          include: {
            serviceUser: {
              select: { id: true, firstName: true, lastName: true, preferredName: true },
            },
            scheduleRun: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { allocatedAt: 'asc' },
    });

    type DayEntry = {
      date: string;
      jobs: Array<{
        scheduledJobId: string;
        jobName: string;
        serviceUser: (typeof allocations)[0]['scheduledJob']['serviceUser'];
        scheduledStartDateTime: string;
        scheduledEndDateTime: string | null;
        durationMinutes: number;
        scheduleRun: (typeof allocations)[0]['scheduledJob']['scheduleRun'];
      }>;
      totalMinutes: number;
    };

    const byEmployee = new Map<
      string,
      { employee: ReturnType<typeof mapEmployeeBrief>; days: Map<string, DayEntry> }
    >();

    for (const a of allocations) {
      const job = a.scheduledJob;
      const dateKey = job.scheduledStartDateTime.toISOString().slice(0, 10);
      if (!byEmployee.has(a.employeeId)) {
        byEmployee.set(a.employeeId, {
          employee: mapEmployeeBrief(a.employee),
          days: new Map(),
        });
      }
      const emp = byEmployee.get(a.employeeId)!;
      if (!emp.days.has(dateKey)) {
        emp.days.set(dateKey, { date: dateKey, jobs: [], totalMinutes: 0 });
      }
      const day = emp.days.get(dateKey)!;
      const mins = jobDurationMinutes(job);
      day.jobs.push({
        scheduledJobId: job.id,
        jobName: job.jobName,
        serviceUser: job.serviceUser,
        scheduledStartDateTime: job.scheduledStartDateTime.toISOString(),
        scheduledEndDateTime: job.scheduledEndDateTime?.toISOString() ?? null,
        durationMinutes: mins,
        scheduleRun: job.scheduleRun,
      });
      day.totalMinutes += mins;
    }

    const employees = [...byEmployee.values()].map((e) => ({
      employee: e.employee,
      days: [...e.days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      totalMinutes: [...e.days.values()].reduce((s, d) => s + d.totalMinutes, 0),
    }));

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const paged = employees.slice(skip, skip + limit);

    await this.logReportAccess(
      userId,
      ScheduleReportType.DAILY_CARER_ALLOCATION,
      query,
      meta,
      employees.length,
    );

    return {
      data: {
        reportType: ScheduleReportType.DAILY_CARER_ALLOCATION,
        supported: true,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        employees: paged,
      },
      meta: buildPaginationMeta({ page, limit, total: employees.length }),
      export: query.export
        ? await this.exportHook.generateExportFile({
            reportType: ScheduleReportType.DAILY_CARER_ALLOCATION,
            format: 'CSV',
            rows: paged,
          })
        : undefined,
    };
  }

  async callOffVisits(
    userId: string,
    query: ScheduleReportQueryDto,
    meta?: RequestAuditMeta,
    userPermissions?: string[],
  ) {
    this.assertExportPermission(query, userPermissions);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const where = buildCallOffVisitReportWhere(query);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.callOffVisit.count({ where }),
      this.prisma.callOffVisit.findMany({
        where,
        orderBy: { callOffDate: query.sortOrder ?? 'desc' },
        skip,
        take: limit,
        include: {
          serviceUser: {
            select: { id: true, firstName: true, lastName: true, preferredName: true },
          },
          scheduledJob: { select: { id: true, jobName: true, status: true } },
          scheduledVisit: { select: { id: true, visitName: true, status: true } },
          requestedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    const data = rows.map((r) => ({
      id: r.id,
      callOffDate: r.callOffDate.toISOString().slice(0, 10),
      reason: r.reason,
      notes: r.notes,
      status: r.status,
      serviceUser: r.serviceUser,
      scheduledJob: r.scheduledJob,
      scheduledVisit: r.scheduledVisit,
      requestedBy: r.requestedBy,
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt?.toISOString() ?? null,
    }));

    await this.logReportAccess(userId, ScheduleReportType.CALL_OFF_VISIT, query, meta, total);

    return {
      data: {
        reportType: ScheduleReportType.CALL_OFF_VISIT,
        supported: true,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        rows: data,
      },
      meta: buildPaginationMeta({ page, limit, total }),
      export: query.export
        ? await this.exportHook.generateExportFile({
            reportType: ScheduleReportType.CALL_OFF_VISIT,
            format: 'CSV',
            rows: data,
          })
        : undefined,
    };
  }

  async employeeCapacity(
    userId: string,
    query: ScheduleReportQueryDto,
    meta?: RequestAuditMeta,
    userPermissions?: string[],
  ) {
    this.assertExportPermission(query, userPermissions);
    const { from, to } = parseReportDateRange(query, 31);
    assertDateRangeMaxDays(from, to, 31);

    const page = query.page ?? 1;
    const limit = query.limit ?? 100;
    const skip = (page - 1) * limit;
    const empWhere: Prisma.EmployeeWhereInput = { deletedAt: null, isActive: true };
    if (query.employeeId) empWhere.id = query.employeeId;

    const jobWhere = buildScheduledJobReportWhere(query, 31);

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

        const pd = emp.personalDetail;
        return {
          employeeId: emp.id,
          employeeName: pd ? `${pd.firstName} ${pd.lastName}`.trim() : emp.id,
          contractedHours: emp.employment?.contractedWeeklyHours ?? null,
          maximumHours: emp.employment?.maximumWeeklyHours ?? null,
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

    await this.logReportAccess(userId, ScheduleReportType.EMPLOYEE_CAPACITY, query, meta, total);

    return {
      data: {
        reportType: ScheduleReportType.EMPLOYEE_CAPACITY,
        supported: true,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        rows,
      },
      meta: buildPaginationMeta({ page, limit, total }),
      export: query.export
        ? await this.exportHook.generateExportFile({
            reportType: ScheduleReportType.EMPLOYEE_CAPACITY,
            format: 'CSV',
            rows,
          })
        : undefined,
    };
  }

  async serviceUserVisits(
    userId: string,
    query: ScheduleReportQueryDto,
    meta?: RequestAuditMeta,
    userPermissions?: string[],
  ) {
    this.assertExportPermission(query, userPermissions);
    const where = buildScheduledVisitReportWhere(query);
    const visits = await this.prisma.scheduledVisit.findMany({
      where,
      orderBy: this.visitOrderBy(query),
      include: {
        serviceUser: {
          select: { id: true, firstName: true, lastName: true, preferredName: true },
        },
        allocations: {
          where: { deletedAt: null, isActive: true, status: { in: ACTIVE_ALLOCATION } },
          include: {
            employee: {
              select: {
                id: true,
                personalDetail: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    const bySu = new Map<
      string,
      {
        serviceUser: (typeof visits)[0]['serviceUser'];
        visits: Array<{
          scheduledVisitId: string;
          visitName: string;
          scheduledStartDateTime: string;
          scheduledEndDateTime: string | null;
          status: string;
          assignedCarers: Array<{ id: string; firstName: string; lastName: string }>;
        }>;
      }
    >();

    for (const v of visits) {
      if (!bySu.has(v.serviceUserId)) {
        bySu.set(v.serviceUserId, { serviceUser: v.serviceUser, visits: [] });
      }
      bySu.get(v.serviceUserId)!.visits.push({
        scheduledVisitId: v.id,
        visitName: v.visitName,
        scheduledStartDateTime: v.scheduledStartDateTime.toISOString(),
        scheduledEndDateTime: v.scheduledEndDateTime?.toISOString() ?? null,
        status: v.status,
        assignedCarers: v.allocations.map((a) => ({
          id: a.employee.id,
          firstName: a.employee.personalDetail?.firstName ?? '',
          lastName: a.employee.personalDetail?.lastName ?? '',
        })),
      });
    }

    const serviceUsers = [...bySu.values()];
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const paged = serviceUsers.slice(skip, skip + limit);

    await this.logReportAccess(
      userId,
      ScheduleReportType.SERVICE_USER_VISIT,
      query,
      meta,
      serviceUsers.length,
    );

    return {
      data: {
        reportType: ScheduleReportType.SERVICE_USER_VISIT,
        supported: true,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        serviceUsers: paged,
      },
      meta: buildPaginationMeta({ page, limit, total: serviceUsers.length }),
      export: query.export
        ? await this.exportHook.generateExportFile({
            reportType: ScheduleReportType.SERVICE_USER_VISIT,
            format: 'CSV',
            rows: paged,
          })
        : undefined,
    };
  }

  async serviceUserTimeAnalysis(
    userId: string,
    query: ScheduleReportQueryDto,
    meta?: RequestAuditMeta,
    userPermissions?: string[],
  ) {
    this.assertExportPermission(query, userPermissions);
    const where = buildScheduledVisitReportWhere(query);
    const visits = await this.prisma.scheduledVisit.findMany({
      where,
      select: {
        serviceUserId: true,
        status: true,
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        actualStartDateTime: true,
        actualEndDateTime: true,
        serviceUser: {
          select: { id: true, firstName: true, lastName: true, preferredName: true },
        },
      },
    });

    const bySu = new Map<
      string,
      {
        serviceUser: (typeof visits)[0]['serviceUser'];
        scheduledMinutes: number;
        completedMinutes: number;
        missedCount: number;
        cancelledCount: number;
        visitCount: number;
      }
    >();

    for (const v of visits) {
      if (!bySu.has(v.serviceUserId)) {
        bySu.set(v.serviceUserId, {
          serviceUser: v.serviceUser,
          scheduledMinutes: 0,
          completedMinutes: 0,
          missedCount: 0,
          cancelledCount: 0,
          visitCount: 0,
        });
      }
      const row = bySu.get(v.serviceUserId)!;
      row.visitCount += 1;
      const schedMins = jobDurationMinutes({
        scheduledStartDateTime: v.scheduledStartDateTime,
        scheduledEndDateTime: v.scheduledEndDateTime,
        estimatedDurationMinutes: null,
      });
      row.scheduledMinutes += schedMins;
      if (v.status === PrismaVisitStatus.MISSED) row.missedCount += 1;
      if (v.status === PrismaVisitStatus.CANCELLED || v.status === PrismaVisitStatus.CALLED_OFF) {
        row.cancelledCount += 1;
      }
      if (v.actualStartDateTime && v.actualEndDateTime) {
        row.completedMinutes += Math.max(
          1,
          Math.round((v.actualEndDateTime.getTime() - v.actualStartDateTime.getTime()) / 60_000),
        );
      } else if (v.status === PrismaVisitStatus.COMPLETED) {
        row.completedMinutes += schedMins;
      }
    }

    const rows = [...bySu.values()].map((r) => ({
      serviceUser: r.serviceUser,
      visitCount: r.visitCount,
      scheduledHours: Math.round((r.scheduledMinutes / 60) * 100) / 100,
      completedHours: Math.round((r.completedMinutes / 60) * 100) / 100,
      missedCount: r.missedCount,
      cancelledCount: r.cancelledCount,
    }));

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const paged = rows.slice(skip, skip + limit);

    await this.logReportAccess(
      userId,
      ScheduleReportType.SERVICE_USER_TIME_ANALYSIS,
      query,
      meta,
      rows.length,
    );

    return {
      data: {
        reportType: ScheduleReportType.SERVICE_USER_TIME_ANALYSIS,
        supported: true,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        rows: paged,
      },
      meta: buildPaginationMeta({ page, limit, total: rows.length }),
      export: query.export
        ? await this.exportHook.generateExportFile({
            reportType: ScheduleReportType.SERVICE_USER_TIME_ANALYSIS,
            format: 'CSV',
            rows: paged,
          })
        : undefined,
    };
  }

  async scheduledJobsStatus(
    userId: string,
    query: ScheduleReportQueryDto,
    meta?: RequestAuditMeta,
    userPermissions?: string[],
  ) {
    this.assertExportPermission(query, userPermissions);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const where = buildScheduledJobReportWhere(query);

    const [statusGroups, total, jobs] = await this.prisma.$transaction([
      this.prisma.scheduledJob.groupBy({
        by: ['status'],
        where,
        orderBy: { status: 'asc' },
        _count: { id: true },
      }),
      this.prisma.scheduledJob.count({ where }),
      this.prisma.scheduledJob.findMany({
        where,
        orderBy: this.jobOrderBy(query),
        skip,
        take: limit,
        include: {
          serviceUser: {
            select: { id: true, firstName: true, lastName: true, preferredName: true },
          },
          scheduleRun: { select: { id: true, name: true } },
          scheduleArea: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);

    const countsByStatus: Record<string, number> = {};
    for (const g of statusGroups) {
      const count =
        typeof g._count === 'object' && g._count && 'id' in g._count ? g._count.id ?? 0 : 0;
      countsByStatus[g.status] = count;
    }

    const jobRows = jobs.map((j) => ({
      id: j.id,
      jobName: j.jobName,
      status: j.status,
      serviceUser: j.serviceUser,
      scheduledStartDateTime: j.scheduledStartDateTime.toISOString(),
      scheduledEndDateTime: j.scheduledEndDateTime?.toISOString() ?? null,
      scheduleRun: j.scheduleRun,
      scheduleArea: j.scheduleArea,
    }));

    await this.logReportAccess(userId, ScheduleReportType.SCHEDULED_JOBS_STATUS, query, meta, total);

    return {
      data: {
        reportType: ScheduleReportType.SCHEDULED_JOBS_STATUS,
        supported: true,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        countsByStatus,
        jobs: jobRows,
      },
      meta: buildPaginationMeta({ page, limit, total }),
      export: query.export
        ? await this.exportHook.generateExportFile({
            reportType: ScheduleReportType.SCHEDULED_JOBS_STATUS,
            format: 'CSV',
            rows: jobRows,
          })
        : undefined,
    };
  }

  unsupportedPlaceholder(reportName: string) {
    return {
      data: {
        supported: false,
        message: 'This report requires future module integration.',
        reportName,
      },
    };
  }
}
