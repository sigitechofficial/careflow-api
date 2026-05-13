import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateServiceUserAllergyDto } from './dto/create-service-user-allergy.dto';
import { UpdateServiceUserAllergyDto } from './dto/update-service-user-allergy.dto';

function mapAllergy(row: {
  id: string;
  serviceUserId: string;
  allergyCatalogId: string | null;
  allergyName: string;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    allergyCatalogId: row.allergyCatalogId,
    allergyName: row.allergyName,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ServiceUserAllergiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  async list(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const rows = await this.prisma.serviceUserAllergy.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { data: rows.map(mapAllergy) };
  }

  private async resolveAllergyFields(dto: CreateServiceUserAllergyDto | UpdateServiceUserAllergyDto): Promise<{
    allergyCatalogId: string | null;
    allergyName: string;
  }> {
    const rawName = dto.allergyName?.trim() ?? '';
    if (dto.allergyCatalogId) {
      const cat = await this.prisma.allergyCatalog.findFirst({
        where: { id: dto.allergyCatalogId, isActive: true },
      });
      if (!cat) throw new BadRequestException('Invalid allergy selection');
      return { allergyCatalogId: cat.id, allergyName: cat.name };
    }
    if (rawName) {
      return { allergyCatalogId: null, allergyName: rawName };
    }
    throw new BadRequestException('Select an allergy from the list or enter an allergy name');
  }

  async create(userId: string, serviceUserId: string, dto: CreateServiceUserAllergyDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    const { allergyCatalogId, allergyName } = await this.resolveAllergyFields(dto);
    const comment = dto.comment.trim();
    if (!comment) throw new BadRequestException('Comment is required');

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceUserAllergy.create({
        data: {
          serviceUserId,
          allergyCatalogId,
          allergyName,
          comment,
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_ALLERGY_ADDED,
        recordType: 'ServiceUserAllergy',
        recordId: created.id,
        newValues: auditSnapshot(mapAllergy(created)),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Allergy recorded', data: mapAllergy(created) };
    });
  }

  async update(
    userId: string,
    serviceUserId: string,
    allergyId: string,
    dto: UpdateServiceUserAllergyDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserAllergy.findFirst({
        where: { id: allergyId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Allergy not found');

      let allergyCatalogId: string | null | undefined = undefined;
      let allergyName: string | undefined = undefined;
      if (dto.allergyCatalogId !== undefined || dto.allergyName !== undefined) {
        const resolved = await this.resolveAllergyFields({
          allergyCatalogId: dto.allergyCatalogId ?? undefined,
          allergyName: dto.allergyName ?? undefined,
          comment: dto.comment ?? before.comment,
        });
        allergyCatalogId = resolved.allergyCatalogId;
        allergyName = resolved.allergyName;
      }

      const comment =
        dto.comment !== undefined ? dto.comment.trim() : undefined;
      if (comment !== undefined && !comment) throw new BadRequestException('Comment is required');

      const updated = await tx.serviceUserAllergy.update({
        where: { id: allergyId },
        data: {
          ...(allergyCatalogId !== undefined ? { allergyCatalogId } : {}),
          ...(allergyName !== undefined ? { allergyName } : {}),
          ...(comment !== undefined ? { comment } : {}),
          updatedById: userId,
        },
      });
      const oldS = auditSnapshot(mapAllergy(before));
      const newS = auditSnapshot(mapAllergy(updated));
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_ALLERGY_UPDATED,
        recordType: 'ServiceUserAllergy',
        recordId: allergyId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Allergy updated', data: mapAllergy(updated) };
    });
  }

  async remove(userId: string, serviceUserId: string, allergyId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserAllergy.findFirst({
        where: { id: allergyId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Allergy not found');
      await tx.serviceUserAllergy.update({
        where: { id: allergyId },
        data: { deletedAt: new Date(), deletedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_ALLERGY_DELETED,
        recordType: 'ServiceUserAllergy',
        recordId: allergyId,
        oldValues: auditSnapshot(mapAllergy(before)),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Allergy removed', data: {} };
    });
  }
}
