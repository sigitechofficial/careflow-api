import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { assertServiceUserExists } from '../medications/medication.asserts';
import { CreateMedicationPackDto } from './dto/create-medication-pack.dto';
import { UpdateMedicationPackDto } from './dto/update-medication-pack.dto';
import { CreateMedicationPackItemDto } from './dto/create-medication-pack-item.dto';
import { UpdateMedicationPackItemDto } from './dto/update-medication-pack-item.dto';

const packInclude = {
  items: { where: { deletedAt: null, isActive: true }, orderBy: { sortOrder: 'asc' as const } },
} as const;

@Injectable()
export class MedicationPacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(serviceUserId: string) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    return this.prisma.medicationPack.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
      include: packInclude,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getOne(serviceUserId: string, packId: string) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const pack = await this.prisma.medicationPack.findFirst({
      where: { id: packId, serviceUserId, deletedAt: null },
      include: packInclude,
    });
    if (!pack) throw new NotFoundException('Medication pack not found');
    return pack;
  }

  async create(userId: string, serviceUserId: string, dto: CreateMedicationPackDto, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const created = await this.prisma.medicationPack.create({
      data: {
        serviceUserId,
        name: dto.name,
        description: dto.description,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        createdById: userId,
        updatedById: userId,
      },
      include: packInclude,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_CREATED,
      recordType: 'MedicationPack',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: { serviceUserId },
      ...meta,
    });
    return created;
  }

  async update(userId: string, serviceUserId: string, packId: string, dto: UpdateMedicationPackDto, meta: RequestAuditMeta) {
    const existing = await this.prisma.medicationPack.findFirst({
      where: { id: packId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Medication pack not found');
    const updated = await this.prisma.medicationPack.update({
      where: { id: packId },
      data: {
        name: dto.name,
        description: dto.description,
        startDate: dto.startDate === undefined ? undefined : dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate === undefined ? undefined : dto.endDate ? new Date(dto.endDate) : null,
        updatedById: userId,
      },
      include: packInclude,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_UPDATED,
      recordType: 'MedicationPack',
      recordId: packId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });
    return updated;
  }

  async remove(userId: string, serviceUserId: string, packId: string, meta: RequestAuditMeta) {
    const existing = await this.prisma.medicationPack.findFirst({
      where: { id: packId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Medication pack not found');
    const now = new Date();
    await this.prisma.medicationPack.update({
      where: { id: packId },
      data: { deletedAt: now, deletedById: userId, isActive: false, updatedById: userId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_DELETED,
      recordType: 'MedicationPack',
      recordId: packId,
      oldValues: auditSnapshot(existing),
      ...meta,
    });
    return { id: packId, deleted: true };
  }

  async addItem(
    userId: string,
    serviceUserId: string,
    packId: string,
    dto: CreateMedicationPackItemDto,
    meta: RequestAuditMeta,
  ) {
    await this.getOne(serviceUserId, packId);
    const item = await this.prisma.medicationPackItem.create({
      data: {
        medicationPackId: packId,
        medicationName: dto.medicationName,
        strength: dto.strength,
        notes: dto.notes,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_ITEM_ADDED,
      recordType: 'MedicationPackItem',
      recordId: item.id,
      newValues: auditSnapshot(item),
      metadata: { serviceUserId, packId },
      ...meta,
    });
    return item;
  }

  async updateItem(
    userId: string,
    serviceUserId: string,
    packId: string,
    itemId: string,
    dto: UpdateMedicationPackItemDto,
    meta: RequestAuditMeta,
  ) {
    await this.getOne(serviceUserId, packId);
    const existing = await this.prisma.medicationPackItem.findFirst({
      where: { id: itemId, medicationPackId: packId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Pack item not found');
    const updated = await this.prisma.medicationPackItem.update({
      where: { id: itemId },
      data: {
        medicationName: dto.medicationName,
        strength: dto.strength,
        notes: dto.notes,
        sortOrder: dto.sortOrder,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_ITEM_UPDATED,
      recordType: 'MedicationPackItem',
      recordId: itemId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });
    return updated;
  }

  async removeItem(userId: string, serviceUserId: string, packId: string, itemId: string, meta: RequestAuditMeta) {
    await this.getOne(serviceUserId, packId);
    const existing = await this.prisma.medicationPackItem.findFirst({
      where: { id: itemId, medicationPackId: packId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Pack item not found');
    await this.prisma.medicationPackItem.update({
      where: { id: itemId },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_ITEM_DELETED,
      recordType: 'MedicationPackItem',
      recordId: itemId,
      oldValues: auditSnapshot(existing),
      ...meta,
    });
    return { id: itemId, deleted: true };
  }
}
