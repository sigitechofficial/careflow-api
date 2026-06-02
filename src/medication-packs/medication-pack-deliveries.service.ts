import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MedicationPackDeliveryLineState, MedicationPackDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreateMedicationPackDeliveryDto } from './dto/create-medication-pack-delivery.dto';
import { ReconcileMedicationPackDeliveryLineDto } from './dto/reconcile-medication-pack-delivery-line.dto';
import { CountersignMedicationPackDeliveryDto } from './dto/countersign-medication-pack-delivery.dto';

const deliveryInclude = {
  lines: { orderBy: { sortOrder: 'asc' as const } },
} as const;

@Injectable()
export class MedicationPackDeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async getPackOrThrow(serviceUserId: string, packId: string) {
    const pack = await this.prisma.medicationPack.findFirst({
      where: { id: packId, serviceUserId, deletedAt: null },
    });
    if (!pack) throw new NotFoundException('Medication pack not found');
    return pack;
  }

  private async getDeliveryOrThrow(packId: string, deliveryId: string) {
    const delivery = await this.prisma.medicationPackDelivery.findFirst({
      where: { id: deliveryId, medicationPackId: packId, deletedAt: null },
      include: deliveryInclude,
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    return delivery;
  }

  async list(serviceUserId: string, packId: string) {
    await this.getPackOrThrow(serviceUserId, packId);
    return this.prisma.medicationPackDelivery.findMany({
      where: { medicationPackId: packId, deletedAt: null },
      include: deliveryInclude,
      orderBy: { receivedAt: 'desc' },
    });
  }

  async create(
    userId: string,
    serviceUserId: string,
    packId: string,
    dto: CreateMedicationPackDeliveryDto,
    meta: RequestAuditMeta,
  ) {
    const pack = await this.getPackOrThrow(serviceUserId, packId);

    // Expected contents come from the latest published snapshot (CQC reconciliation).
    const snapshot = await this.prisma.medicationPackContentsSnapshot.findFirst({
      where: { medicationPackId: packId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { publishedAt: 'desc' },
    });
    if (!snapshot) {
      throw new BadRequestException('Publish the pack before logging a delivery — no contents to reconcile against');
    }

    const created = await this.prisma.medicationPackDelivery.create({
      data: {
        medicationPackId: packId,
        contentsSnapshotId: snapshot.id,
        cycleNumber: pack.cycleNumber,
        status: MedicationPackDeliveryStatus.PENDING,
        receivedAt: new Date(dto.receivedAt),
        receivedById: dto.receivedById,
        deliveredBy: dto.deliveredBy,
        batchReference: dto.batchReference,
        condition: dto.condition ?? undefined,
        conditionNotes: dto.conditionNotes,
        createdById: userId,
        lines: {
          create: snapshot.lines.map((l, index) => ({
            serviceUserMedicationId: l.serviceUserMedicationId,
            medicationName: l.medicationName,
            strength: l.strength,
            dose: l.dose,
            expectedOnSnapshot: true,
            state: MedicationPackDeliveryLineState.PENDING,
            sortOrder: index,
          })),
        },
      },
      include: deliveryInclude,
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_DELIVERY_LOGGED,
      recordType: 'MedicationPackDelivery',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: { serviceUserId, packId, cycleNumber: pack.cycleNumber },
      ...meta,
    });
    return created;
  }

  async reconcileLine(
    userId: string,
    serviceUserId: string,
    packId: string,
    deliveryId: string,
    lineId: string,
    dto: ReconcileMedicationPackDeliveryLineDto,
    meta: RequestAuditMeta,
  ) {
    await this.getPackOrThrow(serviceUserId, packId);
    const delivery = await this.getDeliveryOrThrow(packId, deliveryId);
    if (delivery.status === MedicationPackDeliveryStatus.VERIFIED) {
      throw new ConflictException('Delivery is already verified and locked');
    }
    const line = delivery.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException('Delivery line not found');

    const resolvedState =
      dto.state ??
      (dto.confirmedPresent
        ? MedicationPackDeliveryLineState.MATCHED
        : MedicationPackDeliveryLineState.MISSING);

    await this.prisma.medicationPackDeliveryLine.update({
      where: { id: lineId },
      data: {
        confirmedPresent: dto.confirmedPresent,
        state: resolvedState,
        notes: dto.notes,
      },
    });

    const updated = await this.recomputeStatus(deliveryId);

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_DELIVERY_RECONCILED,
      recordType: 'MedicationPackDeliveryLine',
      recordId: lineId,
      newValues: auditSnapshot({ confirmedPresent: dto.confirmedPresent, state: resolvedState, notes: dto.notes }),
      metadata: { serviceUserId, packId, deliveryId, deliveryStatus: updated.status },
      ...meta,
    });
    return updated;
  }

  private async recomputeStatus(deliveryId: string) {
    const delivery = await this.prisma.medicationPackDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
      include: deliveryInclude,
    });
    const lines = delivery.lines;
    const anyFlagged = lines.some(
      (l) =>
        l.state === MedicationPackDeliveryLineState.MISSING ||
        l.state === MedicationPackDeliveryLineState.DISCREPANCY,
    );
    const allHandled = lines.every((l) => l.state !== MedicationPackDeliveryLineState.PENDING);

    let status: MedicationPackDeliveryStatus = MedicationPackDeliveryStatus.PENDING;
    if (anyFlagged) status = MedicationPackDeliveryStatus.FLAGGED;
    else if (allHandled && lines.length > 0) status = MedicationPackDeliveryStatus.RECONCILED;

    if (status !== delivery.status) {
      return this.prisma.medicationPackDelivery.update({
        where: { id: deliveryId },
        data: { status },
        include: deliveryInclude,
      });
    }
    return delivery;
  }

  async countersign(
    userId: string,
    serviceUserId: string,
    packId: string,
    deliveryId: string,
    dto: CountersignMedicationPackDeliveryDto,
    meta: RequestAuditMeta,
  ) {
    await this.getPackOrThrow(serviceUserId, packId);
    const delivery = await this.getDeliveryOrThrow(packId, deliveryId);
    if (delivery.status === MedicationPackDeliveryStatus.VERIFIED) {
      throw new ConflictException('Delivery is already verified');
    }

    // Hard gate (CQC): every line confirmed present and no unresolved discrepancies.
    const unresolved = delivery.lines.filter(
      (l) =>
        !l.confirmedPresent ||
        l.state === MedicationPackDeliveryLineState.MISSING ||
        l.state === MedicationPackDeliveryLineState.DISCREPANCY,
    );
    if (unresolved.length > 0) {
      throw new BadRequestException(
        'Cannot countersign — all medicines must be confirmed present and discrepancies resolved',
      );
    }

    const updated = await this.prisma.medicationPackDelivery.update({
      where: { id: deliveryId },
      data: {
        status: MedicationPackDeliveryStatus.VERIFIED,
        countersignedAt: new Date(),
        countersignedById: userId,
        countersignNotes: dto.notes,
      },
      include: deliveryInclude,
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_DELIVERY_COUNTERSIGNED,
      recordType: 'MedicationPackDelivery',
      recordId: deliveryId,
      oldValues: auditSnapshot(delivery),
      newValues: auditSnapshot(updated),
      metadata: { serviceUserId, packId, cycleNumber: delivery.cycleNumber },
      ...meta,
    });
    return updated;
  }
}
