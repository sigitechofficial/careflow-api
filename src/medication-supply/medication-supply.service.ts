import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MedicationKind, MedicationSupplyModel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertServiceUserExists } from '../medications/medication.asserts';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateMedicationSupplyDeliveryDto } from './dto/create-medication-supply-delivery.dto';
import { groupMedicationsByName } from '../medications/medication-name-dedupe.util';
import {
  computeMedicationSupplySummary,
  CONSUMING_MAR_STATUS_CODES,
  estimateDosesPerDay,
  type MedicationSupplySummary,
} from './medication-supply-summary.util';

function parseDateOnly(value: string): Date {
  const d = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function inferSupplyModel(med: {
  medicationPackId: string | null;
  medicationType: { name: string } | null;
  route: { name: string } | null;
}): MedicationSupplyModel {
  if (med.medicationPackId) return MedicationSupplyModel.BLISTER_CYCLE;
  const typeName = med.medicationType?.name?.toLowerCase() ?? '';
  const routeName = med.route?.name?.toLowerCase() ?? '';
  if (typeName.includes('drop') || routeName.includes('eye') || routeName.includes('topical')) {
    return MedicationSupplyModel.BOTTLE_28DAY;
  }
  return MedicationSupplyModel.PRESCRIPTION_QTY;
}

@Injectable()
export class MedicationSupplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /** Supply stats keyed by medication id — used by MAR calendar and supply tab. */
  async buildSupplySummariesByMedicationId(
    serviceUserId: string,
    medicationIds: string[],
    /** When duplicate rows share a name, count MAR consumption across all related ids. */
    relatedIdsByCanonicalId?: Record<string, string[]>,
  ): Promise<Record<string, MedicationSupplySummary>> {
    if (medicationIds.length === 0) return {};

    const allIds = relatedIdsByCanonicalId
      ? [...new Set(Object.values(relatedIdsByCanonicalId).flat())]
      : medicationIds;

    const medications = await this.prisma.serviceUserMedication.findMany({
      where: {
        serviceUserId,
        id: { in: allIds },
        deletedAt: null,
        isActive: true,
      },
      include: {
        medicationType: true,
        route: true,
        medicationPack: true,
        supplyProfile: true,
        schedules: {
          where: { deletedAt: null, isActive: true },
          select: { daysOfWeek: true },
        },
        supplyDeliveries: {
          where: { deletedAt: null, isActive: true },
          orderBy: { deliveredAt: 'desc' },
          take: 1,
        },
      },
    });

    const medById = new Map(medications.map((m) => [m.id, m]));
    const consumedByMed = new Map<string, number>();
    await Promise.all(
      medicationIds.map(async (canonicalId) => {
        const m = medById.get(canonicalId);
        if (!m) {
          consumedByMed.set(canonicalId, 0);
          return;
        }
        const relatedIds = relatedIdsByCanonicalId?.[canonicalId] ?? [canonicalId];
        const latest = relatedIds
          .flatMap((id) => medById.get(id)?.supplyDeliveries ?? [])
          .sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime())[0] ?? null;
        if (!latest) {
          consumedByMed.set(canonicalId, 0);
          return;
        }
        const count = await this.prisma.medicationAdministrationEvent.count({
          where: {
            serviceUserMedicationId: { in: relatedIds },
            deletedAt: null,
            statusCode: { in: [...CONSUMING_MAR_STATUS_CODES] },
            OR: [
              { scheduledDateTime: { gte: latest.deliveredAt } },
              { actualDateTime: { gte: latest.deliveredAt } },
            ],
          },
        });
        consumedByMed.set(canonicalId, count);
      }),
    );

    const out: Record<string, MedicationSupplySummary> = {};
    for (const canonicalId of medicationIds) {
      const m = medById.get(canonicalId);
      if (!m) continue;
      const model = m.supplyProfile?.supplyModel ?? inferSupplyModel(m);
      const relatedIds = relatedIdsByCanonicalId?.[canonicalId] ?? [canonicalId];
      const latestDelivery =
        relatedIds
          .flatMap((id) => medById.get(id)?.supplyDeliveries ?? [])
          .sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime())[0] ?? null;
      const summary = computeMedicationSupplySummary({
        medicationKind: m.medicationKind,
        dose: m.dose,
        supplyModel: model,
        packName: m.medicationPack?.name ?? null,
        schedules: m.schedules,
        supplyProfile: m.supplyProfile
          ? { defaultQty: m.supplyProfile.defaultQty, qtyUnit: m.supplyProfile.qtyUnit }
          : null,
        latestDelivery: latestDelivery
          ? {
              deliveredAt: latestDelivery.deliveredAt,
              quantity: latestDelivery.quantity,
              cycleEndDate: latestDelivery.cycleEndDate,
              expiresAt: latestDelivery.expiresAt,
              runsOutDate: latestDelivery.runsOutDate,
              openedAt: latestDelivery.openedAt,
              pharmacyName: latestDelivery.pharmacyName,
            }
          : null,
        consumedSinceDelivery: consumedByMed.get(canonicalId) ?? 0,
      });
      if (summary) out[canonicalId] = summary;
    }
    return out;
  }

  async getBundle(serviceUserId: string) {
    await assertServiceUserExists(this.prisma, serviceUserId);

    const medications = await this.prisma.serviceUserMedication.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        isActive: true,
        status: 'ACTIVE',
        medicationKind: MedicationKind.REGULAR,
      },
      include: {
        medicationType: true,
        route: true,
        medicationPack: true,
        supplyProfile: true,
        schedules: {
          where: { deletedAt: null, isActive: true },
          select: { daysOfWeek: true },
        },
        supplyDeliveries: {
          where: { deletedAt: null, isActive: true },
          orderBy: { deliveredAt: 'desc' },
          take: 10,
          include: {
            receivedBy: { select: { id: true, firstName: true, lastName: true } },
            witnessBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        _count: {
          select: {
            events: { where: { deletedAt: null } },
            supplyDeliveries: { where: { deletedAt: null, isActive: true } },
          },
        },
      },
      orderBy: { medicationName: 'asc' },
    });

    const groups = groupMedicationsByName(medications);
    const relatedIdsByCanonicalId = Object.fromEntries(
      groups.map((g) => [g.canonical.id, g.relatedIds]),
    );

    const supplyById = await this.buildSupplySummariesByMedicationId(
      serviceUserId,
      groups.map((g) => g.canonical.id),
      relatedIdsByCanonicalId,
    );

    const mapDelivery = (
      d: (typeof medications)[0]['supplyDeliveries'][0],
    ) => ({
      id: d.id,
      deliveredAt: d.deliveredAt,
      cycleEndDate: d.cycleEndDate,
      openedAt: d.openedAt,
      expiresAt: d.expiresAt,
      runsOutDate: d.runsOutDate,
      quantity: d.quantity,
      pharmacyName: d.pharmacyName,
      notes: d.notes,
      receivedBy: d.receivedBy
        ? {
            id: d.receivedBy.id,
            name: [d.receivedBy.firstName, d.receivedBy.lastName].filter(Boolean).join(' ').trim(),
          }
        : null,
      witnessBy: d.witnessBy
        ? {
            id: d.witnessBy.id,
            name: [d.witnessBy.firstName, d.witnessBy.lastName].filter(Boolean).join(' ').trim(),
          }
        : null,
      createdAt: d.createdAt,
    });

    return {
      medications: groups.map((g) => {
        const m = g.canonical;
        const supplySummary = supplyById[m.id] ?? null;
        const model = m.supplyProfile?.supplyModel ?? inferSupplyModel(m);
        const mergedDeliveries = g.members
          .flatMap((member) => member.supplyDeliveries)
          .sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime())
          .slice(0, 10);
        const dosesPerDay = estimateDosesPerDay(m.schedules);
        return {
          medicationId: m.id,
          relatedMedicationIds: g.relatedIds,
          medicationName: m.medicationName,
          packName: m.medicationPack?.name ?? null,
          dose: m.dose,
          strength: m.strength,
          isControlledMedication: m.isControlledMedication,
          supplyModel: model,
          supplyProfile: m.supplyProfile,
          supplySummary,
          dosesPerDay,
          scheduleSlotCount: m.schedules.length,
          recentDeliveries: mergedDeliveries.map((d) => ({
            ...mapDelivery(d),
          })),
        };
      }),
    };
  }

  async createDelivery(
    userId: string,
    serviceUserId: string,
    dto: CreateMedicationSupplyDeliveryDto,
    meta: RequestAuditMeta,
  ) {
    await assertServiceUserExists(this.prisma, serviceUserId);

    const med = await this.prisma.serviceUserMedication.findFirst({
      where: { id: dto.serviceUserMedicationId, serviceUserId, deletedAt: null },
      include: { medicationType: true, route: true, medicationPack: true, supplyProfile: true },
    });
    if (!med) throw new NotFoundException('Medication not found');

    const deliveredAt = parseDateOnly(dto.deliveredAt);
    const model = med.supplyProfile?.supplyModel ?? inferSupplyModel(med);

    let cycleEndDate = dto.cycleEndDate ? parseDateOnly(dto.cycleEndDate) : null;
    let openedAt = dto.openedAt ? parseDateOnly(dto.openedAt) : null;
    let expiresAt = dto.expiresAt ? parseDateOnly(dto.expiresAt) : null;
    let runsOutDate = dto.runsOutDate ? parseDateOnly(dto.runsOutDate) : null;

    const cycleDays = med.supplyProfile?.cycleDays ?? 28;
    const bottleDays = med.supplyProfile?.bottleDiscardDays ?? 28;

    if (model === MedicationSupplyModel.BLISTER_CYCLE && !cycleEndDate) {
      cycleEndDate = addDays(deliveredAt, cycleDays);
    }
    if (model === MedicationSupplyModel.BOTTLE_28DAY) {
      if (!openedAt) openedAt = deliveredAt;
      if (!expiresAt) expiresAt = addDays(openedAt, bottleDays);
    }

    const profile =
      med.supplyProfile ??
      (await this.prisma.medicationSupplyProfile.create({
        data: {
          serviceUserMedicationId: med.id,
          supplyModel: model,
          cycleDays,
          bottleDiscardDays: bottleDays,
          defaultQty: dto.quantity ?? null,
          createdById: userId,
          updatedById: userId,
        },
      }));

    const created = await this.prisma.medicationSupplyDelivery.create({
      data: {
        serviceUserId,
        serviceUserMedicationId: med.id,
        supplyProfileId: profile.id,
        deliveredAt,
        cycleEndDate,
        openedAt,
        expiresAt,
        runsOutDate,
        quantity: dto.quantity,
        pharmacyName: dto.pharmacyName,
        receivedById: dto.receivedById ?? userId,
        witnessById: dto.witnessById,
        notes: dto.notes,
        source: 'care_admin',
        createdById: userId,
        updatedById: userId,
      },
      include: {
        receivedBy: { select: { id: true, firstName: true, lastName: true } },
        witnessBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_ADMINISTERED,
      recordType: 'MedicationSupplyDelivery',
      recordId: created.id,
      metadata: { serviceUserId, medicationId: med.id },
      ...meta,
    });

    return created;
  }
}
