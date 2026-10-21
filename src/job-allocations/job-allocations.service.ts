import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus as PrismaAllocationStatus,
  CarerVisitPushKind,
  Prisma,
  ScheduledJobStatus as PrismaJobStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { andWhereFragment, OrgScopeService } from '../common/org-scope/org-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  ensureActiveEmployee,
  parseIsoDateTime,
} from '../scheduling/scheduling-validation.util';
import { AllocationChecksService, type AllocationWarning } from './allocation-checks.service';
import { AllocationWarningType } from './enums/allocation-warning-type.enum';
import { CARER_ROTA_CONFLICT_MESSAGE } from '../service-user-visit-plans/visit-carer-rota-conflict.util';
import { ScheduleAllocationNotificationHook } from './schedule-allocation-notification.hook';
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';
import { AllocationQueryDto } from './dto/allocation-query.dto';
import { AllocateJobDto } from './dto/allocate-job.dto';
import { UnallocateJobDto } from './dto/unallocate-job.dto';
import { ConfirmAllocationDto } from './dto/confirm-allocation.dto';
import { UpdateAllocationTimingDto } from './dto/update-allocation-timing.dto';
import { AllocateTeamDto } from './dto/allocate-team.dto';
import {
  clockedInRemovalBlockMessage,
  fullVisitMessage,
  pickPromotedLead,
  sortByAssignedOrder,
  teamCompositionError,
} from './lead-carer.util';
import { resolveLeadEmployeeId } from '../employee-app/employee-app-multi-carer.util';
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

/** Lead-carer rules apply to visits that need 2+ carers (single-carer visits unchanged). */
const MULTI_CARER_MIN = 2;

type WarningView = { type: string; message: string; severity: string; hardBlock?: boolean };

export type TeamCarerCheck = {
  employeeId: string;
  name: string;
  /** Cannot be assigned, even with force (rota clash, blocked, compliance, inactive). */
  hardBlocked: boolean;
  /** Has blocking warnings that force=true may override. */
  requiresConfirmation: boolean;
  warnings: WarningView[];
};

function personName(
  pd: { firstName?: string | null; lastName?: string | null } | null | undefined,
  fallback = 'Carer',
): string {
  return [pd?.firstName, pd?.lastName].filter(Boolean).join(' ').trim() || fallback;
}

function warningViews(warnings: AllocationWarning[]): WarningView[] {
  return warnings.map((w) => ({
    type: w.type,
    message: w.message,
    severity: w.severity,
    ...(w.hardBlock ? { hardBlock: true } : {}),
  }));
}

@Injectable()
export class JobAllocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly checks: AllocationChecksService,
    private readonly notifications: ScheduleAllocationNotificationHook,
    private readonly orgScope: OrgScopeService,
    private readonly carerPush: CarerVisitPushHook,
  ) {}

  /** Status for a new allocation given its check warnings (same rules for single and team). */
  private allocationOutcome(
    warnings: AllocationWarning[],
    force: boolean | undefined,
  ): { status: PrismaAllocationStatus; needsConfirmation: boolean } {
    const needsConfirmation = warnings.length > 0 && !force;
    const status = needsConfirmation
      ? PrismaAllocationStatus.PENDING_CONFIRMATION
      : force && warnings.length
        ? PrismaAllocationStatus.ALLOCATED
        : warnings.length === 0
          ? PrismaAllocationStatus.CONFIRMED
          : PrismaAllocationStatus.ALLOCATED;
    return { status, needsConfirmation };
  }

  /** Active allocations with the fields the lead rules need. */
  private activeLeadRows(client: Prisma.TransactionClient | PrismaService, scheduledJobId: string) {
    return client.jobAllocation.findMany({
      where: {
        scheduledJobId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: [{ allocatedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        employeeId: true,
        status: true,
        isLeadCarer: true,
        allocatedAt: true,
        employee: {
          select: { personalDetail: { select: { firstName: true, lastName: true } } },
        },
      },
    });
  }

  /** Lead the carer app shows right now (explicit lead, else earliest assigned). */
  private async currentLeadEmployeeId(
    requiredCarers: number,
    scheduledJobId: string,
  ): Promise<string | null> {
    if (requiredCarers < MULTI_CARER_MIN) return null;
    return resolveLeadEmployeeId(
      requiredCarers,
      await this.activeLeadRows(this.prisma, scheduledJobId),
    );
  }

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

  async list(query: AllocationQueryDto, actor?: RequestUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.JobAllocationWhereInput = { deletedAt: null };
    if (query.scheduledJobId) where.scheduledJobId = query.scheduledJobId;
    if (query.scheduledVisitId) where.scheduledVisitId = query.scheduledVisitId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status as PrismaAllocationStatus;

    if (actor) {
      const scope = this.orgScope.fromRequestUser(actor);
      if (scope.locationIds?.length === 0) {
        return { data: [], meta: buildPaginationMeta({ page, limit, total: 0 }) };
      }
      if (query.scheduledJobId) {
        await this.orgScope.assertScheduledJobInScope(scope, query.scheduledJobId);
      }
      andWhereFragment(where, this.orgScope.jobAllocationScopeWhere(scope));
    }

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

  async listForJob(scheduledJobId: string, actor?: RequestUser) {
    if (actor) {
      await this.orgScope.assertScheduledJobInScope(
        this.orgScope.fromRequestUser(actor),
        scheduledJobId,
      );
    }
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

  async getById(id: string, actor?: RequestUser) {
    if (actor) {
      await this.orgScope.assertJobAllocationInScope(this.orgScope.fromRequestUser(actor), id);
    }
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

  /** Single allocate never goes over requiredCarers (replace / drag remove the old carer first). */
  private async assertCarerPlaceAvailable(scheduledJobId: string, requiredCarers: number) {
    const active = await this.prisma.jobAllocation.count({
      where: {
        scheduledJobId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_STATUSES },
      },
    });
    const message = fullVisitMessage(active, requiredCarers);
    if (message) throw new BadRequestException(message);
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
    actor?: RequestUser,
  ) {
    if (actor) {
      await this.orgScope.assertScheduledJobInScope(
        this.orgScope.fromRequestUser(actor),
        scheduledJobId,
      );
    }
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: scheduledJobId, deletedAt: null, isActive: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    await ensureActiveEmployee(this.prisma, dto.employeeId);
    await this.assertNoDuplicateAllocation(scheduledJobId, dto.employeeId);
    await this.assertCarerPlaceAvailable(scheduledJobId, job.requiredCarers);

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
        warnings: warningViews(warnings),
        requiresConfirmation: false,
      });
    }

    const hasBlocking = this.checks.hasBlockingWarnings(warnings);
    if (hasBlocking && !dto.force) {
      throw new BadRequestException({
        message: 'Allocation blocked due to validation warnings. Use force=true to create pending confirmation.',
        warnings: warningViews(warnings),
        requiresConfirmation: true,
      });
    }

    const { status, needsConfirmation } = this.allocationOutcome(warnings, dto.force);

    const previousJobStatus = job.status;
    const warningTypes = warnings.map((w) => w.type);
    const warningMessages = warnings.map((w) => w.message);
    const leadChange = Boolean(dto.isLeadCarer) && job.requiredCarers >= MULTI_CARER_MIN;
    const previousLeadEmployeeId = leadChange
      ? await this.currentLeadEmployeeId(job.requiredCarers, scheduledJobId)
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      // Exactly one lead: the new lead replaces any existing one in the same transaction.
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

      // Multi-carer: the push says Lead / Support (as the carer app will show it).
      const role =
        job.requiredCarers >= MULTI_CARER_MIN
          ? resolveLeadEmployeeId(
              job.requiredCarers,
              await this.activeLeadRows(tx, scheduledJobId),
            ) === dto.employeeId
            ? ('lead' as const)
            : ('support' as const)
          : null;
      void this.notifications.notifyAllocated({
        employeeId: dto.employeeId,
        scheduledJobId,
        jobName: job.jobName,
        serviceUserId: job.serviceUserId,
        scheduledStartDateTime: assignment.start,
        scheduledEndDateTime: assignment.end,
        role,
      });
      if (needsConfirmation) {
        void this.notifications.notifyRequiresConfirmation({
          scheduledJobId,
          jobName: job.jobName,
          employeeId: dto.employeeId,
          serviceUserId: job.serviceUserId,
          scheduledStartDateTime: assignment.start,
          warningMessages,
        });
      }

      return {
        message: needsConfirmation
          ? 'Allocation created — confirmation required'
          : 'Carer allocated to job',
        requiresConfirmation: needsConfirmation,
        warnings: warningViews(warnings),
        data: this.mapAllocation(created),
        jobStatus: newJobStatus,
      };
    });
    if (leadChange) {
      this.notifications.scheduleLeadChangePush({
        scheduledJobId,
        previousLeadEmployeeId,
        newlyAssignedEmployeeIds: [dto.employeeId],
      });
    } else if (job.requiredCarers >= MULTI_CARER_MIN) {
      // e.g. replace: lead removed (push pending), new carer added as support.
      this.notifications.noteAssignedDuringLeadChange(scheduledJobId, dto.employeeId);
    }
    return result;
  }

  /**
   * Multi-carer visit: allocate the whole team (new visit) or the missing carers
   * (gap fill) in ONE transaction, with exactly one lead. Every carer goes through
   * the same checks as single allocation; if any carer is hard-blocked, or has
   * overridable warnings without force, nothing is saved and the per-carer
   * warnings are returned (`carers`).
   */
  async allocateTeam(
    userId: string,
    scheduledJobId: string,
    dto: AllocateTeamDto,
    meta?: RequestAuditMeta,
    actor?: RequestUser,
  ) {
    if (actor) {
      await this.orgScope.assertScheduledJobInScope(
        this.orgScope.fromRequestUser(actor),
        scheduledJobId,
      );
    }
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: scheduledJobId, deletedAt: null, isActive: true },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');

    const existing = await this.activeLeadRows(this.prisma, scheduledJobId);
    const existingIds = existing.map((a) => a.employeeId);
    const compositionError = teamCompositionError({
      requiredCarers: job.requiredCarers,
      existingEmployeeIds: existingIds,
      newEmployeeIds: dto.employeeIds,
      leadEmployeeId: dto.leadEmployeeId,
    });
    if (compositionError) throw new BadRequestException(compositionError);

    if (dto.scheduledVisitId) {
      const visit = await this.prisma.scheduledVisit.findFirst({
        where: { id: dto.scheduledVisitId, scheduledJobId, deletedAt: null },
      });
      if (!visit) throw new BadRequestException('Scheduled visit not found for this job');
    }

    const assignment = this.resolveAssignmentTimesFromDto(job, dto);
    const personal = await this.prisma.employeePersonalDetail.findMany({
      where: { employeeId: { in: dto.employeeIds }, deletedAt: null },
      select: { employeeId: true, firstName: true, lastName: true },
    });
    const nameById = new Map(personal.map((p) => [p.employeeId, personName(p)]));
    for (const row of existing) {
      nameById.set(row.employeeId, personName(row.employee.personalDetail));
    }

    // Same per-carer checks as POST /allocate, run for every new carer before any write.
    const checked: Array<TeamCarerCheck & { raw: AllocationWarning[] }> = [];
    for (const employeeId of dto.employeeIds) {
      const name = nameById.get(employeeId) ?? 'Carer';
      try {
        await ensureActiveEmployee(this.prisma, employeeId);
      } catch (err) {
        const message = err instanceof HttpException ? err.message : 'Employee not found or inactive';
        checked.push({
          employeeId,
          name,
          hardBlocked: true,
          requiresConfirmation: false,
          warnings: [
            { type: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE, message, severity: 'blocking' },
          ],
          raw: [],
        });
        continue;
      }
      const warnings = await this.checks.runAllChecks({
        scheduledJobId,
        scheduledVisitId: dto.scheduledVisitId,
        employeeId,
        serviceUserId: job.serviceUserId,
        jobStart: assignment.start,
        jobEnd: assignment.end,
        jobMetadata: job.metadata,
      });
      checked.push({
        employeeId,
        name,
        hardBlocked: this.checks.hasNonOverridableBlockingWarnings(warnings),
        requiresConfirmation:
          this.checks.hasBlockingWarnings(warnings) &&
          !this.checks.hasNonOverridableBlockingWarnings(warnings),
        warnings: warningViews(warnings),
        raw: warnings,
      });
    }

    const carersPayload: TeamCarerCheck[] = checked.map(({ raw: _raw, ...c }) => c);
    const flatWarnings = checked.flatMap((c) =>
      c.warnings.map((w) => ({ ...w, employeeId: c.employeeId, employeeName: c.name })),
    );
    const hardBlocked = checked.filter((c) => c.hardBlocked);
    if (hardBlocked.length) {
      const first = hardBlocked[0]!;
      const firstMessage =
        first.warnings.find((w) => w.severity === 'blocking')?.message ?? CARER_ROTA_CONFLICT_MESSAGE;
      throw new BadRequestException({
        message: `Team not assigned — ${first.name} cannot be assigned: ${firstMessage}`,
        warnings: flatWarnings,
        carers: carersPayload,
        requiresConfirmation: false,
      });
    }
    if (!dto.force && checked.some((c) => c.requiresConfirmation)) {
      throw new BadRequestException({
        message:
          'Team not assigned — some carers have warnings. Review them and use force=true to assign anyway.',
        warnings: flatWarnings,
        carers: carersPayload,
        requiresConfirmation: true,
      });
    }

    const previousJobStatus = job.status;
    const previousLeadEmployeeId =
      existing.length > 0 ? resolveLeadEmployeeId(job.requiredCarers, existing) : null;
    const leadName = nameById.get(dto.leadEmployeeId) ?? 'Carer';
    const baseAllocatedAt = Date.now();

    const result = await this.prisma.$transaction(async (tx) => {
      // The team must still be exactly what the dialog saw (no concurrent edits).
      const current = await this.activeLeadRows(tx, scheduledJobId);
      const currentIds = new Set(current.map((a) => a.employeeId));
      if (
        current.length !== existing.length ||
        existingIds.some((id) => !currentIds.has(id))
      ) {
        throw new ConflictException('Carers on this visit changed — refresh and try again.');
      }

      // Exactly one lead: clear every lead, then set the chosen one below.
      await tx.jobAllocation.updateMany({
        where: {
          scheduledJobId,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_STATUSES },
          isLeadCarer: true,
          employeeId: { not: dto.leadEmployeeId },
        },
        data: { isLeadCarer: false },
      });
      const existingLeadRow = current.find((a) => a.employeeId === dto.leadEmployeeId);
      if (existingLeadRow && !existingLeadRow.isLeadCarer) {
        await tx.jobAllocation.update({
          where: { id: existingLeadRow.id },
          data: { isLeadCarer: true },
        });
      }
      for (const row of current) {
        const wasLead = row.isLeadCarer;
        const isLead = row.employeeId === dto.leadEmployeeId;
        if (wasLead === isLead) continue;
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SCHEDULING,
          action: AuditAction.JOB_ALLOCATION_UPDATED,
          recordType: 'JobAllocation',
          recordId: row.id,
          oldValues: auditSnapshot({ isLeadCarer: wasLead }),
          newValues: auditSnapshot({ isLeadCarer: isLead }),
          metadata: {
            scheduledJobId,
            employeeId: row.employeeId,
            serviceUserId: job.serviceUserId,
            reason: 'lead_set_by_team_allocation',
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      }

      const created: Array<Prisma.JobAllocationGetPayload<{ include: typeof allocationInclude }>> =
        [];
      for (const [index, carer] of checked.entries()) {
        const { status, needsConfirmation } = this.allocationOutcome(carer.raw, dto.force);
        const warningTypes = carer.raw.map((w) => w.type);
        const warningMessages = carer.raw.map((w) => w.message);
        const row = await tx.jobAllocation.create({
          data: {
            scheduledJobId,
            scheduledVisitId: dto.scheduledVisitId ?? null,
            employeeId: carer.employeeId,
            status,
            requiresConfirmation: needsConfirmation,
            warningTypes: warningTypes.length ? warningTypes : undefined,
            warningMessages: warningMessages.length ? warningMessages : undefined,
            notes: dto.notes?.trim() ?? null,
            allocatedById: userId,
            // Selection order = assigned order (lead promotion order if the lead is removed later).
            allocatedAt: new Date(baseAllocatedAt + index),
            confirmedAt: status === PrismaAllocationStatus.CONFIRMED ? new Date() : null,
            confirmedById: status === PrismaAllocationStatus.CONFIRMED ? userId : null,
            scheduledStartDateTime: assignment.start,
            scheduledEndDateTime: assignment.end,
            durationMinutes: assignment.durationMinutes,
            isLeadCarer: carer.employeeId === dto.leadEmployeeId,
          },
          include: allocationInclude,
        });
        created.push(row);

        if (carer.raw.length) {
          await this.audit.logAudit({
            tx,
            userId,
            module: AuditModule.SCHEDULING,
            action: AuditAction.ALLOCATION_WARNING_GENERATED,
            recordType: 'JobAllocation',
            recordId: row.id,
            metadata: {
              scheduledJobId,
              employeeId: carer.employeeId,
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
          recordId: row.id,
          newValues: auditSnapshot(row),
          metadata: {
            scheduledJobId,
            employeeId: carer.employeeId,
            serviceUserId: job.serviceUserId,
            warningTypes,
            previousJobStatus,
            teamAllocation: true,
            leadEmployeeId: dto.leadEmployeeId,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      }

      const newJobStatus = await this.syncJobAllocationStatus(tx, scheduledJobId, userId);
      return { created, newJobStatus };
    });

    for (const [index, carer] of checked.entries()) {
      const row = result.created[index]!;
      void this.notifications.notifyAllocated({
        employeeId: carer.employeeId,
        scheduledJobId,
        jobName: job.jobName,
        serviceUserId: job.serviceUserId,
        scheduledStartDateTime: assignment.start,
        scheduledEndDateTime: assignment.end,
        role: carer.employeeId === dto.leadEmployeeId ? 'lead' : 'support',
      });
      if (row.status === PrismaAllocationStatus.PENDING_CONFIRMATION) {
        void this.notifications.notifyRequiresConfirmation({
          scheduledJobId,
          jobName: job.jobName,
          employeeId: carer.employeeId,
          serviceUserId: job.serviceUserId,
          scheduledStartDateTime: assignment.start,
          warningMessages: carer.raw.map((w) => w.message),
        });
      }
    }
    if (previousLeadEmployeeId) {
      this.notifications.scheduleLeadChangePush({
        scheduledJobId,
        previousLeadEmployeeId,
        newlyAssignedEmployeeIds: dto.employeeIds,
      });
    }

    const pending = result.created.some(
      (r) => r.status === PrismaAllocationStatus.PENDING_CONFIRMATION,
    );
    return {
      message: pending
        ? `Carers allocated — confirmation required. ${leadName} is the lead carer.`
        : `Carers allocated. ${leadName} is the lead carer.`,
      data: result.created.map((r) => this.mapAllocation(r)),
      meta: {
        requiresConfirmation: pending,
        leadEmployeeId: dto.leadEmployeeId,
        jobStatus: result.newJobStatus,
        warnings: flatWarnings,
        carers: carersPayload,
      },
    };
  }

  async confirm(
    userId: string,
    scheduledJobId: string,
    allocationId: string,
    dto: ConfirmAllocationDto,
    meta?: RequestAuditMeta,
    actor?: RequestUser,
  ) {
    if (actor) {
      await this.orgScope.assertScheduledJobInScope(
        this.orgScope.fromRequestUser(actor),
        scheduledJobId,
      );
    }
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
    actor?: RequestUser,
  ) {
    if (actor) {
      await this.orgScope.assertScheduledJobInScope(
        this.orgScope.fromRequestUser(actor),
        scheduledJobId,
      );
    }
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
    const clockedInMessage = clockedInRemovalBlockMessage({
      carerName: personName(allocation.employee.personalDetail),
      actualStartDateTime: allocation.actualStartDateTime,
      actualEndDateTime: allocation.actualEndDateTime,
      jobStatus: allocation.scheduledJob.status,
    });
    if (clockedInMessage) throw new ConflictException(clockedInMessage);

    const previousJobStatus = allocation.scheduledJob.status;
    const requiredCarers = allocation.scheduledJob.requiredCarers;
    const previousLeadEmployeeId = await this.currentLeadEmployeeId(
      requiredCarers,
      scheduledJobId,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.jobAllocation.update({
        where: { id: allocation.id },
        data: {
          status: PrismaAllocationStatus.UNALLOCATED,
          isActive: false,
          unallocatedAt: new Date(),
          unallocatedById: userId,
          unallocationReason: dto.reason?.trim() ?? null,
          // Removed carers are never the lead.
          ...(allocation.isLeadCarer ? { isLeadCarer: false } : {}),
        },
        include: allocationInclude,
      });

      // Lead removed while others remain: promote the earliest-assigned carer (same transaction).
      let promotedLeadCarer: { employeeId: string; name: string } | null = null;
      if (allocation.isLeadCarer && requiredCarers >= MULTI_CARER_MIN) {
        const remaining = await this.activeLeadRows(tx, scheduledJobId);
        const next = sortByAssignedOrder(remaining).find((r) => r.isLeadCarer) ?? pickPromotedLead(remaining);
        if (next) {
          await tx.jobAllocation.updateMany({
            where: {
              scheduledJobId,
              deletedAt: null,
              isActive: true,
              status: { in: ACTIVE_STATUSES },
              isLeadCarer: true,
              id: { not: next.id },
            },
            data: { isLeadCarer: false },
          });
          if (!next.isLeadCarer) {
            await tx.jobAllocation.update({
              where: { id: next.id },
              data: { isLeadCarer: true },
            });
          }
          promotedLeadCarer = {
            employeeId: next.employeeId,
            name: personName(next.employee.personalDetail),
          };
          await this.audit.logAudit({
            tx,
            userId,
            module: AuditModule.SCHEDULING,
            action: AuditAction.JOB_ALLOCATION_UPDATED,
            recordType: 'JobAllocation',
            recordId: next.id,
            oldValues: auditSnapshot({ isLeadCarer: next.isLeadCarer }),
            newValues: auditSnapshot({ isLeadCarer: true }),
            metadata: {
              scheduledJobId,
              employeeId: next.employeeId,
              serviceUserId: allocation.scheduledJob.serviceUserId,
              reason: 'lead_auto_promoted',
              previousLeadEmployeeId: dto.employeeId,
            },
            ipAddress: meta?.ipAddress,
            userAgent: meta?.userAgent,
          });
        }
      }

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

      this.carerPush.notify({
        employeeIds: [dto.employeeId],
        kind: CarerVisitPushKind.VISIT_REMOVED,
        title: 'Removed from visit',
        body: `You have been taken off "${allocation.scheduledJob.jobName}".`,
        scheduledJobId,
        serviceUserId: allocation.scheduledJob.serviceUserId,
      });

      return {
        message: promotedLeadCarer
          ? `Carer unallocated from job. ${promotedLeadCarer.name} is now the lead carer.`
          : 'Carer unallocated from job',
        data: this.mapAllocation(updated),
        jobStatus: newJobStatus,
        // Envelope keeps only message/data/meta — admin toasts the promotion from meta.
        meta: { jobStatus: newJobStatus, promotedLeadCarer },
      };
    });
    if (previousLeadEmployeeId && previousLeadEmployeeId === dto.employeeId) {
      this.notifications.scheduleLeadChangePush({ scheduledJobId, previousLeadEmployeeId });
    }
    return result;
  }

  async updateTiming(
    userId: string,
    scheduledJobId: string,
    allocationId: string,
    dto: UpdateAllocationTimingDto,
    meta?: RequestAuditMeta,
    actor?: RequestUser,
  ) {
    if (actor) {
      await this.orgScope.assertScheduledJobInScope(
        this.orgScope.fromRequestUser(actor),
        scheduledJobId,
      );
    }
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

    const multiCarer = job.requiredCarers >= MULTI_CARER_MIN;
    if (multiCarer && dto.isLeadCarer === false && allocation.isLeadCarer) {
      const others = await this.prisma.jobAllocation.count({
        where: {
          scheduledJobId,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_STATUSES },
          id: { not: allocationId },
        },
      });
      if (others > 0) {
        throw new BadRequestException(
          'A multi-carer visit must keep one lead carer. Set another carer as lead instead.',
        );
      }
    }
    const leadChange = multiCarer && dto.isLeadCarer === true && !allocation.isLeadCarer;
    const previousLeadEmployeeId = leadChange
      ? await this.currentLeadEmployeeId(job.requiredCarers, scheduledJobId)
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      // Exactly one lead: clear every other lead in the same transaction.
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

      if (assignment) {
        this.carerPush.notify({
          employeeIds: [allocation.employeeId],
          kind: CarerVisitPushKind.VISIT_CHANGE,
          title: 'Visit updated',
          body: `Time changed for "${job.jobName}".`,
          scheduledJobId,
          serviceUserId: job.serviceUserId,
        });
      }

      return {
        message:
          dto.isLeadCarer === true && multiCarer
            ? `${personName(updated.employee.personalDetail)} is now the lead carer`
            : 'Allocation updated',
        data: this.mapAllocation(updated),
      };
    });
    if (leadChange) {
      this.notifications.scheduleLeadChangePush({ scheduledJobId, previousLeadEmployeeId });
    }
    return result;
  }

  async setLeadCarer(
    userId: string,
    scheduledJobId: string,
    employeeId: string,
    meta?: RequestAuditMeta,
    actor?: RequestUser,
  ) {
    if (actor) {
      await this.orgScope.assertScheduledJobInScope(
        this.orgScope.fromRequestUser(actor),
        scheduledJobId,
      );
    }
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
