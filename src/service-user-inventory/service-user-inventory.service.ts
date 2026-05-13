import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateServiceUserInventoryItemDto } from './dto/create-service-user-inventory-item.dto';
import { UpdateServiceUserInventoryItemDto } from './dto/update-service-user-inventory-item.dto';

const PHOTO_SEGMENTS = ['service-users', 'inventory', 'photos'] as const;

function parseDateDeposited(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new BadRequestException('dateDeposited must be YYYY-MM-DD');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0));
  if (Number.isNaN(dt.getTime())) throw new BadRequestException('Invalid dateDeposited');
  return dt;
}

function mapItem(row: {
  id: string;
  serviceUserId: string;
  itemName: string;
  quantity: number;
  itemValue: string | null;
  description: string;
  location: string;
  itemPhotoUrl: string | null;
  dateDeposited: Date;
  witnessSignatureDataUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    itemName: row.itemName,
    quantity: row.quantity,
    itemValue: row.itemValue,
    description: row.description,
    location: row.location,
    itemPhotoUrl: row.itemPhotoUrl,
    dateDeposited: row.dateDeposited.toISOString().slice(0, 10),
    witnessSignatureDataUrl: row.witnessSignatureDataUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ServiceUserInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  filePublicUrl(fileName: string): string {
    return `/uploads/${PHOTO_SEGMENTS.join('/')}/${fileName}`;
  }

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  private async ensureItem(serviceUserId: string, itemId: string) {
    const row = await this.prisma.serviceUserInventoryItem.findFirst({
      where: { id: itemId, serviceUserId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Inventory item not found');
    return row;
  }

  async list(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const rows = await this.prisma.serviceUserInventoryItem.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { data: rows.map(mapItem) };
  }

  async create(userId: string, serviceUserId: string, dto: CreateServiceUserInventoryItemDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    const dateDeposited = parseDateDeposited(dto.dateDeposited);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceUserInventoryItem.create({
        data: {
          serviceUserId,
          itemName: dto.itemName.trim(),
          quantity: dto.quantity ?? 1,
          itemValue: dto.itemValue?.trim() || null,
          description: dto.description.trim(),
          location: dto.location.trim(),
          dateDeposited,
          witnessSignatureDataUrl: dto.witnessSignatureDataUrl?.trim() || null,
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_INVENTORY_ADDED,
        recordType: 'ServiceUserInventoryItem',
        recordId: created.id,
        newValues: auditSnapshot(mapItem(created)),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Inventory item created', data: mapItem(created) };
    });
  }

  async update(
    userId: string,
    serviceUserId: string,
    itemId: string,
    dto: UpdateServiceUserInventoryItemDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserInventoryItem.findFirst({
        where: { id: itemId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Inventory item not found');

      const dateDeposited =
        dto.dateDeposited !== undefined ? parseDateDeposited(dto.dateDeposited) : undefined;

      const updated = await tx.serviceUserInventoryItem.update({
        where: { id: itemId },
        data: {
          ...(dto.itemName !== undefined ? { itemName: dto.itemName.trim() } : {}),
          ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
          ...(dto.itemValue !== undefined ? { itemValue: dto.itemValue?.trim() || null } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(dto.location !== undefined ? { location: dto.location.trim() } : {}),
          ...(dateDeposited !== undefined ? { dateDeposited } : {}),
          ...(dto.witnessSignatureDataUrl !== undefined
            ? { witnessSignatureDataUrl: dto.witnessSignatureDataUrl?.trim() || null }
            : {}),
          updatedById: userId,
        },
      });
      const oldS = auditSnapshot(mapItem(before));
      const newS = auditSnapshot(mapItem(updated));
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_INVENTORY_UPDATED,
        recordType: 'ServiceUserInventoryItem',
        recordId: itemId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Inventory item updated', data: mapItem(updated) };
    });
  }

  async remove(userId: string, serviceUserId: string, itemId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserInventoryItem.findFirst({
        where: { id: itemId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Inventory item not found');
      await tx.serviceUserInventoryItem.update({
        where: { id: itemId },
        data: { deletedAt: new Date(), deletedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_INVENTORY_DELETED,
        recordType: 'ServiceUserInventoryItem',
        recordId: itemId,
        oldValues: auditSnapshot(mapItem(before)),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Inventory item removed', data: {} };
    });
  }

  async uploadItemPhoto(
    userId: string,
    serviceUserId: string,
    itemId: string,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureItem(serviceUserId, itemId);
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP images are allowed');
    }
    const fileUrl = this.filePublicUrl(file.filename);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.serviceUserInventoryItem.update({
        where: { id: itemId },
        data: { itemPhotoUrl: fileUrl, updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_INVENTORY_PHOTO_UPLOADED,
        recordType: 'ServiceUserInventoryItem',
        recordId: itemId,
        newValues: auditSnapshot({ itemPhotoUrl: fileUrl }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Item photo uploaded', data: mapItem(updated) };
    });
  }
}
