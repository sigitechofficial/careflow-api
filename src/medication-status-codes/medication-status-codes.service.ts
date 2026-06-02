import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { MedicationStatusCodeQueryDto } from './dto/medication-status-code-query.dto';

@Injectable()
export class MedicationStatusCodesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: MedicationStatusCodeQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const where: Prisma.MedicationStatusCodeWhereInput = { deletedAt: null };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.category) where.category = query.category;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { code: { contains: s, mode: 'insensitive' } },
        { label: { contains: s, mode: 'insensitive' } },
      ];
    }
    const sortBy = query.sortBy ?? 'sortOrder';
    const sortOrder = query.sortOrder ?? 'asc';
    const orderBy: Prisma.MedicationStatusCodeOrderByWithRelationInput = { [sortBy]: sortOrder };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.medicationStatusCode.count({ where }),
      this.prisma.medicationStatusCode.findMany({ where, orderBy, skip, take: limit }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async listActive() {
    const rows = await this.prisma.medicationStatusCode.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    return rows;
  }

  async getById(id: string) {
    const row = await this.prisma.medicationStatusCode.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Medication status code not found');
    return { data: row };
  }

  async getByCode(code: string) {
    const row = await this.prisma.medicationStatusCode.findFirst({
      where: { code, deletedAt: null, isActive: true },
    });
    if (!row) throw new NotFoundException('Medication status code not found');
    return { data: row };
  }

  async update(id: string, dto: {
    label?: string;
    color?: string;
    textColor?: string;
    reasonRequirement?: Prisma.MedicationStatusCodeUpdateInput['reasonRequirement'];
    managerReviewRequirement?: Prisma.MedicationStatusCodeUpdateInput['managerReviewRequirement'];
    sortOrder?: number;
    isActive?: boolean;
  }) {
    await this.getById(id);
    const row = await this.prisma.medicationStatusCode.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.textColor !== undefined ? { textColor: dto.textColor } : {}),
        ...(dto.reasonRequirement !== undefined ? { reasonRequirement: dto.reasonRequirement } : {}),
        ...(dto.managerReviewRequirement !== undefined
          ? { managerReviewRequirement: dto.managerReviewRequirement }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return { data: row };
  }
}
