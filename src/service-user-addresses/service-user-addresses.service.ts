import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { UpdateServiceUserAddressDto } from './dto/update-service-user-address.dto';

@Injectable()
export class ServiceUserAddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  async get(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const address = await this.prisma.serviceUserAddress.findFirst({
      where: { serviceUserId, deletedAt: null },
    });
    return { data: address };
  }

  private buildAddressFields(dto: UpdateServiceUserAddressDto): Prisma.ServiceUserAddressUpdateInput {
    const data: Prisma.ServiceUserAddressUpdateInput = {};
    if (dto.addressLine1 !== undefined) data.addressLine1 = dto.addressLine1;
    if (dto.addressLine2 !== undefined) data.addressLine2 = dto.addressLine2;
    if (dto.town !== undefined) data.town = dto.town;
    if (dto.county !== undefined) data.county = dto.county;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.postcode !== undefined) data.postcode = dto.postcode;
    if (dto.secondaryPostcode !== undefined) data.secondaryPostcode = dto.secondaryPostcode;
    if (dto.accessInstructions !== undefined) data.accessInstructions = dto.accessInstructions;
    if (dto.keySafeNumber !== undefined) data.keySafeNumber = dto.keySafeNumber;
    if (dto.accessMethod !== undefined) {
      data.accessMethod = dto.accessMethod?.trim() ? dto.accessMethod.trim() : null;
    }
    if (dto.keySafeLocation !== undefined) {
      data.keySafeLocation = dto.keySafeLocation?.trim() ? dto.keySafeLocation.trim() : null;
    }
    if (dto.latitude !== undefined && dto.latitude !== null) {
      data.latitude = new Prisma.Decimal(dto.latitude);
    }
    if (dto.longitude !== undefined && dto.longitude !== null) {
      data.longitude = new Prisma.Decimal(dto.longitude);
    }
    return data;
  }

  async upsert(userId: string, serviceUserId: string, dto: UpdateServiceUserAddressDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserAddress.findFirst({
        where: { serviceUserId, deletedAt: null },
      });
      const fields = this.buildAddressFields(dto);
      fields.updatedById = userId;

      const updated = await tx.serviceUserAddress.upsert({
        where: { serviceUserId },
        create: {
          serviceUserId,
          addressLine1: dto.addressLine1 ?? null,
          addressLine2: dto.addressLine2 ?? null,
          town: dto.town ?? null,
          county: dto.county ?? null,
          country: dto.country ?? null,
          postcode: dto.postcode ?? null,
          secondaryPostcode: dto.secondaryPostcode ?? null,
          accessInstructions: dto.accessInstructions ?? null,
          keySafeNumber: dto.keySafeNumber ?? null,
          accessMethod: dto.accessMethod?.trim() ? dto.accessMethod.trim() : null,
          keySafeLocation: dto.keySafeLocation?.trim() ? dto.keySafeLocation.trim() : null,
          latitude:
            dto.latitude !== undefined && dto.latitude !== null ? new Prisma.Decimal(dto.latitude) : null,
          longitude:
            dto.longitude !== undefined && dto.longitude !== null ? new Prisma.Decimal(dto.longitude) : null,
          createdById: userId,
          updatedById: userId,
        },
        update: fields,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_ADDRESS_UPDATED,
        recordType: 'ServiceUserAddress',
        recordId: updated.id,
        oldValues: auditSnapshot(before),
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Address saved', data: updated };
    });
  }
}
