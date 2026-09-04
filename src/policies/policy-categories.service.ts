import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePolicyCategoryDto,
  PolicyCategoryListQueryDto,
  UpdatePolicyCategoryDto,
} from './dto/policy.dto';

@Injectable()
export class PolicyCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private map(row: {
    id: string;
    name: string;
    code: string;
    description: string | null;
    displayOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }) {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      displayOrder: row.displayOrder,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  async list(query: PolicyCategoryListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { code: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.policyCategory.findMany({
        where,
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.policyCategory.count({ where }),
    ]);

    return { data: rows.map((r) => this.map(r)), meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.policyCategory.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Policy category not found');
    return this.map(row);
  }

  async create(userId: string, dto: CreatePolicyCategoryDto, meta?: RequestAuditMeta) {
    const code = dto.code.trim();
    const existing = await this.prisma.policyCategory.findFirst({ where: { code } });
    if (existing) throw new ConflictException('Category code already exists');

    const row = await this.prisma.policyCategory.create({
      data: {
        name: dto.name.trim(),
        code,
        description: dto.description?.trim() || null,
        displayOrder: dto.displayOrder ?? 0,
        createdById: userId,
        updatedById: userId,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.POLICY,
      action: 'policy_category_created',
      recordType: 'PolicyCategory',
      recordId: row.id,
      newValues: this.map(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.map(row);
  }

  async update(id: string, userId: string, dto: UpdatePolicyCategoryDto, meta?: RequestAuditMeta) {
    const existing = await this.getById(id);
    if (dto.code && dto.code.trim() !== existing.code) {
      const clash = await this.prisma.policyCategory.findFirst({ where: { code: dto.code.trim() } });
      if (clash) throw new ConflictException('Category code already exists');
    }

    const row = await this.prisma.policyCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.code !== undefined ? { code: dto.code.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.displayOrder !== undefined ? { displayOrder: dto.displayOrder } : {}),
        updatedById: userId,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.POLICY,
      action: 'policy_category_updated',
      recordType: 'PolicyCategory',
      recordId: id,
      oldValues: existing,
      newValues: this.map(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.map(row);
  }

  async softDelete(id: string, userId: string, meta?: RequestAuditMeta) {
    const existing = await this.getById(id);
    const inUse = await this.prisma.policyDocument.count({
      where: { primaryCategoryId: id, deletedAt: null },
    });
    if (inUse > 0) {
      throw new BadRequestException('Cannot delete a category that is still assigned to policies');
    }

    const row = await this.prisma.policyCategory.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId, isActive: false },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.POLICY,
      action: 'policy_category_deleted',
      recordType: 'PolicyCategory',
      recordId: id,
      oldValues: existing,
      newValues: this.map(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.map(row);
  }
}
