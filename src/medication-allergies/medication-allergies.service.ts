import { Injectable, NotFoundException } from '@nestjs/common';
import { AllergyCatalogCategory, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { assertServiceUserExists } from '../medications/medication.asserts';
import { CreateMedicationAllergyDto } from './dto/create-medication-allergy.dto';
import { UpdateMedicationAllergyDto } from './dto/update-medication-allergy.dto';

type AllergyRow = Prisma.ServiceUserAllergyGetPayload<{ include: { allergyCatalog: { select: { category: true } } } }>;

/** Keeps the shape the Meds tab has always used, over the person's one allergy list. */
export function toMedicationAllergyRow(row: AllergyRow) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    allergyName: row.allergyName,
    reaction: null,
    severity: null,
    notes: row.comment || null,
    recordedAt: row.createdAt.toISOString(),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Comment saved when an allergy is added from the Meds tab without one. */
export function medicationAllergyComment(dto: { reaction?: string; severity?: string; notes?: string }): string {
  const parts = [
    dto.reaction?.trim() ? `Reaction: ${dto.reaction.trim()}` : '',
    dto.severity?.trim() ? `Severity: ${dto.severity.trim()}` : '',
    dto.notes?.trim() ?? '',
  ].filter(Boolean);
  return parts.join('. ') || 'Recorded from the Meds tab';
}

/**
 * Medicine allergies are the medicine-type entries in the person's one allergy list (Profile → Allergies).
 * There used to be a separate list here, which the carer app and family portal never saw.
 */
@Injectable()
export class MedicationAllergiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private medicineWhere(serviceUserId: string, medicineNames: string[]): Prisma.ServiceUserAllergyWhereInput {
    return {
      serviceUserId,
      deletedAt: null,
      isActive: true,
      OR: [
        { allergyCatalog: { category: AllergyCatalogCategory.MEDICATION } },
        { allergyCatalogId: null, allergyName: { in: medicineNames, mode: 'insensitive' } },
      ],
    };
  }

  private async medicineNames(): Promise<string[]> {
    const rows = await this.prisma.allergyCatalog.findMany({
      where: { category: AllergyCatalogCategory.MEDICATION },
      select: { name: true },
    });
    return rows.map((r) => r.name);
  }

  async list(serviceUserId: string) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const rows = await this.prisma.serviceUserAllergy.findMany({
      where: this.medicineWhere(serviceUserId, await this.medicineNames()),
      include: { allergyCatalog: { select: { category: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toMedicationAllergyRow);
  }

  async create(userId: string, serviceUserId: string, dto: CreateMedicationAllergyDto, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const name = dto.allergyName.trim();
    const existing = await this.prisma.serviceUserAllergy.findFirst({
      where: { serviceUserId, deletedAt: null, isActive: true, allergyName: { equals: name, mode: 'insensitive' } },
      include: { allergyCatalog: { select: { category: true } } },
    });
    if (existing) return toMedicationAllergyRow(existing);
    const catalog = await this.prisma.allergyCatalog.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, isActive: true },
      select: { id: true, name: true },
    });
    const row = await this.prisma.serviceUserAllergy.create({
      data: {
        serviceUserId,
        allergyCatalogId: catalog?.id ?? null,
        allergyName: catalog?.name ?? name,
        comment: medicationAllergyComment(dto),
        createdById: userId,
        updatedById: userId,
      },
      include: { allergyCatalog: { select: { category: true } } },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_ALLERGY_ADDED,
      recordType: 'ServiceUserAllergy',
      recordId: row.id,
      newValues: auditSnapshot(toMedicationAllergyRow(row)),
      metadata: { serviceUserId, from: 'meds tab' },
      ...meta,
    });
    return toMedicationAllergyRow(row);
  }

  async update(
    userId: string,
    serviceUserId: string,
    allergyId: string,
    dto: UpdateMedicationAllergyDto,
    meta: RequestAuditMeta,
  ) {
    const existing = await this.prisma.serviceUserAllergy.findFirst({
      where: { id: allergyId, serviceUserId, deletedAt: null },
      include: { allergyCatalog: { select: { category: true } } },
    });
    if (!existing) throw new NotFoundException('Allergy not found');
    const comment =
      dto.reaction !== undefined || dto.severity !== undefined || dto.notes !== undefined
        ? medicationAllergyComment(dto)
        : undefined;
    const updated = await this.prisma.serviceUserAllergy.update({
      where: { id: allergyId },
      data: {
        ...(dto.allergyName?.trim() ? { allergyName: dto.allergyName.trim() } : {}),
        ...(comment !== undefined ? { comment } : {}),
        updatedById: userId,
      },
      include: { allergyCatalog: { select: { category: true } } },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_ALLERGY_UPDATED,
      recordType: 'ServiceUserAllergy',
      recordId: allergyId,
      oldValues: auditSnapshot(toMedicationAllergyRow(existing)),
      newValues: auditSnapshot(toMedicationAllergyRow(updated)),
      ...meta,
    });
    return toMedicationAllergyRow(updated);
  }

  async remove(userId: string, serviceUserId: string, allergyId: string, meta: RequestAuditMeta) {
    const existing = await this.prisma.serviceUserAllergy.findFirst({
      where: { id: allergyId, serviceUserId, deletedAt: null },
      include: { allergyCatalog: { select: { category: true } } },
    });
    if (!existing) throw new NotFoundException('Allergy not found');
    await this.prisma.serviceUserAllergy.update({
      where: { id: allergyId },
      data: { deletedAt: new Date(), deletedById: userId, isActive: false, updatedById: userId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_ALLERGY_DELETED,
      recordType: 'ServiceUserAllergy',
      recordId: allergyId,
      oldValues: auditSnapshot(toMedicationAllergyRow(existing)),
      ...meta,
    });
    return { id: allergyId, deleted: true };
  }
}
