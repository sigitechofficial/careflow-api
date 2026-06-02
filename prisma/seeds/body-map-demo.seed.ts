/**
 * Body map demo data — wipe all body map rows and seed realistic clinical scenarios.
 */
import type { PrismaClient } from '@prisma/client';
import {
  BodyMapAuditAction,
  BodyMapBodyView,
  BodyMapConditionStatus,
  BodyMapEmollientFireRisk,
  BodyMapLinkedModule,
  BodyMapRecordStatus,
  BodyMapRecordType,
  BodyMapRiskLevel,
  BodyMapSide,
  MedicationKind,
  MedicationRecordStatus,
} from '@prisma/client';

export type SeedBodyMapDemoOptions = {
  /** Target service user; defaults to SU-1042 (Margaret Hughes) then oldest SU. */
  serviceUserId?: string;
  /** Also seed a lighter set on one additional active service user. */
  includeSecondServiceUser?: boolean;
};

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 0, 0, 0);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d;
}

function hoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

/** Canvas engine uses 0–100 % coords + prototype recordView (see careflow-body-map-demo-data.js). */
type DemoMarkerPlacement = {
  recordView: string;
  canvasView: string;
  regionId: string;
  x: number;
  y: number;
  bodyView: BodyMapBodyView;
  side: BodyMapSide;
  bodyPart: string;
  specificLocation?: string;
};

function mapPlacement(p: DemoMarkerPlacement) {
  return {
    observationDetails: {
      recordView: p.recordView,
      canvasView: p.canvasView,
      regionId: p.regionId,
    },
    marker: {
      bodyView: p.bodyView,
      side: p.side,
      bodyPart: p.bodyPart,
      specificLocation: p.specificLocation ?? null,
      xCoordinate: p.x,
      yCoordinate: p.y,
    },
  };
}

export async function clearAllBodyMapData(prisma: PrismaClient): Promise<void> {
  const alerts = await prisma.bodyMapAlert.deleteMany({});
  const records = await prisma.bodyMapRecord.deleteMany({});
  console.log(`  ✓ Cleared body map: ${records.count} record(s), ${alerts.count} alert(s)`);
}

async function resolveActor(prisma: PrismaClient): Promise<string | null> {
  const user =
    (await prisma.user.findFirst({ where: { email: 'admin@careadmin.local', deletedAt: null } })) ??
    (await prisma.user.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }));
  return user?.id ?? null;
}

async function resolveTargetServiceUser(
  prisma: PrismaClient,
  serviceUserId?: string,
): Promise<{ id: string; firstName: string; lastName: string } | null> {
  if (serviceUserId) {
    return prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
  }
  const byNumber = await prisma.serviceUser.findFirst({
    where: { serviceUserNumber: 'SU-1042', deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (byNumber) return byNumber;
  return prisma.serviceUser.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, firstName: true, lastName: true },
  });
}

async function ensureTopicalMedications(
  prisma: PrismaClient,
  suId: string,
  actorId: string | null,
): Promise<{
  hydrocortisoneId: string;
  buprenorphinePatchId: string;
  emollientNoSiteId: string;
}> {
  const [typeCream, typePatch, routeTopical, routeTransdermal, freqTwiceDaily, freqOnceDaily, catGeneral] =
    await Promise.all([
      prisma.medicationType.findUnique({ where: { code: 'CREAM' } }),
      prisma.medicationType.findUnique({ where: { code: 'PATCH' } }),
      prisma.medicationRoute.findUnique({ where: { code: 'TOPICAL' } }),
      prisma.medicationRoute.findUnique({ where: { code: 'TRANSDERMAL' } }),
      prisma.medicationFrequency.findUnique({ where: { code: 'TWICE_DAILY' } }),
      prisma.medicationFrequency.findUnique({ where: { code: 'ONCE_DAILY' } }),
      prisma.medicationCategory.findUnique({ where: { code: 'GENERAL' } }),
    ]);

  const upsertMed = async (name: string, data: {
    medicationName: string;
    strength: string;
    medicationTypeId?: string;
    routeId?: string;
    frequencyText: string;
    instructions: string;
  }) => {
    const existing = await prisma.serviceUserMedication.findFirst({
      where: { serviceUserId: suId, medicationName: data.medicationName, deletedAt: null },
    });
    if (existing) return existing.id;
    const row = await prisma.serviceUserMedication.create({
      data: {
        serviceUserId: suId,
        medicationName: data.medicationName,
        strength: data.strength,
        dose: 'As prescribed',
        startDate: daysAgo(30),
        medicationTypeId: data.medicationTypeId,
        routeId: data.routeId,
        categoryId: catGeneral?.id,
        frequencyId: freqTwiceDaily?.id,
        frequencyText: data.frequencyText,
        instructions: data.instructions,
        medicationKind: MedicationKind.REGULAR,
        status: MedicationRecordStatus.ACTIVE,
        isActive: true,
        createdById: actorId ?? undefined,
      },
    });
    return row.id;
  };

  const hydrocortisoneId = await upsertMed('Hydrocortisone 1% cream', {
    medicationName: 'Hydrocortisone 1% cream',
    strength: '1%',
    medicationTypeId: typeCream?.id,
    routeId: routeTopical?.id,
    frequencyText: 'Apply thinly twice daily',
    instructions: 'Apply to affected area only. Record body site on body map.',
  });

  const buprenorphinePatchId = await upsertMed('Buprenorphine 5 micrograms/hour patch', {
    medicationName: 'Buprenorphine 5 micrograms/hour patch',
    strength: '5mcg/h',
    medicationTypeId: typePatch?.id,
    routeId: routeTransdermal?.id,
    frequencyText: 'Change every 72 hours',
    instructions: 'Remove old patch before applying new. Rotate application site.',
  });

  const emollientNoSiteId = await upsertMed('Doublebase emollient gel', {
    medicationName: 'Doublebase emollient gel',
    strength: '100g',
    medicationTypeId: typeCream?.id,
    routeId: routeTopical?.id,
    frequencyText: 'Apply after bathing',
    instructions: 'Full body emollient — body map site required per policy.',
  });

  void freqOnceDaily;
  return { hydrocortisoneId, buprenorphinePatchId, emollientNoSiteId };
}

async function seedPrimaryServiceUserBodyMap(
  prisma: PrismaClient,
  suId: string,
  actorId: string | null,
): Promise<number> {
  const meds = await ensureTopicalMedications(prisma, suId, actorId);
  const carePlanLinkId = '00000000-0000-4000-8000-000000000001';
  let count = 0;

  const sacral = mapPlacement({
    recordView: 'back',
    canvasView: 'dual',
    regionId: 'sacrum',
    x: 50,
    y: 36,
    bodyView: BodyMapBodyView.BACK,
    side: BodyMapSide.CENTRE,
    bodyPart: 'Sacrum',
    specificLocation: 'Mid sacrum',
  });

  // 1 — Sacral pressure area (high risk, review overdue, no care plan → governance alert)
  await prisma.bodyMapRecord.create({
    data: {
      serviceUserId: suId,
      recordType: BodyMapRecordType.PRESSURE,
      subType: 'Category 2 pressure damage',
      title: 'Sacral redness — non-blanching',
      description:
        'Non-blanching erythema over sacrum noted during morning personal care. Person reports discomfort when repositioning.',
      riskLevel: BodyMapRiskLevel.HIGH,
      status: BodyMapRecordStatus.MONITORING,
      firstNoticedAt: daysAgo(5),
      noticedByType: 'CARER',
      noticedByName: 'Jane Cooper',
      causeSummary: 'Prolonged sitting in recliner chair; reduced mobility.',
      actionSummary:
        'Nurse informed. Repositioning 2-hourly documented. Pressure-relieving cushion ordered.',
      reviewRequired: true,
      nextReviewAt: daysAgo(1),
      managerReviewRequired: true,
      observationDetails: sacral.observationDetails,
      createdById: actorId,
      updatedById: actorId,
      markers: {
        create: {
          ...sacral.marker,
          markerNumber: 1,
          markerType: BodyMapRecordType.PRESSURE,
          riskLevel: BodyMapRiskLevel.HIGH,
          status: BodyMapRecordStatus.MONITORING,
          createdById: actorId,
        },
      },
      pressureAssessment: {
        create: {
          riskTool: 'Waterlow',
          blanching: 'Non-blanching',
          skinIntact: 'No — superficial loss',
          nonBlanching: 'Yes',
          repositioningRecorded: 'Yes — 2 hourly',
          repositioningFrequency: 'Every 2 hours',
          pressureEquipment: 'High-spec foam mattress; cushion on order',
          createdById: actorId,
        },
      },
      reviews: {
        create: {
          conditionStatus: BodyMapConditionStatus.WORSENING,
          reviewNote: 'Area slightly larger than yesterday. District nurse referral requested.',
          actionTaken: 'Photos taken with consent. GP notified.',
          escalationRequired: true,
          reviewedById: actorId,
          reviewedAt: daysAgo(2),
          nextReviewAt: daysAgo(1),
        },
      },
      auditLogs: {
        create: [
          { action: BodyMapAuditAction.CREATE, actorUserId: actorId },
          { action: BodyMapAuditAction.PRESSURE_ASSESSMENT, actorUserId: actorId },
          { action: BodyMapAuditAction.ADD_REVIEW, actorUserId: actorId },
        ],
      },
    },
  });
  count += 1;

  const leftShin = mapPlacement({
    recordView: 'front',
    canvasView: 'dual',
    regionId: 'left-leg-lower-front',
    x: 26,
    y: 78,
    bodyView: BodyMapBodyView.FRONT,
    side: BodyMapSide.LEFT,
    bodyPart: 'Left lower leg',
    specificLocation: 'Anterior shin',
  });

  // 2 — Lower leg skin tear (improving wound, linked care plan)
  await prisma.bodyMapRecord.create({
    data: {
      serviceUserId: suId,
      recordType: BodyMapRecordType.WOUND,
      subType: 'Skin tear',
      title: 'Left shin skin tear',
      description: 'Superficial skin tear from catching leg on bed rail during night transfer.',
      riskLevel: BodyMapRiskLevel.MEDIUM,
      status: BodyMapRecordStatus.MONITORING,
      firstNoticedAt: daysAgo(12),
      noticedByType: 'CARER',
      noticedByName: 'Michael Okonkwo',
      causeSummary: 'Accidental contact with bed rail.',
      actionSummary: 'Cleaned with saline. Non-adherent dressing applied. District nurse reviewing weekly.',
      reviewRequired: true,
      nextReviewAt: daysFromNow(2),
      observationDetails: leftShin.observationDetails,
      createdById: actorId,
      updatedById: actorId,
      markers: {
        create: {
          ...leftShin.marker,
          markerNumber: 1,
          markerType: BodyMapRecordType.WOUND,
          riskLevel: BodyMapRiskLevel.MEDIUM,
          status: BodyMapRecordStatus.MONITORING,
          createdById: actorId,
        },
      },
      woundAssessment: {
        create: {
          woundType: 'Skin tear',
          exudate: 'Minimal serous',
          dressing: 'Non-adherent pad + light bandage',
          measurements: '2.1 × 0.8 cm',
          nextDressingChange: daysFromNow(2),
          infectionSigns: 'None observed',
          professionalInvolvement: 'District nurse — weekly review',
          assessmentData: {
            woundLifecycleStatus: 'IMPROVING',
            lastProgression: 'BETTER',
            lifecycleHistory: [
              { status: 'NEW', at: daysAgo(12).toISOString() },
              { status: 'ACTIVE', at: daysAgo(11).toISOString() },
              { status: 'TREATMENT_PLANNED', at: daysAgo(10).toISOString() },
              { status: 'IMPROVING', at: daysAgo(3).toISOString() },
            ],
          },
          createdById: actorId,
        },
      },
      links: {
        create: {
          linkedModule: BodyMapLinkedModule.CARE_PLAN,
          linkedRecordId: carePlanLinkId,
          label: 'Skin integrity & wound care plan',
          createdById: actorId,
        },
      },
      reviews: {
        create: [
          {
            conditionStatus: BodyMapConditionStatus.UNCHANGED,
            reviewNote: 'Initial dressing intact. No increase in exudate.',
            reviewedById: actorId,
            reviewedAt: daysAgo(8),
          },
          {
            conditionStatus: BodyMapConditionStatus.IMPROVING,
            reviewNote: 'Edges approximating. Less exudate. Person reports less pain.',
            actionTaken: 'Dressing changed. Next review in 48 hours.',
            reviewedById: actorId,
            reviewedAt: daysAgo(3),
            nextReviewAt: daysFromNow(2),
            reviewDetails: {
              progressionComparison: 'BETTER',
              painChange: 'Reduced',
              dressingChanged: true,
              treatmentFollowed: true,
              measurements: '2.1 × 0.8 cm',
            },
          },
        ],
      },
      auditLogs: {
        create: [
          { action: BodyMapAuditAction.CREATE, actorUserId: actorId },
          { action: BodyMapAuditAction.WOUND_ASSESSMENT, actorUserId: actorId },
          { action: BodyMapAuditAction.ADD_REVIEW, actorUserId: actorId },
        ],
      },
    },
  });
  count += 1;

  const rightForearm = mapPlacement({
    recordView: 'front',
    canvasView: 'dual',
    regionId: 'right-arm-lower-front',
    x: 88,
    y: 38,
    bodyView: BodyMapBodyView.FRONT,
    side: BodyMapSide.RIGHT,
    bodyPart: 'Right forearm',
    specificLocation: 'Inner aspect',
  });

  // 3 — Unexplained forearm bruise (safeguarding, awaiting manager review)
  await prisma.bodyMapRecord.create({
    data: {
      serviceUserId: suId,
      recordType: BodyMapRecordType.INJURY,
      subType: 'Bruise',
      title: 'Unexplained bruising — right forearm',
      description:
        'Approx. 3 cm purple bruise on inner right forearm. Person could not recall how it happened.',
      riskLevel: BodyMapRiskLevel.HIGH,
      status: BodyMapRecordStatus.AWAITING_REVIEW,
      firstNoticedAt: hoursAgo(6),
      noticedByType: 'CARER',
      noticedByName: 'Sarah Mitchell',
      causeSummary: 'Unknown — person denies fall or bump.',
      actionSummary: 'Safeguarding checklist completed. Manager informed. Monitoring for pattern.',
      reviewRequired: true,
      nextReviewAt: daysFromNow(1),
      safeguardingTriggered: true,
      managerReviewRequired: true,
      observationDetails: rightForearm.observationDetails,
      createdById: actorId,
      updatedById: actorId,
      markers: {
        create: {
          ...rightForearm.marker,
          markerNumber: 1,
          markerType: BodyMapRecordType.INJURY,
          riskLevel: BodyMapRiskLevel.HIGH,
          status: BodyMapRecordStatus.AWAITING_REVIEW,
          createdById: actorId,
        },
      },
      safeguardingCheck: {
        create: {
          causeKnown: 'No',
          explanationConsistent: 'N/A — cause unknown',
          happenedBefore: 'Yes — similar bruise noted 6 weeks ago (closed record)',
          immediateRisk: 'Low — no acute pain, full movement',
          managerInformed: 'Yes — phone call at 09:15',
          incidentRequired: 'Yes',
          referralRequired: 'Under review',
          referralReason: 'Awaiting manager decision after 24h monitoring',
          managerNotes: 'Check visit logs and previous body map records for pattern.',
          completedById: actorId,
          completedAt: hoursAgo(5),
        },
      },
      auditLogs: {
        create: [
          { action: BodyMapAuditAction.CREATE, actorUserId: actorId },
          { action: BodyMapAuditAction.SAFEGUARDING_CHECK, actorUserId: actorId },
        ],
      },
    },
  });
  count += 1;

  const leftElbowCream = mapPlacement({
    recordView: 'front',
    canvasView: 'dual',
    regionId: 'left-arm-lower-front',
    x: 12,
    y: 40,
    bodyView: BodyMapBodyView.FRONT,
    side: BodyMapSide.LEFT,
    bodyPart: 'Left forearm',
    specificLocation: 'Elbow crease',
  });

  // 4 — Hydrocortisone cream site (left elbow)
  await prisma.bodyMapRecord.create({
    data: {
      serviceUserId: suId,
      recordType: BodyMapRecordType.MEDICATION,
      subType: 'Cream',
      title: 'Hydrocortisone 1% — left elbow',
      description: 'Topical steroid for eczema flare on left elbow crease.',
      riskLevel: BodyMapRiskLevel.LOW,
      status: BodyMapRecordStatus.ACTIVE,
      actionSummary: 'Applied thinly BDS after morning and evening personal care.',
      reviewRequired: false,
      observationDetails: leftElbowCream.observationDetails,
      createdById: actorId,
      updatedById: actorId,
      markers: {
        create: {
          ...leftElbowCream.marker,
          markerNumber: 1,
          markerType: BodyMapRecordType.MEDICATION,
          riskLevel: BodyMapRiskLevel.LOW,
          status: BodyMapRecordStatus.ACTIVE,
          createdById: actorId,
        },
      },
      medicationSite: {
        create: {
          serviceUserMedicationId: meds.hydrocortisoneId,
          medicineNameSnapshot: 'Hydrocortisone 1% cream',
          strength: '1%',
          frequencyText: 'Twice daily',
          appliedAt: hoursAgo(8),
          appliedById: actorId,
          consentGiven: true,
          amountOrThickness: 'Thin layer',
          reasonForApplication: 'Eczema flare',
          fireRiskEmollient: BodyMapEmollientFireRisk.NOT_APPLICABLE,
          siteRotationChecked: true,
          createdById: actorId,
        },
      },
      links: {
        create: {
          linkedModule: BodyMapLinkedModule.MAR,
          linkedRecordId: meds.hydrocortisoneId,
          label: 'Hydrocortisone 1% cream',
          createdById: actorId,
        },
      },
      auditLogs: {
        create: [
          { action: BodyMapAuditAction.CREATE, actorUserId: actorId },
          { action: BodyMapAuditAction.MEDICATION_SITE_CREATE, actorUserId: actorId },
          { action: BodyMapAuditAction.ADD_LINK, actorUserId: actorId },
        ],
      },
    },
  });
  count += 1;

  const rightPatch = mapPlacement({
    recordView: 'front',
    canvasView: 'dual',
    regionId: 'right-arm-upper-front',
    x: 86,
    y: 28,
    bodyView: BodyMapBodyView.FRONT,
    side: BodyMapSide.RIGHT,
    bodyPart: 'Right upper arm',
    specificLocation: 'Deltoid — outer aspect',
  });

  // 5 — Buprenorphine patch (overdue change due)
  await prisma.bodyMapRecord.create({
    data: {
      serviceUserId: suId,
      recordType: BodyMapRecordType.MEDICATION,
      subType: 'Patch',
      title: 'Buprenorphine patch — right upper arm',
      description: 'Transdermal analgesic patch for chronic pain management.',
      riskLevel: BodyMapRiskLevel.MEDIUM,
      status: BodyMapRecordStatus.ACTIVE,
      actionSummary: 'Patch change due — old patch removed and disposed at last visit.',
      reviewRequired: true,
      nextReviewAt: daysFromNow(1),
      observationDetails: rightPatch.observationDetails,
      createdById: actorId,
      updatedById: actorId,
      markers: {
        create: {
          ...rightPatch.marker,
          markerNumber: 1,
          markerType: BodyMapRecordType.MEDICATION,
          riskLevel: BodyMapRiskLevel.MEDIUM,
          status: BodyMapRecordStatus.ACTIVE,
          createdById: actorId,
        },
      },
      medicationSite: {
        create: {
          serviceUserMedicationId: meds.buprenorphinePatchId,
          medicineNameSnapshot: 'Buprenorphine 5 micrograms/hour patch',
          strength: '5mcg/h',
          frequencyText: 'Change every 72 hours',
          appliedAt: daysAgo(4),
          appliedById: actorId,
          consentGiven: true,
          oldPatchPresent: false,
          oldPatchRemoved: true,
          oldPatchRemovalAt: daysAgo(4),
          disposalRecorded: true,
          nextChangeDue: daysAgo(1),
          siteRotationChecked: true,
          secondStaffCheck: true,
          siteRotationNotes: 'Rotated from left upper arm at last change.',
          createdById: actorId,
        },
      },
      links: {
        create: {
          linkedModule: BodyMapLinkedModule.MAR,
          linkedRecordId: meds.buprenorphinePatchId,
          label: 'Buprenorphine 5 micrograms/hour patch',
          createdById: actorId,
        },
      },
      auditLogs: {
        create: [
          { action: BodyMapAuditAction.CREATE, actorUserId: actorId },
          { action: BodyMapAuditAction.MEDICATION_SITE_CREATE, actorUserId: actorId },
        ],
      },
    },
  });
  count += 1;

  const leftKneeClosed = mapPlacement({
    recordView: 'front',
    canvasView: 'dual',
    regionId: 'left-knee',
    x: 28,
    y: 72,
    bodyView: BodyMapBodyView.FRONT,
    side: BodyMapSide.LEFT,
    bodyPart: 'Left knee',
  });

  // 6 — Closed historical bruise (resolved marker hidden)
  await prisma.bodyMapRecord.create({
    data: {
      serviceUserId: suId,
      recordType: BodyMapRecordType.INJURY,
      subType: 'Bruise',
      title: 'Left knee bruise — resolved',
      description: 'Small bruise after bump on coffee table — fully healed.',
      riskLevel: BodyMapRiskLevel.LOW,
      status: BodyMapRecordStatus.CLOSED,
      firstNoticedAt: daysAgo(45),
      causeSummary: 'Accidental bump on low coffee table.',
      actionSummary: 'Monitored until faded. No safeguarding concerns.',
      closedAt: daysAgo(20),
      closedById: actorId,
      closureNote: 'Bruising fully resolved. No further action required.',
      observationDetails: leftKneeClosed.observationDetails,
      createdById: actorId,
      markers: {
        create: {
          ...leftKneeClosed.marker,
          markerNumber: 1,
          markerType: BodyMapRecordType.INJURY,
          riskLevel: BodyMapRiskLevel.LOW,
          status: BodyMapRecordStatus.CLOSED,
          isVisible: false,
          createdById: actorId,
        },
      },
      reviews: {
        create: {
          conditionStatus: BodyMapConditionStatus.RESOLVED,
          reviewNote: 'Discolouration gone. Person reports no pain.',
          reviewedById: actorId,
          reviewedAt: daysAgo(22),
        },
      },
      auditLogs: {
        create: [
          { action: BodyMapAuditAction.CREATE, actorUserId: actorId },
          { action: BodyMapAuditAction.ADD_REVIEW, actorUserId: actorId },
          { action: BodyMapAuditAction.CLOSE, actorUserId: actorId },
        ],
      },
    },
  });
  count += 1;

  const dryCalves = mapPlacement({
    recordView: 'front',
    canvasView: 'dual',
    regionId: 'left-leg-lower-front',
    x: 24,
    y: 86,
    bodyView: BodyMapBodyView.FRONT,
    side: BodyMapSide.LEFT,
    bodyPart: 'Left calf',
  });

  // 7 — Dry skin calves (low priority)
  await prisma.bodyMapRecord.create({
    data: {
      serviceUserId: suId,
      recordType: BodyMapRecordType.SKIN,
      subType: 'Dry skin',
      title: 'Dry skin — both calves',
      description: 'Xerosis noted during bathing. Emollient care plan in place.',
      riskLevel: BodyMapRiskLevel.LOW,
      status: BodyMapRecordStatus.MONITORING,
      firstNoticedAt: daysAgo(7),
      actionSummary: 'Doublebase gel applied after bathing. Body map site pending for emollient.',
      nextReviewAt: daysFromNow(14),
      observationDetails: dryCalves.observationDetails,
      createdById: actorId,
      markers: {
        create: {
          ...dryCalves.marker,
          markerNumber: 1,
          markerType: BodyMapRecordType.SKIN,
          riskLevel: BodyMapRiskLevel.LOW,
          status: BodyMapRecordStatus.MONITORING,
          createdById: actorId,
        },
      },
      auditLogs: { create: { action: BodyMapAuditAction.CREATE, actorUserId: actorId } },
    },
  });
  count += 1;

  void meds.emollientNoSiteId;

  return count;
}

async function seedSecondaryServiceUserBodyMap(
  prisma: PrismaClient,
  excludeId: string,
  actorId: string | null,
): Promise<number> {
  const su = await prisma.serviceUser.findFirst({
    where: { deletedAt: null, id: { not: excludeId } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!su) return 0;

  const rightHipPain = mapPlacement({
    recordView: 'front',
    canvasView: 'dual',
    regionId: 'right-hip-front',
    x: 78,
    y: 58,
    bodyView: BodyMapBodyView.FRONT,
    side: BodyMapSide.RIGHT,
    bodyPart: 'Right hip',
  });

  await prisma.bodyMapRecord.create({
    data: {
      serviceUserId: su.id,
      recordType: BodyMapRecordType.PAIN,
      subType: 'Hip discomfort',
      title: 'Right hip pain on movement',
      description: 'Reports aching over right hip when transferring from chair to bed.',
      riskLevel: BodyMapRiskLevel.MEDIUM,
      status: BodyMapRecordStatus.ACTIVE,
      firstNoticedAt: daysAgo(3),
      actionSummary: 'GP aware. Paracetamol regular chart. Physio referral sent.',
      nextReviewAt: daysFromNow(7),
      observationDetails: { painLevel: 4, ...rightHipPain.observationDetails },
      createdById: actorId,
      markers: {
        create: {
          ...rightHipPain.marker,
          markerNumber: 1,
          markerType: BodyMapRecordType.PAIN,
          riskLevel: BodyMapRiskLevel.MEDIUM,
          status: BodyMapRecordStatus.ACTIVE,
          createdById: actorId,
        },
      },
      auditLogs: { create: { action: BodyMapAuditAction.CREATE, actorUserId: actorId } },
    },
  });

  console.log(`  → Secondary SU: ${su.firstName} ${su.lastName} — 1 pain record`);
  return 1;
}

async function syncGovernanceAlerts(prisma: PrismaClient, serviceUserId: string): Promise<void> {
  const records = await prisma.bodyMapRecord.findMany({
    where: {
      serviceUserId,
      status: { notIn: [BodyMapRecordStatus.CLOSED, BodyMapRecordStatus.RESOLVED] },
    },
    select: {
      id: true,
      recordType: true,
      subType: true,
      nextReviewAt: true,
      links: { select: { linkedModule: true } },
    },
  });

  const now = Date.now();
  for (const r of records) {
    if (r.nextReviewAt && r.nextReviewAt.getTime() < now) {
      const existing = await prisma.bodyMapAlert.findFirst({
        where: { bodyMapRecordId: r.id, alertType: 'REVIEW_OVERDUE', dismissedAt: null },
      });
      if (!existing) {
        await prisma.bodyMapAlert.create({
          data: {
            serviceUserId,
            bodyMapRecordId: r.id,
            alertType: 'REVIEW_OVERDUE',
            severity: 'HIGH',
            message: `Review overdue (${r.subType ?? r.recordType})`,
          },
        });
      }
    }

    if (
      (r.recordType === BodyMapRecordType.PRESSURE || r.recordType === BodyMapRecordType.WOUND) &&
      !r.links.some(l => l.linkedModule === BodyMapLinkedModule.CARE_PLAN)
    ) {
      const existing = await prisma.bodyMapAlert.findFirst({
        where: { bodyMapRecordId: r.id, alertType: 'MISSING_CARE_PLAN_LINK', dismissedAt: null },
      });
      if (!existing) {
        await prisma.bodyMapAlert.create({
          data: {
            serviceUserId,
            bodyMapRecordId: r.id,
            alertType: 'MISSING_CARE_PLAN_LINK',
            severity: 'MEDIUM',
            message: 'Wound/pressure record not linked to a care plan',
          },
        });
      }
    }

    if (
      (r.recordType === BodyMapRecordType.INJURY || r.recordType === BodyMapRecordType.SAFEGUARDING) &&
      !r.links.some(l => l.linkedModule === BodyMapLinkedModule.INCIDENT)
    ) {
      const existing = await prisma.bodyMapAlert.findFirst({
        where: { bodyMapRecordId: r.id, alertType: 'MISSING_INCIDENT_LINK', dismissedAt: null },
      });
      if (!existing) {
        await prisma.bodyMapAlert.create({
          data: {
            serviceUserId,
            bodyMapRecordId: r.id,
            alertType: 'MISSING_INCIDENT_LINK',
            severity: 'HIGH',
            message: 'Injury/safeguarding record not linked to an incident',
          },
        });
      }
    }
  }
}

export async function seedBodyMapDemoData(
  prisma: PrismaClient,
  options: SeedBodyMapDemoOptions = {},
): Promise<{ serviceUserId: string; recordCount: number } | null> {
  const su = await resolveTargetServiceUser(prisma, options.serviceUserId);
  if (!su) {
    console.log('  ⚠  No service user found — skipping body map demo seed');
    return null;
  }

  const actorId = await resolveActor(prisma);
  console.log(`  → Body map demo for ${su.firstName} ${su.lastName} (${su.id})`);

  let recordCount = await seedPrimaryServiceUserBodyMap(prisma, su.id, actorId);

  if (options.includeSecondServiceUser !== false) {
    recordCount += await seedSecondaryServiceUserBodyMap(prisma, su.id, actorId);
  }

  await syncGovernanceAlerts(prisma, su.id);

  console.log(`  ✓ Created ${recordCount} body map record(s)`);
  return { serviceUserId: su.id, recordCount };
}

export async function resetAndSeedBodyMapDemo(
  prisma: PrismaClient,
  options: SeedBodyMapDemoOptions = {},
): Promise<{ serviceUserId: string; recordCount: number } | null> {
  console.log('  ── Body map: clear all ──');
  await clearAllBodyMapData(prisma);
  console.log('  ── Body map: seed demo ──');
  return seedBodyMapDemoData(prisma, options);
}
