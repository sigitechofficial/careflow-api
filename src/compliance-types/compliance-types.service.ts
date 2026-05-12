import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ComplianceTypeQueryDto } from './dto/compliance-type-query.dto';
import { CreateComplianceTypeDto } from './dto/create-compliance-type.dto';
import { UpdateComplianceTypeDto } from './dto/update-compliance-type.dto';

@Injectable()
export class ComplianceTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: ComplianceTypeQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ComplianceTypeWhereInput = { deletedAt: null };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.category) where.category = query.category;
    if (query.hasExpiry !== undefined) where.hasExpiry = query.hasExpiry;
    if (query.requiresDocument !== undefined) where.requiresDocument = query.requiresDocument;
    if (query.requiresVerification !== undefined) where.requiresVerification = query.requiresVerification;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
      ];
    }

    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';
    const orderBy: Prisma.ComplianceTypeOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.complianceType.count({ where }),
      this.prisma.complianceType.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.complianceType.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Compliance type not found');
    return { data: row };
  }

  async create(userId: string, dto: CreateComplianceTypeDto, meta?: RequestAuditMeta) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.complianceType.create({
          data: {
            name: dto.name,
            code: dto.code,
            description: dto.description ?? null,
            category: dto.category,
            hasExpiry: dto.hasExpiry ?? true,
            defaultValidityMonths: dto.defaultValidityMonths ?? null,
            requiresDocument: dto.requiresDocument ?? true,
            requiresVerification: dto.requiresVerification ?? true,
            isMandatoryByDefault: dto.isMandatoryByDefault ?? false,
            createdById: userId,
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.COMPLIANCE_TYPE,
          action: AuditAction.COMPLIANCE_TYPE_CREATED,
          recordType: 'ComplianceType',
          recordId: created.id,
          newValues: auditSnapshot(created),
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
        return { message: 'Compliance type created', data: created };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A compliance type with this name or code already exists');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateComplianceTypeDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.complianceType.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Compliance type not found');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.complianceType.update({
          where: { id },
          data: {
            ...dto,
            updatedById: userId,
            defaultValidityMonths: dto.defaultValidityMonths === undefined ? undefined : dto.defaultValidityMonths,
          },
        });
        const oldS = auditSnapshot(existing);
        const newS = auditSnapshot(updated);
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.COMPLIANCE_TYPE,
          action: AuditAction.COMPLIANCE_TYPE_UPDATED,
          recordType: 'ComplianceType',
          recordId: id,
          oldValues: oldS,
          newValues: newS,
          metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
        return { message: 'Compliance type updated', data: updated };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A compliance type with this name or code already exists');
      }
      throw e;
    }
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.complianceType.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Compliance type not found');
    return this.prisma.$transaction(async (tx) => {
      await tx.complianceType.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.COMPLIANCE_TYPE,
        action: AuditAction.COMPLIANCE_TYPE_DELETED,
        recordType: 'ComplianceType',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Compliance type deleted', data: {} };
    });
  }
}
