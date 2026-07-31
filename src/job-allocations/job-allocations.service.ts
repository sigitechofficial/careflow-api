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
import {
  ensureActiveEmployee,
  parseIsoDateTime,
} from '../scheduling/scheduling-validation.util';
import { AllocationChecksService } from './allocation-checks.service';
import { CARER_ROTA_CONFLICT_MESSAGE } from '../service-user-visit-plans/visit-carer-rota-conflict.util';
import { ScheduleAllocationNotificationHook } from './schedule-allocation-notification.hook';
import { AllocationQueryDto } from './dto/allocation-query.dto';
import { AllocateJobDto } from './dto/allocate-job.dto';
import { UnallocateJobDto } from './dto/unallocate-job.dto';
import { ConfirmAllocationDto } from './dto/confirm-allocation.dto';
import { UpdateAllocationTimingDto } from './dto/update-allocation-timing.dto';
import {
  durationMinutesBetween,
  isInheritedAllocationTiming,
  resolveAllocationWindow,
  resolveVisitWindow,
  validateAllocationTimingWithinVisit,
} from './allocation-window.util';

const allocationInclude = {
  scheduledJob: {
    select: {
      id: true,
      jobName: true,
      serviceUserId: true,
      requiredCarers: true,
      status: true,
      scheduledStartDateTime: true,
      scheduledEndDateTime: true,
      estimatedDurationMinutes: true,
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
    return resolveVisitWindow(job);
  }

  private resolveAssignmentTimesFromDto(
    job: {
      scheduledStartDateTime: Date;
      scheduledEndDateTime: Date | null;
      estimatedDurationMinutes: number | null;
    },
    dto: {
      scheduledStartDateTime?: string;
      scheduledEndDateTime?: string;
    },
    carerLabel?: string,
  ): { start: Date; end: Date; durationMinutes: number } {
    const envelope = this.jobWindow(job);
    const hasStart = dto.scheduledStartDateTime != null && dto.scheduledStartDateTime !== '';
    const hasEnd = dto.scheduledEndDateTime != null && dto.scheduledEndDateTime !== '';
    if (hasStart !== hasEnd) {
      throw new BadRequestException(
        'Both scheduledStartDateTime and scheduledEndDateTime are required when setting assignment timing',
      );
    }
    const start = hasStart
      ? parseIsoDateTime(dto.scheduledStartDateTime!, 'scheduledStartDateTime')
      : envelope.start;
    const end = hasEnd
      ? parseIsoDateTime(dto.scheduledEndDateTime!, 'scheduledEndDateTime')
      : envelope.end;
    const errors = validateAllocationTimingWithinVisit({
      assignmentStart: start,
      assignmentEnd: end,
      visitStart: envelope.start,
      visitEnd: envelope.end,
      carerLabel,
    });
    if (errors.length) {
      throw new BadRequestException({
        message: errors[0]!.message,
        errors: errors.map((e) => ({ property: e.field, message: e.message })),
      });
    }
    return { start, end, durationMinutes: durationMinutesBetween(start, end) };
  }

  /**
   * When the job visit window changes: update inherited allocations to the new
   * window; reject if a customized assignment falls outside the new window.
   */
  async syncAllocationTimingsToJobWindow(
    tx: Prisma.TransactionClient,
    params: {
      scheduledJobId: string;
      previousJob: {
        scheduledStartDateTime: Date;
        scheduledEndDateTime: Date | null;
        estimatedDurationMinutes: number | null;
      };
      nextJob: {
        scheduledStartDateTime: Date;
        scheduledEndDateTime: Date | null;
        estimatedDurationMinutes: number | null;
      };
      userId: string;
      meta?: RequestAuditMeta;
    },
  ): Promise<void> {
    const allocations = await tx.jobAllocation.findMany({
      where: {
        scheduledJobId: params.scheduledJobId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_STATUSES },
      },
    });
    if (!allocations.length) return;

    const nextWindow = resolveVisitWindow(params.nextJob);
    const outside: string[] = [];

    for (const allocation of allocations) {
      const inherited = isInheritedAllocationTiming(allocation, params.previousJob);
      if (inherited) {
        const updated = await tx.jobAllocation.update({
          where: { id: allocation.id },
          data: {
            scheduledStartDateTime: nextWindow.start,
            scheduledEndDateTime: nextWindow.end,
            durationMinutes: durationMinutesBetween(nextWindow.start, nextWindow.end),
          },
        });
        await this.audit.logAudit({
          tx,
          userId: params.userId,
          module: AuditModule.SCHEDULING,
          action: AuditAction.JOB_ALLOCATION_UPDATED,
          recordType: 'JobAllocation',
          recordId: allocation.id,
          oldValues: auditSnapshot({
            scheduledStartDateTime: allocation.scheduledStartDateTime,
            scheduledEndDateTime: allocation.scheduledEndDateTime,
          }),
          newValues: auditSnapshot({
            scheduledStartDateTime: updated.scheduledStartDateTime,
            scheduledEndDateTime: updated.scheduledEndDateTime,
          }),
          metadata: {
            scheduledJobId: params.scheduledJobId,
            reason: 'inherited_from_job_window',
          },
          ipAddress: params.meta?.ipAddress,
          userAgent: params.meta?.userAgent,
        });
        continue;
      }

      const resolved = resolveAllocationWindow(allocation, params.nextJob);
      const errors = validateAllocationTimingWithinVisit({
        assignmentStart: resolved.start,
        assignmentEnd: resolved.end,
        visitStart: nextWindow.start,
        visitEnd: nextWindow.end,
      });
      if (errors.length) {
        outside.push(allocation.employeeId);
      }
    }

    if (outside.length) {
      throw new BadRequestException({
        message:
          'One or more carer assignment times fall outside the new visit window. Correct assignment timings before saving.',
        errors: outside.map((employeeId) => ({
          property: 'allocations',
          employeeId,
          message: 'Assignment timing is outside the updated visit window',
        })),
      });
    }
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
      next = PrismaJobStatus.NEEDS_ATTENTION;
    } else {
      next = PrismaJobStatus.UNALLOCATED;
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

    const assignment = this.resolveAssignmentTimesFromDto(job, dto);
    const warnings = await this.checks.runAllChecks({
      scheduledJobId,
      scheduledVisitId: dto.scheduledVisitId,
      employeeId: dto.employeeId,
      serviceUserId: job.serviceUserId,
      jobStart: assignment.start,
      jobEnd: assignment.end,
      jobMetadata: job.metadata,
    });

    if (this.checks.hasNonOverridableBlockingWarnings(warnings)) {
      throw new BadRequestException({
        message: warnings.find((w) => w.severity === 'blocking')?.message ?? CARER_ROTA_CONFLICT_MESSAGE,
        warnings: warnings.map((w) => ({ type: w.type, message: w.message, severity: w.severity })),
        requiresConfirmation: false,
      });
    }

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
      if (dto.isLeadCarer) {
        await tx.jobAllocation.updateMany({
          where: {
            scheduledJobId,
            deletedAt: null,
            isActive: true,
            status: { in: ACTIVE_STATUSES },
            isLeadCarer: true,
          },
          data: { isLeadCarer: false },
        });
      }

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
          scheduledStartDateTime: assignment.start,
          scheduledEndDateTime: assignment.end,
          durationMinutes: assignment.durationMinutes,
          isLeadCarer: Boolean(dto.isLeadCarer),
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
          scheduledStartDateTime: assignment.start,
          scheduledEndDateTime: assignment.end,
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

      const resolved = resolveAllocationWindow(allocation, allocation.scheduledJob);
      void this.notifications.notifyAllocated({
        employeeId: allocation.employeeId,
        scheduledJobId,
        jobName: allocation.scheduledJob.jobName,
        serviceUserId: allocation.scheduledJob.serviceUserId,
        scheduledStartDateTime: resolved.start,
        scheduledEndDateTime: resolved.end,
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

  async updateTiming(
    userId: string,
    scheduledJobId: string,
    allocationId: string,
    dto: UpdateAllocationTimingDto,
    meta?: RequestAuditMeta,
  ) {
    const allocation = await this.prisma.jobAllocation.findFirst({
      where: { id: allocationId, scheduledJobId, deletedAt: null, isActive: true },
      include: allocationInclude,
    });
    if (!allocation) throw new NotFoundException('Job allocation not found');
    if (!ACTIVE_STATUSES.includes(allocation.status)) {
      throw new BadRequestException('Only active allocations can be updated');
    }

    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: scheduledJobId, deletedAt: null },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');

    const timingTouched =
      dto.scheduledStartDateTime !== undefined || dto.scheduledEndDateTime !== undefined;
    const assignment = timingTouched
      ? this.resolveAssignmentTimesFromDto(
          job,
          {
            scheduledStartDateTime:
              dto.scheduledStartDateTime ??
              allocation.scheduledStartDateTime?.toISOString() ??
              undefined,
            scheduledEndDateTime:
              dto.scheduledEndDateTime ??
              allocation.scheduledEndDateTime?.toISOString() ??
              undefined,
          },
          allocation.employee.personalDetail
            ? `${allocation.employee.personalDetail.firstName} ${allocation.employee.personalDetail.lastName}`.trim()
            : undefined,
        )
      : null;

    return this.prisma.$transaction(async (tx) => {
      if (dto.isLeadCarer === true) {
        await tx.jobAllocation.updateMany({
          where: {
            scheduledJobId,
            deletedAt: null,
            isActive: true,
            status: { in: ACTIVE_STATUSES },
            isLeadCarer: true,
            id: { not: allocationId },
          },
          data: { isLeadCarer: false },
        });
      }

      const updated = await tx.jobAllocation.update({
        where: { id: allocationId },
        data: {
          ...(assignment
            ? {
                scheduledStartDateTime: assignment.start,
                scheduledEndDateTime: assignment.end,
                durationMinutes: assignment.durationMinutes,
              }
            : {}),
          ...(dto.isLeadCarer !== undefined ? { isLeadCarer: dto.isLeadCarer } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
        },
        include: allocationInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.JOB_ALLOCATION_UPDATED,
        recordType: 'JobAllocation',
        recordId: allocationId,
        oldValues: auditSnapshot({
          scheduledStartDateTime: allocation.scheduledStartDateTime,
          scheduledEndDateTime: allocation.scheduledEndDateTime,
          durationMinutes: allocation.durationMinutes,
          isLeadCarer: allocation.isLeadCarer,
          notes: allocation.notes,
        }),
        newValues: auditSnapshot({
          scheduledStartDateTime: updated.scheduledStartDateTime,
          scheduledEndDateTime: updated.scheduledEndDateTime,
          durationMinutes: updated.durationMinutes,
          isLeadCarer: updated.isLeadCarer,
          notes: updated.notes,
        }),
        metadata: {
          scheduledJobId,
          employeeId: allocation.employeeId,
          serviceUserId: job.serviceUserId,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return {
        message: 'Allocation updated',
        data: this.mapAllocation(updated),
      };
    });
  }

  async setLeadCarer(
    userId: string,
    scheduledJobId: string,
    employeeId: string,
    meta?: RequestAuditMeta,
  ) {
    const allocation = await this.prisma.jobAllocation.findFirst({
      where: {
        scheduledJobId,
        employeeId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_STATUSES },
      },
      include: allocationInclude,
    });
    if (!allocation) throw new NotFoundException('Active allocation not found for this employee');

    return this.updateTiming(
      userId,
      scheduledJobId,
      allocation.id,
      { isLeadCarer: true },
      meta,
    );
  }

  mapAllocation(row: Prisma.JobAllocationGetPayload<{ include: typeof allocationInclude }>) {
    const resolved = resolveAllocationWindow(row, row.scheduledJob);
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
      isLeadCarer: row.isLeadCarer,
      scheduledStartDateTime: row.scheduledStartDateTime?.toISOString() ?? null,
      scheduledEndDateTime: row.scheduledEndDateTime?.toISOString() ?? null,
      durationMinutes: row.durationMinutes,
      resolvedStartDateTime: resolved.start.toISOString(),
      resolvedEndDateTime: resolved.end.toISOString(),
      resolvedDurationMinutes: resolved.durationMinutes,
      hasExplicitTiming: resolved.hasExplicitTiming,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      scheduledJob: row.scheduledJob,
      scheduledVisit: row.scheduledVisit,
      employee: row.employee,
    };
  }
}
