import {
  MedicationRecordStatus,
  Prisma,
} from '@prisma/client';
import { submissionAnswersForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CarePlanComposeContext,
  CarePlanFormFieldRef,
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
import { loadAboutMeFromReferences } from './about-me-compose-summary.util';
import { buildPersonalisationFromServiceUser } from './care-plan-personalisation.util';
import { iaRoute } from './compose-routes.util';
import {
  findIaAnswer,
  resolveIaDisplayValue,
} from './ia-answer-resolver.util';
import {
  COMPOSE_ELIGIBLE_IA_STATUSES,
  splitLatestAndPreviousAssessments,
  toComposeIaStatus,
} from './compose-ia-eligibility.util';
import type { CarePlanComposeIaSnapshot, CarePlanFallsSnapshotEvidence } from './compose-context.types';

const MEDICATION_FORM_NAME = 'Medication';
const CARE_PLAN_REVIEW_FORM_NAME = 'Care Plan review form';
const MASTER_CARE_PLAN_FORM_NAME = 'Risk Assessment and Care Plan';
const DEMENTIA_CARE_PLAN_FORM_NAME = 'Dementia Care plan';
const PERSON_CENTRED_FORM_NAME = 'Person Centred care plan';
const FALLS_FORM_NAME = 'Falls';
const SKIN_INTEGRITY_FORM_NAME = 'Skin Integrity';

export async function loadCarePlanFormFields(
  prisma: PrismaService,
  formId: string,
): Promise<{ formName: string; fields: CarePlanFormFieldRef[] }> {
  const form = await prisma.carePathwayForm.findFirst({
    where: { id: formId, deletedAt: null },
    select: {
      name: true,
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
    return { formName: form?.name ?? '', fields: [] };
  }

  const fields: CarePlanFormFieldRef[] = [];
  for (const section of form.currentVersion.sections) {
    for (const field of section.fields) {
      fields.push({
        key: `${section.id}:${field.id}`,
        sectionId: section.id,
        fieldId: field.id,
        sectionTitle: section.title,
        label: field.label,
        fieldType: field.fieldType,
        required: field.required,
      });
    }
  }

  return { formName: form.name, fields };
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
      status: { in: COMPOSE_ELIGIBLE_IA_STATUSES },
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
  const [serviceUser, iaBundle, allergies, meds, pack, references, emergencyContacts] = await Promise.all([
    prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, preferredName: true, serviceUserNumber: true },
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
    const gpName = resolveIaDisplayValue(findIaAnswer(ia.answers, { specRef: '13.9', questionTextContains: 'gp name' }));
    const gpPractice = resolveIaDisplayValue(
      findIaAnswer(ia.answers, { specRef: '13.9', questionTextContains: 'gp practice' }),
    );
    const pharmacy = resolveIaDisplayValue(
      findIaAnswer(ia.answers, { specRef: '13.9', questionTextContains: 'pharmacy' }),
    );
    if (gpName) gpParts.push(`GP: ${gpName}`);
    if (gpPractice) gpParts.push(gpPractice);
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
  };
}

export function runCarePlanCompose(
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

  if (formName === SKIN_INTEGRITY_FORM_NAME) {
    return composeSkinIntegrityCarePlan(ctx, fields, ctx.serviceUserId);
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
