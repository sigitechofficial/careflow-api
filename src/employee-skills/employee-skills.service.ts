import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { defaultExpiryFromValidity } from '../common/utils/validity-default.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { CreateEmployeeSkillDto } from './dto/create-employee-skill.dto';
import { UpdateEmployeeSkillDto } from './dto/update-employee-skill.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

@Injectable()
export class EmployeeSkillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(employeeId: string) {
    const items = await this.prisma.employeeSkill.findMany({
      where: { employeeId, deletedAt: null },
      include: { skillType: true },
      orderBy: { createdAt: 'desc' },
    });
    return { data: items };
  }

  async create(userId: string, employeeId: string, dto: CreateEmployeeSkillDto, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    // No expiry sent: refresh due the skill type's refresh period from today (Settings → Skill types).
    let expiryDate = dto.expiryDate;
    if (expiryDate === undefined && dto.skillTypeId) {
      const type = await this.prisma.skillType.findFirst({
        where: { id: dto.skillTypeId, deletedAt: null },
        select: { defaultRefreshMonths: true },
      });
      expiryDate = defaultExpiryFromValidity(new Date(), type?.defaultRefreshMonths) ?? undefined;
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeSkill.create({
        data: { employeeId, ...dto, expiryDate, createdById: userId },
        include: { skillType: true },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_SKILL_ADDED,
        recordType: 'EmployeeSkill',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Employee skill created', data: created };
    });
  }

  async update(
    userId: string,
    employeeId: string,
    skillId: string,
    dto: UpdateEmployeeSkillDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeSkill.findFirst({
        where: { id: skillId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Employee skill not found');
      const updated = await tx.employeeSkill.update({
        where: { id: skillId },
        data: { ...dto, updatedById: userId },
        include: { skillType: true },
      });
      const oldS = auditSnapshot(existing);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_SKILL_UPDATED,
        recordType: 'EmployeeSkill',
        recordId: skillId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS), employeeId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Employee skill updated', data: updated };
    });
  }

  async remove(userId: string, employeeId: string, skillId: string, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeSkill.findFirst({
        where: { id: skillId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Employee skill not found');
      await tx.employeeSkill.update({
        where: { id: skillId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_SKILL_DELETED,
        recordType: 'EmployeeSkill',
        recordId: skillId,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Employee skill deleted', data: {} };
    });
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
