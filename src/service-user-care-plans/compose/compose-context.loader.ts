import {
  InitialAssessmentRiskLevel,
  MedicationRecordStatus,
  Prisma,
} from '@prisma/client';
import { submissionAnswersForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import { buildLoneWorkerRiskDraft } from '../../initial-assessments/initial-assessment-lone-worker-risk.util';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CarePlanComposeContext,
  CarePlanComposeIaSnapshot,
  CarePlanCommunicationSnapshotEvidence,
  CarePlanContinenceSnapshotEvidence,
  CarePlanEatingDrinkingSnapshotEvidence,
  CarePlanFallsSnapshotEvidence,
  CarePlanFormFieldRef,
  CarePlanMedicationSnapshotEvidence,
  CarePlanPersonalSafetySnapshotEvidence,
  CarePlanSkinIntegritySnapshotEvidence,
  ComposePlanResult,
} from './compose-context.types';
import { buildEmarComposeSummary } from './emar-compose-summary.util';
import { buildMedicationPackComposeSummary } from './medication-pack-compose-summary.util';
import {
  composeMedicationCarePlan,
  MEDICATION_CARE_PLAN_FIELD_MAPPINGS,
} from './medication-care-plan.compose';
import { composeCarePlanReviewForm } from './care-plan-review.compose';
import { composeMasterCarePlan } from './master-care-plan.compose';
import { composeDementiaCarePlan } from './dementia-care-plan.compose';
import {
  composeFallsCarePlan,
  composePersonCentredCarePlan,
  composeSkinIntegrityCarePlan,
} from './area-care-plans.compose';
import {
  composeCommunicationCarePlan,
  composeContinenceCarePlan,
  composeEatingDrinkingCarePlan,
  composePersonalSafetyCarePlan,
} from './remaining-area-care-plans.compose';
import { loadAboutMeFromReferences } from './about-me-compose-summary.util';
import { buildPersonalisationFromServiceUser } from './care-plan-personalisation.util';
import { iaRoute } from './compose-routes.util';
import { attachCare2020NeedsGoalsSuggestions } from './care-2020-needs-goals.suggestions';
import {
  findIaAnswer,
  resolveIaDisplayValue,
} from './ia-answer-resolver.util';
import {
  COMPOSE_IA_LOAD_STATUSES,
  splitLatestAndPreviousAssessments,
  toComposeIaStatus,
} from './compose-ia-eligibility.util';
import { readAdlMetadataFromSubmissionMetadata } from './compose-adl-metadata.util';
import { readWaterlowFromSubmissionMetadata } from './compose-waterlow-metadata.util';
import { readPainAssessmentFromSubmissionMetadata } from './compose-pain-assessment-metadata.util';
import {
  composePressureUlcerCarePlan,
  PRESSURE_ULCER_CARE_PLAN_FORM_NAME,
} from './pressure-ulcer-care-plan.compose';
import {
  composeSleepingNightCarePlan,
  SLEEPING_NIGHT_CARE_PLAN_FORM_NAME,
} from './sleeping-night-care-plan.compose';
import {
  composeWashingDressingCarePlan,
  WASHING_DRESSING_CARE_PLAN_FORM_NAME,
} from './washing-dressing-care-plan.compose';
import {
  composeHomeSupportPlanHybrid,
  HOME_SUPPORT_PLAN_FORM_NAME,
} from './home-support-plan.compose';
import {
  composeHomeCarePlanHybrid,
  HOME_CARE_PLAN_FORM_NAME,
} from './home-care-plan.compose';
import {
  composeAdvanceCarePlan,
  ADVANCE_CARE_PLAN_FORM_NAME,
} from './advance-care-plan.compose';
import {
  composeCognitionBehaviourCarePlan,
  COGNITION_BEHAVIOUR_CARE_PLAN_FORM_NAME,
} from './cognition-behaviour-care-plan.compose';
import {
  composeCultureReligionCarePlan,
  CULTURE_RELIGION_CARE_PLAN_FORM_NAME,
} from './culture-religion-care-plan.compose';
import {
  composeFinalDaysCarePlan,
  FINAL_DAYS_CARE_PLAN_FORM_NAME,
} from './final-days-care-plan.compose';
import {
  composePainManagementCarePlan,
  PAIN_MANAGEMENT_CARE_PLAN_FORM_NAME,
} from './pain-management-care-plan.compose';
import {
  composePsychologicalCarePlan,
  PSYCHOLOGICAL_CARE_PLAN_FORM_NAME,
} from './psychological-care-plan.compose';

const MEDICATION_FORM_NAME = 'Medication';
const CARE_PLAN_REVIEW_FORM_NAME = 'Care Plan review form';
const MASTER_CARE_PLAN_FORM_NAME = 'Risk Assessment and Care Plan';
const DEMENTIA_CARE_PLAN_FORM_NAME = 'Dementia Care plan';
const PERSON_CENTRED_FORM_NAME = 'Person Centred care plan';
const FALLS_FORM_NAME = 'Falls';
const SKIN_INTEGRITY_FORM_NAME = 'Skin Integrity';
const CONTINENCE_FORM_NAME = 'Continence';
const EATING_DRINKING_FORM_NAME = 'Eating and Drinking';
const PERSONAL_SAFETY_FORM_NAME = 'Personal Safety';
const COMMUNICATION_FORM_NAME = 'Communication';

export async function loadCarePlanFormFields(
  prisma: PrismaService,
  formId: string,
): Promise<{ formName: string; fields: CarePlanFormFieldRef[]; reviewFrequencyMonths: number | null }> {
  const form = await prisma.carePathwayForm.findFirst({
    where: { id: formId, deletedAt: null },
    select: {
      name: true,
      reviewFrequencyMonths: true,
      currentVersion: {
        select: {
          sections: {
            where: { deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              title: true,
              fields: {
                where: { deletedAt: null, isActive: true },
                orderBy: { sortOrder: 'asc' },
                select: {
                  id: true,
                  fieldKey: true,
                  label: true,
                  fieldType: true,
                  required: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!form?.currentVersion) {
    return { formName: form?.name ?? '', fields: [], reviewFrequencyMonths: form?.reviewFrequencyMonths ?? null };
  }

  const fields: CarePlanFormFieldRef[] = [];
  for (const section of form.currentVersion.sections) {
    for (const field of section.fields) {
      fields.push({
        key: `${section.id}:${field.id}`,
        sectionId: section.id,
        fieldId: field.id,
        fieldKey: field.fieldKey,
        sectionTitle: section.title,
        label: field.label,
        fieldType: field.fieldType,
        required: field.required,
      });
    }
  }

  return { formName: form.name, fields, reviewFrequencyMonths: form.reviewFrequencyMonths ?? null };
}

function caseFindingReasonsOf(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const reasons = (raw as { reasons?: unknown }).reasons;
  return Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === 'string') : [];
}

function readFallsSnapshot(metadata: Prisma.JsonValue | null | undefined): CarePlanFallsSnapshotEvidence | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const falls = (metadata as Record<string, unknown>).falls;
  if (!falls || typeof falls !== 'object' || Array.isArray(falls)) return null;
  const row = falls as Record<string, unknown>;
  return {
    fallsLast12Months: typeof row.fallsLast12Months === 'boolean' ? row.fallsLast12Months : null,
    numberOfFalls: typeof row.numberOfFalls === 'number' ? row.numberOfFalls : null,
    mostRecentFallDate: typeof row.mostRecentFallDate === 'string' ? row.mostRecentFallDate : null,
    injuryCaused: typeof row.injuryCaused === 'boolean' ? row.injuryCaused : null,
    riskScore: typeof row.riskScore === 'number' ? row.riskScore : null,
    riskLevel: typeof row.riskLevel === 'string' ? row.riskLevel : null,
    caseFindingReasons: caseFindingReasonsOf(row.caseFinding),
  };
}

function readMedicationSnapshot(
  metadata: Prisma.JsonValue | null | undefined,
): CarePlanMedicationSnapshotEvidence | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const medication = (metadata as Record<string, unknown>).medication;
  if (!medication || typeof medication !== 'object' || Array.isArray(medication)) return null;
  const row = medication as Record<string, unknown>;
  return {
    supportLevel: typeof row.supportLevel === 'string' ? row.supportLevel : null,
    allergyDetails: typeof row.allergyDetails === 'string' ? row.allergyDetails : null,
    currentMedicationDetails:
      typeof row.currentMedicationDetails === 'string' ? row.currentMedicationDetails : null,
    prnProtocol: typeof row.prnProtocol === 'string' ? row.prnProtocol : null,
    packagingHelpRequired:
      typeof row.packagingHelpRequired === 'boolean' ? row.packagingHelpRequired : null,
    storageNotes: typeof row.storageNotes === 'string' ? row.storageNotes : null,
    safetyNotes: typeof row.safetyNotes === 'string' ? row.safetyNotes : null,
  };
}

function readStringField(row: Record<string, unknown>, key: string): string | null {
  return typeof row[key] === 'string' ? (row[key] as string) : null;
}

function readBooleanField(row: Record<string, unknown>, key: string): boolean | null {
  return typeof row[key] === 'boolean' ? (row[key] as boolean) : null;
}

function readContinenceSnapshot(
  metadata: Prisma.JsonValue | null | undefined,
): CarePlanContinenceSnapshotEvidence | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const continence = (metadata as Record<string, unknown>).continence;
  if (!continence || typeof continence !== 'object' || Array.isArray(continence)) return null;
  const row = continence as Record<string, unknown>;
  return {
    bladderStatus: readStringField(row, 'bladderStatus'),
    bowelStatus: readStringField(row, 'bowelStatus'),
    productsUsed: readStringField(row, 'productsUsed'),
    toiletingRoutine: readStringField(row, 'toiletingRoutine'),
    fluidGuidance: readStringField(row, 'fluidGuidance'),
    skinCareAfterEpisodes: readStringField(row, 'skinCareAfterEpisodes'),
  };
}

function readEatingDrinkingSnapshot(
  metadata: Prisma.JsonValue | null | undefined,
): CarePlanEatingDrinkingSnapshotEvidence | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const eating = (metadata as Record<string, unknown>).eatingDrinking;
  if (!eating || typeof eating !== 'object' || Array.isArray(eating)) return null;
  const row = eating as Record<string, unknown>;
  const fluidTargetMl =
    typeof row.fluidTargetMl === 'number'
      ? String(row.fluidTargetMl)
      : readStringField(row, 'fluidTargetMl');
  return {
    dietType: readStringField(row, 'dietType'),
    fluidTargetMl,
    foodAllergiesIntolerances: readStringField(row, 'foodAllergiesIntolerances'),
    mealAssistanceLevel: readStringField(row, 'mealAssistanceLevel'),
    chokingSaltGuidance: readStringField(row, 'chokingSaltGuidance'),
    preferredFoodsDislikes: readStringField(row, 'preferredFoodsDislikes'),
  };
}

function readSkinIntegritySnapshot(
  metadata: Prisma.JsonValue | null | undefined,
): CarePlanSkinIntegritySnapshotEvidence | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const skin = (metadata as Record<string, unknown>).skinIntegrity;
  if (!skin || typeof skin !== 'object' || Array.isArray(skin)) return null;
  const row = skin as Record<string, unknown>;
  return {
    skinTypeIssues: readStringField(row, 'skinTypeIssues'),
    emollientsCreams: readStringField(row, 'emollientsCreams'),
    previousPressureDamage: readBooleanField(row, 'previousPressureDamage'),
    creamApplication: readStringField(row, 'creamApplication'),
    signsToReport: readStringField(row, 'signsToReport'),
  };
}

function riskLevelWord(level: InitialAssessmentRiskLevel): string {
  if (level === InitialAssessmentRiskLevel.HIGH) return 'High';
  if (level === InitialAssessmentRiskLevel.MEDIUM) return 'Medium';
  return 'Low';
}

export function readPersonalSafetySnapshot(
  metadata: Prisma.JsonValue | null | undefined,
): CarePlanPersonalSafetySnapshotEvidence | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const safety = (metadata as Record<string, unknown>).personalSafety;
  const row: Record<string, unknown> =
    safety && typeof safety === 'object' && !Array.isArray(safety)
      ? (safety as Record<string, unknown>)
      : {};

  let loneWorkerRisk = readStringField(row, 'loneWorkerRisk');
  let actionsInPlace = readStringField(row, 'actionsInPlace');

  // Fallback: derive from the Environment Assessment "Lone Worker & Staff Safety"
  // block so the level + control measures flow into the Personal Safety care plan
  // even when no explicit personalSafety snapshot was written.
  const envRaw = (metadata as Record<string, unknown>).environmentAssessment;
  const env =
    envRaw && typeof envRaw === 'object' && !Array.isArray(envRaw)
      ? (envRaw as Record<string, unknown>)
      : null;
  if (env) {
    if (!loneWorkerRisk) {
      const draft = buildLoneWorkerRiskDraft({ questions: [], answers: [], metadata });
      if (draft) loneWorkerRisk = riskLevelWord(draft.riskLevel);
    }
    if (
      !actionsInPlace &&
      typeof env.staffSafetyInstructions === 'string' &&
      env.staffSafetyInstructions.trim()
    ) {
      actionsInPlace = env.staffSafetyInstructions.trim();
    }
  }

  const snapshot: CarePlanPersonalSafetySnapshotEvidence = {
    homeHazards: readStringField(row, 'homeHazards'),
    fireSafety: readStringField(row, 'fireSafety'),
    loneWorkerRisk,
    safeguardingOnFile: readBooleanField(row, 'safeguardingOnFile'),
    actionsInPlace,
    emergencyContacts: readStringField(row, 'emergencyContacts'),
  };

  // Preserve prior behaviour: no personal-safety evidence at all → null.
  const hasAny =
    snapshot.homeHazards != null ||
    snapshot.fireSafety != null ||
    snapshot.loneWorkerRisk != null ||
    snapshot.safeguardingOnFile != null ||
    snapshot.actionsInPlace != null ||
    snapshot.emergencyContacts != null;
  return hasAny ? snapshot : null;
}

function readCommunicationSnapshot(
  metadata: Prisma.JsonValue | null | undefined,
): CarePlanCommunicationSnapshotEvidence | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const communication = (metadata as Record<string, unknown>).communication;
  if (!communication || typeof communication !== 'object' || Array.isArray(communication)) {
    return null;
  }
  const row = communication as Record<string, unknown>;
  return {
    preferredLanguage: readStringField(row, 'preferredLanguage'),
    hearingImpairment: readBooleanField(row, 'hearingImpairment'),
    visionImpairment: readBooleanField(row, 'visionImpairment'),
    communicationMethod: readStringField(row, 'communicationMethod'),
    staffGuidance: readStringField(row, 'staffGuidance'),
    aids: readStringField(row, 'aids'),
    consentSharing: readBooleanField(row, 'consentSharing'),
  };
}

function readFallsScreeningSummary(metadata: Prisma.JsonValue | null | undefined): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const screening = (metadata as Record<string, unknown>).fallsScreening;
  if (!screening || typeof screening !== 'object' || Array.isArray(screening)) return null;
  const row = screening as Record<string, unknown>;
  const parts: string[] = [];
  if (row.q6FearOfFalling === true) parts.push('Fear of falling recorded');
  if (row.q5TrippingMore === true) parts.push('Tripping more often');
  if (row.q1FallsNeedInvestigating === true) parts.push('Falls need investigating');
  if (parts.length === 0 && row.fallOrConcern === true) parts.push('Fall or concern recorded');
  return parts.length > 0 ? parts.join('; ') : 'Falls screening completed';
}

function readEquipmentSelectionSummary(metadata: Prisma.JsonValue | null | undefined): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const equipment = (metadata as Record<string, unknown>).equipmentSelection;
  if (!equipment || typeof equipment !== 'object' || Array.isArray(equipment)) return null;
  const row = equipment as Record<string, unknown>;
  const selected =
    typeof row.selectedEquipment === 'string' ? row.selectedEquipment.trim() : '';
  if (!selected) return null;
  const risk =
    typeof row.selectedRiskLevel === 'string' ? row.selectedRiskLevel.trim() : '';
  return risk ? `Equipment selection (${risk}): ${selected}` : `Equipment selection: ${selected}`;
}

const iaAnswerInclude = {
  question: {
    select: {
      questionText: true,
      metadata: true,
      section: {
        select: {
          sectionNumber: true,
          title: true,
          carePlanArea: true,
        },
      },
    },
  },
} as const;

async function loadComposeIaSnapshots(
  prisma: PrismaService,
  serviceUserId: string,
): Promise<{ latest: CarePlanComposeIaSnapshot | null; previous: CarePlanComposeIaSnapshot[] }> {
  const rows = await prisma.initialAssessmentSubmission.findMany({
    where: {
      serviceUserId,
      deletedAt: null,
      status: { in: COMPOSE_IA_LOAD_STATUSES },
    },
    select: { id: true, submittedAt: true, updatedAt: true, status: true, metadata: true },
  });
  const { latest, previous } = splitLatestAndPreviousAssessments(rows);
  const ids = [latest, ...previous].filter(Boolean).map((row) => row!.id);
  if (ids.length === 0) return { latest: null, previous: [] };

  const answerRows = await prisma.initialAssessmentAnswer.findMany({
    where: { submissionId: { in: ids } },
    include: iaAnswerInclude,
  });
  const answersBySubmission = new Map<string, typeof answerRows>();
  for (const row of answerRows) {
    const list = answersBySubmission.get(row.submissionId) ?? [];
    list.push(row);
    answersBySubmission.set(row.submissionId, list);
  }

  const toSnapshot = (row: NonNullable<typeof latest>): CarePlanComposeIaSnapshot | null => {
    const status = toComposeIaStatus(row.status);
    if (!status) return null;
    const mapped = (answersBySubmission.get(row.id) ?? []).map((a) => ({
      questionId: a.questionId,
      checked: a.checked,
      booleanValue: a.booleanValue,
      textValue: a.textValue,
      selectedOptions: a.selectedOptions as Prisma.JsonValue,
      numberValue: a.numberValue,
      dateValue: a.dateValue,
      question: a.question,
    }));
    return {
      submissionId: row.id,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      status,
      answers: submissionAnswersForRules(mapped),
      fallsSnapshot: readFallsSnapshot(row.metadata),
      fallsScreeningSummary: readFallsScreeningSummary(row.metadata),
      equipmentSelectionSummary: readEquipmentSelectionSummary(row.metadata),
      medicationSnapshot: readMedicationSnapshot(row.metadata),
      continenceSnapshot: readContinenceSnapshot(row.metadata),
      eatingDrinkingSnapshot: readEatingDrinkingSnapshot(row.metadata),
      skinIntegritySnapshot: readSkinIntegritySnapshot(row.metadata),
      personalSafetySnapshot: readPersonalSafetySnapshot(row.metadata),
      communicationSnapshot: readCommunicationSnapshot(row.metadata),
      adlMetadata: readAdlMetadataFromSubmissionMetadata(row.metadata),
      waterlowMetadata: readWaterlowFromSubmissionMetadata(row.metadata),
      painAssessmentMetadata: readPainAssessmentFromSubmissionMetadata(row.metadata),
    };
  };

  return {
    latest: latest ? toSnapshot(latest) : null,
    previous: previous.map(toSnapshot).filter((s): s is CarePlanComposeIaSnapshot => Boolean(s)),
  };
}

export async function loadCarePlanComposeContext(
  prisma: PrismaService,
  serviceUserId: string,
): Promise<CarePlanComposeContext> {
  const [serviceUser, iaBundle, allergies, meds, pack, references, emergencyContacts, legalDocument] =
    await Promise.all([
    prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        serviceUserNumber: true,
        dateOfBirth: true,
        phone: true,
        mobile: true,
        address: {
          select: {
            addressLine1: true,
            addressLine2: true,
            town: true,
            county: true,
            postcode: true,
            accessInstructions: true,
            keySafeNumber: true,
          },
        },
      },
    }),
    loadComposeIaSnapshots(prisma, serviceUserId),
    prisma.serviceUserAllergy.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
      select: { allergyName: true, comment: true },
      orderBy: { allergyName: 'asc' },
    }),
    prisma.serviceUserMedication.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
      select: {
        medicationName: true,
        medicationKind: true,
        status: true,
        dose: true,
        strength: true,
      },
    }),
    prisma.medicationPack.findFirst({
      where: { serviceUserId, deletedAt: null, isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        packType: true,
        cycleNumber: true,
        pharmacyName: true,
        pharmacyPhone: true,
        gpName: true,
        gpSurgery: true,
      },
    }),
    prisma.serviceUserReference.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
      select: { referenceType: true, referenceValue: true },
    }),
    prisma.serviceUserContact.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true, isEmergencyContact: true },
      select: { firstName: true, lastName: true, phone: true, mobile: true, relationshipType: { select: { name: true } } },
      orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
      take: 6,
    }),
    prisma.serviceUserLegalDocument.findFirst({
      where: { serviceUserId, isActive: true },
      select: {
        dnacprInPlace: true,
        dnacprStatusConfirmation: true,
        dnacprPhysicalLocation: true,
        dnacprStartDate: true,
      },
    }),
  ]);

  const displayName = serviceUser
    ? [serviceUser.firstName, serviceUser.lastName].filter(Boolean).join(' ').trim() ||
      serviceUser.preferredName ||
      'Service user'
    : 'Service user';

  const ia = iaBundle.latest;
  const previousAssessments = iaBundle.previous;

  const gpParts: string[] = [];
  if (ia) {
    const gpContact = resolveIaDisplayValue(
      findIaAnswer(ia.answers, { fieldKey: 'gpContactDetails' }),
    );
    const pharmacy = resolveIaDisplayValue(
      findIaAnswer(ia.answers, { specRef: '13.9', questionTextContains: 'pharmacy' }),
    );
    if (gpContact) gpParts.push(gpContact);
    if (pharmacy) gpParts.push(`Pharmacy: ${pharmacy}`);
  }

  return {
    serviceUserId,
    serviceUserName: displayName,
    personalisation: buildPersonalisationFromServiceUser({
      firstName: serviceUser?.firstName ?? null,
      lastName: serviceUser?.lastName ?? null,
      preferredName: serviceUser?.preferredName ?? null,
      serviceUserNumber: serviceUser?.serviceUserNumber ?? null,
    }),
    ia,
    previousAssessments,
    aboutMe: loadAboutMeFromReferences(references),
    emergencyContacts: emergencyContacts.map((c) => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
      const phone = c.mobile?.trim() || c.phone?.trim();
      const rel = c.relationshipType?.name;
      return [name, rel, phone].filter(Boolean).join(' · ');
    }),
    allergies: allergies.map((a) => {
      const comment = a.comment?.trim();
      return comment ? `${a.allergyName} — ${comment}` : a.allergyName;
    }),
    emar: buildEmarComposeSummary(
      meds.map((m) => ({
        medicationName: m.medicationName,
        medicationKind: m.medicationKind,
        status: m.status as MedicationRecordStatus,
        dose: m.dose,
        strength: m.strength,
      })),
    ),
    pack: pack ? buildMedicationPackComposeSummary(pack) : null,
    gpPharmacyLine: gpParts.length > 0 ? gpParts.join('\n') : null,
    profile: serviceUser
      ? {
          preferredName: serviceUser.preferredName?.trim() || null,
          dateOfBirth: serviceUser.dateOfBirth
            ? serviceUser.dateOfBirth.toISOString().slice(0, 10)
            : null,
          phone: serviceUser.mobile?.trim() || serviceUser.phone?.trim() || null,
          homeAddress: (() => {
            const a = serviceUser.address;
            if (!a) return null;
            const line = [a.addressLine1, a.addressLine2, a.town, a.county, a.postcode]
              .map((p) => p?.trim())
              .filter(Boolean)
              .join('\n');
            return line || null;
          })(),
          propertyAccessInstructions: (() => {
            const a = serviceUser.address;
            if (!a) return null;
            const parts = [
              a.accessInstructions?.trim() || null,
              a.keySafeNumber?.trim() ? `Key safe: ${a.keySafeNumber.trim()}` : null,
            ].filter(Boolean);
            return parts.length > 0 ? parts.join('\n') : null;
          })(),
        }
      : null,
    legalDocument: legalDocument
      ? {
          dnacprInPlace: legalDocument.dnacprInPlace,
          dnacprStatusConfirmation: String(legalDocument.dnacprStatusConfirmation),
          dnacprPhysicalLocation: legalDocument.dnacprPhysicalLocation ?? null,
          dnacprStartDate: legalDocument.dnacprStartDate
            ? legalDocument.dnacprStartDate.toISOString()
            : null,
        }
      : null,
  };
}

export function runCarePlanCompose(
  formName: string,
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
): ComposePlanResult {
  const result = runCarePlanComposeCore(formName, ctx, fields);
  return attachCare2020NeedsGoalsSuggestions(formName, ctx, fields, result);
}

function runCarePlanComposeCore(
  formName: string,
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
): ComposePlanResult {
  if (formName === MEDICATION_FORM_NAME) {
    return composeMedicationCarePlan(ctx, fields, MEDICATION_CARE_PLAN_FIELD_MAPPINGS, ctx.serviceUserId);
  }

  if (formName === CARE_PLAN_REVIEW_FORM_NAME) {
    return composeCarePlanReviewForm(ctx, fields, ctx.serviceUserId);
  }

  if (formName === MASTER_CARE_PLAN_FORM_NAME) {
    return composeMasterCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === DEMENTIA_CARE_PLAN_FORM_NAME) {
    return composeDementiaCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === PERSON_CENTRED_FORM_NAME) {
    return composePersonCentredCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === FALLS_FORM_NAME) {
    return composeFallsCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === HOME_SUPPORT_PLAN_FORM_NAME) {
    return composeHomeSupportPlanHybrid(ctx, fields, ctx.serviceUserId);
  }

  if (formName === HOME_CARE_PLAN_FORM_NAME) {
    return composeHomeCarePlanHybrid(ctx, fields, ctx.serviceUserId);
  }

  if (formName === ADVANCE_CARE_PLAN_FORM_NAME) {
    return composeAdvanceCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === COGNITION_BEHAVIOUR_CARE_PLAN_FORM_NAME) {
    return composeCognitionBehaviourCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === CULTURE_RELIGION_CARE_PLAN_FORM_NAME) {
    return composeCultureReligionCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === FINAL_DAYS_CARE_PLAN_FORM_NAME) {
    return composeFinalDaysCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === PAIN_MANAGEMENT_CARE_PLAN_FORM_NAME) {
    return composePainManagementCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === PSYCHOLOGICAL_CARE_PLAN_FORM_NAME) {
    return composePsychologicalCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === SKIN_INTEGRITY_FORM_NAME) {
    return composeSkinIntegrityCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === CONTINENCE_FORM_NAME) {
    return composeContinenceCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === EATING_DRINKING_FORM_NAME) {
    return composeEatingDrinkingCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === PERSONAL_SAFETY_FORM_NAME) {
    return composePersonalSafetyCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === COMMUNICATION_FORM_NAME) {
    return composeCommunicationCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === PRESSURE_ULCER_CARE_PLAN_FORM_NAME) {
    return composePressureUlcerCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === SLEEPING_NIGHT_CARE_PLAN_FORM_NAME) {
    return composeSleepingNightCarePlan(ctx, fields, ctx.serviceUserId);
  }

  if (formName === WASHING_DRESSING_CARE_PLAN_FORM_NAME) {
    return composeWashingDressingCarePlan(ctx, fields, ctx.serviceUserId);
  }

  return {
    values: {},
    fieldSources: {},
    gaps: [],
    evidence: ctx.ia
      ? [
          {
            id: 'ia-submission',
            source: 'ia',
            label: 'Initial Assessment',
            value: ctx.ia.submittedAt
              ? `Submitted ${ctx.ia.submittedAt.slice(0, 10)}`
              : 'Submitted assessment on file',
          route: iaRoute(ctx.serviceUserId),
          },
        ]
      : [],
    composedFrom: {
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      composedAt: new Date().toISOString(),
      mapping: 'generic',
    },
  };
}
