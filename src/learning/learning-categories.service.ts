import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  CreateLearningCategoryDto,
  LearningListQueryDto,
  UpdateLearningCategoryDto,
} from './dto/learning.dto';

@Injectable()
export class LearningCategoriesService {
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

  async list(query: LearningListQueryDto) {
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
      this.prisma.learningCategory.findMany({
        where,
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningCategory.count({ where }),
    ]);

    return { data: rows.map((r) => this.map(r)), meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.learningCategory.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Category not found');
    return this.map(row);
  }

  async create(userId: string, dto: CreateLearningCategoryDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.learningCategory.findFirst({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Category code already exists');

    const row = await this.prisma.learningCategory.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        displayOrder: dto.displayOrder ?? 0,
        createdById: userId,
        updatedById: userId,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_category_created',
      recordType: 'LearningCategory',
      recordId: row.id,
      newValues: this.map(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.map(row);
  }

  async update(id: string, userId: string, dto: UpdateLearningCategoryDto, meta?: RequestAuditMeta) {
    const existing = await this.getById(id);
    if (dto.code && dto.code !== existing.code) {
      const clash = await this.prisma.learningCategory.findFirst({ where: { code: dto.code } });
      if (clash) throw new ConflictException('Category code already exists');
    }

    const row = await this.prisma.learningCategory.update({
      where: { id },
      data: { ...dto, updatedById: userId },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_category_updated',
      recordType: 'LearningCategory',
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
    const row = await this.prisma.learningCategory.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId, isActive: false },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_category_deleted',
      recordType: 'LearningCategory',
      recordId: id,
      oldValues: existing,
      newValues: this.map(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.map(row);
  }
}
