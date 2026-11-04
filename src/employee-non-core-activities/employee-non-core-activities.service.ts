import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { CreateNonCoreActivityDto } from './dto/create-non-core-activity.dto';
import { UpdateNonCoreActivityDto } from './dto/update-non-core-activity.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import type { ScheduleImpactResult } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';
import { VisitReconciliationsService } from '../billing/visit-reconciliations.service';

/** System pay item that pays a visit the carer was taken off (see SYSTEM_PAY_ITEM_CONFIG). */
const NON_CORE_VISIT_PAY = 'NON_CORE_VISIT_PAY';

type RemovedVisitPay = {
  scheduledJobId: string;
  jobName: string;
  amount: number | null;
  payItemId: string | null;
  problem?: string;
};

@Injectable()
export class EmployeeNonCoreActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly scheduleImpact: ScheduleLifecycleImpactService,
    private readonly visitPay: VisitReconciliationsService,
  ) {}

  async list(employeeId: string) {
    const items = await this.prisma.employeeNonCoreActivity.findMany({
      where: { employeeId, deletedAt: null },
      include: { reason: true },
      orderBy: { dateFrom: 'desc' },
    });
    return { data: items };
  }

  async create(userId: string, employeeId: string, dto: CreateNonCoreActivityDto, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    if (dto.dateTo.getTime() <= dto.dateFrom.getTime()) {
      throw new BadRequestException('dateTo must be after dateFrom');
    }
    const { applyToSchedule, payRemovedVisits, ...activityData } = dto;
    if (payRemovedVisits && applyToSchedule === false) {
      throw new BadRequestException('Visits can only be paid when the carer is taken off them (unallocate visits).');
    }
    // Visit pay replaces paying the activity itself, so the same time is not paid twice.
    if (payRemovedVisits) activityData.includeInPayroll = false;
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeNonCoreActivity.create({
        data: { employeeId, ...activityData, createdById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_NON_CORE_ACTIVITY,
        action: AuditAction.EMPLOYEE_NON_CORE_ACTIVITY_ADDED,
        recordType: 'EmployeeNonCoreActivity',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      let scheduleImpact: ScheduleImpactResult | undefined;
      if (applyToSchedule !== false) {
        scheduleImpact = await this.scheduleImpact.unallocateEmployeeJobsInRange(
          userId,
          {
            employeeId,
            fromDate: dto.dateFrom,
            toDate: dto.dateTo,
            reason: dto.notes?.trim() ? `Non-core activity: ${dto.notes.trim()}` : 'Non-core activity',
            source: 'employee_non_core_activity',
            // Activities have real start/end times — only visits in that window are affected.
            exactWindow: true,
          },
          meta,
          tx,
        );
      }

      const removedVisitPay =
        payRemovedVisits && scheduleImpact?.jobIds.length
          ? await this.createRemovedVisitPayItems(tx, userId, created, scheduleImpact.jobIds)
          : undefined;

      return {
        message: 'Non-core activity created',
        data: created,
        ...(scheduleImpact ? { scheduleImpact } : {}),
        ...(removedVisitPay ? { removedVisitPay } : {}),
      };
    });
  }

  /**
   * One pay item awaiting approval per visit the carer was taken off, for what that visit would have
   * paid them. A visit that cannot be priced gets no item and is reported with the reason.
   */
  private async createRemovedVisitPayItems(
    tx: Prisma.TransactionClient,
    userId: string,
    activity: { id: string; employeeId: string; reasonId: string | null },
    jobIds: string[],
  ): Promise<RemovedVisitPay[]> {
    const [reason, jobs] = await Promise.all([
      activity.reasonId
        ? tx.nonCoreActivityReason.findUnique({ where: { id: activity.reasonId }, select: { name: true } })
        : null,
      tx.scheduledJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobName: true } }),
    ]);
    const what = reason?.name ?? 'non-core activity';
    const results: RemovedVisitPay[] = [];
    for (const job of jobs) {
      const priced = await this.visitPay.plannedCarerPayForVisit(activity.employeeId, job.id, tx);
      if (priced.amount == null || priced.amount <= 0 || !priced.day) {
        results.push({
          scheduledJobId: job.id,
          jobName: job.jobName,
          amount: null,
          payItemId: null,
          problem: priced.problem ?? 'The visit has no pay',
        });
        continue;
      }
      const item = await tx.employeePayItem.create({
        data: {
          employeeId: activity.employeeId,
          wageTypeCode: NON_CORE_VISIT_PAY,
          workDate: new Date(`${priced.day}T00:00:00.000Z`),
          unit: 'AMOUNT',
          amount: new Prisma.Decimal(priced.amount).toDecimalPlaces(2),
          reason: `Taken off visit for ${what}: ${job.jobName} (${priced.day})`.slice(0, 500),
          sourceType: 'NON_CORE_ACTIVITY',
          sourceId: activity.id,
          status: 'PENDING_APPROVAL',
          createdById: userId,
        },
      });
      results.push({ scheduledJobId: job.id, jobName: job.jobName, amount: priced.amount, payItemId: item.id });
    }
    return results;
  }

  async update(
    userId: string,
    employeeId: string,
    activityId: string,
    dto: UpdateNonCoreActivityDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeNonCoreActivity.findFirst({
        where: { id: activityId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Non-core activity not found');

      const dateFrom = dto.dateFrom ?? existing.dateFrom;
      const dateTo = dto.dateTo ?? existing.dateTo;
      if (dateTo.getTime() <= dateFrom.getTime()) {
        throw new BadRequestException('dateTo must be after dateFrom');
      }

      const updated = await tx.employeeNonCoreActivity.update({
        where: { id: activityId },
        data: { ...dto, updatedById: userId },
      });
      const oldS = auditSnapshot(existing);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_NON_CORE_ACTIVITY,
        action: AuditAction.EMPLOYEE_NON_CORE_ACTIVITY_UPDATED,
        recordType: 'EmployeeNonCoreActivity',
        recordId: activityId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS), employeeId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Non-core activity updated', data: updated };
    });
  }

  async remove(userId: string, employeeId: string, activityId: string, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeNonCoreActivity.findFirst({
        where: { id: activityId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Non-core activity not found');
      await tx.employeeNonCoreActivity.update({
        where: { id: activityId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_NON_CORE_ACTIVITY,
        action: AuditAction.EMPLOYEE_NON_CORE_ACTIVITY_DELETED,
        recordType: 'EmployeeNonCoreActivity',
        recordId: activityId,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Non-core activity deleted', data: {} };
    });
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
