import { Injectable, NotFoundException } from '@nestjs/common';
import { LearningExternalVerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  CreateExternalTrainingDto,
  LearningListQueryDto,
  RejectExternalTrainingDto,
  UpdateExternalTrainingDto,
  VerifyExternalTrainingDto,
} from './dto/learning.dto';

@Injectable()
export class LearningExternalTrainingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: LearningListQueryDto & { employeeId?: string; verificationStatus?: LearningExternalVerificationStatus }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      deletedAt: null,
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.learningExternalTraining.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningExternalTraining.count({ where }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.learningExternalTraining.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('External training record not found');
    return row;
  }

  async create(userId: string, dto: CreateExternalTrainingDto) {
    return this.prisma.learningExternalTraining.create({
      data: {
        ...dto,
        completedAt: new Date(dto.completedAt),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById: userId,
        updatedById: userId,
      },
    });
  }

  async update(id: string, userId: string, dto: UpdateExternalTrainingDto) {
    await this.getById(id);
    return this.prisma.learningExternalTraining.update({
      where: { id },
      data: {
        ...dto,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        updatedById: userId,
      },
    });
  }

  async softDelete(id: string, userId: string) {
    await this.getById(id);
    return this.prisma.learningExternalTraining.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId },
    });
  }

  async verify(id: string, userId: string, dto: VerifyExternalTrainingDto) {
    await this.getById(id);
    return this.prisma.learningExternalTraining.update({
      where: { id },
      data: {
        verificationStatus: LearningExternalVerificationStatus.VERIFIED,
        verifiedById: userId,
        verifiedAt: new Date(),
        verificationNotes: dto.verificationNotes,
        updatedById: userId,
      },
    });
  }

  async reject(id: string, userId: string, dto: RejectExternalTrainingDto) {
    await this.getById(id);
    return this.prisma.learningExternalTraining.update({
      where: { id },
      data: {
        verificationStatus: LearningExternalVerificationStatus.REJECTED,
        verifiedById: userId,
        verifiedAt: new Date(),
        verificationNotes: dto.verificationNotes,
        updatedById: userId,
      },
    });
  }
}
