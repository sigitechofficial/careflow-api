import { Injectable } from '@nestjs/common';
import { AllocationStatus, Prisma, ScheduledJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { utcDayBounds } from '../scheduling/schedule-date-range.util';
import { mapTimelineJob, timelineJobInclude } from '../scheduling/schedule-timeline.mapper';
import { jobDurationMinutes } from '../scheduling/schedule-date-range.util';
import { FilterJobsDto } from './dto/filter-jobs.dto';
import { FilterCarersDto } from './dto/filter-carers.dto';
import { FilterCustomersDto } from './dto/filter-customers.dto';

const ACTIVE_ALLOCATION = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

@Injectable()
export class ScheduleFiltersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async filterJobs(userId: string, dto: FilterJobsDto, meta?: RequestAuditMeta) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const skip = (page - 1) * limit;
    const where: Prisma.ScheduledJobWhereInput = { deletedAt: null, isActive: true };

    if (dto.serviceUserIds?.length) where.serviceUserId = { in: dto.serviceUserIds };
    if (dto.scheduleBatchId) where.scheduleBatchId = dto.scheduleBatchId;
    if (dto.status) where.status = dto.status as ScheduledJobStatus;
    if (dto.postcode?.trim()) where.postcode = { contains: dto.postcode.trim(), mode: 'insensitive' };
    if (dto.timePeriodColors?.length) where.timePeriodColor = { in: dto.timePeriodColors };
    if (dto.date) {
      const { start, end } = utcDayBounds(dto.date);
      where.scheduledStartDateTime = { gte: start, lte: end };
    }

    const orderBy: Prisma.ScheduledJobOrderByWithRelationInput | Prisma.ScheduledJobOrderByWithRelationInput[] =
      dto.sortBy === 'serviceUser'
        ? [{ serviceUser: { lastName: 'asc' } }, { scheduledStartDateTime: 'asc' }]
        : { scheduledStartDateTime: 'asc' };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduledJob.count({ where }),
      this.prisma.scheduledJob.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: timelineJobInclude,
      }),
    ]);

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.SCHEDULE_FILTER_JOBS_APPLIED,
      metadata: { filters: dto, total },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: rows.map(mapTimelineJob),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async filterCarers(userId: string, dto: FilterCarersDto, meta?: RequestAuditMeta) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const skip = (page - 1) * limit;

    const empWhere: Prisma.EmployeeWhereInput = { deletedAt: null, isActive: true };
    if (dto.employeeIds?.length) empWhere.id = { in: dto.employeeIds };

    const employmentFilter: Prisma.EmployeeEmploymentWhereInput = { deletedAt: null };
    if (dto.roleIds?.length) employmentFilter.roleId = { in: dto.roleIds };
    if (dto.designationIds?.length) employmentFilter.jobTitleId = { in: dto.designationIds };
    if (dto.employed === true) {
      employmentFilter.isBankStaff = false;
      employmentFilter.isAgencyStaff = false;
    }
    if (dto.bankStaff === true) employmentFilter.isBankStaff = true;
    if (dto.agencyStaff === true) employmentFilter.isAgencyStaff = true;
    if (
      dto.roleIds?.length ||
      dto.designationIds?.length ||
      dto.employed !== undefined ||
      dto.bankStaff !== undefined ||
      dto.agencyStaff !== undefined
    ) {
      empWhere.employment = employmentFilter;
    }

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
        },
      }),
    ]);

    let dayStart: Date | undefined;
    let dayEnd: Date | undefined;
    if (dto.date) {
      ({ start: dayStart, end: dayEnd } = utcDayBounds(dto.date));
    }

    const data = await Promise.all(
      employees.map(async (emp) => {
        const jobWhere: Prisma.ScheduledJobWhereInput = {
          deletedAt: null,
          isActive: true,
          allocations: {
            some: {
              employeeId: emp.id,
              deletedAt: null,
              isActive: true,
              status: { in: ACTIVE_ALLOCATION },
            },
          },
        };
        if (dto.scheduleBatchId) jobWhere.scheduleBatchId = dto.scheduleBatchId;
        if (dayStart && dayEnd) jobWhere.scheduledStartDateTime = { gte: dayStart, lte: dayEnd };

        const assignedJobs = await this.prisma.scheduledJob.findMany({
          where: jobWhere,
          include: timelineJobInclude,
          orderBy: { scheduledStartDateTime: 'asc' },
          take: 50,
        });

        const totalMinutes = assignedJobs.reduce((sum, j) => sum + jobDurationMinutes(j), 0);
        const employment = emp.employment;
        const maxHours = employment?.maximumWeeklyHours ?? employment?.contractedWeeklyHours ?? null;

        let available = true;
        if (dto.availableOnly && maxHours && dayStart) {
          available = totalMinutes / 60 < maxHours / 7;
        }

        if (dto.availableOnly && !available) return null;

        return {
          employee: {
            id: emp.id,
            firstName: emp.personalDetail?.firstName,
            lastName: emp.personalDetail?.lastName,
            email: emp.personalDetail?.email,
            role: employment?.role,
            jobTitle: employment?.jobTitle,
            isBankStaff: employment?.isBankStaff,
            isAgencyStaff: employment?.isAgencyStaff,
          },
          assignedJobs: assignedJobs.map(mapTimelineJob),
          capacitySummary: {
            assignedMinutes: totalMinutes,
            contractedWeeklyHours: employment?.contractedWeeklyHours,
            maximumWeeklyHours: employment?.maximumWeeklyHours,
          },
        };
      }),
    );

    const filtered = data.filter(Boolean);

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.SCHEDULE_FILTER_CARERS_APPLIED,
      metadata: { filters: dto, total },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: filtered,
      meta: buildPaginationMeta({ page, limit, total: dto.availableOnly ? filtered.length : total }),
    };
  }

  async filterCustomers(userId: string, dto: FilterCustomersDto, meta?: RequestAuditMeta) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const skip = (page - 1) * limit;
    const where: Prisma.ServiceUserWhereInput = { deletedAt: null, isActive: true };

    if (dto.serviceUserIds?.length) where.id = { in: dto.serviceUserIds };
    if (dto.statusId) where.statusId = dto.statusId;
    if (dto.locationId) where.locationId = dto.locationId;
    if (dto.keyWorkerId) where.keyWorkerId = dto.keyWorkerId;
    if (dto.namedNurseId) where.namedNurseId = dto.namedNurseId;
    if (dto.search?.trim()) {
      const s = dto.search.trim();
      where.OR = [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { preferredName: { contains: s, mode: 'insensitive' } },
        { serviceUserNumber: { contains: s, mode: 'insensitive' } },
      ];
    }
    if (dto.postcode?.trim()) {
      where.address = { postcode: { contains: dto.postcode.trim(), mode: 'insensitive' } };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.serviceUser.count({ where }),
      this.prisma.serviceUser.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          serviceUserNumber: true,
          statusId: true,
          locationId: true,
          keyWorkerId: true,
          namedNurseId: true,
          status: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          address: { select: { postcode: true, town: true } },
        },
      }),
    ]);

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.SCHEDULE_FILTER_CUSTOMERS_APPLIED,
      metadata: { filters: dto, total },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: rows,
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }
}
