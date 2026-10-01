import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  CarePathwayFormType,
  ServiceUserClinicalDataSource,
  ServiceUserMedicalConditionStatus,
} from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { assertServiceUserAccessible } from './medical-access.util';
import type {
  CreateMedicalConditionCatalogDto,
  CreateServiceUserMedicalConditionDto,
  UpdateMedicalConditionCatalogDto,
  UpdateServiceUserMedicalConditionDto,
} from './dto/medical.dto';
import { buildRecommendationsFromMedicalConditions } from '../initial-assessments/medical-condition-care-plan-map.util';

function mapCondition(row: {
  id: string;
  serviceUserId: string;
  conditionId: string;
  status: ServiceUserMedicalConditionStatus;
  notes: string;
  onsetDate: Date | null;
  reviewDate: Date | null;
  impactOnCare: string;
  carerGuidance: string;
  confirmationSource: string;
  sourceSubmissionId: string | null;
  source: ServiceUserClinicalDataSource;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  condition?: {
    id: string;
    code: string;
    name: string;
    category: string;
  };
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    conditionId: row.conditionId,
    status: row.status,
    notes: row.notes,
    onsetDate: row.onsetDate?.toISOString().slice(0, 10) ?? null,
    reviewDate: row.reviewDate?.toISOString().slice(0, 10) ?? null,
    impactOnCare: row.impactOnCare,
    carerGuidance: row.carerGuidance,
    confirmationSource: row.confirmationSource,
    sourceSubmissionId: row.sourceSubmissionId,
    source: row.source,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    condition: row.condition
      ? {
          id: row.condition.id,
          code: row.condition.code,
          name: row.condition.name,
          category: row.condition.category,
        }
      : undefined,
  };
}

function conditionCareDetails(dto: {
  impactOnCare?: string;
  carerGuidance?: string;
  confirmationSource?: string;
}) {
  return {
    ...(dto.impactOnCare !== undefined ? { impactOnCare: dto.impactOnCare.trim() } : {}),
    ...(dto.carerGuidance !== undefined ? { carerGuidance: dto.carerGuidance.trim() } : {}),
    ...(dto.confirmationSource !== undefined ? { confirmationSource: dto.confirmationSource.trim() } : {}),
  };
}

@Injectable()
export class MedicalConditionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  async listCatalog(opts: { includeInactive?: boolean; search?: string } = {}) {
    const where: Prisma.MedicalConditionCatalogWhereInput = {};
    if (!opts.includeInactive) where.isActive = true;
    if (opts.search?.trim()) {
      const q = opts.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.medicalConditionCatalog.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        category: r.category,
        description: r.description,
        sortOrder: r.sortOrder,
        isActive: r.isActive,
      })),
    };
  }

  private readonly catalogSelect = {
    id: true,
    code: true,
    name: true,
    category: true,
    description: true,
    sortOrder: true,
    isActive: true,
  } as const;

  private normalizeCatalogCode(raw: string): string {
    return raw.trim().toUpperCase().replace(/\s+/g, '_');
  }

  async createCatalogItem(dto: CreateMedicalConditionCatalogDto) {
    const name = dto.name.trim();
    const code = this.normalizeCatalogCode(dto.code);
    if (!name || !code) throw new BadRequestException('Name and code are required');
    const maxSort = await this.prisma.medicalConditionCatalog.aggregate({
      _max: { sortOrder: true },
    });
    const sortOrder = dto.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1;
    try {
      const created = await this.prisma.medicalConditionCatalog.create({
        data: {
          name,
          code,
          category: dto.category,
          description: dto.description?.trim() ?? null,
          sortOrder,
          isActive: true,
        },
        select: this.catalogSelect,
      });
      return { data: created };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A medical condition with this code already exists');
      }
      throw e;
    }
  }

  async updateCatalogItem(id: string, dto: UpdateMedicalConditionCatalogDto) {
    const existing = await this.prisma.medicalConditionCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Medical condition catalogue entry not found');
    const data: Prisma.MedicalConditionCatalogUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      data.name = name;
    }
    if (dto.code !== undefined) {
      const code = this.normalizeCatalogCode(dto.code);
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.description !== undefined) data.description = dto.description?.trim() ?? null;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      const updated = await this.prisma.medicalConditionCatalog.update({
        where: { id },
        data,
        select: this.catalogSelect,
      });
      return { data: updated };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A medical condition with this code already exists');
      }
      throw e;
    }
  }

  async deleteCatalogItem(id: string) {
    const existing = await this.prisma.medicalConditionCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Medical condition catalogue entry not found');
    await this.prisma.medicalConditionCatalog.update({
      where: { id },
      data: { isActive: false },
    });
    return { message: 'Medical condition catalogue entry deactivated' };
  }

  async list(user: RequestUser, serviceUserId: string) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    const rows = await this.prisma.serviceUserMedicalCondition.findMany({
      where: { serviceUserId, deletedAt: null },
      include: {
        condition: { select: { id: true, code: true, name: true, category: true } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return { data: rows.map(mapCondition) };
  }

  /**
   * Care plan recommendations driven only by active medical conditions.
   * Used when there is no IA yet, and as a refresh source after condition save.
   */
  async listCarePlanRecommendations(user: RequestUser, serviceUserId: string) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    const [activeConditions, catalogue] = await Promise.all([
      this.prisma.serviceUserMedicalCondition.findMany({
        where: {
          serviceUserId,
          deletedAt: null,
          status: ServiceUserMedicalConditionStatus.ACTIVE,
          isActive: true,
        },
        select: {
          condition: { select: { code: true, name: true } },
        },
      }),
      this.prisma.carePathwayForm.findMany({
        where: { formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);

    const recommendations = buildRecommendationsFromMedicalConditions(
      activeConditions
        .map((row) => ({
          code: row.condition?.code ?? '',
          name: row.condition?.name ?? '',
        }))
        .filter((c) => c.code),
      catalogue,
    );

    return { data: recommendations };
  }

  async create(
    user: RequestUser,
    serviceUserId: string,
    dto: CreateServiceUserMedicalConditionDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    const catalog = await this.prisma.medicalConditionCatalog.findFirst({
      where: { id: dto.conditionId, isActive: true },
    });
    if (!catalog) throw new BadRequestException('Invalid medical condition');

    const conditionInclude = {
      condition: { select: { id: true, code: true, name: true, category: true } },
    } as const;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.serviceUserMedicalCondition.findFirst({
          where: { serviceUserId, conditionId: dto.conditionId, deletedAt: null },
          include: conditionInclude,
        });

        if (existing) {
          if (existing.status === ServiceUserMedicalConditionStatus.ACTIVE) {
            throw new ConflictException(
              'This medical condition is already recorded for the service user',
            );
          }
          const updated = await tx.serviceUserMedicalCondition.update({
            where: { id: existing.id },
            data: {
              status: ServiceUserMedicalConditionStatus.ACTIVE,
              isActive: true,
              ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
              ...conditionCareDetails(dto),
              ...(dto.onsetDate !== undefined
                ? { onsetDate: dto.onsetDate ? new Date(dto.onsetDate) : null }
                : {}),
              ...(dto.reviewDate !== undefined
                ? { reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : null }
                : {}),
              ...(dto.source !== undefined ? { source: dto.source } : {}),
              updatedById: user.id,
            },
            include: conditionInclude,
          });
          const oldS = auditSnapshot({
            id: existing.id,
            status: existing.status,
            conditionId: existing.conditionId,
          });
          const newS = auditSnapshot({
            id: updated.id,
            status: updated.status,
            conditionId: updated.conditionId,
          });
          await this.audit.logAudit({
            tx,
            userId: user.id,
            module: AuditModule.SERVICE_USER,
            action: AuditAction.SERVICE_USER_MEDICAL_CONDITION_UPDATED,
            recordType: 'ServiceUserMedicalCondition',
            recordId: updated.id,
            oldValues: oldS,
            newValues: newS,
            metadata: {
              serviceUserId,
              conditionCode: catalog.code,
              reactivated: true,
            },
            ipAddress: meta?.ipAddress ?? undefined,
            userAgent: meta?.userAgent ?? undefined,
          });
          return { message: 'Medical condition recorded', data: mapCondition(updated) };
        }

        const created = await tx.serviceUserMedicalCondition.create({
          data: {
            serviceUserId,
            conditionId: dto.conditionId,
            status: dto.status ?? ServiceUserMedicalConditionStatus.ACTIVE,
            notes: dto.notes?.trim() ?? '',
            ...conditionCareDetails(dto),
            onsetDate: dto.onsetDate ? new Date(dto.onsetDate) : null,
            reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : null,
            source: dto.source ?? ServiceUserClinicalDataSource.MANUAL,
            createdById: user.id,
            updatedById: user.id,
          },
          include: conditionInclude,
        });
        await this.audit.logAudit({
          tx,
          userId: user.id,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.SERVICE_USER_MEDICAL_CONDITION_CREATED,
          recordType: 'ServiceUserMedicalCondition',
          recordId: created.id,
          newValues: auditSnapshot({
            id: created.id,
            serviceUserId,
            conditionId: created.conditionId,
            status: created.status,
          }),
          metadata: { serviceUserId, conditionCode: catalog.code },
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
        return { message: 'Medical condition recorded', data: mapCondition(created) };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This medical condition is already recorded for the service user');
      }
      throw e;
    }
  }

  async update(
    user: RequestUser,
    serviceUserId: string,
    id: string,
    dto: UpdateServiceUserMedicalConditionDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserMedicalCondition.findFirst({
        where: { id, serviceUserId, deletedAt: null },
        include: {
          condition: { select: { id: true, code: true, name: true, category: true } },
        },
      });
      if (!before) throw new NotFoundException('Medical condition not found');

      if (dto.conditionId && dto.conditionId !== before.conditionId) {
        const catalog = await tx.medicalConditionCatalog.findFirst({
          where: { id: dto.conditionId, isActive: true },
        });
        if (!catalog) throw new BadRequestException('Invalid medical condition');
      }

      try {
        const updated = await tx.serviceUserMedicalCondition.update({
          where: { id },
          data: {
            ...(dto.conditionId !== undefined ? { conditionId: dto.conditionId } : {}),
            ...(dto.status !== undefined
              ? {
                  status: dto.status,
                  isActive: dto.status === ServiceUserMedicalConditionStatus.ACTIVE,
                }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
              ...conditionCareDetails(dto),
            ...(dto.onsetDate !== undefined
              ? { onsetDate: dto.onsetDate ? new Date(dto.onsetDate) : null }
              : {}),
            ...(dto.reviewDate !== undefined
              ? { reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : null }
              : {}),
            ...(dto.source !== undefined ? { source: dto.source } : {}),
            updatedById: user.id,
          },
          include: {
            condition: { select: { id: true, code: true, name: true, category: true } },
          },
        });
        const oldS = auditSnapshot({
          id: before.id,
          status: before.status,
          conditionId: before.conditionId,
        });
        const newS = auditSnapshot({
          id: updated.id,
          status: updated.status,
          conditionId: updated.conditionId,
        });
        const discontinued =
          dto.status === ServiceUserMedicalConditionStatus.DISCONTINUED ||
          dto.status === ServiceUserMedicalConditionStatus.INACTIVE;
        await this.audit.logAudit({
          tx,
          userId: user.id,
          module: AuditModule.SERVICE_USER,
          action: discontinued
            ? AuditAction.SERVICE_USER_MEDICAL_CONDITION_DISCONTINUED
            : AuditAction.SERVICE_USER_MEDICAL_CONDITION_UPDATED,
          recordType: 'ServiceUserMedicalCondition',
          recordId: id,
          oldValues: oldS,
          newValues: newS,
          metadata: { serviceUserId, changedFields: this.audit.getChangedFields(oldS, newS) },
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
        return { message: 'Medical condition updated', data: mapCondition(updated) };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('This medical condition is already recorded for the service user');
        }
        throw e;
      }
    });
  }

  async discontinue(
    user: RequestUser,
    serviceUserId: string,
    id: string,
    meta?: RequestAuditMeta,
  ) {
    return this.update(
      user,
      serviceUserId,
      id,
      { status: ServiceUserMedicalConditionStatus.DISCONTINUED },
      meta,
    );
  }
}
