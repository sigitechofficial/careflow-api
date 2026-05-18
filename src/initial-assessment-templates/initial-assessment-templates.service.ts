import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { InitialAssessmentTemplateQueryDto } from './dto/initial-assessment-template-query.dto';
import { CreateInitialAssessmentTemplateDto } from './dto/create-initial-assessment-template.dto';
import { UpdateInitialAssessmentTemplateDto } from './dto/update-initial-assessment-template.dto';
import { CreateInitialAssessmentSectionDto } from './dto/create-initial-assessment-section.dto';
import { UpdateInitialAssessmentSectionDto } from './dto/update-initial-assessment-section.dto';
import { CreateInitialAssessmentQuestionDto } from './dto/create-initial-assessment-question.dto';
import { UpdateInitialAssessmentQuestionDto } from './dto/update-initial-assessment-question.dto';

const templateInclude = {
  sections: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' as const },
    include: {
      questions: {
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' as const },
      },
    },
  },
} satisfies Prisma.InitialAssessmentTemplateInclude;

@Injectable()
export class InitialAssessmentTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async getTemplates(query: InitialAssessmentTemplateQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.InitialAssessmentTemplateWhereInput = { deletedAt: null };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.isDefault !== undefined) where.isDefault = query.isDefault;
    if (query.version !== undefined) where.version = query.version;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
      ];
    }
    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';
    const orderBy = { [sortBy]: sortOrder } as Prisma.InitialAssessmentTemplateOrderByWithRelationInput;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.initialAssessmentTemplate.count({ where }),
      this.prisma.initialAssessmentTemplate.findMany({ where, orderBy, skip, take: limit }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getDefaultTemplate() {
    const row = await this.prisma.initialAssessmentTemplate.findFirst({
      where: { isDefault: true, isActive: true, deletedAt: null },
      include: templateInclude,
    });
    if (!row) throw new NotFoundException('Default initial assessment template not found');
    return { data: row };
  }

  async getTemplateById(templateId: string) {
    const row = await this.prisma.initialAssessmentTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      include: templateInclude,
    });
    if (!row) throw new NotFoundException('Initial assessment template not found');
    return { data: row };
  }

  async createTemplate(userId: string, dto: CreateInitialAssessmentTemplateDto, meta?: RequestAuditMeta) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.initialAssessmentTemplate.updateMany({
          where: { isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
      }
      const created = await tx.initialAssessmentTemplate.create({
        data: {
          name: dto.name.trim(),
          description: dto.description?.trim() ?? null,
          version: dto.version ?? 1,
          isDefault: dto.isDefault ?? false,
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_TEMPLATE_CREATED,
        recordType: 'InitialAssessmentTemplate',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Initial assessment template created', data: created };
    });
  }

  async updateTemplate(
    userId: string,
    templateId: string,
    dto: UpdateInitialAssessmentTemplateDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.initialAssessmentTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Initial assessment template not found');
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.initialAssessmentTemplate.updateMany({
          where: { isDefault: true, deletedAt: null, id: { not: templateId } },
          data: { isDefault: false },
        });
      }
      const updated = await tx.initialAssessmentTemplate.update({
        where: { id: templateId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
          ...(dto.version !== undefined ? { version: dto.version } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_TEMPLATE_UPDATED,
        recordType: 'InitialAssessmentTemplate',
        recordId: updated.id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Initial assessment template updated', data: updated };
    });
  }

  async softDeleteTemplate(userId: string, templateId: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.initialAssessmentTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Initial assessment template not found');
    const submissionCount = await this.prisma.initialAssessmentSubmission.count({
      where: { templateId, deletedAt: null },
    });
    if (submissionCount > 0 && existing.isDefault) {
      throw new BadRequestException('Cannot delete default template with existing submissions');
    }
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.initialAssessmentTemplate.update({
        where: { id: templateId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false, isDefault: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_TEMPLATE_DELETED,
        recordType: 'InitialAssessmentTemplate',
        recordId: deleted.id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Initial assessment template deleted', data: deleted };
    });
  }

  private async ensureTemplate(templateId: string) {
    const t = await this.prisma.initialAssessmentTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
    });
    if (!t) throw new NotFoundException('Initial assessment template not found');
    return t;
  }

  async getSections(templateId: string) {
    await this.ensureTemplate(templateId);
    const rows = await this.prisma.initialAssessmentSection.findMany({
      where: { templateId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { questions: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
    });
    return { data: rows };
  }

  async createSection(
    userId: string,
    templateId: string,
    dto: CreateInitialAssessmentSectionDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureTemplate(templateId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.initialAssessmentSection.create({
          data: {
            templateId,
            sectionNumber: dto.sectionNumber,
            title: dto.title.trim(),
            description: dto.description?.trim() ?? null,
            carePlanArea: dto.carePlanArea?.trim() ?? null,
            sortOrder: dto.sortOrder ?? dto.sectionNumber,
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.INITIAL_ASSESSMENT_SECTION_CREATED,
          recordType: 'InitialAssessmentSection',
          recordId: created.id,
          newValues: auditSnapshot(created),
          metadata: { templateId },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Section created', data: created };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Section number already exists for this template');
      }
      throw e;
    }
  }

  async updateSection(
    userId: string,
    templateId: string,
    sectionId: string,
    dto: UpdateInitialAssessmentSectionDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.initialAssessmentSection.findFirst({
      where: { id: sectionId, templateId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Section not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.initialAssessmentSection.update({
        where: { id: sectionId },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.sectionNumber !== undefined ? { sectionNumber: dto.sectionNumber } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
          ...(dto.carePlanArea !== undefined ? { carePlanArea: dto.carePlanArea?.trim() ?? null } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_SECTION_UPDATED,
        recordType: 'InitialAssessmentSection',
        recordId: row.id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(row),
        metadata: { templateId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return row;
    });
    return { message: 'Section updated', data: updated };
  }

  async softDeleteSection(userId: string, templateId: string, sectionId: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.initialAssessmentSection.findFirst({
      where: { id: sectionId, templateId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Section not found');
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.initialAssessmentSection.update({
        where: { id: sectionId },
        data: { deletedAt: new Date(), isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_SECTION_DELETED,
        recordType: 'InitialAssessmentSection',
        recordId: deleted.id,
        oldValues: auditSnapshot(existing),
        metadata: { templateId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Section deleted', data: deleted };
    });
  }

  async getQuestions(templateId: string) {
    await this.ensureTemplate(templateId);
    const rows = await this.prisma.initialAssessmentQuestion.findMany({
      where: { section: { templateId, deletedAt: null }, deletedAt: null },
      orderBy: [{ section: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      include: { section: { select: { id: true, title: true, sectionNumber: true } } },
    });
    return { data: rows };
  }

  async createQuestion(
    userId: string,
    templateId: string,
    sectionId: string,
    dto: CreateInitialAssessmentQuestionDto,
    meta?: RequestAuditMeta,
  ) {
    const section = await this.prisma.initialAssessmentSection.findFirst({
      where: { id: sectionId, templateId, deletedAt: null },
    });
    if (!section) throw new NotFoundException('Section not found');
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.initialAssessmentQuestion.create({
        data: {
          sectionId,
          questionText: dto.questionText.trim(),
          helpText: dto.helpText?.trim() ?? null,
          questionType: dto.questionType,
          options: dto.options === undefined ? undefined : (dto.options as Prisma.InputJsonValue),
          isRequired: dto.isRequired ?? false,
          allowNotes: dto.allowNotes ?? true,
          riskFlag: dto.riskFlag ?? false,
          carePlanTrigger: dto.carePlanTrigger ?? false,
          sortOrder: dto.sortOrder ?? 0,
          metadata: dto.metadata === undefined ? undefined : (dto.metadata as Prisma.InputJsonValue),
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_QUESTION_CREATED,
        recordType: 'InitialAssessmentQuestion',
        recordId: created.id,
        newValues: auditSnapshot(created),
        metadata: { templateId, sectionId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Question created', data: created };
    });
  }

  async updateQuestion(
    userId: string,
    templateId: string,
    questionId: string,
    dto: UpdateInitialAssessmentQuestionDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.initialAssessmentQuestion.findFirst({
      where: { id: questionId, section: { templateId }, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Question not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.initialAssessmentQuestion.update({
        where: { id: questionId },
        data: {
          ...(dto.questionText !== undefined ? { questionText: dto.questionText.trim() } : {}),
          ...(dto.helpText !== undefined ? { helpText: dto.helpText?.trim() ?? null } : {}),
          ...(dto.questionType !== undefined ? { questionType: dto.questionType } : {}),
          ...(dto.options !== undefined ? { options: dto.options as Prisma.InputJsonValue } : {}),
          ...(dto.isRequired !== undefined ? { isRequired: dto.isRequired } : {}),
          ...(dto.allowNotes !== undefined ? { allowNotes: dto.allowNotes } : {}),
          ...(dto.riskFlag !== undefined ? { riskFlag: dto.riskFlag } : {}),
          ...(dto.carePlanTrigger !== undefined ? { carePlanTrigger: dto.carePlanTrigger } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.metadata !== undefined ? { metadata: dto.metadata as Prisma.InputJsonValue } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_QUESTION_UPDATED,
        recordType: 'InitialAssessmentQuestion',
        recordId: updated.id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        metadata: { templateId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Question updated', data: updated };
    });
  }

  async softDeleteQuestion(
    userId: string,
    templateId: string,
    questionId: string,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.initialAssessmentQuestion.findFirst({
      where: { id: questionId, section: { templateId }, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Question not found');
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.initialAssessmentQuestion.update({
        where: { id: questionId },
        data: { deletedAt: new Date(), isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.INITIAL_ASSESSMENT_QUESTION_DELETED,
        recordType: 'InitialAssessmentQuestion',
        recordId: deleted.id,
        oldValues: auditSnapshot(existing),
        metadata: { templateId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Question deleted', data: deleted };
    });
  }
}
