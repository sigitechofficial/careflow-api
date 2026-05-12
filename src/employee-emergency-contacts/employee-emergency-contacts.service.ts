import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { CreateEmergencyContactDto } from './dto/create-emergency-contact.dto';
import { UpdateEmergencyContactDto } from './dto/update-emergency-contact.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

@Injectable()
export class EmployeeEmergencyContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(employeeId: string) {
    const items = await this.prisma.employeeEmergencyContact.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { data: items };
  }

  async create(userId: string, employeeId: string, dto: CreateEmergencyContactDto, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeEmergencyContact.create({
        data: { employeeId, ...dto, createdById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMERGENCY_CONTACT_ADDED,
        recordType: 'EmployeeEmergencyContact',
        recordId: created.id,
        newValues: auditSnapshot({ ...created, employeeId }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Emergency contact created', data: created };
    });
  }

  async update(
    userId: string,
    employeeId: string,
    contactId: string,
    dto: UpdateEmergencyContactDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeEmergencyContact.findFirst({
        where: { id: contactId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Emergency contact not found');

      const updated = await tx.employeeEmergencyContact.update({
        where: { id: contactId },
        data: { ...dto, updatedById: userId },
      });
      const oldS = auditSnapshot(existing);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMERGENCY_CONTACT_UPDATED,
        recordType: 'EmployeeEmergencyContact',
        recordId: contactId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS), employeeId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Emergency contact updated', data: updated };
    });
  }

  async remove(userId: string, employeeId: string, contactId: string, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeEmergencyContact.findFirst({
        where: { id: contactId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Emergency contact not found');

      await tx.employeeEmergencyContact.update({
        where: { id: contactId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMERGENCY_CONTACT_DELETED,
        recordType: 'EmployeeEmergencyContact',
        recordId: contactId,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Emergency contact deleted', data: {} };
    });
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
