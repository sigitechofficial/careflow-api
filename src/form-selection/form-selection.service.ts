import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CarePathwayFormType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { DefaultFormSelectionQueryDto } from './dto/default-form-selection-query.dto';
import { UpdateDefaultFormSelectionDto } from './dto/update-default-form-selection.dto';
import { UpdateCarePlanRequiredAssessmentsDto } from './dto/update-care-plan-required-assessments.dto';

const FORM_TYPE_GROUPS = {
  carePlans: CarePathwayFormType.CARE_PLAN,
  assessments: CarePathwayFormType.ASSESSMENT,
  serviceForms: CarePathwayFormType.SERVICE_FORM,
  staffForms: CarePathwayFormType.STAFF_FORM,
} as const;

type FormTypeGroupKey = keyof typeof FORM_TYPE_GROUPS;

function mapFormSummary(row: {
  id: string;
  name: string;
  description: string | null;
  formType: CarePathwayFormType;
  status: string;
  lastPublishedAt: Date | null;
  pictureUrl: string | null;
  versionLabel: string;
  isActive: boolean;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    formType: row.formType,
    status: row.status,
    lastPublishedAt: row.lastPublishedAt?.toISOString() ?? null,
    pictureUrl: row.pictureUrl,
    versionLabel: row.versionLabel,
    isActive: row.isActive,
  };
}

function mapSelection(row: {
  id: string;
  formId: string;
  formType: CarePathwayFormType;
  isDefault: boolean;
  selectedById: string | null;
  selectedAt: Date;
  form: Parameters<typeof mapFormSummary>[0];
}) {
  return {
    id: row.id,
    formId: row.formId,
    formType: row.formType,
    isDefault: row.isDefault,
    selectedById: row.selectedById,
    selectedAt: row.selectedAt.toISOString(),
    form: mapFormSummary(row.form),
  };
}

@Injectable()
export class FormSelectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async getSelections() {
    const rows = await this.prisma.defaultFormSelection.findMany({
      where: { deletedAt: null, isActive: true },
      include: { form: true },
      orderBy: [{ formType: 'asc' }, { selectedAt: 'desc' }],
    });

    const activeRows = rows.filter((row) => row.form && row.form.deletedAt === null);

    const grouped = {
      carePlans: [] as ReturnType<typeof mapSelection>[],
      assessments: [] as ReturnType<typeof mapSelection>[],
      serviceForms: [] as ReturnType<typeof mapSelection>[],
      staffForms: [] as ReturnType<typeof mapSelection>[],
    };

    for (const row of activeRows) {
      const mapped = mapSelection(row as Parameters<typeof mapSelection>[0]);
      switch (row.formType) {
        case CarePathwayFormType.CARE_PLAN:
          grouped.carePlans.push(mapped);
          break;
        case CarePathwayFormType.ASSESSMENT:
          grouped.assessments.push(mapped);
          break;
        case CarePathwayFormType.SERVICE_FORM:
          grouped.serviceForms.push(mapped);
          break;
        case CarePathwayFormType.STAFF_FORM:
          grouped.staffForms.push(mapped);
          break;
      }
    }

    return { data: grouped };
  }

  async listFormsByType(formType: CarePathwayFormType, query: DefaultFormSelectionQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.CarePathwayFormWhereInput = {
      deletedAt: null,
      isActive: true,
      formType,
    };

    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [{ name: { contains: s, mode: 'insensitive' } }];
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
      data: rows.map(mapFormSummary),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async updateSelections(
    userId: string,
    dto: UpdateDefaultFormSelectionDto,
    meta?: RequestAuditMeta,
  ) {
    const submitted = Object.entries(FORM_TYPE_GROUPS).filter(
      ([key]) => dto[key as FormTypeGroupKey] !== undefined,
    ) as Array<[FormTypeGroupKey, CarePathwayFormType]>;

    if (!submitted.length) {
      throw new BadRequestException('At least one form type selection must be provided');
    }

    for (const [key, formType] of submitted) {
      const formIds = dto[key] ?? [];
      if (formIds.length) {
        await this.validateFormIds(formType, formIds);
      }
    }

    const before = await this.prisma.defaultFormSelection.findMany({
      where: { deletedAt: null, isActive: true },
      include: { form: true },
    });

    return this.prisma.$transaction(async (tx) => {
      for (const [key, formType] of submitted) {
        const formIds = dto[key] ?? [];

        await tx.defaultFormSelection.updateMany({
          where: { formType, deletedAt: null, isActive: true },
          data: { deletedAt: new Date(), isActive: false },
        });

        if (formIds.length) {
          await tx.defaultFormSelection.createMany({
            data: formIds.map((formId) => ({
              formId,
              formType,
              isDefault: true,
              selectedById: userId,
              isActive: true,
            })),
          });
        }
      }

      const after = await tx.defaultFormSelection.findMany({
        where: { deletedAt: null, isActive: true },
        include: { form: true },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.DEFAULT_FORMS_UPDATED,
        recordType: 'DefaultFormSelection',
        recordId: 'bulk',
        oldValues: auditSnapshot(before),
        newValues: auditSnapshot(after),
        metadata: {
          changedTypes: submitted.map(([key]) => key),
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      const activeAfter = after.filter((row) => row.form && row.form.deletedAt === null);
      const grouped = {
        carePlans: [] as ReturnType<typeof mapSelection>[],
        assessments: [] as ReturnType<typeof mapSelection>[],
        serviceForms: [] as ReturnType<typeof mapSelection>[],
        staffForms: [] as ReturnType<typeof mapSelection>[],
      };

      for (const row of activeAfter) {
        const mapped = mapSelection(row as Parameters<typeof mapSelection>[0]);
        switch (row.formType) {
          case CarePathwayFormType.CARE_PLAN:
            grouped.carePlans.push(mapped);
            break;
          case CarePathwayFormType.ASSESSMENT:
            grouped.assessments.push(mapped);
            break;
          case CarePathwayFormType.SERVICE_FORM:
            grouped.serviceForms.push(mapped);
            break;
          case CarePathwayFormType.STAFF_FORM:
            grouped.staffForms.push(mapped);
            break;
        }
      }

      return { message: 'Default form selections updated', data: grouped };
    });
  }

  /** Assessments required per care plan form (only care plans that have at least one). */
  async getCarePlanRequiredAssessments() {
    const rows = await this.prisma.carePlanRequiredAssessment.findMany({
      where: { carePlanForm: { deletedAt: null }, assessmentForm: { deletedAt: null } },
      select: { carePlanFormId: true, assessmentFormId: true },
      orderBy: { createdAt: 'asc' },
    });
    const byCarePlan = new Map<string, string[]>();
    for (const row of rows) {
      const list = byCarePlan.get(row.carePlanFormId) ?? [];
      list.push(row.assessmentFormId);
      byCarePlan.set(row.carePlanFormId, list);
    }
    return {
      data: [...byCarePlan].map(([carePlanFormId, assessmentFormIds]) => ({ carePlanFormId, assessmentFormIds })),
    };
  }

  /** Replaces the assessments required for one care plan form. */
  async setCarePlanRequiredAssessments(
    userId: string,
    carePlanFormId: string,
    dto: UpdateCarePlanRequiredAssessmentsDto,
    meta?: RequestAuditMeta,
  ) {
    const carePlan = await this.prisma.carePathwayForm.findFirst({
      where: { id: carePlanFormId, formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!carePlan) throw new NotFoundException('Care plan form not found');

    const assessmentFormIds = [...new Set(dto.assessmentFormIds)];
    if (assessmentFormIds.length) {
      await this.validateFormIds(CarePathwayFormType.ASSESSMENT, assessmentFormIds);
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.carePlanRequiredAssessment.findMany({
        where: { carePlanFormId },
        select: { assessmentFormId: true },
      });
      await tx.carePlanRequiredAssessment.deleteMany({
        where: { carePlanFormId, assessmentFormId: { notIn: assessmentFormIds } },
      });
      if (assessmentFormIds.length) {
        await tx.carePlanRequiredAssessment.createMany({
          data: assessmentFormIds.map((assessmentFormId) => ({
            carePlanFormId,
            assessmentFormId,
            createdById: userId,
          })),
          skipDuplicates: true,
        });
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.CARE_PLAN_REQUIRED_ASSESSMENTS_UPDATED,
        recordType: 'CarePathwayForm',
        recordId: carePlanFormId,
        oldValues: { assessmentFormIds: before.map((row) => row.assessmentFormId) },
        newValues: { assessmentFormIds },
        metadata: { carePlanFormName: carePlan.name },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Required assessments updated', data: { carePlanFormId, assessmentFormIds } };
    });
  }

  private async validateFormIds(formType: CarePathwayFormType, formIds: string[]) {
    const uniqueIds = [...new Set(formIds)];
    const forms = await this.prisma.carePathwayForm.findMany({
      where: {
        id: { in: uniqueIds },
        deletedAt: null,
        isActive: true,
        formType,
      },
      select: { id: true },
    });

    if (forms.length !== uniqueIds.length) {
      throw new BadRequestException(
        `One or more selected forms are invalid or do not match form type ${formType}`,
      );
    }
  }
}
