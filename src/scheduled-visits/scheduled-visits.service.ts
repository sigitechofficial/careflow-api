import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ScheduledVisitStatus as PrismaVisitStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  assertDateRange,
  assertRequiredCarers,
  ensureActiveServiceUser,
  parseIsoDateTime,
} from '../scheduling/scheduling-validation.util';
import { ScheduledJobsService } from '../scheduled-jobs/scheduled-jobs.service';
import { ScheduledVisitQueryDto } from './dto/scheduled-visit-query.dto';
import { CreateScheduledVisitDto } from './dto/create-scheduled-visit.dto';
import { UpdateScheduledVisitDto } from './dto/update-scheduled-visit.dto';
import { UpdateScheduledVisitStatusDto } from './dto/update-scheduled-visit-status.dto';
import { ScheduledVisitStatus } from './enums/scheduled-visit-status.enum';

const visitInclude = {
  scheduledJob: {
    select: { id: true, jobName: true, scheduleBatchId: true, status: true },
  },
  serviceUser: {
    select: { id: true, firstName: true, lastName: true, preferredName: true },
  },
} satisfies Prisma.ScheduledVisitInclude;

@Injectable()
export class ScheduledVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly scheduledJobsService: ScheduledJobsService,
  ) {}

  async list(query: ScheduledVisitQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.ScheduledVisitWhereInput = { deletedAt: null, isActive: true };
    if (query.scheduledJobId) where.scheduledJobId = query.scheduledJobId;
    if (query.serviceUserId) where.serviceUserId = query.serviceUserId;
    const allowedStatuses = new Set(Object.values(ScheduledVisitStatus));
    const statusList = (query.statuses ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is PrismaVisitStatus => allowedStatuses.has(s as ScheduledVisitStatus));
    if (statusList.length > 0) {
      where.status = { in: statusList };
    } else if (query.status) {
      where.status = query.status as PrismaVisitStatus;
    }
    if (query.dateFrom || query.dateTo) {
      where.scheduledStartDateTime = {};
      if (query.dateFrom) where.scheduledStartDateTime.gte = parseIsoDateTime(query.dateFrom, 'dateFrom');
      if (query.dateTo) where.scheduledStartDateTime.lte = parseIsoDateTime(query.dateTo, 'dateTo');
    }
    const orderBy: Prisma.ScheduledVisitOrderByWithRelationInput = {
      [query.sortBy ?? 'scheduledStartDateTime']: query.sortOrder ?? 'asc',
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduledVisit.count({ where }),
      this.prisma.scheduledVisit.findMany({ where, orderBy, skip, take: limit, include: visitInclude }),
    ]);
    return { data: rows.map((r) => this.mapVisit(r)), meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.scheduledVisit.findFirst({
      where: { id, deletedAt: null },
      include: visitInclude,
    });
    if (!row) throw new NotFoundException('Scheduled visit not found');
    return { data: this.mapVisit(row) };
  }

  private async ensureJob(jobId: string) {
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null, isActive: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    return job;
  }

  async create(userId: string, dto: CreateScheduledVisitDto, meta?: RequestAuditMeta) {
    const job = await this.ensureJob(dto.scheduledJobId);
    if (dto.serviceUserId !== job.serviceUserId) {
      throw new BadRequestException('serviceUserId must match the scheduled job service user');
    }
    const start = parseIsoDateTime(dto.scheduledStartDateTime, 'scheduledStartDateTime');
    const end = dto.scheduledEndDateTime
      ? parseIsoDateTime(dto.scheduledEndDateTime, 'scheduledEndDateTime')
      : null;
    assertDateRange(start, end);
    assertRequiredCarers(dto.requiredCarers ?? 1);
    await ensureActiveServiceUser(this.prisma, dto.serviceUserId);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.scheduledVisit.create({
        data: {
          scheduledJobId: dto.scheduledJobId,
          serviceUserId: dto.serviceUserId,
          visitName: dto.visitName.trim(),
          scheduledStartDateTime: start,
          scheduledEndDateTime: end,
          status: (dto.status ?? 'PLANNED') as PrismaVisitStatus,
          requiredCarers: dto.requiredCarers ?? 1,
          notes: dto.notes?.trim() ?? null,
          medicationRequired: dto.medicationRequired ?? false,
          checklistRequired: dto.checklistRequired ?? false,
          photoRequired: dto.photoRequired ?? false,
          notesRequired: dto.notesRequired ?? false,
          createdById: userId,
        },
        include: visitInclude,
      });
      await this.scheduledJobsService.syncJobStatusFromVisits(tx, dto.scheduledJobId, userId);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_VISIT_CREATED,
        recordType: 'ScheduledVisit',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Scheduled visit created', data: this.mapVisit(created) };
    });
  }

  async update(userId: string, id: string, dto: UpdateScheduledVisitDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduledVisit.findFirst({
      where: { id, deletedAt: null },
      include: visitInclude,
    });
    if (!existing) throw new NotFoundException('Scheduled visit not found');

    const start = dto.scheduledStartDateTime
      ? parseIsoDateTime(dto.scheduledStartDateTime, 'scheduledStartDateTime')
      : existing.scheduledStartDateTime;
    const end =
      dto.scheduledEndDateTime !== undefined
        ? dto.scheduledEndDateTime
          ? parseIsoDateTime(dto.scheduledEndDateTime, 'scheduledEndDateTime')
          : null
        : existing.scheduledEndDateTime;
    assertDateRange(start, end);
    if (dto.requiredCarers !== undefined) assertRequiredCarers(dto.requiredCarers);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.scheduledVisit.update({
        where: { id },
        data: {
          ...(dto.visitName !== undefined ? { visitName: dto.visitName.trim() } : {}),
          ...(dto.scheduledStartDateTime !== undefined ? { scheduledStartDateTime: start } : {}),
          ...(dto.scheduledEndDateTime !== undefined ? { scheduledEndDateTime: end } : {}),
          ...(dto.status !== undefined ? { status: dto.status as PrismaVisitStatus } : {}),
          ...(dto.requiredCarers !== undefined ? { requiredCarers: dto.requiredCarers } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes?.trim() ?? null } : {}),
          ...(dto.medicationRequired !== undefined ? { medicationRequired: dto.medicationRequired } : {}),
          ...(dto.checklistRequired !== undefined ? { checklistRequired: dto.checklistRequired } : {}),
          ...(dto.photoRequired !== undefined ? { photoRequired: dto.photoRequired } : {}),
          ...(dto.notesRequired !== undefined ? { notesRequired: dto.notesRequired } : {}),
          updatedById: userId,
        },
        include: visitInclude,
      });
      await this.scheduledJobsService.syncJobStatusFromVisits(tx, existing.scheduledJobId, userId);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_VISIT_UPDATED,
        recordType: 'ScheduledVisit',
        recordId: id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Scheduled visit updated', data: this.mapVisit(updated) };
    });
  }

  async updateStatus(
    userId: string,
    id: string,
    dto: UpdateScheduledVisitStatusDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.scheduledVisit.findFirst({
      where: { id, deletedAt: null },
      include: visitInclude,
    });
    if (!existing) throw new NotFoundException('Scheduled visit not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.scheduledVisit.update({
        where: { id },
        data: {
          status: dto.status as PrismaVisitStatus,
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          ...(dto.status === ScheduledVisitStatus.STARTED ? { actualStartDateTime: new Date() } : {}),
          ...(dto.status === ScheduledVisitStatus.COMPLETED ? { actualEndDateTime: new Date() } : {}),
          updatedById: userId,
        },
        include: visitInclude,
      });
      await this.scheduledJobsService.syncJobStatusFromVisits(tx, existing.scheduledJobId, userId);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_VISIT_STATUS_CHANGED,
        recordType: 'ScheduledVisit',
        recordId: id,
        oldValues: auditSnapshot({ status: existing.status }),
        newValues: auditSnapshot({ status: updated.status }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Scheduled visit status updated', data: this.mapVisit(updated) };
    });
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduledVisit.findFirst({
      where: { id, deletedAt: null },
      include: visitInclude,
    });
    if (!existing) throw new NotFoundException('Scheduled visit not found');

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.scheduledVisit.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false, updatedById: userId },
        include: visitInclude,
      });
      await this.scheduledJobsService.syncJobStatusFromVisits(tx, existing.scheduledJobId, userId);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_VISIT_DELETED,
        recordType: 'ScheduledVisit',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Scheduled visit deleted', data: this.mapVisit(deleted) };
    });
  }

  mapVisit(row: Prisma.ScheduledVisitGetPayload<{ include: typeof visitInclude }>) {
    return {
      id: row.id,
      scheduledJobId: row.scheduledJobId,
      serviceUserId: row.serviceUserId,
      visitName: row.visitName,
      scheduledStartDateTime: row.scheduledStartDateTime.toISOString(),
      scheduledEndDateTime: row.scheduledEndDateTime?.toISOString() ?? null,
      actualStartDateTime: row.actualStartDateTime?.toISOString() ?? null,
      actualEndDateTime: row.actualEndDateTime?.toISOString() ?? null,
      status: row.status,
      requiredCarers: row.requiredCarers,
      notes: row.notes,
      medicationRequired: row.medicationRequired,
      checklistRequired: row.checklistRequired,
      photoRequired: row.photoRequired,
      notesRequired: row.notesRequired,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      scheduledJob: row.scheduledJob,
      serviceUser: row.serviceUser,
    };
  }
}
