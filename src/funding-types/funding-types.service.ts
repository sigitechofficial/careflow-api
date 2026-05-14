import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { FundingTypeQueryDto } from './dto/funding-type-query.dto';
import { CreateFundingTypeDto } from './dto/create-funding-type.dto';
import { UpdateFundingTypeDto } from './dto/update-funding-type.dto';

@Injectable()
export class FundingTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: FundingTypeQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.FundingTypeWhereInput = { deletedAt: null };
    if (query.isActive !== undefined) where.isActive = query.isActive;
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
    const orderBy: Prisma.FundingTypeOrderByWithRelationInput = { [sortBy]: sortOrder };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fundingType.count({ where }),
      this.prisma.fundingType.findMany({ where, orderBy, skip, take: limit }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.fundingType.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Funding type not found');
    return { data: row };
  }

  async create(userId: string, dto: CreateFundingTypeDto, meta?: RequestAuditMeta) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.fundingType.create({
          data: {
            name: dto.name.trim(),
            code: dto.code.trim().toUpperCase(),
            description: dto.description?.trim() ?? null,
            createdById: userId,
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.FUNDING_TYPE,
          action: AuditAction.FUNDING_TYPE_CREATED,
          recordType: 'FundingType',
          recordId: created.id,
          newValues: auditSnapshot(created),
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Funding type created', data: created };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A funding type with this code already exists');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateFundingTypeDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.fundingType.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Funding type not found');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.fundingType.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
            ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
            updatedById: userId,
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.FUNDING_TYPE,
          action: AuditAction.FUNDING_TYPE_UPDATED,
          recordType: 'FundingType',
          recordId: id,
          oldValues: auditSnapshot(existing),
          newValues: auditSnapshot(updated),
          metadata: { changedFields: this.audit.getChangedFields(auditSnapshot(existing), auditSnapshot(updated)) },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Funding type updated', data: updated };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A funding type with this code already exists');
      }
      throw e;
    }
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.fundingType.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Funding type not found');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.fundingType.update({
        where: { id },
        data: { deletedAt: now, deletedById: userId, isActive: false, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.FUNDING_TYPE,
        action: AuditAction.FUNDING_TYPE_DELETED,
        recordType: 'FundingType',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Funding type deleted', data: {} };
    });
  }
}
