import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BodyMapAuditAction,
  BodyMapEmollientFireRisk,
  BodyMapLinkedModule,
  BodyMapRecordStatus,
  BodyMapRecordType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BodyMapMedicationSiteDto,
  CreateMedicationBodyMapSiteFromMarDto,
  PatchBodyMapMedicationSiteAdministrationDto,
} from './dto/body-map-medication-site.dto';
import { CreateBodyMapRecordDto } from './dto/create-body-map-record.dto';
import { medicationRequiresBodyMapSiteFromMed } from './body-map-medication-eligibility.util';
import {
  assertPatchMedicationSite,
  evaluatePatchRotationWarnings,
  isPatchMedicationSite,
  type PatchRotationPriorSite,
} from './body-map-patch-safety.util';
import type { BodyMapBodyView } from '@prisma/client';

export const medicationSiteInclude = {
  serviceUserMedication: {
    select: {
      id: true,
      medicationName: true,
      strength: true,
      frequencyText: true,
      status: true,
      medicationType: { select: { id: true, code: true, name: true, requiresBodyMapSite: true } },
      route: { select: { id: true, code: true, name: true, requiresBodyMapSite: true } },
    },
  },
  appliedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  lastAdministrationEvent: {
    select: { id: true, actualDateTime: true, status: true, medicationNameSnapshot: true },
  },
} satisfies Prisma.BodyMapMedicationSiteInclude;

export type MedicationSiteRow = Prisma.BodyMapMedicationSiteGetPayload<{
  include: typeof medicationSiteInclude;
}>;

function userDisplayName(u: {
  firstName: string | null;
  lastName: string | null;
  email: string;
} | null): string | null {
  if (!u) return null;
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

export function mapMedicationSite(site: MedicationSiteRow) {
  return {
    id: site.id,
    bodyMapRecordId: site.bodyMapRecordId,
    serviceUserMedicationId: site.serviceUserMedicationId,
    lastAdministrationEventId: site.lastAdministrationEventId,
    medicineNameSnapshot: site.medicineNameSnapshot,
    strength: site.strength,
    frequencyText: site.frequencyText,
    appliedAt: site.appliedAt?.toISOString() ?? null,
    appliedById: site.appliedById,
    appliedByName: userDisplayName(site.appliedBy),
    consentGiven: site.consentGiven,
    marLinkedAt: site.marLinkedAt?.toISOString() ?? null,
    amountOrThickness: site.amountOrThickness,
    reasonForApplication: site.reasonForApplication,
    fireRiskEmollient: site.fireRiskEmollient,
    outcomeNote: site.outcomeNote,
    oldPatchPresent: site.oldPatchPresent,
    oldPatchRemoved: site.oldPatchRemoved,
    oldPatchRemovalAt: site.oldPatchRemovalAt?.toISOString() ?? null,
    oldPatchBodyPart: site.oldPatchBodyPart,
    oldPatchNotes: site.oldPatchNotes,
    disposalRecorded: site.disposalRecorded,
    nextChangeDue: site.nextChangeDue?.toISOString() ?? null,
    siteRotationChecked: site.siteRotationChecked,
    secondStaffCheck: site.secondStaffCheck,
    siteRotationNotes: site.siteRotationNotes,
    assessmentData: site.assessmentData,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
    medication: site.serviceUserMedication
      ? {
          id: site.serviceUserMedication.id,
          medicationName: site.serviceUserMedication.medicationName,
          strength: site.serviceUserMedication.strength,
          frequencyText: site.serviceUserMedication.frequencyText,
          status: site.serviceUserMedication.status,
          medicationType: site.serviceUserMedication.medicationType,
          route: site.serviceUserMedication.route,
        }
      : null,
    lastAdministrationEvent: site.lastAdministrationEvent
      ? {
          id: site.lastAdministrationEvent.id,
          actualDateTime: site.lastAdministrationEvent.actualDateTime?.toISOString() ?? null,
          status: site.lastAdministrationEvent.status,
          medicationNameSnapshot: site.lastAdministrationEvent.medicationNameSnapshot,
        }
      : null,
  };
}

type MedWithLookups = Prisma.ServiceUserMedicationGetPayload<{
  include: {
    medicationType: true;
    route: true;
    frequency: true;
  };
}>;

@Injectable()
export class BodyMapMedicationSiteService {
  constructor(private readonly prisma: PrismaService) {}

  private enforceEligibilityPolicy(): 'REQUIRED' | 'WARN' | 'OFF' {
    const raw = process.env.BODY_MAP_MEDICATION_SITE_POLICY?.toUpperCase();
    if (raw === 'OFF' || raw === 'WARN') return raw;
    return 'REQUIRED';
  }

  async loadMedicationForSite(serviceUserId: string, medicationId: string): Promise<MedWithLookups> {
    const med = await this.prisma.serviceUserMedication.findFirst({
      where: { id: medicationId, serviceUserId, deletedAt: null },
      include: { medicationType: true, route: true, frequency: true },
    });
    if (!med) {
      throw new NotFoundException('Medication chart line not found for this service user');
    }
    return med;
  }

  assertMedicationEligible(med: MedWithLookups, policy = this.enforceEligibilityPolicy()) {
    if (policy === 'OFF') return;
    const eligible = medicationRequiresBodyMapSiteFromMed(med);
    if (!eligible && policy === 'REQUIRED') {
      throw new BadRequestException(
        'This medication type/route does not require a body map site. Choose a topical, patch, or injection medicine.',
      );
    }
  }

  private buildSiteData(
    dto: BodyMapMedicationSiteDto,
    med: MedWithLookups,
    serviceUserMedicationId: string,
    userId: string | undefined,
    isCreate: boolean,
  ): Omit<Prisma.BodyMapMedicationSiteUncheckedCreateInput, 'bodyMapRecordId'> {
    const actorUserId = userId?.trim() ? userId.trim() : undefined;
    return {
      serviceUserMedicationId,
      lastAdministrationEventId: dto.lastAdministrationEventId,
      medicineNameSnapshot: dto.medicineNameSnapshot?.trim() || med.medicationName,
      strength: dto.strength ?? med.strength,
      frequencyText: dto.frequencyText ?? med.frequencyText ?? med.frequency?.name ?? null,
      appliedAt: dto.appliedAt ? new Date(dto.appliedAt) : isCreate ? new Date() : undefined,
      appliedById: dto.appliedById ?? actorUserId,
      consentGiven: dto.consentGiven,
      marLinkedAt: isCreate ? new Date() : undefined,
      amountOrThickness: dto.amountOrThickness,
      reasonForApplication: dto.reasonForApplication,
      fireRiskEmollient: dto.fireRiskEmollient,
      outcomeNote: dto.outcomeNote,
      oldPatchPresent: dto.oldPatchPresent,
      oldPatchRemoved: dto.oldPatchRemoved,
      oldPatchRemovalAt: dto.oldPatchRemovalAt ? new Date(dto.oldPatchRemovalAt) : undefined,
      oldPatchBodyPart: dto.oldPatchBodyPart,
      oldPatchNotes: dto.oldPatchNotes,
      disposalRecorded: dto.disposalRecorded,
      nextChangeDue: dto.nextChangeDue ? new Date(dto.nextChangeDue) : undefined,
      siteRotationChecked: dto.siteRotationChecked,
      secondStaffCheck: dto.secondStaffCheck,
      siteRotationNotes: dto.siteRotationNotes,
      assessmentData: dto.assessmentData as Prisma.InputJsonValue | undefined,
      createdById: isCreate ? actorUserId : undefined,
    };
  }

  async validateAdministrationEvent(
    serviceUserId: string,
    medicationId: string,
    eventId: string,
  ) {
    const event = await this.prisma.medicationAdministrationEvent.findFirst({
      where: {
        id: eventId,
        serviceUserId,
        serviceUserMedicationId: medicationId,
        deletedAt: null,
      },
    });
    if (!event) {
      throw new BadRequestException(
        'Administration event not found for this medication and service user',
      );
    }
    return event;
  }

  async persistSiteInTransaction(
    tx: Prisma.TransactionClient,
    opts: {
      recordId: string;
      serviceUserId: string;
      userId: string | undefined;
      dto: BodyMapMedicationSiteDto;
      isCreate: boolean;
      auditAction: BodyMapAuditAction;
    },
  ) {
    const medicationId = opts.dto.serviceUserMedicationId;
    const med = await tx.serviceUserMedication.findFirst({
      where: { id: medicationId, serviceUserId: opts.serviceUserId, deletedAt: null },
      include: { medicationType: true, route: true, frequency: true },
    });
    if (!med) {
      throw new BadRequestException('Medication chart line does not belong to this service user');
    }
    this.assertMedicationEligible(med);

    if (opts.dto.lastAdministrationEventId) {
      await this.validateAdministrationEvent(
        opts.serviceUserId,
        medicationId,
        opts.dto.lastAdministrationEventId,
      );
    }

    const actorUserId = opts.userId?.trim() ? opts.userId.trim() : undefined;
    const data = this.buildSiteData(opts.dto, med, medicationId, actorUserId, opts.isCreate);

    const site = await tx.bodyMapMedicationSite.upsert({
      where: { bodyMapRecordId: opts.recordId },
      create: { bodyMapRecordId: opts.recordId, ...data },
      update: data,
    });

    await tx.bodyMapLink.deleteMany({
      where: {
        bodyMapRecordId: opts.recordId,
        linkedModule: BodyMapLinkedModule.MAR,
      },
    });
    await tx.bodyMapLink.create({
      data: {
        bodyMapRecordId: opts.recordId,
        linkedModule: BodyMapLinkedModule.MAR,
        linkedRecordId: medicationId,
        label: med.medicationName,
        createdById: actorUserId,
      },
    });

    await tx.bodyMapAuditLog.create({
      data: {
        bodyMapRecordId: opts.recordId,
        action: opts.auditAction,
        actorUserId: actorUserId,
        payload: {
          serviceUserMedicationId: medicationId,
          medicationSiteId: site.id,
        },
      },
    });

    return site;
  }

  validateMedicationSiteForRecord(
    recordType: BodyMapRecordType,
    dto: CreateBodyMapRecordDto,
  ) {
    if (recordType === BodyMapRecordType.MEDICATION) {
      const policy = this.enforceEligibilityPolicy();
      if (policy === 'REQUIRED' && !dto.medicationSite?.serviceUserMedicationId) {
        throw new BadRequestException(
          'Medication site records must link to a MAR chart line (serviceUserMedicationId)',
        );
      }
      if (dto.medicationSite && !dto.medicationSite.serviceUserMedicationId) {
        throw new BadRequestException('serviceUserMedicationId is required on medicationSite');
      }
      return;
    }
    if (dto.medicationSite) {
      throw new BadRequestException('medicationSite applies only to MEDICATION records');
    }
  }

  async findActiveSiteForMedication(serviceUserId: string, medicationId: string) {
    await this.loadMedicationForSite(serviceUserId, medicationId);
    const site = await this.prisma.bodyMapMedicationSite.findFirst({
      where: {
        serviceUserMedicationId: medicationId,
        bodyMapRecord: {
          serviceUserId,
          isArchived: false,
          status: { notIn: [BodyMapRecordStatus.CLOSED, BodyMapRecordStatus.RESOLVED] },
        },
      },
      include: medicationSiteInclude,
      orderBy: { updatedAt: 'desc' },
    });
    return site;
  }

  async validateMarLink(
    serviceUserId: string,
    linkedRecordId: string,
  ): Promise<{ medicationName: string }> {
    const med = await this.prisma.serviceUserMedication.findFirst({
      where: { id: linkedRecordId, serviceUserId, deletedAt: null },
      include: { medicationType: true, route: true },
    });
    if (!med) {
      throw new BadRequestException(
        'MAR links must reference a medication chart line UUID for this service user, not the service user id',
      );
    }
    return { medicationName: med.medicationName };
  }

  suggestSubType(med: MedWithLookups): string | undefined {
    const code = med.medicationType?.code;
    const map: Record<string, string> = {
      CREAM: 'Cream application',
      OINTMENT: 'Cream application',
      LOTION: 'Cream application',
      PATCH: 'Patch site',
      INJECTION: 'Injection site',
      SPRAY: 'Spray site',
    };
    return code ? map[code] : undefined;
  }

  assertPatchSiteRules(
    dto: BodyMapMedicationSiteDto,
    subType: string | null | undefined,
    med: MedWithLookups,
  ) {
    assertPatchMedicationSite(dto, subType, med.medicationType?.code ?? null);
  }

  async loadRecentPatchSitesForRotation(
    serviceUserId: string,
    excludeRecordId?: string,
    limit = 3,
  ): Promise<PatchRotationPriorSite[]> {
    const sites = await this.prisma.bodyMapMedicationSite.findMany({
      where: {
        bodyMapRecord: {
          serviceUserId,
          isArchived: false,
          recordType: BodyMapRecordType.MEDICATION,
          status: { notIn: [BodyMapRecordStatus.CLOSED, BodyMapRecordStatus.RESOLVED] },
          ...(excludeRecordId ? { id: { not: excludeRecordId } } : {}),
        },
        OR: [
          { serviceUserMedication: { medicationType: { code: 'PATCH' } } },
          { bodyMapRecord: { subType: { contains: 'patch', mode: 'insensitive' } } },
        ],
      },
      include: {
        bodyMapRecord: {
          include: {
            markers: { orderBy: { markerNumber: 'asc' }, take: 1 },
          },
        },
      },
      orderBy: { appliedAt: 'desc' },
      take: limit,
    });

    return sites
      .map(site => {
        const marker = site.bodyMapRecord.markers[0];
        if (!marker) return null;
        return {
          recordId: site.bodyMapRecordId,
          medicineName: site.medicineNameSnapshot,
          bodyPart: marker.bodyPart,
          bodyView: marker.bodyView as BodyMapBodyView,
          x: Number(marker.xCoordinate),
          y: Number(marker.yCoordinate),
          appliedAt: site.appliedAt?.toISOString() ?? null,
        };
      })
      .filter((r): r is PatchRotationPriorSite => r != null);
  }

  async patchRotationWarnings(opts: {
    serviceUserId: string;
    bodyView: BodyMapBodyView;
    x: number;
    y: number;
    excludeRecordId?: string;
  }): Promise<string[]> {
    const prior = await this.loadRecentPatchSitesForRotation(
      opts.serviceUserId,
      opts.excludeRecordId,
    );
    return evaluatePatchRotationWarnings(
      { bodyView: opts.bodyView, x: opts.x, y: opts.y },
      prior,
    );
  }

  isPatchSite(subType: string | null | undefined, med: MedWithLookups): boolean {
    return isPatchMedicationSite(subType, med.medicationType?.code ?? null);
  }

  requireCreamFireRisk(subType: string | null | undefined, fireRisk?: BodyMapEmollientFireRisk | null) {
    const creamLike =
      subType?.toLowerCase().includes('cream') ||
      subType?.toLowerCase().includes('ointment') ||
      subType?.toLowerCase().includes('lotion');
    if (creamLike && !fireRisk) {
      throw new BadRequestException(
        'Fire risk assessment for emollients is required for cream/ointment/lotion sites',
      );
    }
  }
}
