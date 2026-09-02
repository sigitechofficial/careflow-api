import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CarePathwayFormStatus,
  CarePathwayFormVersionStatus,
  Prisma,
} from '@prisma/client';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { FormBuilderQueryDto } from './dto/form-builder-query.dto';
import { CreateCareFormDto } from './dto/create-care-form.dto';
import { UpdateCareFormDto } from './dto/update-care-form.dto';
import { SaveCareFormSchemaDto } from './dto/save-care-form-schema.dto';
import { reviewFrequencyMonthsForCreate } from '../service-user-care-plans/care-plan-review-schedule';

/**
 * Prisma include shape for reading a form for the UI/response. Fields are filtered to
 * `isActive: true` so deactivated (intentionally-removed) fields are never rendered.
 * Exported so the renderer contract can be asserted in tests.
 */
export const formInclude = {
  currentVersion: {
    include: {
      sections: {
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' as const },
        include: {
          // Deactivated fields (isActive:false) are intentionally removed from the schema
          // by the ID-safe care-plan appliers; they are kept as soft rows (deletedAt:null)
          // to preserve UUIDs and any saved values, but they must NOT be rendered. Without
          // this isActive filter the UI showed removed fields (e.g. Skin Integrity's
          // duplicate "Person-centred details" fields) even after deactivation.
          fields: {
            where: { deletedAt: null, isActive: true },
            orderBy: { sortOrder: 'asc' as const },
          },
        },
      },
    },
  },
} satisfies Prisma.CarePathwayFormInclude;

const FORM_ICON_SEGMENTS = ['care-pathway', 'forms'] as const;
const FORM_ICON_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);
const FORM_ICON_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);

export function formIconUploadRoot(): string {
  const base = process.env.UPLOAD_BASE_PATH ?? 'uploads';
  return join(process.cwd(), base, ...FORM_ICON_SEGMENTS);
}

export function ensureFormIconUploadDir(): string {
  const root = formIconUploadRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function formIconPublicUrl(fileName: string): string {
  return `/uploads/${FORM_ICON_SEGMENTS.join('/')}/${fileName}`;
}

function formIconMaxBytes(): number {
  const explicit = Number(process.env.CARE_FORM_ICON_MAX_BYTES ?? 0);
  if (explicit > 0) return explicit;
  return 2 * 1024 * 1024;
}

function normalizeFieldKey(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function mapField(row: {
  id: string;
  fieldKey: string | null;
  label: string;
  fieldType: string;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  optionsJson: unknown;
  validationJson: unknown;
  conditionalLogicJson?: unknown;
  sortOrder: number;
}) {
  return {
    id: row.id,
    fieldKey: row.fieldKey,
    label: row.label,
    fieldType: row.fieldType,
    placeholder: row.placeholder,
    helpText: row.helpText,
    required: row.required,
    optionsJson: row.optionsJson ?? null,
    validationJson: (row.validationJson as Record<string, unknown> | null) ?? null,
    conditionalLogicJson:
      (row.conditionalLogicJson as Record<string, unknown> | null) ?? null,
    sortOrder: row.sortOrder,
  };
}

function mapSection(row: {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  fields: Parameters<typeof mapField>[0][];
}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    sortOrder: row.sortOrder,
    fields: row.fields.map(mapField),
  };
}

function mapFormList(row: {
  id: string;
  name: string;
  description: string | null;
  formType: string;
  status: string;
  lastPublishedAt: Date | null;
  publishedById: string | null;
  versionLabel: string;
  pictureUrl: string | null;
  reviewFrequencyMonths?: number | null;
  currentVersionId: string | null;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    formType: row.formType,
    status: row.status,
    lastPublishedAt: row.lastPublishedAt?.toISOString() ?? null,
    publishedById: row.publishedById,
    versionLabel: row.versionLabel,
    pictureUrl: row.pictureUrl,
    reviewFrequencyMonths: row.reviewFrequencyMonths ?? null,
    currentVersionId: row.currentVersionId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapFormDetail(
  row: NonNullable<Awaited<ReturnType<FormBuilderService['findFormOrThrow']>>>,
) {
  const sections = row.currentVersion?.sections ?? [];
  return {
    ...mapFormList(row),
    sections: sections.map(mapSection),
  };
}

function buildSchemaJson(sections: SaveCareFormSchemaDto['sections']) {
  return {
    sections: sections.map(s => ({
      title: s.title,
      description: s.description ?? null,
      sortOrder: s.sortOrder,
      fields: s.fields.map(f => ({
        label: f.label,
        fieldKey: normalizeFieldKey(f.fieldKey) ?? null,
        fieldType: f.fieldType,
        placeholder: f.placeholder ?? null,
        helpText: f.helpText ?? null,
        required: f.required ?? false,
        optionsJson: f.optionsJson ?? null,
        sortOrder: f.sortOrder,
      })),
    })),
  };
}

@Injectable()
export class FormBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: FormBuilderQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.CarePathwayFormWhereInput = { deletedAt: null };
    if (query.formType) where.formType = query.formType;
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
      ];
    }
    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.carePathwayForm.count({ where }),
      this.prisma.carePathwayForm.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: rows.map(mapFormList),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(id: string) {
    const form = await this.findFormOrThrow(id);
    return { data: mapFormDetail(form) };
  }

  async create(userId: string, dto: CreateCareFormDto, meta?: RequestAuditMeta) {
    const result = await this.prisma.$transaction(async tx => {
      const form = await tx.carePathwayForm.create({
        data: {
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          formType: dto.formType,
          pictureUrl: dto.pictureUrl?.trim() || null,
          reviewFrequencyMonths: reviewFrequencyMonthsForCreate(
            dto.formType,
            dto.reviewFrequencyMonths,
          ),
          status: CarePathwayFormStatus.DRAFT,
          createdById: userId,
          updatedById: userId,
        },
      });

      const version = await tx.carePathwayFormVersion.create({
        data: {
          formId: form.id,
          versionNumber: 1,
          status: CarePathwayFormVersionStatus.DRAFT,
        },
      });

      await tx.carePathwayFormSection.create({
        data: {
          formVersionId: version.id,
          title: 'Section 1',
          sortOrder: 0,
        },
      });

      const updated = await tx.carePathwayForm.update({
        where: { id: form.id },
        data: { currentVersionId: version.id },
        include: formInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.FORM_CREATED,
        recordType: 'CarePathwayForm',
        recordId: form.id,
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return updated;
    });

    return { message: 'Form created', data: mapFormDetail(result) };
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCareFormDto,
    meta?: RequestAuditMeta,
  ) {
    const before = await this.findFormOrThrow(id);
    if (before.status === CarePathwayFormStatus.ARCHIVED) {
      throw new BadRequestException('Archived forms cannot be edited');
    }

    const data: Prisma.CarePathwayFormUpdateInput = { updatedById: userId };
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.formType !== undefined) data.formType = dto.formType;
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }
    if (dto.pictureUrl !== undefined) {
      data.pictureUrl = dto.pictureUrl?.trim() || null;
    }
    if (dto.reviewFrequencyMonths !== undefined) {
      data.reviewFrequencyMonths = dto.reviewFrequencyMonths;
    }

    const after = await this.prisma.$transaction(async tx => {
      const updated = await tx.carePathwayForm.update({
        where: { id },
        data,
        include: formInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.FORM_UPDATED,
        recordType: 'CarePathwayForm',
        recordId: id,
        oldValues: auditSnapshot(before),
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return updated;
    });

    return { message: 'Form updated', data: mapFormDetail(after) };
  }

  async saveSchema(
    userId: string,
    id: string,
    dto: SaveCareFormSchemaDto,
    meta?: RequestAuditMeta,
  ) {
    const before = await this.findFormOrThrow(id);
    if (before.status === CarePathwayFormStatus.ARCHIVED) {
      throw new BadRequestException('Archived forms cannot be edited');
    }

    const versionId = before.currentVersionId;
    if (!versionId) {
      throw new BadRequestException('Form has no editable version');
    }

    const schemaJson = buildSchemaJson(dto.sections);

    const after = await this.prisma.$transaction(async tx => {
      await tx.carePathwayFormSection.deleteMany({
        where: { formVersionId: versionId },
      });

      for (const section of dto.sections) {
        const createdSection = await tx.carePathwayFormSection.create({
          data: {
            formVersionId: versionId,
            title: section.title.trim(),
            description: section.description?.trim() || null,
            sortOrder: section.sortOrder,
          },
        });

        if (section.fields.length) {
          await tx.carePathwayFormField.createMany({
            data: section.fields.map(field => ({
              sectionId: createdSection.id,
              fieldKey: normalizeFieldKey(field.fieldKey),
              label: field.label.trim(),
              fieldType: field.fieldType,
              placeholder: field.placeholder?.trim() || null,
              helpText: field.helpText?.trim() || null,
              required: field.required ?? false,
              optionsJson: field.optionsJson ?? undefined,
              sortOrder: field.sortOrder,
            })),
          });
        }
      }

      await tx.carePathwayFormVersion.update({
        where: { id: versionId },
        data: { schemaJson: schemaJson as Prisma.InputJsonValue },
      });

      const updated = await tx.carePathwayForm.update({
        where: { id },
        data: {
          updatedById: userId,
          status:
            before.status === CarePathwayFormStatus.PUBLISHED
              ? CarePathwayFormStatus.DRAFT
              : before.status,
        },
        include: formInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.FORM_UPDATED,
        recordType: 'CarePathwayForm',
        recordId: id,
        oldValues: auditSnapshot(before),
        newValues: auditSnapshot(updated),
        metadata: { schemaSaved: true },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return updated;
    });

    return { message: 'Form structure saved', data: mapFormDetail(after) };
  }

  async publish(userId: string, id: string, meta?: RequestAuditMeta) {
    const before = await this.findFormOrThrow(id);
    const versionId = before.currentVersionId;
    if (!versionId) {
      throw new BadRequestException('Form has no version to publish');
    }

    const sectionCount = before.currentVersion?.sections.length ?? 0;
    if (!sectionCount) {
      throw new BadRequestException('Add at least one section before publishing');
    }

    const now = new Date();

    const after = await this.prisma.$transaction(async tx => {
      await tx.carePathwayFormVersion.update({
        where: { id: versionId },
        data: {
          status: CarePathwayFormVersionStatus.PUBLISHED,
          publishedAt: now,
          publishedById: userId,
        },
      });

      const updated = await tx.carePathwayForm.update({
        where: { id },
        data: {
          status: CarePathwayFormStatus.PUBLISHED,
          lastPublishedAt: now,
          publishedById: userId,
          updatedById: userId,
        },
        include: formInclude,
      });

      await tx.carePathwayFormPublishLog.create({
        data: {
          formId: id,
          formVersionId: versionId,
          publishedById: userId,
          publishedAt: now,
        },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.FORM_PUBLISHED,
        recordType: 'CarePathwayForm',
        recordId: id,
        oldValues: auditSnapshot(before),
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return updated;
    });

    return { message: 'Form published', data: mapFormDetail(after) };
  }

  async uploadIcon(
    userId: string,
    id: string,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    if (!file?.filename) {
      throw new BadRequestException('No file uploaded');
    }
    if (!FORM_ICON_MIMES.has(file.mimetype)) {
      throw new BadRequestException('Only JPG, PNG, WebP, and SVG images are allowed');
    }
    const ext = extname(file.originalname).toLowerCase();
    if (!FORM_ICON_EXTENSIONS.has(ext)) {
      throw new BadRequestException('Invalid file extension');
    }
    if (file.size > formIconMaxBytes()) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }

    const before = await this.findFormOrThrow(id);
    const pictureUrl = formIconPublicUrl(file.filename);

    const after = await this.prisma.$transaction(async tx => {
      const updated = await tx.carePathwayForm.update({
        where: { id },
        data: { pictureUrl, updatedById: userId },
        include: formInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.FORM_UPDATED,
        recordType: 'CarePathwayForm',
        recordId: id,
        oldValues: auditSnapshot(before),
        newValues: auditSnapshot(updated),
        metadata: { iconUploaded: true },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return updated;
    });

    return { message: 'Form icon uploaded', data: mapFormDetail(after) };
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const before = await this.findFormOrThrow(id);

    await this.prisma.$transaction(async tx => {
      await tx.carePathwayForm.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedById: userId,
          isActive: false,
        },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.FORM_DELETED,
        recordType: 'CarePathwayForm',
        recordId: id,
        oldValues: auditSnapshot(before),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    });

    return { message: 'Form deleted' };
  }

  private async findFormOrThrow(id: string) {
    const form = await this.prisma.carePathwayForm.findFirst({
      where: { id, deletedAt: null },
      include: formInclude,
    });
    if (!form) {
      throw new NotFoundException('Form not found');
    }
    return form;
  }
}
