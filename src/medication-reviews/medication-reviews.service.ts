import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { assertServiceUserExists } from '../medications/medication.asserts';
import { CreateMedicationReviewDto } from './dto/create-medication-review.dto';
import { UpdateMedicationReviewDto } from './dto/update-medication-review.dto';

const inc = { reviewedBy: { include: { personalDetail: true } } } as const;

@Injectable()
export class MedicationReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(serviceUserId: string) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    return this.prisma.medicationReview.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
      include: inc,
      orderBy: { reviewDate: 'desc' },
    });
  }

  async create(userId: string, serviceUserId: string, dto: CreateMedicationReviewDto, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const row = await this.prisma.medicationReview.create({
      data: {
        serviceUserId,
        reviewedById: dto.reviewedById,
        reviewDate: new Date(dto.reviewDate),
        purpose: dto.purpose,
        outcome: dto.outcome,
        notes: dto.notes,
        nextReviewDate: dto.nextReviewDate ? new Date(dto.nextReviewDate) : undefined,
        createdById: userId,
        updatedById: userId,
      },
      include: inc,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_REVIEW_ADDED,
      recordType: 'MedicationReview',
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
    reviewId: string,
    dto: UpdateMedicationReviewDto,
    meta: RequestAuditMeta,
  ) {
    const existing = await this.prisma.medicationReview.findFirst({
      where: { id: reviewId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Medication review not found');
    const updated = await this.prisma.medicationReview.update({
      where: { id: reviewId },
      data: {
        reviewedById: dto.reviewedById,
        reviewDate: dto.reviewDate === undefined ? undefined : new Date(dto.reviewDate),
        purpose: dto.purpose,
        outcome: dto.outcome,
        notes: dto.notes,
        nextReviewDate:
          dto.nextReviewDate === undefined ? undefined : dto.nextReviewDate ? new Date(dto.nextReviewDate) : null,
        updatedById: userId,
      },
      include: inc,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_REVIEW_UPDATED,
      recordType: 'MedicationReview',
      recordId: reviewId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });
    return updated;
  }

  async remove(userId: string, serviceUserId: string, reviewId: string, meta: RequestAuditMeta) {
    const existing = await this.prisma.medicationReview.findFirst({
      where: { id: reviewId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Medication review not found');
    await this.prisma.medicationReview.update({
      where: { id: reviewId },
      data: { deletedAt: new Date(), deletedById: userId, isActive: false, updatedById: userId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_REVIEW_DELETED,
      recordType: 'MedicationReview',
      recordId: reviewId,
      oldValues: auditSnapshot(existing),
      ...meta,
    });
    return { id: reviewId, deleted: true };
  }
}
