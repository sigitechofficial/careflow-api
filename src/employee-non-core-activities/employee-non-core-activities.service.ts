import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { CreateNonCoreActivityDto } from './dto/create-non-core-activity.dto';
import { UpdateNonCoreActivityDto } from './dto/update-non-core-activity.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

@Injectable()
export class EmployeeNonCoreActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
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
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeNonCoreActivity.create({
        data: { employeeId, ...dto, createdById: userId },
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
      return { message: 'Non-core activity created', data: created };
    });
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
