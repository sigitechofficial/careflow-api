import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { assertServiceUserExists } from '../medications/medication.asserts';
import { CreateMedicationAllergyDto } from './dto/create-medication-allergy.dto';
import { UpdateMedicationAllergyDto } from './dto/update-medication-allergy.dto';

@Injectable()
export class MedicationAllergiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(serviceUserId: string) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    return this.prisma.medicationAllergy.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async create(userId: string, serviceUserId: string, dto: CreateMedicationAllergyDto, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const row = await this.prisma.medicationAllergy.create({
      data: {
        serviceUserId,
        allergyName: dto.allergyName,
        reaction: dto.reaction,
        severity: dto.severity,
        notes: dto.notes,
        recordedById: userId,
        createdById: userId,
        updatedById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_ALLERGY_ADDED,
      recordType: 'MedicationAllergy',
      recordId: row.id,
      newValues: auditSnapshot(row),
      metadata: { serviceUserId },
      ...meta,
    });
    return row;
  }

  async update(
    userId: string,
    serviceUserId: string,
    allergyId: string,
    dto: UpdateMedicationAllergyDto,
    meta: RequestAuditMeta,
  ) {
    const existing = await this.prisma.medicationAllergy.findFirst({
      where: { id: allergyId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Medication allergy not found');
    const updated = await this.prisma.medicationAllergy.update({
      where: { id: allergyId },
      data: {
        allergyName: dto.allergyName,
        reaction: dto.reaction,
        severity: dto.severity,
        notes: dto.notes,
        updatedById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_ALLERGY_UPDATED,
      recordType: 'MedicationAllergy',
      recordId: allergyId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });
    return updated;
  }

  async remove(userId: string, serviceUserId: string, allergyId: string, meta: RequestAuditMeta) {
    const existing = await this.prisma.medicationAllergy.findFirst({
      where: { id: allergyId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Medication allergy not found');
    await this.prisma.medicationAllergy.update({
      where: { id: allergyId },
      data: { deletedAt: new Date(), deletedById: userId, isActive: false, updatedById: userId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_ALLERGY_DELETED,
      recordType: 'MedicationAllergy',
      recordId: allergyId,
      oldValues: auditSnapshot(existing),
      ...meta,
    });
    return { id: allergyId, deleted: true };
  }
}
