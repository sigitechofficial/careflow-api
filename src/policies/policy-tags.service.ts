import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePolicyTagDto, PolicyTagListQueryDto, UpdatePolicyTagDto } from './dto/policy.dto';

@Injectable()
export class PolicyTagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private map(row: {
    id: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }) {
    return {
      id: row.id,
      name: row.name,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  async list(query: PolicyTagListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      deletedAt: null,
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.policyTag.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.policyTag.count({ where }),
    ]);

    return { data: rows.map((r) => this.map(r)), meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.policyTag.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Policy tag not found');
    return this.map(row);
  }

  async create(userId: string, dto: CreatePolicyTagDto, meta?: RequestAuditMeta) {
    const name = dto.name.trim();
    const existing = await this.prisma.policyTag.findFirst({ where: { name } });
    if (existing) throw new ConflictException('Tag name already exists');

    const row = await this.prisma.policyTag.create({
      data: {
        name,
        createdById: userId,
        updatedById: userId,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.POLICY,
      action: 'policy_tag_created',
      recordType: 'PolicyTag',
      recordId: row.id,
      newValues: this.map(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.map(row);
  }

  async update(id: string, userId: string, dto: UpdatePolicyTagDto, meta?: RequestAuditMeta) {
    const existing = await this.getById(id);
    if (dto.name && dto.name.trim() !== existing.name) {
      const clash = await this.prisma.policyTag.findFirst({ where: { name: dto.name.trim() } });
      if (clash) throw new ConflictException('Tag name already exists');
    }

    const row = await this.prisma.policyTag.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        updatedById: userId,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.POLICY,
      action: 'policy_tag_updated',
      recordType: 'PolicyTag',
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
    const inUse = await this.prisma.policyTagLink.count({ where: { tagId: id } });
    if (inUse > 0) {
      throw new BadRequestException('Cannot delete a tag that is still assigned to policies');
    }

    const row = await this.prisma.policyTag.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId, isActive: false },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.POLICY,
      action: 'policy_tag_deleted',
      recordType: 'PolicyTag',
      recordId: id,
      oldValues: existing,
      newValues: this.map(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.map(row);
  }
}
