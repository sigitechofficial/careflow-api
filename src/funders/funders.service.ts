import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { FunderQueryDto } from './dto/funder-query.dto';
import { CreateFunderDto } from './dto/create-funder.dto';
import { UpdateFunderDto } from './dto/update-funder.dto';

@Injectable()
export class FundersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: FunderQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.FunderWhereInput = { deletedAt: null };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.fundingTypeId) where.fundingTypeId = query.fundingTypeId;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s, mode: 'insensitive' } },
        { contactName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
      ];
    }
    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';
    const orderBy: Prisma.FunderOrderByWithRelationInput = { [sortBy]: sortOrder };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.funder.count({ where }),
      this.prisma.funder.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: { fundingType: { select: { id: true, name: true, code: true } } },
      }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.funder.findFirst({
      where: { id, deletedAt: null },
      include: { fundingType: { select: { id: true, name: true, code: true } } },
    });
    if (!row) throw new NotFoundException('Funder not found');
    return { data: row };
  }

  private async assertFundingType(fundingTypeId: string | undefined) {
    if (!fundingTypeId) return;
    const ft = await this.prisma.fundingType.findFirst({ where: { id: fundingTypeId, deletedAt: null } });
    if (!ft) throw new NotFoundException('Funding type not found');
  }

  async create(userId: string, dto: CreateFunderDto, meta?: RequestAuditMeta) {
    await this.assertFundingType(dto.fundingTypeId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.funder.create({
          data: {
            name: dto.name.trim(),
            code: dto.code?.trim() || null,
            fundingTypeId: dto.fundingTypeId ?? null,
            contactName: dto.contactName?.trim() ?? null,
            email: dto.email?.trim() ?? null,
            phone: dto.phone?.trim() ?? null,
            addressLine1: dto.addressLine1?.trim() ?? null,
            addressLine2: dto.addressLine2?.trim() ?? null,
            town: dto.town?.trim() ?? null,
            county: dto.county?.trim() ?? null,
            country: dto.country?.trim() ?? null,
            postcode: dto.postcode?.trim() ?? null,
            notes: dto.notes?.trim() ?? null,
            createdById: userId,
          },
          include: { fundingType: { select: { id: true, name: true, code: true } } },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.FUNDER,
          action: AuditAction.FUNDER_CREATED,
          recordType: 'Funder',
          recordId: created.id,
          newValues: auditSnapshot(created),
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Funder created', data: created };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A funder with this code already exists');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateFunderDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.funder.findFirst({
      where: { id, deletedAt: null },
      include: { fundingType: { select: { id: true, name: true, code: true } } },
    });
    if (!existing) throw new NotFoundException('Funder not found');
    if (dto.fundingTypeId !== undefined) await this.assertFundingType(dto.fundingTypeId ?? undefined);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.funder.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.code !== undefined ? { code: dto.code?.trim() || null } : {}),
            ...(dto.fundingTypeId !== undefined ? { fundingTypeId: dto.fundingTypeId ?? null } : {}),
            ...(dto.contactName !== undefined ? { contactName: dto.contactName?.trim() ?? null } : {}),
            ...(dto.email !== undefined ? { email: dto.email?.trim() ?? null } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone?.trim() ?? null } : {}),
            ...(dto.addressLine1 !== undefined ? { addressLine1: dto.addressLine1?.trim() ?? null } : {}),
            ...(dto.addressLine2 !== undefined ? { addressLine2: dto.addressLine2?.trim() ?? null } : {}),
            ...(dto.town !== undefined ? { town: dto.town?.trim() ?? null } : {}),
            ...(dto.county !== undefined ? { county: dto.county?.trim() ?? null } : {}),
            ...(dto.country !== undefined ? { country: dto.country?.trim() ?? null } : {}),
            ...(dto.postcode !== undefined ? { postcode: dto.postcode?.trim() ?? null } : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes?.trim() ?? null } : {}),
            updatedById: userId,
          },
          include: { fundingType: { select: { id: true, name: true, code: true } } },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.FUNDER,
          action: AuditAction.FUNDER_UPDATED,
          recordType: 'Funder',
          recordId: id,
          oldValues: auditSnapshot(existing),
          newValues: auditSnapshot(updated),
          metadata: { changedFields: this.audit.getChangedFields(auditSnapshot(existing), auditSnapshot(updated)) },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Funder updated', data: updated };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A funder with this code already exists');
      }
      throw e;
    }
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.funder.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Funder not found');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.funder.update({
        where: { id },
        data: { deletedAt: now, deletedById: userId, isActive: false, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.FUNDER,
        action: AuditAction.FUNDER_DELETED,
        recordType: 'Funder',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Funder deleted', data: {} };
    });
  }
}
