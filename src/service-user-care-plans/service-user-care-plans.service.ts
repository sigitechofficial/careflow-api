import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CarePathwayFormType, Prisma, ServiceUserCarePlanInstanceStatus } from '@prisma/client';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { PrismaService } from '../prisma/prisma.service';
import { PublishCarePlanDto } from './dto/save-care-plan-draft.dto';
import type { SaveCarePlanDraftDto } from './dto/save-care-plan-draft.dto';
import {
  computeCarePlanReviewState,
  computeNextReviewDueAt,
  getCarePlanReviewSchedule,
} from './care-plan-review-schedule';

const instanceInclude = {
  draft: true,
  publishedVersions: {
    where: { supersededAt: null },
    orderBy: { versionNumber: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.ServiceUserCarePlanInstanceInclude;

type InstanceRow = Prisma.ServiceUserCarePlanInstanceGetPayload<{ include: typeof instanceInclude }>;

@Injectable()
export class ServiceUserCarePlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async ensureServiceUser(serviceUserId: string) {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true },
    });
    if (!su) throw new NotFoundException('Service user not found');
  }

  private async ensureCarePlanForm(formId: string) {
    const form = await this.prisma.carePathwayForm.findFirst({
      where: { id: formId, deletedAt: null, formType: CarePathwayFormType.CARE_PLAN },
      select: { id: true, name: true, currentVersionId: true },
    });
    if (!form) throw new NotFoundException('Care plan form not found');
    return form;
  }

  private mapInstance(row: InstanceRow, formName?: string | null) {
    const latest = row.publishedVersions[0] ?? null;
    const displayStatus =
      latest == null
        ? row.draft
          ? 'DRAFT'
          : 'NOT_STARTED'
        : row.draft
          ? 'PUBLISHED_WITH_DRAFT'
          : 'PUBLISHED';

    const schedule = getCarePlanReviewSchedule(formName);
    const review = computeCarePlanReviewState({
      nextReviewDueAt: row.nextReviewDueAt,
      lastReviewedAt: row.lastReviewedAt,
      intervalDays: schedule.defaultIntervalDays,
      guidanceSummary: schedule.guidanceSummary,
    });

    return {
      id: row.id,
      serviceUserId: row.serviceUserId,
      carePathwayFormId: row.carePathwayFormId,
      carePathwayFormVersionId: row.carePathwayFormVersionId,
      status: row.status,
      displayStatus,
      nextReviewDueAt: row.nextReviewDueAt?.toISOString() ?? null,
      lastReviewedAt: row.lastReviewedAt?.toISOString() ?? null,
      lastReviewedById: row.lastReviewedById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      draft: row.draft
        ? {
            values: (row.draft.valuesJson as Record<string, string | boolean>) ?? {},
            composedFrom: (row.draft.composedFromJson as Record<string, unknown> | null) ?? null,
            gaps: row.draft.gapsJson ?? null,
            updatedAt: row.draft.updatedAt.toISOString(),
            updatedById: row.draft.updatedById,
          }
        : null,
      latestPublishedVersion: latest
        ? {
            id: latest.id,
            versionNumber: latest.versionNumber,
            summary: latest.summary,
            publishedAt: latest.publishedAt.toISOString(),
            publishedById: latest.publishedById,
          }
        : null,
      review,
    };
  }

  private countBlockingGaps(gapsJson: unknown): number {
    if (!Array.isArray(gapsJson)) return 0;
    return gapsJson.filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        (item as { severity?: string }).severity === 'blocking',
    ).length;
  }

  private hasPublishableValues(values: unknown): boolean {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
    return Object.values(values as Record<string, unknown>).some((value) => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'boolean') return true;
      if (typeof value === 'string') return value.trim().length > 0;
      return true;
    });
  }

  async getOrCreateInstance(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
  ): Promise<InstanceRow> {
    await this.ensureServiceUser(serviceUserId);
    await this.ensureCarePlanForm(carePathwayFormId);

    const existing = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: {
        serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId },
      },
      include: instanceInclude,
    });
    if (existing) return existing;

    const created = await this.prisma.serviceUserCarePlanInstance.create({
      data: {
        serviceUserId,
        carePathwayFormId,
        createdById: userId,
        updatedById: userId,
      },
      include: instanceInclude,
    });
    return created;
  }

  async listInstances(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);

    const rows = await this.prisma.serviceUserCarePlanInstance.findMany({
      where: { serviceUserId },
      include: instanceInclude,
      orderBy: { updatedAt: 'desc' },
    });

    const formIds = [...new Set(rows.map((r) => r.carePathwayFormId))];
    const forms =
      formIds.length > 0
        ? await this.prisma.carePathwayForm.findMany({
            where: { id: { in: formIds }, deletedAt: null },
            select: { id: true, name: true, pictureUrl: true },
          })
        : [];
    const formById = new Map(forms.map((f) => [f.id, f]));

    return {
      data: rows.map((row) => ({
        ...this.mapInstance(row, formById.get(row.carePathwayFormId)?.name ?? null),
        formName: formById.get(row.carePathwayFormId)?.name ?? null,
        pictureUrl: formById.get(row.carePathwayFormId)?.pictureUrl ?? null,
      })),
    };
  }

  async getInstance(serviceUserId: string, carePathwayFormId: string) {
    await this.ensureServiceUser(serviceUserId);
    await this.ensureCarePlanForm(carePathwayFormId);

    const row = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: {
        serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId },
      },
      include: instanceInclude,
    });

    if (!row) {
      return { data: null };
    }

    const form = await this.prisma.carePathwayForm.findFirst({
      where: { id: carePathwayFormId, deletedAt: null },
      select: { id: true, name: true, pictureUrl: true },
    });

    return {
      data: {
        ...this.mapInstance(row, form?.name ?? null),
        formName: form?.name ?? null,
        pictureUrl: form?.pictureUrl ?? null,
      },
    };
  }

  async saveDraft(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    dto: SaveCarePlanDraftDto,
    meta?: RequestAuditMeta,
  ) {
    const instance = await this.getOrCreateInstance(userId, serviceUserId, carePathwayFormId);

    const valuesJson = dto.values as Prisma.InputJsonValue;
    const composedFromJson = dto.composedFrom
      ? (dto.composedFrom as Prisma.InputJsonValue)
      : undefined;
    const gapsJson = dto.gaps ? (dto.gaps as Prisma.InputJsonValue) : undefined;

    await this.prisma.$transaction([
      this.prisma.serviceUserCarePlanInstance.update({
        where: { id: instance.id },
        data: { updatedById: userId },
      }),
      this.prisma.serviceUserCarePlanDraft.upsert({
        where: { instanceId: instance.id },
        create: {
          instanceId: instance.id,
          valuesJson,
          composedFromJson,
          gapsJson,
          updatedById: userId,
        },
        update: {
          valuesJson,
          ...(composedFromJson !== undefined ? { composedFromJson } : {}),
          ...(gapsJson !== undefined ? { gapsJson } : {}),
          updatedById: userId,
        },
      }),
    ]);

    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PLAN,
      action: AuditAction.CARE_PLAN_DRAFT_SAVED,
      recordType: 'ServiceUserCarePlanInstance',
      recordId: instance.id,
      newValues: auditSnapshot({
        carePathwayFormId,
        fieldCount: Object.keys(dto.values).length,
      }),
      metadata: { serviceUserId, carePathwayFormId, instanceId: instance.id },
      ...meta,
    });

    return this.getInstance(serviceUserId, carePathwayFormId);
  }

  async publish(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    dto: PublishCarePlanDto,
    meta?: RequestAuditMeta,
  ) {
    const form = await this.ensureCarePlanForm(carePathwayFormId);
    const instance = await this.getOrCreateInstance(userId, serviceUserId, carePathwayFormId);

    const draft = await this.prisma.serviceUserCarePlanDraft.findUnique({
      where: { instanceId: instance.id },
    });
    if (!draft) {
      throw new BadRequestException('Save a draft before publishing.');
    }

    const values = draft.valuesJson as Record<string, unknown>;
    if (!this.hasPublishableValues(values)) {
      throw new BadRequestException('Care plan draft has no values to publish.');
    }

    const blockingGapCount = this.countBlockingGaps(draft.gapsJson);
    if (blockingGapCount > 0 && !dto.gapAcknowledged) {
      throw new BadRequestException(
        `Acknowledge ${blockingGapCount} blocking gap(s) before publishing.`,
      );
    }

    const latestVersion = await this.prisma.serviceUserCarePlanPublishedVersion.findFirst({
      where: { instanceId: instance.id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
    const publishedAt = new Date();
    const schedule = getCarePlanReviewSchedule(form.name);
    const nextReviewDueAt = computeNextReviewDueAt(publishedAt, schedule.defaultIntervalDays);

    const version = await this.prisma.$transaction(async (tx) => {
      await tx.serviceUserCarePlanPublishedVersion.updateMany({
        where: { instanceId: instance.id, supersededAt: null },
        data: { supersededAt: new Date() },
      });

      const created = await tx.serviceUserCarePlanPublishedVersion.create({
        data: {
          instanceId: instance.id,
          versionNumber,
          valuesJson: draft.valuesJson as Prisma.InputJsonValue,
          composedFromJson: draft.composedFromJson ?? undefined,
          summary: dto.summary?.trim() || null,
          signaturesJson: dto.signatures
            ? (dto.signatures as Prisma.InputJsonValue)
            : undefined,
          publishedById: userId,
        },
      });

      await tx.serviceUserCarePlanInstance.update({
        where: { id: instance.id },
        data: {
          status: ServiceUserCarePlanInstanceStatus.PUBLISHED,
          carePathwayFormVersionId: instance.carePathwayFormVersionId ?? form.currentVersionId,
          updatedById: userId,
          lastReviewedAt: publishedAt,
          lastReviewedById: userId,
          nextReviewDueAt,
        },
      });

      return created;
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PLAN,
      action: AuditAction.CARE_PLAN_PUBLISHED,
      recordType: 'ServiceUserCarePlanPublishedVersion',
      recordId: version.id,
      newValues: auditSnapshot({
        carePathwayFormId,
        versionNumber,
        summary: dto.summary ?? null,
      }),
      metadata: {
        serviceUserId,
        carePathwayFormId,
        instanceId: instance.id,
        versionNumber,
      },
      ...meta,
    });

    return this.getInstance(serviceUserId, carePathwayFormId);
  }

  async listVersions(serviceUserId: string, carePathwayFormId: string) {
    await this.ensureServiceUser(serviceUserId);
    const instance = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: {
        serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId },
      },
      select: { id: true },
    });
    if (!instance) {
      return { data: [] };
    }

    const rows = await this.prisma.serviceUserCarePlanPublishedVersion.findMany({
      where: { instanceId: instance.id },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        summary: true,
        publishedAt: true,
        publishedById: true,
        supersededAt: true,
      },
    });

    return {
      data: rows.map((row) => ({
        id: row.id,
        versionNumber: row.versionNumber,
        summary: row.summary,
        publishedAt: row.publishedAt.toISOString(),
        publishedById: row.publishedById,
        supersededAt: row.supersededAt?.toISOString() ?? null,
        isCurrent: row.supersededAt == null,
      })),
    };
  }

  async getVersion(serviceUserId: string, carePathwayFormId: string, versionId: string) {
    await this.ensureServiceUser(serviceUserId);
    const instance = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: {
        serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId },
      },
      select: { id: true },
    });
    if (!instance) throw new NotFoundException('Care plan instance not found');

    const version = await this.prisma.serviceUserCarePlanPublishedVersion.findFirst({
      where: { id: versionId, instanceId: instance.id },
    });
    if (!version) throw new NotFoundException('Published version not found');

    return {
      data: {
        id: version.id,
        instanceId: version.instanceId,
        versionNumber: version.versionNumber,
        values: (version.valuesJson as Record<string, string | boolean>) ?? {},
        composedFrom: (version.composedFromJson as Record<string, unknown> | null) ?? null,
        summary: version.summary,
        signatures: (version.signaturesJson as Record<string, unknown> | null) ?? null,
        publishedAt: version.publishedAt.toISOString(),
        publishedById: version.publishedById,
        supersededAt: version.supersededAt?.toISOString() ?? null,
      },
    };
  }
}
