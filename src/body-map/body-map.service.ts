import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  BodyMapAuditAction,
  BodyMapConditionStatus,
  BodyMapLinkedModule,
  BodyMapPhotoConsentStatus,
  BodyMapRecordStatus,
  BodyMapRecordType,
  BodyMapRiskLevel,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBodyMapMarkerDto } from './dto/create-body-map-marker.dto';
import { BodyMapSafeguardingCheckDto } from './dto/body-map-safeguarding.dto';
import {
  BodyMapPressureAssessmentDto,
  BodyMapWoundAssessmentDto,
  CreateBodyMapLinkDto,
} from './dto/body-map-assessments.dto';
import {
  CloseBodyMapRecordDto,
  CreateBodyMapRecordDto,
  CreateBodyMapReviewDto,
  UpdateBodyMapRecordDto,
} from './dto/create-body-map-record.dto';
import { UpdateBodyMapMarkerDto } from './dto/update-body-map-marker.dto';
import { evaluateSafeguardingTrigger } from './body-map-safeguarding.util';
import {
  buildBodyMapRecordTypeCatalogLookups,
  staticBodyMapRecordTypeCatalogLookups,
} from './body-map-record-type-catalog.util';
import {
  BodyMapMedicationSiteService,
  mapMedicationSite,
  medicationSiteInclude,
} from './body-map-medication-site.service';
import { BodyMapAlertsService } from './body-map-alerts.service';
import {
  deriveWoundLifecycleFromAssessment,
  deriveWoundLifecycleFromReview,
  initialWoundLifecycleData,
  readWoundLifecycleStatus,
  withWoundLifecycle,
  woundLifecycleLabel,
} from './body-map-wound-lifecycle.util';
import { medicationRequiresBodyMapSiteFromMed } from './body-map-medication-eligibility.util';
import {
  BodyMapMedicationSiteDto,
  CreateMedicationBodyMapSiteFromMarDto,
  PatchBodyMapMedicationSiteAdministrationDto,
} from './dto/body-map-medication-site.dto';
import { computeBodyMapOutstandingGaps } from './body-map-gaps.util';
import { buildBodyMapCqcPdf } from './body-map-cqc-pdf.util';

const PHOTO_SEGMENTS = ['body-map', 'photos'] as const;

const recordInclude = {
  markers: { orderBy: { markerNumber: 'asc' as const } },
  reviews: { orderBy: { reviewedAt: 'desc' as const }, take: 5 },
  photos: { orderBy: { createdAt: 'desc' as const } },
  safeguardingCheck: true,
  woundAssessment: true,
  pressureAssessment: true,
  medicationSite: { include: medicationSiteInclude },
  links: { orderBy: { createdAt: 'desc' as const } },
  createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
} satisfies Prisma.BodyMapRecordInclude;

type RecordRow = Prisma.BodyMapRecordGetPayload<{ include: typeof recordInclude }>;

function userDisplayName(u: {
  firstName: string | null;
  lastName: string | null;
  email: string;
} | null): string | null {
  if (!u) return null;
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

function mapMarker(m: RecordRow['markers'][number]) {
  return {
    id: m.id,
    bodyMapRecordId: m.bodyMapRecordId,
    bodyView: m.bodyView,
    side: m.side,
    bodyPart: m.bodyPart,
    specificLocation: m.specificLocation,
    xCoordinate: Number(m.xCoordinate),
    yCoordinate: Number(m.yCoordinate),
    markerNumber: m.markerNumber,
    markerType: m.markerType,
    riskLevel: m.riskLevel,
    status: m.status,
    isVisible: m.isVisible,
    createdAt: m.createdAt.toISOString(),
  };
}

function mapWoundAssessment(w: NonNullable<RecordRow['woundAssessment']>) {
  const lifecycleStatus = readWoundLifecycleStatus(w.assessmentData);
  return {
    id: w.id,
    woundType: w.woundType,
    exudate: w.exudate,
    dressing: w.dressing,
    nextDressingChange: w.nextDressingChange?.toISOString() ?? null,
    measurements: w.measurements,
    infectionSigns: w.infectionSigns,
    professionalInvolvement: w.professionalInvolvement,
    assessmentData: w.assessmentData,
    woundLifecycleStatus: lifecycleStatus,
    woundLifecycleLabel: lifecycleStatus ? woundLifecycleLabel(lifecycleStatus) : null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function mapPressureAssessment(p: NonNullable<RecordRow['pressureAssessment']>) {
  return {
    id: p.id,
    riskTool: p.riskTool,
    blanching: p.blanching,
    skinIntact: p.skinIntact,
    repositioningRecorded: p.repositioningRecorded,
    nonBlanching: p.nonBlanching,
    repositioningFrequency: p.repositioningFrequency,
    pressureEquipment: p.pressureEquipment,
    assessmentData: p.assessmentData,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function mapRecord(row: RecordRow) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    recordType: row.recordType,
    subType: row.subType,
    title: row.title,
    description: row.description,
    riskLevel: row.riskLevel,
    status: row.status,
    firstNoticedAt: row.firstNoticedAt?.toISOString() ?? null,
    noticedByType: row.noticedByType,
    noticedByName: row.noticedByName,
    causeSummary: row.causeSummary,
    actionSummary: row.actionSummary,
    observationDetails: row.observationDetails,
    reviewRequired: row.reviewRequired,
    nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
    safeguardingTriggered: row.safeguardingTriggered,
    managerReviewRequired: row.managerReviewRequired,
    closedAt: row.closedAt?.toISOString() ?? null,
    closureNote: row.closureNote,
    isArchived: row.isArchived,
    createdByName: userDisplayName(row.createdBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    markers: row.markers.map(mapMarker),
    reviews: row.reviews.map(r => ({
      id: r.id,
      conditionStatus: r.conditionStatus,
      reviewNote: r.reviewNote,
      actionTaken: r.actionTaken,
      escalationRequired: r.escalationRequired,
      nextReviewAt: r.nextReviewAt?.toISOString() ?? null,
      reviewedAt: r.reviewedAt.toISOString(),
      reviewDetails: r.reviewDetails ?? null,
    })),
    photos: row.photos.map(p => ({
      id: p.id,
      fileUrl: p.fileUrl,
      consentStatus: p.consentStatus,
      caption: p.caption,
      createdAt: p.createdAt.toISOString(),
    })),
    safeguardingCheck: row.safeguardingCheck
      ? {
          id: row.safeguardingCheck.id,
          causeKnown: row.safeguardingCheck.causeKnown,
          explanationConsistent: row.safeguardingCheck.explanationConsistent,
          happenedBefore: row.safeguardingCheck.happenedBefore,
          immediateRisk: row.safeguardingCheck.immediateRisk,
          managerInformed: row.safeguardingCheck.managerInformed,
          incidentRequired: row.safeguardingCheck.incidentRequired,
          referralRequired: row.safeguardingCheck.referralRequired,
          referralReason: row.safeguardingCheck.referralReason,
          managerNotes: row.safeguardingCheck.managerNotes,
          completedAt: row.safeguardingCheck.completedAt.toISOString(),
        }
      : null,
    woundAssessment: row.woundAssessment ? mapWoundAssessment(row.woundAssessment) : null,
    pressureAssessment: row.pressureAssessment
      ? mapPressureAssessment(row.pressureAssessment)
      : null,
    medicationSite: row.medicationSite ? mapMedicationSite(row.medicationSite) : null,
    links: row.links.map(l => ({
      id: l.id,
      linkedModule: l.linkedModule,
      linkedRecordId: l.linkedRecordId,
      label: l.label,
      createdAt: l.createdAt.toISOString(),
    })),
    serviceUserName: row.serviceUser
      ? [row.serviceUser.preferredName, row.serviceUser.firstName, row.serviceUser.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || null
      : null,
  };
}

@Injectable()
export class BodyMapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly medicationSiteService: BodyMapMedicationSiteService,
    private readonly alertsService: BodyMapAlertsService,
  ) {}

  private photoUploadRoot(): string {
    const base = this.config.get<string>('app.uploadBasePath', 'uploads');
    return join(process.cwd(), base, ...PHOTO_SEGMENTS);
  }

  private photoPublicUrl(fileName: string): string {
    return `/uploads/${PHOTO_SEGMENTS.join('/')}/${fileName}`;
  }

  ensurePhotoUploadDir(): string {
    const root = this.photoUploadRoot();
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    return root;
  }

  maxPhotoBytes(): number {
    return this.config.get<number>('app.uploadMaxFileSizeBytes', 10_485_760);
  }

  private requiresManagerSignOff(record: {
    safeguardingTriggered: boolean;
    managerReviewRequired: boolean;
    riskLevel: BodyMapRiskLevel;
    status: BodyMapRecordStatus;
  }): boolean {
    return (
      record.safeguardingTriggered ||
      record.managerReviewRequired ||
      record.status === BodyMapRecordStatus.AWAITING_REVIEW ||
      record.riskLevel === BodyMapRiskLevel.HIGH ||
      record.riskLevel === BodyMapRiskLevel.URGENT
    );
  }

  private mapWoundInput(dto: BodyMapWoundAssessmentDto) {
    return {
      woundType: dto.woundType,
      exudate: dto.exudate,
      dressing: dto.dressing,
      nextDressingChange: dto.nextDressingChange ? new Date(dto.nextDressingChange) : undefined,
      measurements: dto.measurements,
      infectionSigns: dto.infectionSigns,
      professionalInvolvement: dto.professionalInvolvement,
      assessmentData: dto.assessmentData as Prisma.InputJsonValue | undefined,
    };
  }

  private mapPressureInput(dto: BodyMapPressureAssessmentDto) {
    return {
      riskTool: dto.riskTool,
      blanching: dto.blanching,
      skinIntact: dto.skinIntact,
      repositioningRecorded: dto.repositioningRecorded,
      nonBlanching: dto.nonBlanching,
      repositioningFrequency: dto.repositioningFrequency,
      pressureEquipment: dto.pressureEquipment,
      assessmentData: dto.assessmentData as Prisma.InputJsonValue | undefined,
    };
  }

  private mapSafeguardingInput(dto: BodyMapSafeguardingCheckDto) {
    return {
      causeKnown: dto.causeKnown,
      explanationConsistent: dto.explanationConsistent,
      happenedBefore: dto.happenedBefore,
      immediateRisk: dto.immediateRisk,
      managerInformed: dto.managerInformed,
      incidentRequired: dto.incidentRequired,
      referralRequired: dto.referralRequired,
      referralReason: dto.referralReason,
      managerReviewRequired: dto.managerReviewRequired ?? true,
      managerNotes: dto.managerNotes,
      checklistData: dto.checklistData as Prisma.InputJsonValue | undefined,
    };
  }

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
    });
    if (!u) throw new NotFoundException('Service user not found');
  }

  private async ensureRecord(recordId: string) {
    const r = await this.prisma.bodyMapRecord.findUnique({ where: { id: recordId } });
    if (!r) throw new NotFoundException('Body map record not found');
    return r;
  }

  private async writeAudit(
    recordId: string,
    action: BodyMapAuditAction,
    actorUserId: string,
    payload?: Record<string, unknown>,
  ) {
    await this.prisma.bodyMapAuditLog.create({
      data: {
        bodyMapRecordId: recordId,
        action,
        actorUserId,
        payload: payload ? (payload as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  async listForServiceUser(serviceUserId: string, includeResolved = false) {
    await this.ensureServiceUser(serviceUserId);
    const rows = await this.prisma.bodyMapRecord.findMany({
      where: {
        serviceUserId,
        isArchived: false,
        ...(includeResolved ? {} : { status: { notIn: [BodyMapRecordStatus.CLOSED, BodyMapRecordStatus.RESOLVED] } }),
      },
      include: recordInclude,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return { records: rows.map(mapRecord) };
  }

  async summary(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const now = new Date();
    const [activeCount, reviewDueCount, highRiskCount, safeguardingCount, lastReview] =
      await Promise.all([
      this.prisma.bodyMapRecord.count({
        where: {
          serviceUserId,
          isArchived: false,
          status: { in: [BodyMapRecordStatus.ACTIVE, BodyMapRecordStatus.MONITORING, BodyMapRecordStatus.AWAITING_REVIEW] },
        },
      }),
      this.prisma.bodyMapRecord.count({
        where: {
          serviceUserId,
          isArchived: false,
          status: { not: BodyMapRecordStatus.CLOSED },
          nextReviewAt: { lte: now },
        },
      }),
      this.prisma.bodyMapRecord.count({
        where: {
          serviceUserId,
          isArchived: false,
          riskLevel: { in: [BodyMapRiskLevel.HIGH, BodyMapRiskLevel.URGENT] },
          status: { not: BodyMapRecordStatus.CLOSED },
        },
      }),
      this.prisma.bodyMapRecord.count({
        where: {
          serviceUserId,
          isArchived: false,
          safeguardingTriggered: true,
          status: { not: BodyMapRecordStatus.CLOSED },
        },
      }),
      this.prisma.bodyMapReview.findFirst({
        where: { bodyMapRecord: { serviceUserId } },
        orderBy: { reviewedAt: 'desc' },
        select: { reviewedAt: true },
      }),
    ]);
    const medicationAlerts = await this.medicationSiteAlerts(serviceUserId);

    return {
      activeCount,
      reviewDueCount,
      highRiskCount,
      safeguardingCount,
      lastReviewAt: lastReview?.reviewedAt.toISOString() ?? null,
      medicationAlerts,
    };
  }

  /** Active markers summary for visit handover (§13, §23). */
  async handoverPreview(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const { records } = await this.listForServiceUser(serviceUserId, false);
    const now = Date.now();
    const concerns = records.map(r => {
      const marker = r.markers[0];
      return {
        recordId: r.id,
        recordType: r.recordType,
        subType: r.subType,
        riskLevel: r.riskLevel,
        status: r.status,
        bodyPart: marker?.bodyPart ?? null,
        specificLocation: marker?.specificLocation ?? null,
        bodyView: marker?.bodyView ?? null,
        nextReviewAt: r.nextReviewAt,
        reviewOverdue: r.nextReviewAt
          ? new Date(r.nextReviewAt).getTime() < now
          : false,
        safeguardingTriggered: r.safeguardingTriggered,
        descriptionPreview: r.description
          ? r.description.length > 160
            ? `${r.description.slice(0, 160)}…`
            : r.description
          : null,
      };
    });

    const patchSites = records
      .filter(
        r =>
          r.recordType === BodyMapRecordType.MEDICATION &&
          r.medicationSite &&
          (r.subType?.toLowerCase().includes('patch') ||
            r.medicationSite.medication?.medicationType?.code === 'PATCH'),
      )
      .map(r => ({
        recordId: r.id,
        medicineName:
          r.medicationSite!.medicineNameSnapshot ??
          r.medicationSite!.medication?.medicationName ??
          null,
        bodyPart: r.markers[0]?.bodyPart ?? null,
        nextChangeDue: r.medicationSite!.nextChangeDue,
        marMedicationId: r.medicationSite!.serviceUserMedicationId,
      }));

    return {
      serviceUserId,
      generatedAt: new Date().toISOString(),
      activeCount: records.length,
      highRiskCount: concerns.filter(c =>
        ['HIGH', 'URGENT'].includes(c.riskLevel),
      ).length,
      safeguardingCount: concerns.filter(c => c.safeguardingTriggered).length,
      reviewDueCount: concerns.filter(c => c.reviewOverdue).length,
      concerns,
      patchSites,
    };
  }

  async medicationSiteAlerts(serviceUserId: string) {
    const activeMeds = await this.prisma.serviceUserMedication.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        status: 'ACTIVE',
      },
      include: { medicationType: true, route: true },
      orderBy: { medicationName: 'asc' },
    });

    const siteLinkedMedIds = new Set(
      (
        await this.prisma.bodyMapMedicationSite.findMany({
          where: {
            serviceUserMedication: { serviceUserId },
            bodyMapRecord: {
              isArchived: false,
              status: { notIn: [BodyMapRecordStatus.CLOSED, BodyMapRecordStatus.RESOLVED] },
            },
          },
          select: { serviceUserMedicationId: true },
        })
      ).map(s => s.serviceUserMedicationId),
    );

    const missingBodyMapSites = activeMeds
      .filter(m => medicationRequiresBodyMapSiteFromMed(m) && !siteLinkedMedIds.has(m.id))
      .map(m => ({
        medicationId: m.id,
        medicationName: m.medicationName,
        medicationTypeCode: m.medicationType?.code ?? null,
      }));

    const now = new Date();
    const overduePatchSites = await this.prisma.bodyMapMedicationSite.findMany({
      where: {
        serviceUserMedication: { serviceUserId },
        nextChangeDue: { lt: now },
        bodyMapRecord: {
          isArchived: false,
          status: { notIn: [BodyMapRecordStatus.CLOSED, BodyMapRecordStatus.RESOLVED] },
        },
        OR: [
          { serviceUserMedication: { medicationType: { code: 'PATCH' } } },
          { bodyMapRecord: { subType: { contains: 'patch', mode: 'insensitive' } } },
        ],
      },
      include: {
        bodyMapRecord: { include: { markers: { take: 1, orderBy: { markerNumber: 'asc' } } } },
      },
      orderBy: { nextChangeDue: 'asc' },
      take: 20,
    });

    return {
      missingBodyMapSiteCount: missingBodyMapSites.length,
      missingBodyMapSites,
      overduePatchChangeCount: overduePatchSites.length,
      overduePatchChanges: overduePatchSites.map(s => ({
        recordId: s.bodyMapRecordId,
        medicationId: s.serviceUserMedicationId,
        medicineName: s.medicineNameSnapshot,
        nextChangeDue: s.nextChangeDue?.toISOString() ?? null,
        bodyPart: s.bodyMapRecord.markers[0]?.bodyPart ?? null,
      })),
    };
  }

  async getRecord(recordId: string) {
    const row = await this.prisma.bodyMapRecord.findUnique({
      where: { id: recordId },
      include: recordInclude,
    });
    if (!row) throw new NotFoundException('Body map record not found');
    return mapRecord(row);
  }

  async createRecord(userId: string, dto: CreateBodyMapRecordDto) {
    await this.ensureServiceUser(dto.serviceUserId);
    if (!dto.bodyPart?.trim()) {
      throw new BadRequestException('Body part is required');
    }

    const riskLevel = dto.riskLevel ?? BodyMapRiskLevel.MEDIUM;
    const status = dto.status ?? BodyMapRecordStatus.ACTIVE;
    const recordType = dto.recordType;
    const safeguarding = evaluateSafeguardingTrigger({
      recordType,
      subType: dto.subType,
      causeSummary: dto.causeSummary,
      observationDetails: dto.observationDetails,
    });
    const safeguardingTriggered = dto.safeguardingTriggered ?? safeguarding.safeguardingTriggered;
    const managerReviewRequired = dto.managerReviewRequired ?? safeguarding.managerReviewRequired;

    if (safeguardingTriggered && !dto.safeguardingCheck) {
      throw new BadRequestException(
        'Safeguarding checklist is required before saving this record',
      );
    }
    if (
      dto.safeguardingCheck?.referralRequired === 'No' &&
      !dto.safeguardingCheck.referralReason?.trim()
    ) {
      throw new BadRequestException(
        'Provide a reason when safeguarding referral is not required',
      );
    }
    if (dto.woundAssessment && recordType !== BodyMapRecordType.WOUND) {
      throw new BadRequestException('Wound assessment applies only to WOUND records');
    }
    if (dto.pressureAssessment && recordType !== BodyMapRecordType.PRESSURE) {
      throw new BadRequestException('Pressure assessment applies only to PRESSURE records');
    }
    this.medicationSiteService.validateMedicationSiteForRecord(recordType, dto);
    if (dto.medicationSite) {
      const med = await this.medicationSiteService.loadMedicationForSite(
        dto.serviceUserId,
        dto.medicationSite.serviceUserMedicationId,
      );
      this.medicationSiteService.assertMedicationEligible(med);
      const subType = dto.subType ?? this.medicationSiteService.suggestSubType(med);
      this.medicationSiteService.requireCreamFireRisk(
        subType,
        dto.medicationSite.fireRiskEmollient,
      );
      this.medicationSiteService.assertPatchSiteRules(dto.medicationSite, subType, med);
    }

    let patchWarnings: string[] = [];
    if (dto.medicationSite && dto.recordType === BodyMapRecordType.MEDICATION) {
      patchWarnings = await this.medicationSiteService.patchRotationWarnings({
        serviceUserId: dto.serviceUserId,
        bodyView: dto.bodyView,
        x: dto.xCoordinate,
        y: dto.yCoordinate,
      });
    }

    const created = await this.prisma.$transaction(async tx => {
      const record = await tx.bodyMapRecord.create({
        data: {
          serviceUserId: dto.serviceUserId,
          recordType,
          subType: dto.subType,
          title: dto.title ?? `${dto.recordType} — ${dto.bodyPart}`,
          description: dto.description,
          riskLevel,
          status: safeguardingTriggered ? BodyMapRecordStatus.AWAITING_REVIEW : status,
          firstNoticedAt: dto.firstNoticedAt ? new Date(dto.firstNoticedAt) : new Date(),
          noticedByType: dto.noticedByType,
          noticedByName: dto.noticedByName,
          causeSummary: dto.causeSummary,
          actionSummary: dto.actionSummary,
          observationDetails: dto.observationDetails as Prisma.InputJsonValue | undefined,
          reviewRequired: dto.reviewRequired ?? true,
          nextReviewAt: dto.nextReviewAt ? new Date(dto.nextReviewAt) : null,
          safeguardingTriggered,
          managerReviewRequired,
          createdById: userId,
          updatedById: userId,
        },
      });

      const marker = await tx.bodyMapMarker.create({
        data: {
          bodyMapRecordId: record.id,
          bodyView: dto.bodyView,
          side: dto.side,
          bodyPart: dto.bodyPart.trim(),
          specificLocation: dto.specificLocation,
          xCoordinate: dto.xCoordinate,
          yCoordinate: dto.yCoordinate,
          markerNumber: 1,
          markerType: recordType,
          riskLevel,
          status,
          createdById: userId,
        },
      });

      await tx.bodyMapAuditLog.create({
        data: {
          bodyMapRecordId: record.id,
          action: BodyMapAuditAction.CREATE,
          actorUserId: userId,
          payload: { markerId: marker.id },
        },
      });

      if (dto.safeguardingCheck) {
        await tx.bodyMapSafeguardingCheck.create({
          data: {
            bodyMapRecordId: record.id,
            ...this.mapSafeguardingInput(dto.safeguardingCheck),
            completedById: userId,
          },
        });
        await tx.bodyMapAuditLog.create({
          data: {
            bodyMapRecordId: record.id,
            action: BodyMapAuditAction.SAFEGUARDING_CHECK,
            actorUserId: userId,
            payload: { referralRequired: dto.safeguardingCheck.referralRequired },
          },
        });
      }

      if (recordType === BodyMapRecordType.WOUND) {
        const woundInput = dto.woundAssessment
          ? this.mapWoundInput(dto.woundAssessment)
          : { assessmentData: undefined as Prisma.InputJsonValue | undefined };
        const priorData =
          woundInput.assessmentData && typeof woundInput.assessmentData === 'object'
            ? (woundInput.assessmentData as Record<string, unknown>)
            : {};
        let lifecycleData = withWoundLifecycle(
          { ...initialWoundLifecycleData(), ...priorData },
          'NEW',
        );
        const planned = deriveWoundLifecycleFromAssessment({
          dressing: dto.woundAssessment?.dressing,
          nextDressingChange: dto.woundAssessment?.nextDressingChange
            ? new Date(dto.woundAssessment.nextDressingChange)
            : null,
          professionalInvolvement: dto.woundAssessment?.professionalInvolvement,
          current: 'NEW',
        });
        if (planned) lifecycleData = withWoundLifecycle(lifecycleData, planned);
        await tx.bodyMapWoundAssessment.create({
          data: {
            bodyMapRecordId: record.id,
            ...woundInput,
            assessmentData: lifecycleData as Prisma.InputJsonValue,
            createdById: userId,
          },
        });
        await tx.bodyMapAuditLog.create({
          data: {
            bodyMapRecordId: record.id,
            action: BodyMapAuditAction.WOUND_ASSESSMENT,
            actorUserId: userId,
          },
        });
      }

      if (dto.pressureAssessment) {
        await tx.bodyMapPressureAssessment.create({
          data: {
            bodyMapRecordId: record.id,
            ...this.mapPressureInput(dto.pressureAssessment),
            createdById: userId,
          },
        });
        if (
          dto.pressureAssessment.blanching?.toLowerCase().includes('non') ||
          dto.pressureAssessment.nonBlanching?.toLowerCase() === 'yes'
        ) {
          await tx.bodyMapRecord.update({
            where: { id: record.id },
            data: {
              managerReviewRequired: true,
              status: BodyMapRecordStatus.AWAITING_REVIEW,
            },
          });
        }
        await tx.bodyMapAuditLog.create({
          data: {
            bodyMapRecordId: record.id,
            action: BodyMapAuditAction.PRESSURE_ASSESSMENT,
            actorUserId: userId,
          },
        });
      }

      if (dto.medicationSite) {
        await this.medicationSiteService.persistSiteInTransaction(tx, {
          recordId: record.id,
          serviceUserId: dto.serviceUserId,
          userId,
          dto: dto.medicationSite,
          isCreate: true,
          auditAction: BodyMapAuditAction.MEDICATION_SITE_CREATE,
        });
      }

      return tx.bodyMapRecord.findUniqueOrThrow({
        where: { id: record.id },
        include: recordInclude,
      });
    });

    const mapped = mapRecord(created);
    await this.alertsService.syncForServiceUser(dto.serviceUserId);
    return patchWarnings.length > 0 ? { ...mapped, warnings: patchWarnings } : mapped;
  }

  async updateRecord(userId: string, recordId: string, dto: UpdateBodyMapRecordDto) {
    const existing = await this.ensureRecord(recordId);
    if (existing.status === BodyMapRecordStatus.CLOSED) {
      throw new BadRequestException('Closed records cannot be edited');
    }

    const updated = (await this.prisma.bodyMapRecord.update({
      where: { id: recordId },
      data: {
        subType: dto.subType,
        title: dto.title,
        description: dto.description,
        riskLevel: dto.riskLevel,
        status: dto.status,
        nextReviewAt: dto.nextReviewAt ? new Date(dto.nextReviewAt) : undefined,
        causeSummary: dto.causeSummary,
        actionSummary: dto.actionSummary,
        observationDetails: dto.observationDetails as Prisma.InputJsonValue | undefined,
        updatedById: userId,
      },
      include: recordInclude,
    })) as RecordRow;

    if (dto.riskLevel) {
      await this.prisma.bodyMapMarker.updateMany({
        where: { bodyMapRecordId: recordId },
        data: { riskLevel: dto.riskLevel },
      });
    }

    await this.writeAudit(recordId, BodyMapAuditAction.UPDATE, userId, {
      editReason: dto.editReason,
      fields: Object.keys(dto).filter(k => k !== 'editReason'),
    });

    return mapRecord(updated);
  }

  async addMarker(userId: string, recordId: string, dto: CreateBodyMapMarkerDto) {
    const record = await this.ensureRecord(recordId);
    const count = await this.prisma.bodyMapMarker.count({ where: { bodyMapRecordId: recordId } });
    const marker = await this.prisma.bodyMapMarker.create({
      data: {
        bodyMapRecordId: recordId,
        bodyView: dto.bodyView,
        side: dto.side,
        bodyPart: dto.bodyPart.trim(),
        specificLocation: dto.specificLocation,
        xCoordinate: dto.xCoordinate,
        yCoordinate: dto.yCoordinate,
        markerNumber: count + 1,
        markerType: dto.markerType ?? record.recordType,
        riskLevel: dto.riskLevel ?? record.riskLevel,
        status: record.status,
        createdById: userId,
      },
    });
    await this.writeAudit(recordId, BodyMapAuditAction.ADD_MARKER, userId, { markerId: marker.id });
    return mapMarker(marker);
  }

  async updateMarker(userId: string, markerId: string, dto: UpdateBodyMapMarkerDto) {
    const marker = await this.prisma.bodyMapMarker.findUnique({ where: { id: markerId } });
    if (!marker) throw new NotFoundException('Marker not found');
    const updated = await this.prisma.bodyMapMarker.update({
      where: { id: markerId },
      data: {
        bodyView: dto.bodyView,
        side: dto.side,
        bodyPart: dto.bodyPart,
        specificLocation: dto.specificLocation,
        xCoordinate: dto.xCoordinate,
        yCoordinate: dto.yCoordinate,
        riskLevel: dto.riskLevel,
        status: dto.status,
        isVisible: dto.isVisible,
      },
    });
    await this.writeAudit(marker.bodyMapRecordId, BodyMapAuditAction.UPDATE_MARKER, userId, {
      markerId,
    });
    return mapMarker(updated);
  }

  async addReview(userId: string, recordId: string, dto: CreateBodyMapReviewDto) {
    const record = await this.ensureRecord(recordId);
    const conditionStatus = dto.conditionStatus as BodyMapConditionStatus;
    const reviewDetails = dto.woundReview
      ? (dto.woundReview as Prisma.InputJsonValue)
      : undefined;
    await this.prisma.$transaction(async tx => {
      await tx.bodyMapReview.create({
        data: {
          bodyMapRecordId: recordId,
          reviewedById: userId,
          conditionStatus,
          reviewNote: dto.reviewNote,
          actionTaken: dto.actionTaken,
          escalationRequired: dto.escalationRequired ?? false,
          nextReviewAt: dto.nextReviewAt ? new Date(dto.nextReviewAt) : null,
          reviewDetails,
        },
      });
      let status: BodyMapRecordStatus =
        conditionStatus === BodyMapConditionStatus.RESOLVED
          ? BodyMapRecordStatus.RESOLVED
          : BodyMapRecordStatus.MONITORING;
      if (conditionStatus === BodyMapConditionStatus.WORSENING) {
        status = BodyMapRecordStatus.AWAITING_REVIEW;
      }
      const recordPatch: {
        status: BodyMapRecordStatus;
        nextReviewAt?: Date;
        updatedById: string;
        managerReviewRequired?: boolean;
      } = {
        status,
        updatedById: userId,
      };
      if (dto.nextReviewAt) recordPatch.nextReviewAt = new Date(dto.nextReviewAt);
      if (conditionStatus === BodyMapConditionStatus.WORSENING) {
        recordPatch.managerReviewRequired = true;
      }
      await tx.bodyMapRecord.update({ where: { id: recordId }, data: recordPatch });
      await tx.bodyMapMarker.updateMany({
        where: { bodyMapRecordId: recordId },
        data: { status },
      });

      if (record.recordType === BodyMapRecordType.WOUND && dto.woundReview) {
        const existing = await tx.bodyMapWoundAssessment.findUnique({
          where: { bodyMapRecordId: recordId },
        });
        const priorData =
          existing?.assessmentData && typeof existing.assessmentData === 'object'
            ? (existing.assessmentData as Record<string, unknown>)
            : {};
        const lifecycle = deriveWoundLifecycleFromReview({
          conditionStatus,
          progressionComparison: dto.woundReview.progressionComparison,
          escalationRequired: dto.escalationRequired,
          professionalInvolvement: existing?.professionalInvolvement,
        });
        const assessmentData = withWoundLifecycle(
          { ...priorData, lastProgression: dto.woundReview.progressionComparison },
          lifecycle,
        );
        await tx.bodyMapWoundAssessment.upsert({
          where: { bodyMapRecordId: recordId },
          create: {
            bodyMapRecordId: recordId,
            measurements: dto.woundReview.measurements,
            dressing: dto.woundReview.dressing,
            nextDressingChange: dto.woundReview.nextDressingChange
              ? new Date(dto.woundReview.nextDressingChange)
              : undefined,
            assessmentData: assessmentData as Prisma.InputJsonValue,
            createdById: userId,
          },
          update: {
            measurements: dto.woundReview.measurements ?? existing?.measurements,
            dressing: dto.woundReview.dressing ?? existing?.dressing,
            nextDressingChange: dto.woundReview.nextDressingChange
              ? new Date(dto.woundReview.nextDressingChange)
              : existing?.nextDressingChange,
            assessmentData: assessmentData as Prisma.InputJsonValue,
          },
        });
      }
    });
    await this.writeAudit(recordId, BodyMapAuditAction.ADD_REVIEW, userId, {
      conditionStatus,
      woundReview: Boolean(dto.woundReview),
    });
    await this.alertsService.syncForServiceUser(record.serviceUserId);
    return this.getRecord(recordId);
  }

  listAlerts(serviceUserId: string) {
    return this.alertsService.listForServiceUser(serviceUserId);
  }

  dismissAlert(userId: string, alertId: string) {
    return this.alertsService.dismiss(alertId, userId);
  }

  branchGovernanceAlerts() {
    return this.alertsService.listBranchGovernanceAlerts();
  }

  async closeRecord(userId: string, recordId: string, dto: CloseBodyMapRecordDto) {
    const existing = await this.ensureRecord(recordId);
    if (existing.status === BodyMapRecordStatus.CLOSED) {
      throw new BadRequestException('Record is already closed');
    }
    if (this.requiresManagerSignOff(existing) && !dto.managerSignOff) {
      throw new BadRequestException(
        'Manager sign-off is required to close safeguarding, high-risk, or manager-review records',
      );
    }
    const closed = await this.prisma.$transaction(async tx => {
      const record = await tx.bodyMapRecord.update({
        where: { id: recordId },
        data: {
          status: BodyMapRecordStatus.CLOSED,
          closedAt: new Date(),
          closedById: userId,
          closureNote: dto.closureNote,
          updatedById: userId,
        },
        include: recordInclude,
      });
      await tx.bodyMapMarker.updateMany({
        where: { bodyMapRecordId: recordId },
        data: { status: BodyMapRecordStatus.CLOSED, isVisible: false },
      });
      if (existing.recordType === BodyMapRecordType.WOUND) {
        const wa = await tx.bodyMapWoundAssessment.findUnique({
          where: { bodyMapRecordId: recordId },
        });
        const priorData =
          wa?.assessmentData && typeof wa.assessmentData === 'object'
            ? (wa.assessmentData as Record<string, unknown>)
            : {};
        await tx.bodyMapWoundAssessment.upsert({
          where: { bodyMapRecordId: recordId },
          create: {
            bodyMapRecordId: recordId,
            assessmentData: withWoundLifecycle(priorData, 'CLOSED') as Prisma.InputJsonValue,
            createdById: userId,
          },
          update: {
            assessmentData: withWoundLifecycle(priorData, 'CLOSED') as Prisma.InputJsonValue,
          },
        });
      }
      return record;
    });
    await this.writeAudit(recordId, BodyMapAuditAction.CLOSE, userId, {
      closureNote: dto.closureNote,
      managerSignOff: dto.managerSignOff ?? false,
    });
    await this.alertsService.syncForServiceUser(closed.serviceUserId);
    return mapRecord(closed);
  }

  async saveWoundAssessment(userId: string, recordId: string, dto: BodyMapWoundAssessmentDto) {
    const record = await this.ensureRecord(recordId);
    if (record.recordType !== BodyMapRecordType.WOUND) {
      throw new BadRequestException('Wound assessment applies only to WOUND records');
    }
    const existing = await this.prisma.bodyMapWoundAssessment.findUnique({
      where: { bodyMapRecordId: recordId },
    });
    const mapped = this.mapWoundInput(dto);
    const priorData =
      (mapped.assessmentData && typeof mapped.assessmentData === 'object'
        ? (mapped.assessmentData as Record<string, unknown>)
        : null) ??
      (existing?.assessmentData && typeof existing.assessmentData === 'object'
        ? (existing.assessmentData as Record<string, unknown>)
        : initialWoundLifecycleData());
    const current = readWoundLifecycleStatus(priorData);
    const nextLifecycle = deriveWoundLifecycleFromAssessment({
      dressing: dto.dressing ?? existing?.dressing,
      nextDressingChange: dto.nextDressingChange
        ? new Date(dto.nextDressingChange)
        : existing?.nextDressingChange,
      professionalInvolvement: dto.professionalInvolvement ?? existing?.professionalInvolvement,
      current,
    });
    const assessmentData = nextLifecycle
      ? withWoundLifecycle(priorData, nextLifecycle)
      : priorData;
    await this.prisma.bodyMapWoundAssessment.upsert({
      where: { bodyMapRecordId: recordId },
      create: {
        bodyMapRecordId: recordId,
        ...mapped,
        assessmentData: assessmentData as Prisma.InputJsonValue,
        createdById: userId,
      },
      update: {
        ...mapped,
        assessmentData: assessmentData as Prisma.InputJsonValue,
      },
    });
    await this.writeAudit(recordId, BodyMapAuditAction.WOUND_ASSESSMENT, userId);
    await this.alertsService.syncForServiceUser(record.serviceUserId);
    return this.getRecord(recordId);
  }

  async savePressureAssessment(userId: string, recordId: string, dto: BodyMapPressureAssessmentDto) {
    const record = await this.ensureRecord(recordId);
    if (record.recordType !== BodyMapRecordType.PRESSURE) {
      throw new BadRequestException('Pressure assessment applies only to PRESSURE records');
    }
    await this.prisma.bodyMapPressureAssessment.upsert({
      where: { bodyMapRecordId: recordId },
      create: {
        bodyMapRecordId: recordId,
        ...this.mapPressureInput(dto),
        createdById: userId,
      },
      update: { ...this.mapPressureInput(dto) },
    });
    if (
      dto.blanching?.toLowerCase().includes('non') ||
      dto.nonBlanching?.toLowerCase() === 'yes'
    ) {
      await this.prisma.bodyMapRecord.update({
        where: { id: recordId },
        data: {
          managerReviewRequired: true,
          status: BodyMapRecordStatus.AWAITING_REVIEW,
        },
      });
    }
    await this.writeAudit(recordId, BodyMapAuditAction.PRESSURE_ASSESSMENT, userId);
    return this.getRecord(recordId);
  }

  async addLink(userId: string, recordId: string, dto: CreateBodyMapLinkDto) {
    const record = await this.ensureRecord(recordId);
    let label = dto.label;
    if (dto.linkedModule === BodyMapLinkedModule.MAR) {
      const mar = await this.medicationSiteService.validateMarLink(
        record.serviceUserId,
        dto.linkedRecordId,
      );
      label = label ?? mar.medicationName;
    }
    const link = await this.prisma.bodyMapLink.create({
      data: {
        bodyMapRecordId: recordId,
        linkedModule: dto.linkedModule,
        linkedRecordId: dto.linkedRecordId,
        label,
        createdById: userId,
      },
    });
    await this.writeAudit(recordId, BodyMapAuditAction.ADD_LINK, userId, {
      linkId: link.id,
      linkedModule: dto.linkedModule,
      linkedRecordId: dto.linkedRecordId,
    });
    await this.alertsService.syncForServiceUser(record.serviceUserId);
    return {
      id: link.id,
      linkedModule: link.linkedModule,
      linkedRecordId: link.linkedRecordId,
      label: link.label,
      createdAt: link.createdAt.toISOString(),
    };
  }

  async exportEvidence(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const su = await this.prisma.serviceUser.findUnique({
      where: { id: serviceUserId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        dateOfBirth: true,
        serviceUserNumber: true,
      },
    });
    const { records } = await this.listForServiceUser(serviceUserId, true);
    const audits = await Promise.all(
      records.map(async r => {
        const trail = await this.auditTrail(r.id);
        return { recordId: r.id, entries: trail.entries };
      }),
    );
    const activeMedicationSites = records
      .filter(r => r.recordType === BodyMapRecordType.MEDICATION && r.medicationSite)
      .map(r => ({
        recordId: r.id,
        subType: r.subType,
        status: r.status,
        medicationSite: r.medicationSite,
        markers: r.markers,
      }));

    const handoverPatchSites = activeMedicationSites
      .filter(
        r =>
          r.medicationSite &&
          (r.subType?.toLowerCase().includes('patch') ||
            r.medicationSite.medication?.medicationType?.code === 'PATCH'),
      )
      .map(r => ({
        recordId: r.recordId,
        medicineName: r.medicationSite!.medicineNameSnapshot,
        strength: r.medicationSite!.strength,
        bodyPart: r.markers[0]?.bodyPart ?? null,
        specificLocation: r.markers[0]?.specificLocation ?? null,
        bodyView: r.markers[0]?.bodyView ?? null,
        oldPatchBodyPart: r.medicationSite!.oldPatchBodyPart,
        nextChangeDue: r.medicationSite!.nextChangeDue,
        lastAdministrationAt:
          r.medicationSite!.lastAdministrationEvent?.actualDateTime ?? null,
        marMedicationId: r.medicationSite!.serviceUserMedicationId,
      }));

    const activeRecords = records.filter(
      r => !['CLOSED', 'RESOLVED', 'ARCHIVED'].includes(r.status),
    );
    const outstandingGaps = computeBodyMapOutstandingGaps(activeRecords);

    return {
      exportedAt: new Date().toISOString(),
      activeMedicationSites,
      handoverPatchSites,
      serviceUser: su
        ? {
            id: su.id,
            name: [su.preferredName, su.firstName, su.lastName].filter(Boolean).join(' '),
            dateOfBirth: su.dateOfBirth?.toISOString() ?? null,
            serviceUserNumber: su.serviceUserNumber,
          }
        : null,
      summary: await this.summary(serviceUserId),
      records,
      auditTrails: audits,
      outstandingGaps,
      format: 'cqc-evidence-v1',
    };
  }

  async cqcEvidenceForRecord(recordId: string) {
    const record = await this.getRecord(recordId);
    const trail = await this.auditTrail(recordId);
    const gaps = computeBodyMapOutstandingGaps([record]);
    const su = await this.prisma.serviceUser.findUnique({
      where: { id: record.serviceUserId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        dateOfBirth: true,
        serviceUserNumber: true,
      },
    });
    return {
      format: 'cqc-evidence-record-v1',
      generatedAt: new Date().toISOString(),
      serviceUser: su
        ? {
            id: su.id,
            name: [su.preferredName, su.firstName, su.lastName].filter(Boolean).join(' '),
            dateOfBirth: su.dateOfBirth?.toISOString() ?? null,
            serviceUserNumber: su.serviceUserNumber,
          }
        : null,
      record,
      auditTrail: trail.entries,
      outstandingGaps: gaps,
    };
  }

  async exportEvidencePdf(serviceUserId: string) {
    const pack = await this.exportEvidence(serviceUserId);
    const su = pack.serviceUser;
    const active = pack.records.filter(
      r => !['CLOSED', 'RESOLVED', 'ARCHIVED'].includes(r.status),
    );
    const pdf = await buildBodyMapCqcPdf({
      serviceUserName: su?.name ?? 'Service user',
      serviceUserNumber: su?.serviceUserNumber ?? null,
      dateOfBirth: su?.dateOfBirth
        ? new Date(su.dateOfBirth).toLocaleDateString('en-GB')
        : null,
      generatedAt: new Date(pack.exportedAt).toLocaleString('en-GB'),
      summary: {
        activeCount: pack.summary.activeCount,
        reviewDueCount: pack.summary.reviewDueCount,
        highRiskCount: pack.summary.highRiskCount,
        safeguardingCount: pack.summary.safeguardingCount ?? 0,
      },
      gaps: pack.outstandingGaps ?? [],
      records: active.map(r => ({
        recordType: r.recordType,
        subType: r.subType,
        status: r.status,
        riskLevel: r.riskLevel,
        bodyPart: r.markers[0]?.bodyPart ?? null,
        description: r.description,
        nextReviewAt: r.nextReviewAt,
      })),
    });
    return { pdf, filename: `body-map-cqc-${serviceUserId.slice(0, 8)}.pdf` };
  }

  async analytics() {
    const now = new Date();
    const baseWhere: Prisma.BodyMapRecordWhereInput = {
      isArchived: false,
      status: {
        notIn: [BodyMapRecordStatus.CLOSED, BodyMapRecordStatus.RESOLVED],
      },
    };

    const [activeCount, reviewDueCount, highRiskCount, safeguardingCount, byType] =
      await Promise.all([
        this.prisma.bodyMapRecord.count({ where: baseWhere }),
        this.prisma.bodyMapRecord.count({
          where: { ...baseWhere, nextReviewAt: { lte: now } },
        }),
        this.prisma.bodyMapRecord.count({
          where: {
            ...baseWhere,
            riskLevel: { in: [BodyMapRiskLevel.HIGH, BodyMapRiskLevel.URGENT] },
          },
        }),
        this.prisma.bodyMapRecord.count({
          where: { ...baseWhere, safeguardingTriggered: true },
        }),
        this.prisma.bodyMapRecord.groupBy({
          by: ['recordType'],
          where: baseWhere,
          _count: { _all: true },
        }),
      ]);

    const queue = await this.reviewQueue();

    const gapSample = await this.prisma.bodyMapRecord.findMany({
      where: baseWhere,
      include: {
        medicationSite: { select: { lastAdministrationEventId: true } },
        links: { select: { linkedModule: true } },
      },
      take: 500,
    });
    const outstandingGaps = computeBodyMapOutstandingGaps(
      gapSample.map(r => ({
        id: r.id,
        recordType: r.recordType,
        subType: r.subType,
        status: r.status,
        nextReviewAt: r.nextReviewAt?.toISOString() ?? null,
        medicationSite: r.medicationSite,
        links: r.links,
        actionSummary: r.actionSummary,
      })),
    );

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        activeCount,
        reviewDueCount,
        highRiskCount,
        safeguardingCount,
        reviewQueueCount: queue.records.length,
        outstandingGapCount: outstandingGaps.length,
      },
      byRecordType: byType.map(row => ({
        recordType: row.recordType,
        count: row._count?._all ?? 0,
      })),
      gapCodes: outstandingGaps.reduce(
        (acc, g) => {
          acc[g.code] = (acc[g.code] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  async patchRotationCheck(
    serviceUserId: string,
    opts: { bodyView: string; x: number; y: number; excludeRecordId?: string },
  ) {
    await this.ensureServiceUser(serviceUserId);
    const bodyViews = ['FRONT', 'BACK', 'LEFT', 'RIGHT', 'FACE', 'HAND', 'FOOT'] as const;
    if (!bodyViews.includes(opts.bodyView as (typeof bodyViews)[number])) {
      throw new BadRequestException('Invalid bodyView for patch rotation check');
    }
    if (!Number.isFinite(opts.x) || !Number.isFinite(opts.y)) {
      throw new BadRequestException('x and y coordinates are required');
    }
    const warnings = await this.medicationSiteService.patchRotationWarnings({
      serviceUserId,
      bodyView: opts.bodyView as (typeof bodyViews)[number],
      x: opts.x,
      y: opts.y,
      excludeRecordId: opts.excludeRecordId,
    });
    return { warnings };
  }

  async saveMedicationSite(userId: string, recordId: string, dto: BodyMapMedicationSiteDto) {
    const record = await this.ensureRecord(recordId);
    if (record.recordType !== BodyMapRecordType.MEDICATION) {
      throw new BadRequestException('Medication site applies only to MEDICATION records');
    }
    if (record.status === BodyMapRecordStatus.CLOSED) {
      throw new BadRequestException('Closed records cannot be updated');
    }
    const med = await this.medicationSiteService.loadMedicationForSite(
      record.serviceUserId,
      dto.serviceUserMedicationId,
    );
    this.medicationSiteService.assertMedicationEligible(med);
    const subType = record.subType ?? this.medicationSiteService.suggestSubType(med);
    this.medicationSiteService.requireCreamFireRisk(subType, dto.fireRiskEmollient);
    this.medicationSiteService.assertPatchSiteRules(dto, subType, med);

    const existing = await this.prisma.bodyMapMedicationSite.findUnique({
      where: { bodyMapRecordId: recordId },
    });

    await this.prisma.$transaction(async tx => {
      await this.medicationSiteService.persistSiteInTransaction(tx, {
        recordId,
        serviceUserId: record.serviceUserId,
        userId,
        dto,
        isCreate: !existing,
        auditAction: existing
          ? BodyMapAuditAction.MEDICATION_SITE_UPDATE
          : BodyMapAuditAction.MEDICATION_SITE_CREATE,
      });
    });

    return this.getRecord(recordId);
  }

  async getMedicationSiteForChart(serviceUserId: string, medicationId: string) {
    await this.ensureServiceUser(serviceUserId);
    const site = await this.medicationSiteService.findActiveSiteForMedication(
      serviceUserId,
      medicationId,
    );
    if (!site) {
      return { linked: false, bodyMapRecordId: null, medicationSite: null, record: null };
    }
    const record = await this.getRecord(site.bodyMapRecordId);
    return {
      linked: true,
      bodyMapRecordId: site.bodyMapRecordId,
      medicationSite: mapMedicationSite(site),
      record,
    };
  }

  async createMedicationSiteFromMar(
    userId: string,
    serviceUserId: string,
    medicationId: string,
    dto: CreateMedicationBodyMapSiteFromMarDto,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const med = await this.medicationSiteService.loadMedicationForSite(serviceUserId, medicationId);
    this.medicationSiteService.assertMedicationEligible(med);

    const existing = await this.medicationSiteService.findActiveSiteForMedication(
      serviceUserId,
      medicationId,
    );
    if (existing) {
      throw new BadRequestException(
        'An active body map site already exists for this medication. Open the existing record or close it before creating another.',
      );
    }

    const subType =
      dto.subType ?? this.medicationSiteService.suggestSubType(med) ?? 'Medication site';
    this.medicationSiteService.requireCreamFireRisk(
      subType,
      dto.medicationSite.fireRiskEmollient,
    );

    const createDto: CreateBodyMapRecordDto = {
      serviceUserId,
      recordType: BodyMapRecordType.MEDICATION,
      subType,
      title: dto.title ?? `${med.medicationName} — ${dto.bodyPart}`,
      description: dto.description,
      riskLevel: dto.riskLevel,
      bodyView: dto.bodyView,
      side: dto.side,
      bodyPart: dto.bodyPart,
      specificLocation: dto.specificLocation,
      xCoordinate: dto.xCoordinate,
      yCoordinate: dto.yCoordinate,
      medicationSite: {
        ...dto.medicationSite,
        serviceUserMedicationId: medicationId,
        medicineNameSnapshot:
          dto.medicationSite.medicineNameSnapshot ?? med.medicationName,
        strength: dto.medicationSite.strength ?? med.strength ?? undefined,
        frequencyText:
          dto.medicationSite.frequencyText ?? med.frequencyText ?? med.frequency?.name ?? undefined,
      },
    };

    return this.createRecord(userId, createDto);
  }

  async patchMedicationSiteAdministration(
    userId: string,
    recordId: string,
    dto: PatchBodyMapMedicationSiteAdministrationDto,
  ) {
    const record = await this.ensureRecord(recordId);
    const site = await this.prisma.bodyMapMedicationSite.findUnique({
      where: { bodyMapRecordId: recordId },
    });
    if (!site) {
      throw new NotFoundException('Medication site not found on this record');
    }
    if (dto.lastAdministrationEventId) {
      await this.medicationSiteService.validateAdministrationEvent(
        record.serviceUserId,
        site.serviceUserMedicationId,
        dto.lastAdministrationEventId,
      );
    }
    await this.prisma.bodyMapMedicationSite.update({
      where: { bodyMapRecordId: recordId },
      data: { lastAdministrationEventId: dto.lastAdministrationEventId },
    });
    await this.writeAudit(recordId, BodyMapAuditAction.MEDICATION_SITE_UPDATE, userId, {
      lastAdministrationEventId: dto.lastAdministrationEventId,
      administrationLinkCleared: dto.lastAdministrationEventId === null,
    });
    return this.getRecord(recordId);
  }

  async lookups() {
    const count = await this.prisma.bodyMapRecordTypeCatalog.count({ where: { isActive: true } });
    if (count === 0) {
      return staticBodyMapRecordTypeCatalogLookups();
    }
    return buildBodyMapRecordTypeCatalogLookups(this.prisma);
  }

  async reviewQueue(opts?: { overdueOnly?: boolean; serviceUserId?: string }) {
    const now = new Date();
    const rows = await this.prisma.bodyMapRecord.findMany({
      where: {
        isArchived: false,
        status: { notIn: [BodyMapRecordStatus.CLOSED, BodyMapRecordStatus.RESOLVED] },
        ...(opts?.serviceUserId ? { serviceUserId: opts.serviceUserId } : {}),
        OR: opts?.overdueOnly
          ? [{ nextReviewAt: { lte: now } }]
          : [
              { status: BodyMapRecordStatus.AWAITING_REVIEW },
              { managerReviewRequired: true },
              { safeguardingTriggered: true },
              { nextReviewAt: { lte: now } },
            ],
      },
      include: recordInclude,
      orderBy: [
        { riskLevel: 'desc' },
        { safeguardingTriggered: 'desc' },
        { nextReviewAt: 'asc' },
        { createdAt: 'asc' },
      ],
      take: 200,
    });
    return {
      records: rows.map(r => ({
        ...mapRecord(r),
        queueReasons: [
          r.status === BodyMapRecordStatus.AWAITING_REVIEW ? 'Awaiting manager review' : null,
          r.safeguardingTriggered ? 'Safeguarding triggered' : null,
          r.managerReviewRequired ? 'Manager review required' : null,
          r.nextReviewAt && r.nextReviewAt <= now ? 'Review overdue' : null,
        ].filter(Boolean) as string[],
      })),
      total: rows.length,
    };
  }

  async uploadPhoto(
    userId: string,
    recordId: string,
    file: Express.Multer.File,
    consentStatus: BodyMapPhotoConsentStatus,
    caption?: string,
  ) {
    if (consentStatus !== BodyMapPhotoConsentStatus.GRANTED) {
      throw new BadRequestException('Photo consent must be granted before upload');
    }
    await this.ensureRecord(recordId);
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP images are allowed');
    }
    if (file.size > this.maxPhotoBytes()) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }
    const fileUrl = this.photoPublicUrl(file.filename);

    const photo = await this.prisma.$transaction(async tx => {
      const created = await tx.bodyMapPhoto.create({
        data: {
          bodyMapRecordId: recordId,
          fileName: file.filename,
          originalName: file.originalname,
          fileUrl,
          fileSize: file.size,
          mimeType: file.mimetype,
          consentStatus,
          caption,
          uploadedById: userId,
        },
      });
      await tx.bodyMapAuditLog.create({
        data: {
          bodyMapRecordId: recordId,
          action: BodyMapAuditAction.ADD_PHOTO,
          actorUserId: userId,
          payload: { photoId: created.id, consentStatus },
        },
      });
      return created;
    });

    return {
      id: photo.id,
      fileUrl: photo.fileUrl,
      consentStatus: photo.consentStatus,
      caption: photo.caption,
      createdAt: photo.createdAt.toISOString(),
    };
  }

  async addSafeguardingCheck(userId: string, recordId: string, dto: BodyMapSafeguardingCheckDto) {
    const record = await this.ensureRecord(recordId);
    if (!record.safeguardingTriggered) {
      throw new BadRequestException('Record is not flagged for safeguarding');
    }
    const existing = await this.prisma.bodyMapSafeguardingCheck.findUnique({
      where: { bodyMapRecordId: recordId },
    });
    if (existing) {
      throw new BadRequestException('Safeguarding checklist already completed for this record');
    }
    await this.prisma.$transaction(async tx => {
      await tx.bodyMapSafeguardingCheck.create({
        data: {
          bodyMapRecordId: recordId,
          ...this.mapSafeguardingInput(dto),
          completedById: userId,
        },
      });
      await tx.bodyMapAuditLog.create({
        data: {
          bodyMapRecordId: recordId,
          action: BodyMapAuditAction.SAFEGUARDING_CHECK,
          actorUserId: userId,
        },
      });
    });
    return this.getRecord(recordId);
  }

  async auditTrail(recordId: string) {
    await this.ensureRecord(recordId);
    const rows = await this.prisma.bodyMapAuditLog.findMany({
      where: { bodyMapRecordId: recordId },
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    return {
      entries: rows.map(e => ({
        id: e.id,
        action: e.action,
        actorName: userDisplayName(e.actor),
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}
