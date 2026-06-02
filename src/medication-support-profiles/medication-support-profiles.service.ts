import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { assertServiceUserExists } from '../medications/medication.asserts';
import { UpdateMedicationSupportProfileDto } from './dto/update-medication-support-profile.dto';

@Injectable()
export class MedicationSupportProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async get(serviceUserId: string) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    let row = await this.prisma.medicationSupportProfile.findFirst({
      where: { serviceUserId, deletedAt: null },
    });
    if (!row) {
      const archived = await this.prisma.medicationSupportProfile.findFirst({
        where: { serviceUserId, deletedAt: { not: null } },
        orderBy: { updatedAt: 'desc' },
      });
      if (archived) {
        row = await this.prisma.medicationSupportProfile.update({
          where: { id: archived.id },
          data: {
            deletedAt: null,
            deletedById: null,
            isActive: true,
          },
        });
      } else {
        row = await this.prisma.medicationSupportProfile.create({
          data: {
            serviceUserId,
            selfAdministersMedication: false,
            requiresPrompting: false,
            requiresSupervision: false,
            requiresCarerAdministration: false,
            familyMemberOrCarerSupportsMedication: false,
          },
        });
      }
    }
    return row;
  }

  async update(userId: string, serviceUserId: string, dto: UpdateMedicationSupportProfileDto, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const existing = await this.get(serviceUserId);
    const updated = await this.prisma.medicationSupportProfile.update({
      where: { id: existing.id },
      data: {
        selfAdministersMedication: dto.selfAdministersMedication ?? existing.selfAdministersMedication,
        requiresPrompting: dto.requiresPrompting ?? existing.requiresPrompting,
        requiresSupervision: dto.requiresSupervision ?? existing.requiresSupervision,
        requiresCarerAdministration: dto.requiresCarerAdministration ?? existing.requiresCarerAdministration,
        familyMemberOrCarerSupportsMedication:
          dto.familyMemberOrCarerSupportsMedication ?? existing.familyMemberOrCarerSupportsMedication,
        notes: dto.notes === undefined ? undefined : dto.notes,
        updatedById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_SUPPORT_PROFILE_UPDATED,
      recordType: 'MedicationSupportProfile',
      recordId: updated.id,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      metadata: { serviceUserId },
      ...meta,
    });
    return updated;
  }
}
