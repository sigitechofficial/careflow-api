import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateServiceUserContactDto } from './dto/create-service-user-contact.dto';
import { UpdateServiceUserContactDto } from './dto/update-service-user-contact.dto';

@Injectable()
export class ServiceUserContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  private async ensureRelationshipType(id: string | undefined) {
    if (!id) return;
    const r = await this.prisma.relationshipType.findFirst({ where: { id, isActive: true } });
    if (!r) throw new BadRequestException('Invalid relationship type');
  }

  async list(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const data = await this.prisma.serviceUserContact.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      include: { relationshipType: true },
    });
    return { data };
  }

  async create(
    userId: string,
    serviceUserId: string,
    dto: CreateServiceUserContactDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    await this.ensureRelationshipType(dto.relationshipTypeId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.serviceUserContact.updateMany({
          where: { serviceUserId, deletedAt: null, isPrimary: true },
          data: { isPrimary: false, updatedById: userId },
        });
      }
      const created = await tx.serviceUserContact.create({
        data: {
          serviceUserId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          relationshipTypeId: dto.relationshipTypeId,
          phone: dto.phone,
          mobile: dto.mobile,
          email: dto.email,
          address: dto.address,
          isPrimary: dto.isPrimary ?? false,
          isEmergencyContact: dto.isEmergencyContact ?? false,
          canReceiveUpdates: dto.canReceiveUpdates ?? false,
          notes: dto.notes,
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_CONTACT_ADDED,
        recordType: 'ServiceUserContact',
        recordId: created.id,
        newValues: auditSnapshot({ ...created, serviceUserId }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Contact created', data: created };
    });
  }

  async update(
    userId: string,
    serviceUserId: string,
    contactId: string,
    dto: UpdateServiceUserContactDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    await this.ensureRelationshipType(dto.relationshipTypeId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserContact.findFirst({
        where: { id: contactId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Contact not found');

      if (dto.isPrimary === true) {
        await tx.serviceUserContact.updateMany({
          where: { serviceUserId, deletedAt: null, isPrimary: true, NOT: { id: contactId } },
          data: { isPrimary: false, updatedById: userId },
        });
      }

      const updated = await tx.serviceUserContact.update({
        where: { id: contactId },
        data: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
          ...(dto.relationshipTypeId !== undefined ? { relationshipTypeId: dto.relationshipTypeId } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.mobile !== undefined ? { mobile: dto.mobile } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          ...(dto.isEmergencyContact !== undefined ? { isEmergencyContact: dto.isEmergencyContact } : {}),
          ...(dto.canReceiveUpdates !== undefined ? { canReceiveUpdates: dto.canReceiveUpdates } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          updatedById: userId,
        },
      });
      const oldS = auditSnapshot(before);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_CONTACT_UPDATED,
        recordType: 'ServiceUserContact',
        recordId: contactId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Contact updated', data: updated };
    });
  }

  async remove(userId: string, serviceUserId: string, contactId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserContact.findFirst({
        where: { id: contactId, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Contact not found');
      await tx.serviceUserContact.update({
        where: { id: contactId },
        data: { deletedAt: new Date(), deletedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_CONTACT_DELETED,
        recordType: 'ServiceUserContact',
        recordId: contactId,
        oldValues: auditSnapshot(before),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Contact deleted', data: {} };
    });
  }
}
