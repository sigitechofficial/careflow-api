import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { CreateEmployeeCertificationDto } from './dto/create-employee-certification.dto';
import { UpdateEmployeeCertificationDto } from './dto/update-employee-certification.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

@Injectable()
export class EmployeeCertificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(employeeId: string) {
    const items = await this.prisma.employeeWorkCertification.findMany({
      where: { employeeId, deletedAt: null },
      include: { certificationType: true },
      orderBy: { createdAt: 'desc' },
    });
    return { data: items };
  }

  async create(userId: string, employeeId: string, dto: CreateEmployeeCertificationDto, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeWorkCertification.create({
        data: {
          employeeId,
          certificationTypeId: dto.certificationTypeId,
          reference: dto.reference,
          issueDate: dto.issueDate,
          expiryDate: dto.expiryDate,
          notes: dto.notes,
          certificateUrl: dto.certificateUrl,
          createdById: userId,
        },
        include: { certificationType: true },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_CERTIFICATION_ADDED,
        recordType: 'EmployeeWorkCertification',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Certification created', data: created };
    });
  }

  async update(
    userId: string,
    employeeId: string,
    certificationId: string,
    dto: UpdateEmployeeCertificationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeWorkCertification.findFirst({
        where: { id: certificationId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Certification not found');

      const updated = await tx.employeeWorkCertification.update({
        where: { id: certificationId },
        data: { ...dto, updatedById: userId },
      });
      const oldS = auditSnapshot(existing);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_CERTIFICATION_UPDATED,
        recordType: 'EmployeeWorkCertification',
        recordId: certificationId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS), employeeId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Certification updated', data: updated };
    });
  }

  async remove(userId: string, employeeId: string, certificationId: string, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeWorkCertification.findFirst({
        where: { id: certificationId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Certification not found');

      await tx.employeeWorkCertification.update({
        where: { id: certificationId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_CERTIFICATION_DELETED,
        recordType: 'EmployeeWorkCertification',
        recordId: certificationId,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Certification deleted', data: {} };
    });
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
