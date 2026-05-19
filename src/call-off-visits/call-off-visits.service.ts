import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AllocationStatus,
  CallOffVisitStatus as PrismaCallOffStatus,
  Prisma,
  ScheduledJobStatus as PrismaJobStatus,
  ScheduledVisitStatus as PrismaVisitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { utcDayBounds } from '../scheduling/schedule-date-range.util';
import { ensureActiveServiceUser } from '../scheduling/scheduling-validation.util';
import { CallOffVisitNotificationHook } from './call-off-visit-notification.hook';
import { CreateCallOffVisitDto } from './dto/create-call-off-visit.dto';
import { UpdateCallOffVisitDto } from './dto/update-call-off-visit.dto';
import { CallOffVisitQueryDto } from './dto/call-off-visit-query.dto';
import { CallOffVisitStatus } from './enums/call-off-status.enum';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const callOffInclude = {
  serviceUser: {
    select: { id: true, firstName: true, lastName: true, preferredName: true, serviceUserNumber: true },
  },
  scheduledJob: { select: { id: true, jobName: true, status: true, scheduledStartDateTime: true } },
  scheduledVisit: {
    select: { id: true, visitName: true, status: true, scheduledStartDateTime: true },
  },
  requestedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
} satisfies Prisma.CallOffVisitInclude;

type CallOffRow = Prisma.CallOffVisitGetPayload<{ include: typeof callOffInclude }>;

@Injectable()
export class CallOffVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: CallOffVisitNotificationHook,
  ) {}

  private mapCallOff(row: CallOffRow) {
    return {
      id: row.id,
      scheduledJobId: row.scheduledJobId,
      scheduledVisitId: row.scheduledVisitId,
      serviceUserId: row.serviceUserId,
      callOffDate: row.callOffDate.toISOString().slice(0, 10),
      reason: row.reason,
      notes: row.notes,
      status: row.status,
      requestedById: row.requestedById,
      approvedById: row.approvedById,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      serviceUser: row.serviceUser,
      scheduledJob: row.scheduledJob
        ? {
            ...row.scheduledJob,
            scheduledStartDateTime: row.scheduledJob.scheduledStartDateTime.toISOString(),
          }
        : null,
      scheduledVisit: row.scheduledVisit
        ? {
            ...row.scheduledVisit,
            scheduledStartDateTime: row.scheduledVisit.scheduledStartDateTime.toISOString(),
          }
        : null,
      requestedBy: row.requestedBy,
      approvedBy: row.approvedBy,
    };
  }

  private async resolveScheduleLinks(dto: CreateCallOffVisitDto): Promise<{
    scheduledJobId: string | null;
    scheduledVisitId: string | null;
    serviceUserId: string;
    jobName: string | null;
  }> {
    let scheduledJobId = dto.scheduledJobId ?? null;
    let scheduledVisitId = dto.scheduledVisitId ?? null;
    let serviceUserId = dto.serviceUserId;
    let jobName: string | null = null;

    if (scheduledVisitId) {
      const visit = await this.prisma.scheduledVisit.findFirst({
        where: { id: scheduledVisitId, deletedAt: null, isActive: true },
        include: { scheduledJob: { select: { id: true, jobName: true, serviceUserId: true } } },
      });
      if (!visit) throw new NotFoundException('Scheduled visit not found');
      scheduledJobId = visit.scheduledJobId;
      serviceUserId = visit.serviceUserId;
      jobName = visit.scheduledJob.jobName;
    }

    if (scheduledJobId) {
      const job = await this.prisma.scheduledJob.findFirst({
        where: { id: scheduledJobId, deletedAt: null, isActive: true },
      });
      if (!job) throw new NotFoundException('Scheduled job not found');
      serviceUserId = job.serviceUserId;
      jobName = job.jobName;
    }

    await ensureActiveServiceUser(this.prisma, serviceUserId);

    if (dto.serviceUserId !== serviceUserId) {
      throw new BadRequestException('serviceUserId does not match the linked schedule record');
    }

    return { scheduledJobId, scheduledVisitId, serviceUserId, jobName };
  }

  private async applyCallOffToSchedule(
    tx: Prisma.TransactionClient,
    userId: string,
    params: { scheduledJobId: string | null; scheduledVisitId: string | null },
  ): Promise<string[]> {
    const employeeIds: string[] = [];

    if (params.scheduledVisitId) {
      await tx.scheduledVisit.update({
        where: { id: params.scheduledVisitId },
        data: { status: PrismaVisitStatus.CALLED_OFF, updatedById: userId },
      });
    }

    if (params.scheduledJobId) {
      await tx.scheduledJob.update({
        where: { id: params.scheduledJobId },
        data: { status: PrismaJobStatus.CALLED_OFF, updatedById: userId },
      });

      await tx.scheduledVisit.updateMany({
        where: { scheduledJobId: params.scheduledJobId, deletedAt: null, isActive: true },
        data: { status: PrismaVisitStatus.CALLED_OFF, updatedById: userId },
      });

      const allocations = await tx.jobAllocation.findMany({
        where: {
          scheduledJobId: params.scheduledJobId,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
        },
        select: { employeeId: true },
      });
      employeeIds.push(...allocations.map((a) => a.employeeId));
    }

    return employeeIds;
  }

  async list(query: CallOffVisitQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.CallOffVisitWhereInput = { deletedAt: null, isActive: true };
    if (query.serviceUserId) where.serviceUserId = query.serviceUserId;
    if (query.scheduledJobId) where.scheduledJobId = query.scheduledJobId;
    if (query.status) where.status = query.status as PrismaCallOffStatus;
    if (query.dateFrom || query.dateTo) {
      where.callOffDate = {};
      if (query.dateFrom) where.callOffDate.gte = utcDayBounds(query.dateFrom).start;
      if (query.dateTo) where.callOffDate.lte = utcDayBounds(query.dateTo).end;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.callOffVisit.count({ where }),
      this.prisma.callOffVisit.findMany({
        where,
        orderBy: { callOffDate: 'desc' },
        skip,
        take: limit,
        include: callOffInclude,
      }),
    ]);

    return { data: rows.map((r) => this.mapCallOff(r)), meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.callOffVisit.findFirst({
      where: { id, deletedAt: null },
      include: callOffInclude,
    });
    if (!row) throw new NotFoundException('Call-off visit not found');
    return { data: this.mapCallOff(row) };
  }

  async create(userId: string, dto: CreateCallOffVisitDto, meta?: RequestAuditMeta) {
    const links = await this.resolveScheduleLinks(dto);
    const callOffDate = utcDayBounds(dto.callOffDate).start;

    const created = await this.prisma.callOffVisit.create({
      data: {
        scheduledJobId: links.scheduledJobId,
        scheduledVisitId: links.scheduledVisitId,
        serviceUserId: links.serviceUserId,
        callOffDate,
        reason: dto.reason.trim(),
        notes: dto.notes?.trim() ?? null,
        status: PrismaCallOffStatus.REQUESTED,
        requestedById: userId,
      },
      include: callOffInclude,
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.CALL_OFF_VISIT_CREATED,
      recordType: 'CallOffVisit',
      recordId: created.id,
      newValues: auditSnapshot(created),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    await this.notifications.notifyCallOffCreated({
      callOffVisitId: created.id,
      serviceUserId: links.serviceUserId,
      reason: dto.reason,
      jobName: links.jobName,
    });

    return { message: 'Call-off visit created', data: this.mapCallOff(created) };
  }

  async update(userId: string, id: string, dto: UpdateCallOffVisitDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.callOffVisit.findFirst({
      where: { id, deletedAt: null },
      include: callOffInclude,
    });
    if (!existing) throw new NotFoundException('Call-off visit not found');
    if (existing.status === PrismaCallOffStatus.APPROVED) {
      throw new BadRequestException('Approved call-off visits cannot be edited');
    }

    const data: Prisma.CallOffVisitUpdateInput = {};
    if (dto.callOffDate) data.callOffDate = utcDayBounds(dto.callOffDate).start;
    if (dto.reason !== undefined) data.reason = dto.reason.trim();
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() ?? null;
    if (dto.status !== undefined) {
      if (dto.status === CallOffVisitStatus.APPROVED || dto.status === CallOffVisitStatus.REJECTED) {
        throw new BadRequestException('Use approve or reject endpoints to change approval status');
      }
      data.status = dto.status as PrismaCallOffStatus;
    }

    const updated = await this.prisma.callOffVisit.update({
      where: { id },
      data,
      include: callOffInclude,
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.CALL_OFF_VISIT_UPDATED,
      recordType: 'CallOffVisit',
      recordId: id,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Call-off visit updated', data: this.mapCallOff(updated) };
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.callOffVisit.findFirst({
      where: { id, deletedAt: null },
      include: callOffInclude,
    });
    if (!existing) throw new NotFoundException('Call-off visit not found');

    const deleted = await this.prisma.callOffVisit.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
      include: callOffInclude,
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.CALL_OFF_VISIT_DELETED,
      recordType: 'CallOffVisit',
      recordId: id,
      oldValues: auditSnapshot(existing),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Call-off visit deleted', data: this.mapCallOff(deleted) };
  }

  async approve(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.callOffVisit.findFirst({
      where: { id, deletedAt: null, isActive: true },
      include: callOffInclude,
    });
    if (!existing) throw new NotFoundException('Call-off visit not found');
    if (existing.status !== PrismaCallOffStatus.REQUESTED) {
      throw new BadRequestException(`Cannot approve call-off in status ${existing.status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const employeeIds = await this.applyCallOffToSchedule(tx, userId, {
        scheduledJobId: existing.scheduledJobId,
        scheduledVisitId: existing.scheduledVisitId,
      });

      const updated = await tx.callOffVisit.update({
        where: { id },
        data: {
          status: PrismaCallOffStatus.APPROVED,
          approvedById: userId,
          approvedAt: new Date(),
        },
        include: callOffInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.CALL_OFF_VISIT_APPROVED,
        recordType: 'CallOffVisit',
        recordId: id,
        oldValues: auditSnapshot({ status: existing.status }),
        newValues: auditSnapshot({ status: updated.status }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      if (existing.scheduledJobId && employeeIds.length) {
        await this.notifications.notifyJobCalledOff({
          scheduledJobId: existing.scheduledJobId,
          jobName: existing.scheduledJob?.jobName ?? 'Scheduled job',
          employeeIds,
        });
      }

      return { message: 'Call-off visit approved', data: this.mapCallOff(updated) };
    });
  }

  async reject(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.callOffVisit.findFirst({
      where: { id, deletedAt: null, isActive: true },
    });
    if (!existing) throw new NotFoundException('Call-off visit not found');
    if (existing.status !== PrismaCallOffStatus.REQUESTED) {
      throw new BadRequestException(`Cannot reject call-off in status ${existing.status}`);
    }

    const updated = await this.prisma.callOffVisit.update({
      where: { id },
      data: { status: PrismaCallOffStatus.REJECTED, approvedById: userId, approvedAt: new Date() },
      include: callOffInclude,
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.CALL_OFF_VISIT_REJECTED,
      recordType: 'CallOffVisit',
      recordId: id,
      oldValues: auditSnapshot({ status: existing.status }),
      newValues: auditSnapshot({ status: updated.status }),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Call-off visit rejected', data: this.mapCallOff(updated) };
  }
}
