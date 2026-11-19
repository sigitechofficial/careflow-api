import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LearningCompetencyAssessmentStatus,
  LearningCompetencyOutcome,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { logLearningChange, type LearningActor } from './learning-audit.util';
import { checkedCompetencyCriteria } from './learning-quiz-rules.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  CreateCompetencyAssessmentDto,
  CreateCompetencyDto,
  LearningListQueryDto,
  ReviewCompetencyAssessmentDto,
  UpdateCompetencyDto,
} from './dto/learning.dto';

@Injectable()
export class LearningCompetenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: LearningListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { deletedAt: null, ...(query.isActive !== undefined ? { isActive: query.isActive } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.learningCompetency.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningCompetency.count({ where }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.learningCompetency.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Competency not found');
    return row;
  }

  private async assertActiveCategory(categoryId: string) {
    const category = await this.prisma.learningCategory.findFirst({
      where: { id: categoryId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('Choose an active category');
  }

  async create(dto: CreateCompetencyDto, actor?: LearningActor) {
    const existing = await this.prisma.learningCompetency.findFirst({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Competency code already exists');
    if (dto.categoryId) await this.assertActiveCategory(dto.categoryId);
    const assessmentCriteria = checkedCompetencyCriteria(
      dto.assessmentCriteria,
    );
    const row = await this.prisma.learningCompetency.create({
      data: {
        ...dto,
        description: dto.description?.trim() || null,
        assessmentCriteria,
        createdById: actor?.userId,
        updatedById: actor?.userId,
      },
    });
    await logLearningChange(this.audit, actor, {
      action: 'learning_competency_created',
      recordType: 'LearningCompetency',
      recordId: row.id,
      newValues: row,
    });
    return row;
  }

  async update(id: string, dto: UpdateCompetencyDto, actor?: LearningActor) {
    const before = await this.getById(id);
    if (dto.code && dto.code !== before.code) {
      const clash = await this.prisma.learningCompetency.findFirst({
        where: { code: dto.code },
      });
      if (clash) throw new ConflictException('Competency code already exists');
    }
    if (dto.categoryId && dto.categoryId !== before.categoryId)
      await this.assertActiveCategory(dto.categoryId);
    const row = await this.prisma.learningCompetency.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.assessmentCriteria !== undefined
          ? {
              assessmentCriteria: checkedCompetencyCriteria(
                dto.assessmentCriteria,
              ),
            }
          : {}),
        updatedById: actor?.userId,
      },
    });
    await logLearningChange(this.audit, actor, {
      action: 'learning_competency_updated',
      recordType: 'LearningCompetency',
      recordId: id,
      oldValues: before,
      newValues: row,
    });
    return row;
  }

  async softDelete(id: string, actor?: LearningActor) {
    const before = await this.getById(id);
    const row = await this.prisma.learningCompetency.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        deletedById: actor?.userId,
      },
    });
    await logLearningChange(this.audit, actor, {
      action: 'learning_competency_deleted',
      recordType: 'LearningCompetency',
      recordId: id,
      oldValues: before,
    });
    return row;
  }

  async createAssessment(dto: CreateCompetencyAssessmentDto) {
    await this.getById(dto.competencyId);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.learningCompetencyAssessment.create({
        data: {
          employeeId: dto.employeeId,
          competencyId: dto.competencyId,
          assignmentId: dto.assignmentId,
          assessmentDate: new Date(dto.assessmentDate),
          location: dto.location,
          assessmentMethod: dto.assessmentMethod,
          status: LearningCompetencyAssessmentStatus.DRAFT,
        },
      });

      if (dto.criterionResults?.length) {
        for (const criterion of dto.criterionResults) {
          await tx.learningCompetencyCriterionResult.create({
            data: {
              competencyAssessmentId: row.id,
              criterion: criterion.criterion,
              result: criterion.result,
              comments: criterion.comments,
              displayOrder: criterion.displayOrder ?? 0,
            },
          });
        }
      }

      return tx.learningCompetencyAssessment.findUnique({
        where: { id: row.id },
        include: { criterionResults: true },
      });
    });
  }

  async submitAssessment(id: string) {
    const row = await this.prisma.learningCompetencyAssessment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Assessment not found');
    if (row.status !== LearningCompetencyAssessmentStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT assessments can be submitted');
    }
    return this.prisma.learningCompetencyAssessment.update({
      where: { id },
      data: { status: LearningCompetencyAssessmentStatus.SUBMITTED },
    });
  }

  async approveAssessment(id: string, userId: string, dto: ReviewCompetencyAssessmentDto) {
    const row = await this.prisma.learningCompetencyAssessment.findUnique({
      where: { id },
      include: { competency: true },
    });
    if (!row) throw new NotFoundException('Assessment not found');
    if (row.status !== LearningCompetencyAssessmentStatus.SUBMITTED) {
      throw new BadRequestException('Only SUBMITTED assessments can be approved');
    }

    const validUntil = row.competency.validityDays
      ? new Date(Date.now() + row.competency.validityDays * 86_400_000)
      : null;

    return this.prisma.learningCompetencyAssessment.update({
      where: { id },
      data: {
        status: LearningCompetencyAssessmentStatus.APPROVED,
        assessorUserId: userId,
        assessorComments: dto.assessorComments,
        improvementActions: dto.improvementActions,
        outcome: LearningCompetencyOutcome.COMPETENT,
        validFrom: row.assessmentDate,
        validUntil,
      },
    });
  }

  async rejectAssessment(id: string, userId: string, dto: ReviewCompetencyAssessmentDto) {
    const row = await this.prisma.learningCompetencyAssessment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Assessment not found');
    if (row.status !== LearningCompetencyAssessmentStatus.SUBMITTED) {
      throw new BadRequestException('Only SUBMITTED assessments can be rejected');
    }
    return this.prisma.learningCompetencyAssessment.update({
      where: { id },
      data: {
        status: LearningCompetencyAssessmentStatus.REJECTED,
        assessorUserId: userId,
        assessorComments: dto.assessorComments,
        improvementActions: dto.improvementActions,
        outcome: LearningCompetencyOutcome.NOT_COMPETENT,
      },
    });
  }

  async listAssessments(query: LearningListQueryDto & { employeeId?: string; competencyId?: string }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.competencyId ? { competencyId: query.competencyId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.learningCompetencyAssessment.findMany({
        where,
        orderBy: { assessmentDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { criterionResults: true },
      }),
      this.prisma.learningCompetencyAssessment.count({ where }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }
}
