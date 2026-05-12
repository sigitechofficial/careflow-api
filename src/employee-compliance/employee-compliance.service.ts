import { Injectable, NotFoundException } from '@nestjs/common';
import { DataAccessType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { CreateEmployeeComplianceDto } from './dto/create-employee-compliance.dto';
import { UpdateEmployeeComplianceDto } from './dto/update-employee-compliance.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

@Injectable()
export class EmployeeComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(employeeId: string, audit?: RequestAuditMeta & { actorUserId?: string }) {
    const items = await this.prisma.employeeCompliance.findMany({
      where: { employeeId, deletedAt: null },
      include: { complianceType: true },
      orderBy: { createdAt: 'desc' },
    });
    if (audit?.actorUserId) {
      await this.audit.logDataAccess({
        userId: audit.actorUserId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        recordType: 'EmployeeComplianceList',
        recordId: employeeId,
        accessType: DataAccessType.VIEW,
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
        metadata: { count: items.length },
      });
    }
    return { data: items };
  }

  async create(userId: string, employeeId: string, dto: CreateEmployeeComplianceDto, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeCompliance.create({
        data: { employeeId, ...dto, createdById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        action: AuditAction.EMPLOYEE_COMPLIANCE_ADDED,
        recordType: 'EmployeeCompliance',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance record created', data: created };
    });
  }

  async update(
    userId: string,
    employeeId: string,
    complianceId: string,
    dto: UpdateEmployeeComplianceDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeCompliance.findFirst({
        where: { id: complianceId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Compliance record not found');
      const updated = await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: { ...dto, updatedById: userId },
      });
      const oldS = auditSnapshot(existing);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        action: AuditAction.EMPLOYEE_COMPLIANCE_UPDATED,
        recordType: 'EmployeeCompliance',
        recordId: complianceId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS), employeeId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance record updated', data: updated };
    });
  }

  async remove(userId: string, employeeId: string, complianceId: string, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeCompliance.findFirst({
        where: { id: complianceId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Compliance record not found');
      await tx.employeeCompliance.update({
        where: { id: complianceId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        action: AuditAction.EMPLOYEE_COMPLIANCE_DELETED,
        recordType: 'EmployeeCompliance',
        recordId: complianceId,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance record deleted', data: {} };
    });
  }

  async expiring(days: number, audit?: RequestAuditMeta & { actorUserId?: string }) {
    const now = new Date();
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const items = await this.prisma.employeeCompliance.findMany({
      where: {
        deletedAt: null,
        expiryDate: { not: null, gte: now, lte: until },
      },
      include: { employee: { include: { personalDetail: true } }, complianceType: true },
      orderBy: { expiryDate: 'asc' },
    });
    if (audit?.actorUserId) {
      await this.audit.logDataAccess({
        userId: audit.actorUserId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        recordType: 'ComplianceQuery',
        recordId: `expiring-${days}`,
        accessType: DataAccessType.VIEW,
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
        metadata: { days, resultCount: items.length },
      });
    }
    return { data: items, meta: { days } };
  }

  async missing(audit?: RequestAuditMeta & { actorUserId?: string }) {
    const employees = await this.prisma.employee.findMany({
      where: { deletedAt: null },
      include: { personalDetail: true, complianceRecords: { where: { deletedAt: null } } },
    });
    const missing = employees.filter((e) => e.complianceRecords.length === 0);
    if (audit?.actorUserId) {
      await this.audit.logDataAccess({
        userId: audit.actorUserId,
        module: AuditModule.EMPLOYEE_COMPLIANCE,
        recordType: 'ComplianceQuery',
        recordId: 'missing',
        accessType: DataAccessType.VIEW,
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
        metadata: { resultCount: missing.length },
      });
    }
    return { data: missing };
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
