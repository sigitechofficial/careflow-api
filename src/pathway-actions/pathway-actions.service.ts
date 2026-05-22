import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PathwayActionType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  assertEndTimeAfterStart,
  durationMinutesFromTimes,
} from '../care-pathway-common/time-validation.util';
import { PathwayActionQueryDto } from './dto/pathway-action-query.dto';
import { CreatePathwayActionDto } from './dto/create-pathway-action.dto';
import { UpdatePathwayActionDto } from './dto/update-pathway-action.dto';

function mapAction(row: {
  id: string;
  actionName: string;
  actionIcon: string;
  instruction: string | null;
  actionType: PathwayActionType;
  carersCount: number;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  notesMandatory: boolean;
  photoAllowed: boolean;
  allowFamilyShare: boolean;
  analysisAreaId: string | null;
  approxDurationMinutes: number | null;
  checklistLinks?: Array<{ checklist: { id: string; name: string } }>;
  observationLinks?: Array<{ observationTypeId: string | null }>;
}) {
  return {
    id: row.id,
    actionName: row.actionName,
    actionIcon: row.actionIcon,
    instruction: row.instruction,
    actionType: row.actionType,
    carersCount: row.carersCount,
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    notesMandatory: row.notesMandatory,
    photoAllowed: row.photoAllowed,
    allowFamilyShare: row.allowFamilyShare,
    analysisAreaId: row.analysisAreaId,
    approxDurationMinutes: row.approxDurationMinutes,
    checklistIds: row.checklistLinks?.map((l) => l.checklist.id) ?? [],
    checklists: row.checklistLinks?.map((l) => ({ id: l.checklist.id, name: l.checklist.name })) ?? [],
    observationTypeId: row.observationLinks?.[0]?.observationTypeId ?? null,
  };
}

@Injectable()
export class PathwayActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: PathwayActionQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PathwayActionWhereInput = { deletedAt: null };
    if (query.actionType) where.actionType = query.actionType;
    if (query.notesMandatory !== undefined) where.notesMandatory = query.notesMandatory;
    if (query.photoAllowed !== undefined) where.photoAllowed = query.photoAllowed;
    if (query.allowFamilyShare !== undefined) where.allowFamilyShare = query.allowFamilyShare;
    if (query.search?.trim()) {
      where.OR = [
        { actionName: { contains: query.search.trim(), mode: 'insensitive' } },
        { instruction: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }
    if (query.checklistId) {
      where.checklistLinks = { some: { checklistId: query.checklistId } };
    }
    if (query.observationTypeId) {
      where.observationLinks = { some: { observationTypeId: query.observationTypeId } };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.pathwayAction.count({ where }),
      this.prisma.pathwayAction.findMany({
        where,
        orderBy: { actionName: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          checklistLinks: { include: { checklist: true } },
          observationLinks: true,
        },
      }),
    ]);
    return {
      data: rows.map(mapAction),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(id: string) {
    const row = await this.prisma.pathwayAction.findFirst({
      where: { id, deletedAt: null },
      include: {
        checklistLinks: { include: { checklist: true } },
        observationLinks: true,
      },
    });
    if (!row) throw new NotFoundException('Pathway action not found');
    return { data: mapAction(row) };
  }

  private validateActionDto(dto: {
    carersCount?: number;
    startTime?: string;
    endTime?: string;
    actionType?: PathwayActionType;
    checklistIds?: string[];
    observationTypeId?: string;
  }) {
    const carersCount = dto.carersCount ?? 1;
    if (carersCount < 1 || carersCount > 9) {
      throw new BadRequestException('carersCount must be between 1 and 9');
    }
    assertEndTimeAfterStart(dto.startTime, dto.endTime);
    if (dto.actionType === PathwayActionType.OBSERVATION && dto.observationTypeId) {
      // validated async in create/update
    }
  }

  async create(userId: string, dto: CreatePathwayActionDto, meta?: RequestAuditMeta) {
    this.validateActionDto(dto);
    const duration =
      dto.durationMinutes ??
      durationMinutesFromTimes(dto.startTime, dto.endTime) ??
      null;

    if (dto.observationTypeId) {
      const obs = await this.prisma.observationType.findFirst({
        where: { id: dto.observationTypeId, isActive: true },
      });
      if (!obs) throw new BadRequestException('Invalid observation type');
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.pathwayAction.create({
        data: {
          actionName: dto.actionName.trim(),
          actionIcon: dto.actionIcon.trim(),
          instruction: dto.instruction?.trim() ?? null,
          actionType: dto.actionType,
          carersCount: dto.carersCount ?? 1,
          startTime: dto.startTime ?? null,
          endTime: dto.endTime ?? null,
          durationMinutes: duration,
          notesMandatory: dto.notesMandatory ?? false,
          photoAllowed: dto.photoAllowed ?? false,
          allowFamilyShare: dto.allowFamilyShare ?? false,
          analysisAreaId: dto.analysisAreaId ?? null,
          approxDurationMinutes: dto.approxDurationMinutes ?? null,
          createdById: userId,
        },
      });
      if (dto.checklistIds?.length) {
        await tx.pathwayActionChecklistLink.createMany({
          data: dto.checklistIds.map((checklistId) => ({
            pathwayActionId: created.id,
            checklistId,
          })),
          skipDuplicates: true,
        });
      }
      if (dto.actionType === PathwayActionType.OBSERVATION) {
        await tx.pathwayActionObservationLink.create({
          data: {
            pathwayActionId: created.id,
            observationTypeId: dto.observationTypeId ?? null,
          },
        });
      }
      const full = await tx.pathwayAction.findFirstOrThrow({
        where: { id: created.id },
        include: {
          checklistLinks: { include: { checklist: true } },
          observationLinks: true,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.PATHWAY_ACTION_CREATED,
        recordType: 'PathwayAction',
        recordId: created.id,
        newValues: auditSnapshot(full),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Pathway action created', data: mapAction(full) };
    });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdatePathwayActionDto,
    meta?: RequestAuditMeta,
  ) {
    const before = await this.prisma.pathwayAction.findFirst({
      where: { id, deletedAt: null },
      include: { checklistLinks: true, observationLinks: true },
    });
    if (!before) throw new NotFoundException('Pathway action not found');

    const merged = {
      carersCount: dto.carersCount ?? before.carersCount,
      startTime:
        dto.startTime !== undefined ? (dto.startTime ?? undefined) : (before.startTime ?? undefined),
      endTime: dto.endTime !== undefined ? (dto.endTime ?? undefined) : (before.endTime ?? undefined),
      actionType: dto.actionType ?? before.actionType,
      checklistIds: dto.checklistIds,
      observationTypeId: dto.observationTypeId,
    };
    this.validateActionDto(merged);

    const duration =
      dto.durationMinutes ??
      durationMinutesFromTimes(merged.startTime, merged.endTime) ??
      before.durationMinutes;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.pathwayAction.update({
        where: { id },
        data: {
          ...(dto.actionName !== undefined ? { actionName: dto.actionName.trim() } : {}),
          ...(dto.actionIcon !== undefined ? { actionIcon: dto.actionIcon.trim() } : {}),
          ...(dto.instruction !== undefined ? { instruction: dto.instruction?.trim() ?? null } : {}),
          ...(dto.actionType !== undefined ? { actionType: dto.actionType } : {}),
          carersCount: merged.carersCount,
          startTime: merged.startTime,
          endTime: merged.endTime,
          durationMinutes: duration,
          ...(dto.notesMandatory !== undefined ? { notesMandatory: dto.notesMandatory } : {}),
          ...(dto.photoAllowed !== undefined ? { photoAllowed: dto.photoAllowed } : {}),
          ...(dto.allowFamilyShare !== undefined ? { allowFamilyShare: dto.allowFamilyShare } : {}),
          ...(dto.analysisAreaId !== undefined ? { analysisAreaId: dto.analysisAreaId } : {}),
          ...(dto.approxDurationMinutes !== undefined
            ? { approxDurationMinutes: dto.approxDurationMinutes }
            : {}),
          updatedById: userId,
        },
      });

      if (dto.checklistIds !== undefined) {
        await tx.pathwayActionChecklistLink.deleteMany({ where: { pathwayActionId: id } });
        if (dto.checklistIds.length) {
          await tx.pathwayActionChecklistLink.createMany({
            data: dto.checklistIds.map((checklistId) => ({ pathwayActionId: id, checklistId })),
          });
        }
      }
      if (dto.observationTypeId !== undefined || dto.actionType !== undefined) {
        await tx.pathwayActionObservationLink.deleteMany({ where: { pathwayActionId: id } });
        if ((dto.actionType ?? before.actionType) === PathwayActionType.OBSERVATION) {
          await tx.pathwayActionObservationLink.create({
            data: { pathwayActionId: id, observationTypeId: dto.observationTypeId ?? null },
          });
        }
      }

      const full = await tx.pathwayAction.findFirstOrThrow({
        where: { id },
        include: {
          checklistLinks: { include: { checklist: true } },
          observationLinks: true,
        },
      });
      const oldS = auditSnapshot(before);
      const newS = auditSnapshot(full);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.PATHWAY_ACTION_UPDATED,
        recordType: 'PathwayAction',
        recordId: id,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Pathway action updated', data: mapAction(full) };
    });
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const before = await this.prisma.pathwayAction.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Pathway action not found');
    await this.prisma.pathwayAction.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PATHWAY,
      action: AuditAction.PATHWAY_ACTION_DELETED,
      recordType: 'PathwayAction',
      recordId: id,
      oldValues: auditSnapshot(before),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Pathway action deleted', data: {} };
  }

  async linkChecklist(
    userId: string,
    actionId: string,
    checklistId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureAction(actionId);
    const checklist = await this.prisma.pathwayChecklist.findFirst({
      where: { id: checklistId, deletedAt: null },
    });
    if (!checklist) throw new NotFoundException('Checklist not found');
    const link = await this.prisma.pathwayActionChecklistLink.upsert({
      where: {
        pathwayActionId_checklistId: { pathwayActionId: actionId, checklistId },
      },
      create: { pathwayActionId: actionId, checklistId },
      update: {},
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PATHWAY,
      action: AuditAction.PATHWAY_ACTION_CHECKLIST_LINKED,
      recordType: 'PathwayActionChecklistLink',
      recordId: link.id,
      newValues: auditSnapshot(link),
      metadata: { pathwayActionId: actionId, checklistId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Checklist linked', data: link };
  }

  async unlinkChecklist(
    userId: string,
    actionId: string,
    checklistId: string,
    meta?: RequestAuditMeta,
  ) {
    const link = await this.prisma.pathwayActionChecklistLink.findFirst({
      where: { pathwayActionId: actionId, checklistId },
    });
    if (!link) throw new NotFoundException('Link not found');
    await this.prisma.pathwayActionChecklistLink.delete({ where: { id: link.id } });
    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PATHWAY,
      action: AuditAction.PATHWAY_ACTION_CHECKLIST_UNLINKED,
      recordType: 'PathwayActionChecklistLink',
      recordId: link.id,
      oldValues: auditSnapshot(link),
      metadata: { pathwayActionId: actionId, checklistId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Checklist unlinked', data: {} };
  }

  private async ensureAction(id: string) {
    const row = await this.prisma.pathwayAction.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Pathway action not found');
  }
}
