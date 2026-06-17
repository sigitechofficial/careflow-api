import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AllocationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AllocationChecksService } from '../job-allocations/allocation-checks.service';
import { JobAllocationsService } from '../job-allocations/job-allocations.service';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

export type RunCarerSyncResult = {
  allocated: number;
  skipped: number;
  failed: number;
};

@Injectable()
export class ScheduleRunCarerSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobAllocations: JobAllocationsService,
    private readonly allocationChecks: AllocationChecksService,
  ) {}

  async syncRunCarerToJobs(
    userId: string,
    runId: string,
    meta?: RequestAuditMeta,
  ): Promise<RunCarerSyncResult> {
    const run = await this.prisma.scheduleRun.findFirst({
      where: { id: runId, deletedAt: null, isActive: true },
      select: {
        employeeId: true,
        jobs: {
          where: { deletedAt: null, isActive: true },
          select: { id: true },
        },
      },
    });
    if (!run?.employeeId || run.jobs.length === 0) {
      return { allocated: 0, skipped: 0, failed: 0 };
    }

    const result: RunCarerSyncResult = { allocated: 0, skipped: 0, failed: 0 };
    for (const job of run.jobs) {
      const outcome = await this.ensureRunCarerAllocated(userId, job.id, run.employeeId, meta);
      result[outcome] += 1;
    }
    return result;
  }

  private async ensureRunCarerAllocated(
    userId: string,
    scheduledJobId: string,
    employeeId: string,
    meta?: RequestAuditMeta,
  ): Promise<keyof RunCarerSyncResult> {
    const existing = await this.prisma.jobAllocation.findFirst({
      where: {
        scheduledJobId,
        employeeId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
      },
    });
    if (existing) return 'skipped';

    try {
      await this.jobAllocations.allocate(
        userId,
        scheduledJobId,
        { employeeId, isLeadCarer: true, force: false },
        meta,
      );
      return 'allocated';
    } catch (error) {
      if (error instanceof ConflictException) return 'skipped';

      if (error instanceof BadRequestException) {
        const warnings = this.warningsFromAllocateError(error);
        if (warnings.length > 0 && !this.allocationChecks.hasBlockingWarnings(warnings)) {
          try {
            await this.jobAllocations.allocate(
              userId,
              scheduledJobId,
              { employeeId, isLeadCarer: true, force: true },
              meta,
            );
            return 'allocated';
          } catch {
            return 'failed';
          }
        }
      }
      return 'failed';
    }
  }

  private warningsFromAllocateError(error: BadRequestException) {
    const body = error.getResponse();
    if (!body || typeof body !== 'object') return [];
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.warnings)) {
      return record.warnings as Parameters<AllocationChecksService['hasBlockingWarnings']>[0];
    }
    const message = record.message;
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      const nested = message as Record<string, unknown>;
      if (Array.isArray(nested.warnings)) {
        return nested.warnings as Parameters<AllocationChecksService['hasBlockingWarnings']>[0];
      }
    }
    return [];
  }
}
