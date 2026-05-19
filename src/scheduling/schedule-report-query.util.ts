import { BadRequestException } from '@nestjs/common';
import { Prisma, ScheduledJobStatus, ScheduledVisitStatus } from '@prisma/client';
import { assertDateRangeMaxDays, utcDayBounds } from './schedule-date-range.util';
import type { ScheduleReportQueryDto } from '../schedule-reports/dto/schedule-report-query.dto';

const CANCELLED_JOB_STATUSES: ScheduledJobStatus[] = [
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
];

const CANCELLED_VISIT_STATUSES: ScheduledVisitStatus[] = [
  ScheduledVisitStatus.CANCELLED,
  ScheduledVisitStatus.CALLED_OFF,
];

export function parseReportDateRange(
  query: Pick<ScheduleReportQueryDto, 'dateFrom' | 'dateTo'>,
  maxDays = 93,
): { from: Date; to: Date } {
  const from = utcDayBounds(query.dateFrom).start;
  const to = utcDayBounds(query.dateTo).end;
  if (from > to) throw new BadRequestException('dateFrom must be on or before dateTo');
  assertDateRangeMaxDays(from, to, maxDays);
  return { from, to };
}

export function buildScheduleAreaFilter(
  query: Pick<ScheduleReportQueryDto, 'scheduleAreaId' | 'zoneId' | 'locationId'>,
): Prisma.ScheduleAreaWhereInput | undefined {
  if (!query.scheduleAreaId && !query.zoneId && !query.locationId) return undefined;
  const area: Prisma.ScheduleAreaWhereInput = { deletedAt: null };
  if (query.scheduleAreaId) area.id = query.scheduleAreaId;
  if (query.zoneId) area.zoneId = query.zoneId;
  if (query.locationId) area.locationId = query.locationId;
  return area;
}

export function buildScheduledJobReportWhere(
  query: ScheduleReportQueryDto,
  maxDays = 93,
): Prisma.ScheduledJobWhereInput {
  const { from, to } = parseReportDateRange(query, maxDays);
  const where: Prisma.ScheduledJobWhereInput = {
    deletedAt: null,
    isActive: true,
    scheduledStartDateTime: { gte: from, lte: to },
  };

  if (query.scheduleBatchId) where.scheduleBatchId = query.scheduleBatchId;
  if (query.scheduleAreaId) where.scheduleAreaId = query.scheduleAreaId;
  if (query.serviceUserId) where.serviceUserId = query.serviceUserId;

  const areaFilter = buildScheduleAreaFilter(query);
  if (areaFilter) where.scheduleArea = areaFilter;

  if (query.status) {
    where.status = query.status as ScheduledJobStatus;
  } else if (!query.includeCancelled) {
    where.status = { notIn: CANCELLED_JOB_STATUSES };
  }

  if (query.employeeId) {
    where.allocations = {
      some: {
        employeeId: query.employeeId,
        deletedAt: null,
        isActive: true,
      },
    };
  }

  return where;
}

export function buildScheduledVisitReportWhere(
  query: ScheduleReportQueryDto,
  maxDays = 93,
): Prisma.ScheduledVisitWhereInput {
  const { from, to } = parseReportDateRange(query, maxDays);
  const jobFilter = buildScheduledJobReportWhere(query, maxDays);

  const where: Prisma.ScheduledVisitWhereInput = {
    deletedAt: null,
    isActive: true,
    scheduledStartDateTime: { gte: from, lte: to },
    scheduledJob: jobFilter,
  };

  if (query.serviceUserId) where.serviceUserId = query.serviceUserId;

  if (!query.includeCancelled && !query.status) {
    where.status = { notIn: CANCELLED_VISIT_STATUSES };
  }

  return where;
}

export function buildCallOffVisitReportWhere(
  query: ScheduleReportQueryDto,
  maxDays = 93,
): Prisma.CallOffVisitWhereInput {
  const { from, to } = parseReportDateRange(query, maxDays);
  const where: Prisma.CallOffVisitWhereInput = {
    deletedAt: null,
    isActive: true,
    callOffDate: { gte: from, lte: to },
  };
  if (query.serviceUserId) where.serviceUserId = query.serviceUserId;

  const jobLink: Prisma.ScheduledJobWhereInput = { deletedAt: null };
  if (query.scheduleBatchId) jobLink.scheduleBatchId = query.scheduleBatchId;
  const areaFilter = buildScheduleAreaFilter(query);
  if (areaFilter) jobLink.scheduleArea = areaFilter;
  if (query.scheduleBatchId || areaFilter) {
    where.scheduledJob = jobLink;
  }

  return where;
}
