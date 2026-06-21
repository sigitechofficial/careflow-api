/**
 * Seed service user personas for scheduling QA.
 * Reuses patterns from initial-assessment-demo-service-user.seed.ts and demo-service-user-data.seed.ts.
 *
 * Idempotent — keyed on serviceUserNumber (SU-TEST-P01 … P13).
 * Spec: docs/test-data/SERVICE_USER_PERSONAS.md
 */

import {
  CarePathwayFormType,
  CarePathwayFormVersionStatus,
  Prisma,
  VisitPlanScheduleFrequency,
  VisitPlanSlotCarerRole,
  VisitPlanSlotKind,
  VisitPlanStatus,
  type PrismaClient,
} from '@prisma/client';
import {
  inferBranchFromAddress,
  loadBranchAreasForInference,
} from './service-user-branch-inference.util';
import { seedDemoServiceUserData } from './demo-service-user-data.seed';
import { SERVICE_USER_PERSONAS, type ServiceUserPersona } from './service-user-personas.data';

export type SeedServiceUserPersonasOptions = {
  /** Limit to specific persona codes, e.g. ['SU-P01'] */
  onlyCodes?: string[];
  /** Skip demo clinical enrichment (medications, observations, etc.) for SU-P10 */
  skipDemoClinicalSeed?: boolean;
};

type LookupCache = {
  titles: Map<string, string>;
  genders: Map<string, string>;
  statuses: Map<string, string>;
  careTypes: Map<string, string>;
  riskLevels: Map<string, string>;
  suFundingTypes: Map<string, string>;
  fundingTypes: Map<string, string>;
  relationships: Map<string, string>;
  medTypes: Map<string, string>;
  medRoutes: Map<string, string>;
  medCategories: Map<string, string>;
  medFrequencies: Map<string, string>;
  liveInServiceTypes: Map<string, string>;
  liveInLevels: Map<string, string>;
  liveInScanTypes: Map<string, string>;
};

async function buildLookupCache(prisma: PrismaClient): Promise<LookupCache> {
  const [
    titles,
    genders,
    statuses,
    careTypes,
    riskLevels,
    suFundingTypes,
    fundingTypes,
    relationships,
    medTypes,
    medRoutes,
    medCategories,
    medFrequencies,
    liveInServiceTypes,
    liveInLevels,
    liveInScanTypes,
  ] = await Promise.all([
    prisma.serviceUserTitle.findMany({ where: { isActive: true } }),
    prisma.serviceUserGender.findMany({ where: { isActive: true } }),
    prisma.serviceUserStatus.findMany({ where: { isActive: true } }),
    prisma.serviceUserCareType.findMany({ where: { isActive: true } }),
    prisma.serviceUserRiskLevel.findMany({ where: { isActive: true } }),
    prisma.serviceUserFundingType.findMany({ where: { isActive: true } }),
    prisma.fundingType.findMany({ where: { deletedAt: null, isActive: true } }),
    prisma.relationshipType.findMany({ where: { isActive: true } }),
    prisma.medicationType.findMany({ where: { isActive: true } }),
    prisma.medicationRoute.findMany({ where: { isActive: true } }),
    prisma.medicationCategory.findMany({ where: { isActive: true } }),
    prisma.medicationFrequency.findMany({ where: { isActive: true } }),
    prisma.liveInServiceType.findMany({ where: { isActive: true, deletedAt: null } }),
    prisma.liveInLevelOfCare.findMany({ where: { isActive: true, deletedAt: null } }),
    prisma.liveInScanType.findMany({ where: { isActive: true, deletedAt: null } }),
  ]);

  const toMap = <T extends { code: string; id: string }>(rows: T[]) =>
    new Map(rows.map((r) => [r.code, r.id]));

  return {
    titles: toMap(titles),
    genders: toMap(genders),
    statuses: toMap(statuses),
    careTypes: toMap(careTypes),
    riskLevels: toMap(riskLevels),
    suFundingTypes: toMap(suFundingTypes),
    fundingTypes: toMap(fundingTypes),
    relationships: toMap(relationships),
    medTypes: toMap(medTypes),
    medRoutes: toMap(medRoutes),
    medCategories: toMap(medCategories),
    medFrequencies: toMap(medFrequencies),
    liveInServiceTypes: toMap(liveInServiceTypes),
    liveInLevels: toMap(liveInLevels),
    liveInScanTypes: toMap(liveInScanTypes),
  };
}

function personaNotes(persona: ServiceUserPersona): string {
  return `[PERSONA:${persona.code}] Test persona for scheduling QA — see docs/test-data/SERVICE_USER_PERSONAS.md`;
}

async function upsertCoreServiceUser(
  prisma: PrismaClient,
  persona: ServiceUserPersona,
  lookups: LookupCache,
): Promise<string> {
  const existing = await prisma.serviceUser.findFirst({
    where: { serviceUserNumber: persona.serviceUserNumber, deletedAt: null },
  });

  const data = {
    firstName: persona.firstName,
    lastName: persona.lastName,
    preferredName: persona.preferredName ?? null,
    dateOfBirth: new Date(persona.dateOfBirth),
    nhsNumber: persona.nhsNumber,
    phone: persona.phone ?? null,
    mobile: persona.mobile ?? null,
    email: persona.email ?? null,
    serviceStartDate: persona.serviceStartDate ? new Date(persona.serviceStartDate) : null,
    serviceEndDate: persona.serviceEndDate ? new Date(persona.serviceEndDate) : null,
    titleId: persona.titleCode ? lookups.titles.get(persona.titleCode) ?? null : null,
    genderId: lookups.genders.get(persona.genderCode) ?? null,
    statusId: lookups.statuses.get(persona.statusCode) ?? null,
    careTypeId: lookups.careTypes.get(persona.careTypeCode) ?? null,
    riskLevelId: persona.riskLevelCode ? lookups.riskLevels.get(persona.riskLevelCode) ?? null : null,
    fundingTypeId: persona.suFundingTypeCode
      ? lookups.suFundingTypes.get(persona.suFundingTypeCode) ?? null
      : null,
    notes: personaNotes(persona),
    isActive: persona.statusCode !== 'DISCHARGED' && persona.statusCode !== 'DECEASED',
    deletedAt: null,
  };

  const serviceUser = existing
    ? await prisma.serviceUser.update({ where: { id: existing.id }, data })
    : await prisma.serviceUser.create({
        data: { ...data, serviceUserNumber: persona.serviceUserNumber },
      });

  return serviceUser.id;
}

async function upsertAddress(prisma: PrismaClient, serviceUserId: string, persona: ServiceUserPersona) {
  const { address } = persona;
  await prisma.serviceUserAddress.upsert({
    where: { serviceUserId },
    update: {
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      town: address.town,
      county: address.county ?? null,
      country: 'United Kingdom',
      postcode: address.postcode,
      latitude: new Prisma.Decimal(address.latitude),
      longitude: new Prisma.Decimal(address.longitude),
      accessInstructions: address.accessInstructions ?? null,
      keySafeNumber: address.keySafeNumber ?? null,
      isActive: true,
      deletedAt: null,
    },
    create: {
      serviceUserId,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      town: address.town,
      county: address.county ?? null,
      country: 'United Kingdom',
      postcode: address.postcode,
      latitude: new Prisma.Decimal(address.latitude),
      longitude: new Prisma.Decimal(address.longitude),
      accessInstructions: address.accessInstructions ?? null,
      keySafeNumber: address.keySafeNumber ?? null,
    },
  });
}

async function upsertContacts(
  prisma: PrismaClient,
  serviceUserId: string,
  persona: ServiceUserPersona,
  lookups: LookupCache,
) {
  for (const contact of persona.contacts ?? []) {
    const existing = await prisma.serviceUserContact.findFirst({
      where: {
        serviceUserId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        deletedAt: null,
      },
    });
    const data = {
      relationshipTypeId: lookups.relationships.get(contact.relationshipCode) ?? null,
      phone: contact.phone ?? null,
      mobile: contact.mobile ?? null,
      isPrimary: contact.isPrimary ?? false,
      isEmergencyContact: contact.isEmergencyContact ?? false,
      canReceiveUpdates: contact.canReceiveUpdates ?? false,
      notes: contact.notes ?? null,
      isActive: true,
    };
    if (existing) {
      await prisma.serviceUserContact.update({ where: { id: existing.id }, data });
    } else {
      await prisma.serviceUserContact.create({
        data: {
          serviceUserId,
          firstName: contact.firstName,
          lastName: contact.lastName,
          ...data,
        },
      });
    }
  }
}

async function upsertDomCare(prisma: PrismaClient, serviceUserId: string, persona: ServiceUserPersona) {
  if (!persona.domCare) return;
  const dc = persona.domCare;
  await prisma.serviceUserDomCare.upsert({
    where: { serviceUserId },
    update: {
      numberOfCarers: dc.numberOfCarers,
      weeklyContractedHours: dc.weeklyContractedHours ?? null,
      doorCode: dc.doorCode ?? null,
      accessInstruction: dc.accessInstruction ?? '',
      accessRisks: dc.accessRisks ?? '',
      careInstructions: dc.careInstructions ?? '',
      isActive: true,
      deletedAt: null,
    },
    create: {
      serviceUserId,
      numberOfCarers: dc.numberOfCarers,
      weeklyContractedHours: dc.weeklyContractedHours ?? null,
      doorCode: dc.doorCode ?? null,
      accessInstruction: dc.accessInstruction ?? '',
      accessRisks: dc.accessRisks ?? '',
      careInstructions: dc.careInstructions ?? '',
    },
  });
}

async function upsertLiveIn(prisma: PrismaClient, serviceUserId: string, persona: ServiceUserPersona, lookups: LookupCache) {
  if (!persona.liveIn) return;
  const li = persona.liveIn;
  await prisma.serviceUserLiveInProfile.upsert({
    where: { serviceUserId },
    update: {
      isLiveInEnabled: true,
      serviceTypeId: lookups.liveInServiceTypes.get(li.serviceTypeCode) ?? null,
      levelOfCareId: lookups.liveInLevels.get(li.levelOfCareCode) ?? null,
      scanTypeId: li.scanTypeCode ? lookups.liveInScanTypes.get(li.scanTypeCode) ?? null : null,
      numberOfCarers: persona.domCare?.numberOfCarers ?? 1,
      careInstructions: li.careInstructions ?? null,
      status: 'ACTIVE',
      startDate: persona.serviceStartDate ? new Date(persona.serviceStartDate) : new Date(),
      isActive: true,
      deletedAt: null,
    },
    create: {
      serviceUserId,
      isLiveInEnabled: true,
      serviceTypeId: lookups.liveInServiceTypes.get(li.serviceTypeCode) ?? null,
      levelOfCareId: lookups.liveInLevels.get(li.levelOfCareCode) ?? null,
      scanTypeId: li.scanTypeCode ? lookups.liveInScanTypes.get(li.scanTypeCode) ?? null : null,
      numberOfCarers: persona.domCare?.numberOfCarers ?? 1,
      careInstructions: li.careInstructions ?? null,
      status: 'ACTIVE',
      startDate: persona.serviceStartDate ? new Date(persona.serviceStartDate) : new Date(),
    },
  });
}

async function upsertFundingLine(
  prisma: PrismaClient,
  serviceUserId: string,
  persona: ServiceUserPersona,
  lookups: LookupCache,
) {
  if (!persona.fundingLineTypeCode) return;
  const fundingTypeId = lookups.fundingTypes.get(persona.fundingLineTypeCode);
  if (!fundingTypeId) return;

  const existing = await prisma.serviceUserFunding.findFirst({
    where: { serviceUserId, fundingTypeId, deletedAt: null, isPrimary: true },
  });

  const data = {
    status: 'APPROVED' as const,
    isPrimary: true,
    isActive: true,
    startDate: persona.serviceStartDate ? new Date(persona.serviceStartDate) : new Date(),
    endDate: persona.serviceEndDate ? new Date(persona.serviceEndDate) : null,
    packageName: `${persona.code} package`,
    notes: personaNotes(persona),
  };

  let fundingId: string;
  if (existing) {
    await prisma.serviceUserFunding.update({ where: { id: existing.id }, data });
    fundingId = existing.id;
  } else {
    const created = await prisma.serviceUserFunding.create({
      data: { serviceUserId, fundingTypeId, ...data },
    });
    fundingId = created.id;
  }

  await prisma.serviceUser.update({
    where: { id: serviceUserId },
    data: { currentFundingId: fundingId },
  });
}

async function upsertLegacyIa(prisma: PrismaClient, serviceUserId: string, persona: ServiceUserPersona) {
  if (!persona.legacyIa) return;
  const ia = persona.legacyIa;
  await prisma.serviceUserInitialAssessment.upsert({
    where: { serviceUserId },
    update: {
      numberOfCarers: ia.numberOfCarers ?? persona.domCare?.numberOfCarers ?? 1,
      likesToBeKnownAs: ia.likesToBeKnownAs ?? persona.preferredName ?? persona.firstName,
      reasonForAdmission: ia.reasonForAdmission ?? '',
      previousMedicalHistory: ia.previousMedicalHistory ?? '',
      careInstructions: ia.careInstructions ?? persona.domCare?.careInstructions ?? '',
      accessInstruction: ia.accessInstruction ?? persona.address.accessInstructions ?? '',
      accessRisks: ia.accessRisks ?? persona.domCare?.accessRisks ?? '',
      isActive: true,
      deletedAt: null,
    },
    create: {
      serviceUserId,
      numberOfCarers: ia.numberOfCarers ?? persona.domCare?.numberOfCarers ?? 1,
      likesToBeKnownAs: ia.likesToBeKnownAs ?? persona.preferredName ?? persona.firstName,
      reasonForAdmission: ia.reasonForAdmission ?? '',
      previousMedicalHistory: ia.previousMedicalHistory ?? '',
      careInstructions: ia.careInstructions ?? persona.domCare?.careInstructions ?? '',
      accessInstruction: ia.accessInstruction ?? persona.address.accessInstructions ?? '',
      accessRisks: ia.accessRisks ?? persona.domCare?.accessRisks ?? '',
    },
  });
}

async function resolveSeedEmployeeIds(prisma: PrismaClient, count: number): Promise<string[]> {
  const rows = await prisma.employee.findMany({
    where: { deletedAt: null, personalDetail: { is: { deletedAt: null } } },
    take: count,
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function upsertVisitPlan(prisma: PrismaClient, serviceUserId: string, persona: ServiceUserPersona) {
  if (persona.skipVisitPlan || !persona.visitPlan) return;

  const vp = persona.visitPlan;
  let plan = await prisma.serviceUserVisitPlan.findFirst({
    where: { serviceUserId, status: VisitPlanStatus.ACTIVE, deletedAt: null },
  });

  if (!plan) {
    plan = await prisma.serviceUserVisitPlan.create({
      data: {
        serviceUserId,
        status: VisitPlanStatus.ACTIVE,
        effectiveFrom: persona.serviceStartDate ? new Date(persona.serviceStartDate) : new Date(),
        effectiveTo: persona.serviceEndDate ? new Date(persona.serviceEndDate) : null,
        weeklyContractedHours: vp.weeklyContractedHours ?? null,
        numberOfCarers: vp.numberOfCarers,
        notes: vp.notes ?? personaNotes(persona),
        approvedAt: new Date(),
      },
    });
  } else {
    await prisma.serviceUserVisitPlan.update({
      where: { id: plan.id },
      data: {
        weeklyContractedHours: vp.weeklyContractedHours ?? null,
        numberOfCarers: vp.numberOfCarers,
        notes: vp.notes ?? personaNotes(persona),
        effectiveTo: persona.serviceEndDate ? new Date(persona.serviceEndDate) : null,
      },
    });
  }

  for (let i = 0; i < vp.slots.length; i++) {
    const slot = vp.slots[i];
    const slotKind =
      slot.slotKind === 'OVERNIGHT'
        ? VisitPlanSlotKind.OVERNIGHT
        : slot.slotKind === 'ONE_OFF'
          ? VisitPlanSlotKind.ONE_OFF
          : VisitPlanSlotKind.STANDARD;

    const slotData = {
      daysOfWeek: slot.daysOfWeek,
      plannedStartTime: slot.plannedStartTime,
      plannedEndTime: slot.plannedEndTime,
      requiredCarers: slot.requiredCarers,
      isEnabled: true,
      medicationRoundCode: slot.slotCode,
      notes: slot.notes ?? '',
      sortOrder: i,
      scheduleFrequency:
        slot.scheduleFrequency === 'WEEKLY'
          ? VisitPlanScheduleFrequency.WEEKLY
          : slot.scheduleFrequency === 'MONTHLY'
            ? VisitPlanScheduleFrequency.MONTHLY
            : VisitPlanScheduleFrequency.DAILY,
      timeCritical: slot.timeCritical ?? false,
      timeToleranceMinutes: slot.timeToleranceMinutes ?? 30,
      slotKind,
      durationMinutes: slot.durationMinutes ?? null,
      slotEffectiveFrom: slot.slotEffectiveFrom ? new Date(slot.slotEffectiveFrom) : null,
      slotEffectiveTo: slot.slotEffectiveTo ? new Date(slot.slotEffectiveTo) : null,
      allowBackfillDays: slot.allowBackfillDays ?? 0,
      isActive: true,
    };

    const persisted = await prisma.visitPlanSlot.upsert({
      where: { visitPlanId_slotCode: { visitPlanId: plan.id, slotCode: slot.slotCode } },
      update: slotData,
      create: {
        visitPlanId: plan.id,
        slotCode: slot.slotCode,
        ...slotData,
      },
    });

    if (slot.carerDurationsMinutes?.length) {
      const employeeIds = await resolveSeedEmployeeIds(prisma, slot.carerDurationsMinutes.length);
      await prisma.visitPlanSlotCarerAssignment.deleteMany({ where: { visitPlanSlotId: persisted.id } });
      for (let c = 0; c < slot.carerDurationsMinutes.length; c++) {
        const employeeId = employeeIds[c];
        if (!employeeId) continue;
        await prisma.visitPlanSlotCarerAssignment.create({
          data: {
            visitPlanSlotId: persisted.id,
            dayOfWeek: null,
            employeeId,
            role: c === 0 ? VisitPlanSlotCarerRole.LEAD : VisitPlanSlotCarerRole.SECONDARY,
            durationMinutes: slot.carerDurationsMinutes[c],
            sortOrder: c,
          },
        });
      }
    }
  }
}

async function upsertMedications(
  prisma: PrismaClient,
  serviceUserId: string,
  persona: ServiceUserPersona,
  lookups: LookupCache,
) {
  const routeOral = lookups.medRoutes.get('ORAL');
  const typeTablet = lookups.medTypes.get('TABLET');

  for (const med of persona.medications ?? []) {
    const existing = await prisma.serviceUserMedication.findFirst({
      where: {
        serviceUserId,
        medicationName: med.medicationName,
        strength: med.strength,
        deletedAt: null,
      },
    });
    if (existing) continue;

    await prisma.serviceUserMedication.create({
      data: {
        serviceUserId,
        medicationName: med.medicationName,
        strength: med.strength,
        dose: med.dose,
        startDate: persona.serviceStartDate ? new Date(persona.serviceStartDate) : new Date(),
        medicationTypeId: typeTablet ?? null,
        routeId: routeOral ?? null,
        categoryId: lookups.medCategories.get(med.categoryCode) ?? null,
        frequencyId: lookups.medFrequencies.get(med.frequencyCode) ?? null,
        frequencyText: med.frequencyText,
        instructions: med.instructions ?? null,
        medicationKind: med.kind,
        status: 'ACTIVE',
        isActive: true,
      },
    });
  }
}

async function upsertCarePlans(prisma: PrismaClient, serviceUserId: string, formNames: string[]) {
  for (const name of formNames) {
    const form = await prisma.carePathwayForm.findFirst({
      where: { name, formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
      include: {
        versions: {
          where: { status: CarePathwayFormVersionStatus.PUBLISHED },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    });
    if (!form) continue;

    await prisma.serviceUserCarePlanInstance.upsert({
      where: {
        serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId: form.id },
      },
      update: {
        status: 'PUBLISHED',
        carePathwayFormVersionId: form.versions[0]?.id ?? null,
      },
      create: {
        serviceUserId,
        carePathwayFormId: form.id,
        carePathwayFormVersionId: form.versions[0]?.id ?? null,
        status: 'PUBLISHED',
      },
    });
  }
}

async function upsertAllergies(prisma: PrismaClient, serviceUserId: string, names: string[]) {
  for (const allergyName of names) {
    const existing = await prisma.serviceUserAllergy.findFirst({
      where: { serviceUserId, allergyName, deletedAt: null },
    });
    if (existing) continue;
    await prisma.serviceUserAllergy.create({
      data: { serviceUserId, allergyName, comment: 'Documented in persona seed.', isActive: true },
    });
  }
}

async function upsertFlashMessage(prisma: PrismaClient, serviceUserId: string, message: string) {
  const existing = await prisma.serviceUserFlashMessage.findFirst({
    where: { serviceUserId, isCurrent: true, deletedAt: null },
  });
  if (existing) {
    await prisma.serviceUserFlashMessage.update({
      where: { id: existing.id },
      data: { message, status: 'ACTIVE' },
    });
    return;
  }
  await prisma.serviceUserFlashMessage.create({
    data: {
      serviceUserId,
      message,
      displayUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      status: 'ACTIVE',
      isCurrent: true,
      isActive: true,
    },
  });
}

async function upsertLegal(prisma: PrismaClient, serviceUserId: string, dnacpr: boolean) {
  await prisma.serviceUserLegalDocument.upsert({
    where: { serviceUserId },
    update: { dnacprInPlace: dnacpr, dnacprStartDate: dnacpr ? new Date() : null },
    create: {
      serviceUserId,
      dnacprInPlace: dnacpr,
      dnacprStartDate: dnacpr ? new Date() : null,
    },
  });
}

async function upsertBranchFromAddress(prisma: PrismaClient, serviceUserId: string, persona: ServiceUserPersona) {
  const branchAreas = await loadBranchAreasForInference(prisma);
  const match = inferBranchFromAddress(persona.address, branchAreas);
  if (!match) return;

  await prisma.serviceUser.update({
    where: { id: serviceUserId },
    data: { locationId: match.locationId },
  });

  const assignment = await prisma.serviceUserAssignment.findFirst({
    where: { serviceUserId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
  });
  if (assignment) {
    await prisma.serviceUserAssignment.update({
      where: { id: assignment.id },
      data: { locationId: match.locationId },
    });
    return;
  }

  const su = await prisma.serviceUser.findUnique({ where: { id: serviceUserId } });
  await prisma.serviceUserAssignment.create({
    data: {
      serviceUserId,
      locationId: match.locationId,
      keyWorkerId: su?.keyWorkerId ?? null,
      namedNurseId: su?.namedNurseId ?? null,
    },
  });
}

async function seedOnePersona(
  prisma: PrismaClient,
  persona: ServiceUserPersona,
  lookups: LookupCache,
  options: SeedServiceUserPersonasOptions,
): Promise<string> {
  const serviceUserId = await upsertCoreServiceUser(prisma, persona, lookups);
  await upsertAddress(prisma, serviceUserId, persona);
  await upsertBranchFromAddress(prisma, serviceUserId, persona);
  await upsertContacts(prisma, serviceUserId, persona, lookups);
  await upsertDomCare(prisma, serviceUserId, persona);
  await upsertLiveIn(prisma, serviceUserId, persona, lookups);
  await upsertFundingLine(prisma, serviceUserId, persona, lookups);
  await upsertLegacyIa(prisma, serviceUserId, persona);
  await upsertVisitPlan(prisma, serviceUserId, persona);
  await upsertMedications(prisma, serviceUserId, persona, lookups);
  if (persona.carePlanFormNames?.length) {
    await upsertCarePlans(prisma, serviceUserId, persona.carePlanFormNames);
  }
  if (persona.allergies?.length) {
    await upsertAllergies(prisma, serviceUserId, persona.allergies);
  }
  if (persona.flashMessage) {
    await upsertFlashMessage(prisma, serviceUserId, persona.flashMessage);
  }
  if (persona.dnacpr) {
    await upsertLegal(prisma, serviceUserId, true);
  }

  if (persona.useDemoClinicalSeed && !options.skipDemoClinicalSeed) {
    await seedDemoServiceUserData(prisma, {
      serviceUserId,
      skipObservationsIfAny: true,
    });
  }

  return serviceUserId;
}

export async function seedServiceUserPersonas(
  prisma: PrismaClient,
  options: SeedServiceUserPersonasOptions = {},
): Promise<Map<string, string>> {
  const lookups = await buildLookupCache(prisma);
  const personas = options.onlyCodes?.length
    ? SERVICE_USER_PERSONAS.filter((p) => options.onlyCodes!.includes(p.code))
    : SERVICE_USER_PERSONAS;

  console.log(`[seed] Service user personas: seeding ${personas.length} profile(s)…`);
  const ids = new Map<string, string>();

  for (const persona of personas) {
    const id = await seedOnePersona(prisma, persona, lookups, options);
    ids.set(persona.code, id);
    console.log(`  ✓ ${persona.code} ${persona.firstName} ${persona.lastName} (${persona.serviceUserNumber})`);
  }

  const withVisitPlans = personas.filter((p) => p.visitPlan && !p.skipVisitPlan).length;
  console.log(
    `[seed] Service user personas complete — ${ids.size} users, ${withVisitPlans} with active visit plans.`,
  );
  return ids;
}
