import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { sanitizeRichTextHtml } from '../common/utils/rich-text-html.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CarePlanTextQueryDto } from './dto/care-plan-text-query.dto';
import { CreateCarePlanTextTemplateDto } from './dto/create-care-plan-text-template.dto';
import { UpdateCarePlanTextTemplateDto } from './dto/update-care-plan-text-template.dto';
import { PreviewCarePlanTextDto } from './dto/preview-care-plan-text.dto';

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function replaceCarePlanTextPlaceholders(html: string, serviceUserName: string): string {
  return html.replace(/@/g, serviceUserName);
}

function mapTemplate(row: {
  id: string;
  title: string;
  categoryId: string | null;
  formId: string | null;
  contentHtml: string;
  plainText: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  category?: { id: string; name: string; description: string | null; sortOrder: number } | null;
  form?: { id: string; name: string; formType: string } | null;
}) {
  return {
    id: row.id,
    title: row.title,
    categoryId: row.categoryId,
    formId: row.formId,
    contentHtml: row.contentHtml,
    plainText: row.plainText,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    category: row.category
      ? {
          id: row.category.id,
          name: row.category.name,
          description: row.category.description,
          sortOrder: row.category.sortOrder,
        }
      : null,
    form: row.form
      ? {
          id: row.form.id,
          name: row.form.name,
          formType: row.form.formType,
        }
      : null,
  };
}

const templateInclude = {
  category: true,
  form: true,
} satisfies Prisma.CarePlanTextTemplateInclude;

@Injectable()
export class CarePlanTextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async listCategories() {
    const rows = await this.prisma.carePlanTextCategory.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, description: true, sortOrder: true },
    });
    return { data: rows };
  }

  async list(query: CarePlanTextQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.CarePlanTextTemplateWhereInput = { deletedAt: null };

    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.formId) where.formId = query.formId;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { plainText: { contains: s, mode: 'insensitive' } },
      ];
    }

    const sortBy = query.sortBy ?? 'title';
    const sortOrder = query.sortOrder ?? 'asc';

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.carePlanTextTemplate.count({ where }),
      this.prisma.carePlanTextTemplate.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: templateInclude,
      }),
    ]);

    return {
      data: rows.map(mapTemplate),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(id: string) {
    const row = await this.prisma.carePlanTextTemplate.findFirst({
      where: { id, deletedAt: null },
      include: templateInclude,
    });
    if (!row) throw new NotFoundException('Care plan text template not found');
    return { data: mapTemplate(row) };
  }

  async create(userId: string, dto: CreateCarePlanTextTemplateDto, meta?: RequestAuditMeta) {
    await this.validateReferences(dto.categoryId, dto.formId);
    const contentHtml = sanitizeRichTextHtml(dto.contentHtml);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.carePlanTextTemplate.create({
        data: {
          title: dto.title.trim(),
          contentHtml,
          plainText: stripHtml(contentHtml),
          categoryId: dto.categoryId ?? null,
          formId: dto.formId ?? null,
          createdById: userId,
        },
        include: templateInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.CARE_PLAN_TEXT_CREATED,
        recordType: 'CarePlanTextTemplate',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return { message: 'Care plan text template created', data: mapTemplate(created) };
    });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCarePlanTextTemplateDto,
    meta?: RequestAuditMeta,
  ) {
    const before = await this.prisma.carePlanTextTemplate.findFirst({
      where: { id, deletedAt: null },
      include: templateInclude,
    });
    if (!before) throw new NotFoundException('Care plan text template not found');

    if (dto.categoryId !== undefined || dto.formId !== undefined) {
      await this.validateReferences(
        dto.categoryId ?? before.categoryId ?? undefined,
        dto.formId ?? before.formId ?? undefined,
      );
    }
    const contentHtml =
      dto.contentHtml !== undefined ? sanitizeRichTextHtml(dto.contentHtml) : undefined;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.carePlanTextTemplate.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(contentHtml !== undefined ? { contentHtml, plainText: stripHtml(contentHtml) } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.formId !== undefined ? { formId: dto.formId } : {}),
          updatedById: userId,
        },
        include: templateInclude,
      });

      const oldS = auditSnapshot(before);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.CARE_PLAN_TEXT_UPDATED,
        recordType: 'CarePlanTextTemplate',
        recordId: id,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return { message: 'Care plan text template updated', data: mapTemplate(updated) };
    });
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const before = await this.prisma.carePlanTextTemplate.findFirst({
      where: { id, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Care plan text template not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.carePlanTextTemplate.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.CARE_PLAN_TEXT_DELETED,
        recordType: 'CarePlanTextTemplate',
        recordId: id,
        oldValues: auditSnapshot(before),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    });

    return { message: 'Care plan text template deleted', data: {} };
  }

  async preview(
    userId: string,
    id: string,
    dto: PreviewCarePlanTextDto,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.prisma.carePlanTextTemplate.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Care plan text template not found');

    // Sanitised after the name goes in: the name is typed by the user, and the stored template may
    // predate save-time sanitising.
    const previewHtml = sanitizeRichTextHtml(
      replaceCarePlanTextPlaceholders(row.contentHtml, dto.serviceUserName.trim()),
    );

    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PATHWAY,
      action: AuditAction.CARE_PLAN_TEXT_PREVIEWED,
      recordType: 'CarePlanTextTemplate',
      recordId: id,
      metadata: { serviceUserName: dto.serviceUserName.trim() },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: {
        id: row.id,
        title: row.title,
        contentHtml: previewHtml,
        plainText: stripHtml(previewHtml),
      },
    };
  }

  private async validateReferences(categoryId?: string, formId?: string) {
    if (categoryId) {
      const category = await this.prisma.carePlanTextCategory.findFirst({
        where: { id: categoryId, deletedAt: null, isActive: true },
      });
      if (!category) {
        throw new BadRequestException('Care plan text category not found');
      }
    }

    if (formId) {
      const form = await this.prisma.carePathwayForm.findFirst({
        where: { id: formId, deletedAt: null, isActive: true },
      });
      if (!form) {
        throw new BadRequestException('Care pathway form not found');
      }
    }
  }
}
