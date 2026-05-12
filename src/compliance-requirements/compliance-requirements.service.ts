import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ComplianceRequirementQueryDto } from './dto/compliance-requirement-query.dto';
import { CreateComplianceRequirementDto } from './dto/create-compliance-requirement.dto';
import { UpdateComplianceRequirementDto } from './dto/update-compliance-requirement.dto';

@Injectable()
export class ComplianceRequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: ComplianceRequirementQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ComplianceRequirementWhereInput = { deletedAt: null };
    if (query.complianceTypeId) where.complianceTypeId = query.complianceTypeId;
    if (query.roleId) where.roleId = query.roleId;
    if (query.workAreaId) where.workAreaId = query.workAreaId;
    if (query.jobTitleId) where.jobTitleId = query.jobTitleId;
    if (query.contractTypeId) where.contractTypeId = query.contractTypeId;
    if (query.locationId) where.locationId = query.locationId;
    if (query.zoneId) where.zoneId = query.zoneId;
    if (query.isMandatory !== undefined) where.isMandatory = query.isMandatory;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.complianceRequirement.count({ where }),
      this.prisma.complianceRequirement.findMany({
        where,
        include: { complianceType: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.complianceRequirement.findFirst({
      where: { id, deletedAt: null },
      include: { complianceType: true },
    });
    if (!row) throw new NotFoundException('Compliance requirement not found');
    return { data: row };
  }

  async create(userId: string, dto: CreateComplianceRequirementDto, meta?: RequestAuditMeta) {
    const type = await this.prisma.complianceType.findFirst({
      where: { id: dto.complianceTypeId, deletedAt: null },
    });
    if (!type) throw new NotFoundException('Compliance type not found');

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.complianceRequirement.create({
        data: {
          complianceTypeId: dto.complianceTypeId,
          roleId: dto.roleId ?? null,
          workAreaId: dto.workAreaId ?? null,
          jobTitleId: dto.jobTitleId ?? null,
          contractTypeId: dto.contractTypeId ?? null,
          locationId: dto.locationId ?? null,
          zoneId: dto.zoneId ?? null,
          isMandatory: dto.isMandatory ?? true,
          renewalBeforeDays: dto.renewalBeforeDays ?? 30,
          notes: dto.notes ?? null,
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.COMPLIANCE_REQUIREMENT,
        action: AuditAction.COMPLIANCE_REQUIREMENT_CREATED,
        recordType: 'ComplianceRequirement',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance requirement created', data: created };
    });
  }

  async update(userId: string, id: string, dto: UpdateComplianceRequirementDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.complianceRequirement.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Compliance requirement not found');
    if (dto.complianceTypeId) {
      const t = await this.prisma.complianceType.findFirst({
        where: { id: dto.complianceTypeId, deletedAt: null },
      });
      if (!t) throw new NotFoundException('Compliance type not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.complianceRequirement.update({
        where: { id },
        data: {
          complianceTypeId: dto.complianceTypeId,
          roleId: dto.roleId === undefined ? undefined : dto.roleId,
          workAreaId: dto.workAreaId === undefined ? undefined : dto.workAreaId,
          jobTitleId: dto.jobTitleId === undefined ? undefined : dto.jobTitleId,
          contractTypeId: dto.contractTypeId === undefined ? undefined : dto.contractTypeId,
          locationId: dto.locationId === undefined ? undefined : dto.locationId,
          zoneId: dto.zoneId === undefined ? undefined : dto.zoneId,
          isMandatory: dto.isMandatory,
          renewalBeforeDays: dto.renewalBeforeDays,
          notes: dto.notes === undefined ? undefined : dto.notes,
          isActive: dto.isActive,
          updatedById: userId,
        },
      });
      const oldS = auditSnapshot(existing);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.COMPLIANCE_REQUIREMENT,
        action: AuditAction.COMPLIANCE_REQUIREMENT_UPDATED,
        recordType: 'ComplianceRequirement',
        recordId: id,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance requirement updated', data: updated };
    });
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.complianceRequirement.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Compliance requirement not found');
    return this.prisma.$transaction(async (tx) => {
      await tx.complianceRequirement.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.COMPLIANCE_REQUIREMENT,
        action: AuditAction.COMPLIANCE_REQUIREMENT_DELETED,
        recordType: 'ComplianceRequirement',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance requirement deleted', data: {} };
    });
  }
}
