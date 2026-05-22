import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { PathwayChecklistQueryDto } from './dto/pathway-checklist-query.dto';
import { CreatePathwayChecklistDto } from './dto/create-pathway-checklist.dto';
import { UpdatePathwayChecklistDto } from './dto/update-pathway-checklist.dto';
import { CreatePathwayChecklistItemBodyDto } from './dto/create-pathway-checklist-item.dto';
import { UpdatePathwayChecklistItemDto } from './dto/update-pathway-checklist-item.dto';

function normalizeChecklistFlags(dto: {
  observationEnabled?: boolean;
  recordPhoto?: boolean;
}) {
  const observationEnabled = dto.observationEnabled ?? false;
  let recordPhoto = dto.recordPhoto ?? false;
  if (!observationEnabled && recordPhoto) {
    recordPhoto = false;
  }
  return { observationEnabled, recordPhoto };
}

function mapChecklist(row: {
  id: string;
  name: string;
  icon: string | null;
  carePlanId: string | null;
  analysisGroupId: string | null;
  observationEnabled: boolean;
  recordPhoto: boolean;
  familyShare: boolean;
  groupAction: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  items?: Array<{
    id: string;
    itemText: string;
    sortOrder: number;
    isActive: boolean;
  }>;
}) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    carePlanId: row.carePlanId,
    analysisGroupId: row.analysisGroupId,
    observationEnabled: row.observationEnabled,
    recordPhoto: row.recordPhoto,
    familyShare: row.familyShare,
    groupAction: row.groupAction,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: (row.items ?? [])
      .filter((i) => i.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        id: i.id,
        itemText: i.itemText,
        sortOrder: i.sortOrder,
      })),
  };
}

@Injectable()
export class PathwayChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: PathwayChecklistQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PathwayChecklistWhereInput = { deletedAt: null };
    if (query.observationEnabled !== undefined) where.observationEnabled = query.observationEnabled;
    if (query.recordPhoto !== undefined) where.recordPhoto = query.recordPhoto;
    if (query.familyShare !== undefined) where.familyShare = query.familyShare;
    if (query.groupAction !== undefined) where.groupAction = query.groupAction;
    if (query.carePlanId) where.carePlanId = query.carePlanId;
    if (query.analysisGroupId) where.analysisGroupId = query.analysisGroupId;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [{ name: { contains: s, mode: 'insensitive' } }];
    }
    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.pathwayChecklist.count({ where }),
      this.prisma.pathwayChecklist.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          items: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        },
      }),
    ]);
    return {
      data: rows.map(mapChecklist),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(id: string) {
    const row = await this.prisma.pathwayChecklist.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Pathway checklist not found');
    return { data: mapChecklist(row) };
  }

  async create(userId: string, dto: CreatePathwayChecklistDto, meta?: RequestAuditMeta) {
    const flags = normalizeChecklistFlags(dto);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.pathwayChecklist.create({
        data: {
          name: dto.name.trim(),
          icon: dto.icon?.trim() ?? null,
          carePlanId: dto.carePlanId ?? null,
          analysisGroupId: dto.analysisGroupId ?? null,
          observationEnabled: flags.observationEnabled,
          recordPhoto: flags.recordPhoto,
          familyShare: dto.familyShare ?? false,
          groupAction: dto.groupAction ?? false,
          createdById: userId,
        },
      });
      if (dto.items?.length) {
        await tx.pathwayChecklistItem.createMany({
          data: dto.items.map((item, idx) => ({
            checklistId: created.id,
            itemText: item.itemText.trim(),
            sortOrder: item.sortOrder ?? idx,
          })),
        });
      }
      const full = await tx.pathwayChecklist.findFirstOrThrow({
        where: { id: created.id },
        include: { items: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.PATHWAY_CHECKLIST_CREATED,
        recordType: 'PathwayChecklist',
        recordId: created.id,
        newValues: auditSnapshot(full),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Pathway checklist created', data: mapChecklist(full) };
    });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdatePathwayChecklistDto,
    meta?: RequestAuditMeta,
  ) {
    const before = await this.prisma.pathwayChecklist.findFirst({
      where: { id, deletedAt: null },
      include: { items: { where: { deletedAt: null } } },
    });
    if (!before) throw new NotFoundException('Pathway checklist not found');

    const flags = normalizeChecklistFlags({
      observationEnabled: dto.observationEnabled ?? before.observationEnabled,
      recordPhoto: dto.recordPhoto ?? before.recordPhoto,
    });

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.pathwayChecklist.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.icon !== undefined ? { icon: dto.icon?.trim() ?? null } : {}),
          ...(dto.carePlanId !== undefined ? { carePlanId: dto.carePlanId } : {}),
          ...(dto.analysisGroupId !== undefined ? { analysisGroupId: dto.analysisGroupId } : {}),
          observationEnabled: flags.observationEnabled,
          recordPhoto: flags.recordPhoto,
          ...(dto.familyShare !== undefined ? { familyShare: dto.familyShare } : {}),
          ...(dto.groupAction !== undefined ? { groupAction: dto.groupAction } : {}),
          updatedById: userId,
        },
        include: { items: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      });
      const oldS = auditSnapshot(before);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.PATHWAY_CHECKLIST_UPDATED,
        recordType: 'PathwayChecklist',
        recordId: id,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Pathway checklist updated', data: mapChecklist(updated) };
    });
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const before = await this.prisma.pathwayChecklist.findFirst({
      where: { id, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Pathway checklist not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.pathwayChecklist.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: userId },
      });
      await tx.pathwayChecklistItem.updateMany({
        where: { checklistId: id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.PATHWAY_CHECKLIST_DELETED,
        recordType: 'PathwayChecklist',
        recordId: id,
        oldValues: auditSnapshot(before),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    });
    return { message: 'Pathway checklist deleted', data: {} };
  }

  async addItem(
    userId: string,
    checklistId: string,
    dto: CreatePathwayChecklistItemBodyDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureChecklist(checklistId);
    const created = await this.prisma.pathwayChecklistItem.create({
      data: {
        checklistId,
        itemText: dto.itemText.trim(),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PATHWAY,
      action: AuditAction.PATHWAY_CHECKLIST_ITEM_CREATED,
      recordType: 'PathwayChecklistItem',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: { checklistId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Checklist item added', data: created };
  }

  async updateItem(
    userId: string,
    checklistId: string,
    itemId: string,
    dto: UpdatePathwayChecklistItemDto,
    meta?: RequestAuditMeta,
  ) {
    const before = await this.prisma.pathwayChecklistItem.findFirst({
      where: { id: itemId, checklistId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Checklist item not found');
    const updated = await this.prisma.pathwayChecklistItem.update({
      where: { id: itemId },
      data: {
        ...(dto.itemText !== undefined ? { itemText: dto.itemText.trim() } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    const oldS = auditSnapshot(before);
    const newS = auditSnapshot(updated);
    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PATHWAY,
      action: AuditAction.PATHWAY_CHECKLIST_ITEM_UPDATED,
      recordType: 'PathwayChecklistItem',
      recordId: itemId,
      oldValues: oldS,
      newValues: newS,
      metadata: { changedFields: this.audit.getChangedFields(oldS, newS), checklistId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Checklist item updated', data: updated };
  }

  async removeItem(
    userId: string,
    checklistId: string,
    itemId: string,
    meta?: RequestAuditMeta,
  ) {
    const before = await this.prisma.pathwayChecklistItem.findFirst({
      where: { id: itemId, checklistId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Checklist item not found');
    await this.prisma.pathwayChecklistItem.update({
      where: { id: itemId },
      data: { deletedAt: new Date() },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PATHWAY,
      action: AuditAction.PATHWAY_CHECKLIST_ITEM_DELETED,
      recordType: 'PathwayChecklistItem',
      recordId: itemId,
      oldValues: auditSnapshot(before),
      metadata: { checklistId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Checklist item deleted', data: {} };
  }

  private async ensureChecklist(id: string) {
    const row = await this.prisma.pathwayChecklist.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Pathway checklist not found');
  }
}
