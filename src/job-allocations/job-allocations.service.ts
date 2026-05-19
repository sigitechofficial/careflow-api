import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AllocationStatus as PrismaAllocationStatus,
  Prisma,
  ScheduledJobStatus as PrismaJobStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ensureActiveEmployee } from '../scheduling/scheduling-validation.util';
import { AllocationChecksService } from './allocation-checks.service';
import { ScheduleAllocationNotificationHook } from './schedule-allocation-notification.hook';
import { AllocationQueryDto } from './dto/allocation-query.dto';
import { AllocateJobDto } from './dto/allocate-job.dto';
import { UnallocateJobDto } from './dto/unallocate-job.dto';
import { ConfirmAllocationDto } from './dto/confirm-allocation.dto';
const allocationInclude = {
  scheduledJob: {
    select: {
      id: true,
      jobName: true,
      serviceUserId: true,
      requiredCarers: true,
      status: true,
      scheduledStartDateTime: true,
    },
  },
  scheduledVisit: { select: { id: true, visitName: true } },
  employee: {
    select: {
      id: true,
      personalDetail: { select: { firstName: true, lastName: true, email: true } },
    },
  },
  allocatedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
  confirmedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
} satisfies Prisma.JobAllocationInclude;

const ACTIVE_STATUSES: PrismaAllocationStatus[] = [
  PrismaAllocationStatus.PENDING_CONFIRMATION,
  PrismaAllocationStatus.ALLOCATED,
  PrismaAllocationStatus.CONFIRMED,
];

@Injectable()
export class JobAllocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly checks: AllocationChecksService,
    private readonly notifications: ScheduleAllocationNotificationHook,
  ) {}

  private jobWindow(job: {
    scheduledStartDateTime: Date;
    scheduledEndDateTime: Date | null;
    estimatedDurationMinutes: number | null;
  }): { start: Date; end: Date } {
    const start = job.scheduledStartDateTime;
    const end =
      job.scheduledEndDateTime ??
      new Date(start.getTime() + (job.estimatedDurationMinutes ?? 60) * 60_000);
    return { start, end };
  }

  async list(query: AllocationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.JobAllocationWhereInput = { deletedAt: null };
    if (query.scheduledJobId) where.scheduledJobId = query.scheduledJobId;
    if (query.scheduledVisitId) where.scheduledVisitId = query.scheduledVisitId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status as PrismaAllocationStatus;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.jobAllocation.count({ where }),
      this.prisma.jobAllocation.findMany({
        where,
        orderBy: { allocatedAt: 'desc' },
        skip,
        take: limit,
        include: allocationInclude,
      }),
    ]);
    return {
      data: rows.map((r) => this.mapAllocation(r)),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async listForJob(scheduledJobId: string) {
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: scheduledJobId, deletedAt: null },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    const rows = await this.prisma.jobAllocation.findMany({
      where: { scheduledJobId, deletedAt: null },
      orderBy: { allocatedAt: 'desc' },
      include: allocationInclude,
    });
    return { data: rows.map((r) => this.mapAllocation(r)) };
  }

  async getById(id: string) {
    const row = await this.prisma.jobAllocation.findFirst({
      where: { id, deletedAt: null },
      include: allocationInclude,
    });
    if (!row) throw new NotFoundException('Job allocation not found');
    return { data: this.mapAllocation(row) };
  }

  private async assertNoDuplicateAllocation(scheduledJobId: string, employeeId: string) {
    const existing = await this.prisma.jobAllocation.findFirst({
      where: {
        scheduledJobId,
        employeeId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_STATUSES },
      },
    });
    if (existing) {
      throw new ConflictException('Employee is already actively allocated to this job');
    }
  }

  async syncJobAllocationStatus(
    tx: Prisma.TransactionClient,
    scheduledJobId: string,
    userId: string,
  ): Promise<PrismaJobStatus> {
    const job = await tx.scheduledJob.findUnique({ where: { id: scheduledJobId } });
    if (!job) return PrismaJobStatus.UNALLOCATED;

    const count = await tx.jobAllocation.count({
      where: {
        scheduledJobId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_STATUSES },
      },
    });

    let next: PrismaJobStatus;
    if (count >= job.requiredCarers) {
      next = PrismaJobStatus.ALLOCATED;
    } else if (count > 0) {
      next = PrismaJobStatus.UNALLOCATED;
    } else {
      next =
        job.status === PrismaJobStatus.ALLOCATED ? PrismaJobStatus.UNALLOCATED : job.status;
    }

    if (next !== job.status) {
      await tx.scheduledJob.update({
        where: { id: scheduledJobId },
        data: { status: next, updatedById: userId },
      });
    }
    return next;
  }

  async allocate(
    userId: string,
    scheduledJobId: string,
    dto: AllocateJobDto,
    meta?: RequestAuditMeta,
  ) {
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: scheduledJobId, deletedAt: null, isActive: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    await ensureActiveEmployee(this.prisma, dto.employeeId);
    await this.assertNoDuplicateAllocation(scheduledJobId, dto.employeeId);

    if (dto.scheduledVisitId) {
      const visit = await this.prisma.scheduledVisit.findFirst({
        where: { id: dto.scheduledVisitId, scheduledJobId, deletedAt: null },
      });
      if (!visit) throw new BadRequestException('Scheduled visit not found for this job');
    }

    const { start, end } = this.jobWindow(job);
    const warnings = await this.checks.runAllChecks({
      scheduledJobId,
      scheduledVisitId: dto.scheduledVisitId,
      employeeId: dto.employeeId,
      serviceUserId: job.serviceUserId,
      jobStart: start,
      jobEnd: end,
      jobMetadata: job.metadata,
    });

    const hasBlocking = this.checks.hasBlockingWarnings(warnings);
    if (hasBlocking && !dto.force) {
      throw new BadRequestException({
        message: 'Allocation blocked due to validation warnings. Use force=true to create pending confirmation.',
        warnings: warnings.map((w) => ({ type: w.type, message: w.message, severity: w.severity })),
        requiresConfirmation: true,
      });
    }

    const needsConfirmation = warnings.length > 0 && !dto.force;
    const status = needsConfirmation
      ? PrismaAllocationStatus.PENDING_CONFIRMATION
      : dto.force && warnings.length
        ? PrismaAllocationStatus.ALLOCATED
        : warnings.length === 0
          ? PrismaAllocationStatus.CONFIRMED
          : PrismaAllocationStatus.ALLOCATED;

    const previousJobStatus = job.status;
    const warningTypes = warnings.map((w) => w.type);
    const warningMessages = warnings.map((w) => w.message);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.jobAllocation.create({
        data: {
          scheduledJobId,
          scheduledVisitId: dto.scheduledVisitId ?? null,
          employeeId: dto.employeeId,
          status,
          requiresConfirmation: needsConfirmation,
          warningTypes: warningTypes.length ? warningTypes : undefined,
          warningMessages: warningMessages.length ? warningMessages : undefined,
          notes: dto.notes?.trim() ?? null,
          allocatedById: userId,
          confirmedAt: status === PrismaAllocationStatus.CONFIRMED ? new Date() : null,
          confirmedById: status === PrismaAllocationStatus.CONFIRMED ? userId : null,
        },
        include: allocationInclude,
      });

      const newJobStatus = await this.syncJobAllocationStatus(tx, scheduledJobId, userId);

      if (warnings.length) {
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SCHEDULING,
          action: AuditAction.ALLOCATION_WARNING_GENERATED,
          recordType: 'JobAllocation',
          recordId: created.id,
          metadata: {
            scheduledJobId,
            employeeId: dto.employeeId,
            serviceUserId: job.serviceUserId,
            warningTypes,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      }

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: needsConfirmation
          ? AuditAction.JOB_ALLOCATION_REQUIRES_CONFIRMATION
          : AuditAction.JOB_ALLOCATED,
        recordType: 'JobAllocation',
        recordId: created.id,
        newValues: auditSnapshot(created),
        metadata: {
          scheduledJobId,
          employeeId: dto.employeeId,
          serviceUserId: job.serviceUserId,
          warningTypes,
          previousJobStatus,
          newJobStatus,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      if (needsConfirmation) {
        void this.notifications.notifyRequiresConfirmation({
          scheduledJobId,
          jobName: job.jobName,
          employeeId: dto.employeeId,
        });
        void this.notifications.notifyJobNeedsAttention({
          scheduledJobId,
          jobName: job.jobName,
          serviceUserId: job.serviceUserId,
        });
      } else {
        void this.notifications.notifyAllocated({
          employeeId: dto.employeeId,
          scheduledJobId,
          jobName: job.jobName,
          serviceUserId: job.serviceUserId,
        });
      }

      return {
        message: needsConfirmation
          ? 'Allocation created — confirmation required'
          : 'Carer allocated to job',
        requiresConfirmation: needsConfirmation,
        warnings: warnings.map((w) => ({ type: w.type, message: w.message, severity: w.severity })),
        data: this.mapAllocation(created),
        jobStatus: newJobStatus,
      };
    });
  }

  async confirm(
    userId: string,
    scheduledJobId: string,
    allocationId: string,
    dto: ConfirmAllocationDto,
    meta?: RequestAuditMeta,
  ) {
    const allocation = await this.prisma.jobAllocation.findFirst({
      where: { id: allocationId, scheduledJobId, deletedAt: null },
      include: allocationInclude,
    });
    if (!allocation) throw new NotFoundException('Job allocation not found');
    if (allocation.status !== PrismaAllocationStatus.PENDING_CONFIRMATION) {
      throw new BadRequestException('Only pending allocations can be confirmed');
    }

    const previousJobStatus = allocation.scheduledJob.status;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.jobAllocation.update({
        where: { id: allocationId },
        data: {
          status: PrismaAllocationStatus.CONFIRMED,
          requiresConfirmation: false,
          confirmedAt: new Date(),
          confirmedById: userId,
          notes: dto.notes?.trim() ?? allocation.notes,
        },
        include: allocationInclude,
      });

      const newJobStatus = await this.syncJobAllocationStatus(tx, scheduledJobId, userId);

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.JOB_ALLOCATION_CONFIRMED,
        recordType: 'JobAllocation',
        recordId: allocationId,
        oldValues: auditSnapshot(allocation),
        newValues: auditSnapshot(updated),
        metadata: {
          scheduledJobId,
          employeeId: allocation.employeeId,
          serviceUserId: allocation.scheduledJob.serviceUserId,
          warningTypes: allocation.warningTypes,
          previousJobStatus,
          newJobStatus,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      void this.notifications.notifyAllocated({
        employeeId: allocation.employeeId,
        scheduledJobId,
        jobName: allocation.scheduledJob.jobName,
        serviceUserId: allocation.scheduledJob.serviceUserId,
      });

      return {
        message: 'Allocation confirmed',
        data: this.mapAllocation(updated),
        jobStatus: newJobStatus,
      };
    });
  }

  async unallocate(
    userId: string,
    scheduledJobId: string,
    dto: UnallocateJobDto,
    meta?: RequestAuditMeta,
  ) {
    const allocation = await this.prisma.jobAllocation.findFirst({
      where: {
        scheduledJobId,
        employeeId: dto.employeeId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_STATUSES },
      },
      include: allocationInclude,
    });
    if (!allocation) throw new NotFoundException('Active allocation not found for this employee');

    const previousJobStatus = allocation.scheduledJob.status;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.jobAllocation.update({
        where: { id: allocation.id },
        data: {
          status: PrismaAllocationStatus.UNALLOCATED,
          isActive: false,
          unallocatedAt: new Date(),
          unallocatedById: userId,
          unallocationReason: dto.reason?.trim() ?? null,
        },
        include: allocationInclude,
      });

      const newJobStatus = await this.syncJobAllocationStatus(tx, scheduledJobId, userId);

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.JOB_UNALLOCATED,
        recordType: 'JobAllocation',
        recordId: allocation.id,
        oldValues: auditSnapshot(allocation),
        newValues: auditSnapshot(updated),
        metadata: {
          scheduledJobId,
          employeeId: dto.employeeId,
          serviceUserId: allocation.scheduledJob.serviceUserId,
          previousJobStatus,
          newJobStatus,
          reason: dto.reason,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return {
        message: 'Carer unallocated from job',
        data: this.mapAllocation(updated),
        jobStatus: newJobStatus,
      };
    });
  }

  mapAllocation(row: Prisma.JobAllocationGetPayload<{ include: typeof allocationInclude }>) {
    return {
      id: row.id,
      scheduledJobId: row.scheduledJobId,
      scheduledVisitId: row.scheduledVisitId,
      employeeId: row.employeeId,
      status: row.status,
      requiresConfirmation: row.requiresConfirmation,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      confirmedBy: row.confirmedBy,
      warningTypes: row.warningTypes,
      warningMessages: row.warningMessages,
      notes: row.notes,
      allocatedAt: row.allocatedAt.toISOString(),
      allocatedBy: row.allocatedBy,
      unallocatedAt: row.unallocatedAt?.toISOString() ?? null,
      unallocationReason: row.unallocationReason,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      scheduledJob: row.scheduledJob,
      scheduledVisit: row.scheduledVisit,
      employee: row.employee,
    };
  }
}
