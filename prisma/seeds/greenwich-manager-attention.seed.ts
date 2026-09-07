/**
 * Greenwich manager-attention caseload: submitted IAs, published care plans
 * with overdue / due-soon reviews, assessment alerts, and in-app notifications
 * for branch managers (Registered Manager + Manager roles at Greenwich).
 *
 * Idempotent. Keyed on SU-GW-* service-user numbers and promotion keys.
 */
import {
  CarePathwayFormType,
  CarePathwayFormVersionStatus,
  InitialAssessmentStatus,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
  type PrismaClient,
} from '@prisma/client'
import { computeAssessmentReviewState } from '../seed-lib/assessment-review-schedule'
import { computeCarePlanReviewState } from '../seed-lib/care-plan-review-schedule'
import { ENTERPRISE_TEMPLATE_NAME } from './initial-assessment-enterprise.seed'

const PROMOTION_PREFIX = 'greenwich-attention:'
const META_FLAG = 'greenwichManagerAttention'

function utcNoonPlusDays(days: number, now = new Date()): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0, 0),
  )
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function consent(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assessmentConsent: {
      consentObtained: true,
      givenBy: 'service_user',
      method: 'verbal',
      consentDate: utcNoonPlusDays(-40).toISOString().slice(0, 10),
      capacityIntact: true,
    },
    ...extra,
  }
}

type PlanSeed = { formName: string; dueInDays: number; lastReviewedDaysAgo: number }
type AssessmentSeed = {
  assessmentKey: string
  title: string
  completedDaysAgo: number
  summary: string
  snapshot: Record<string, unknown>
}

const BY_NUMBER: Record<
  string,
  {
    ia?: { managerReviewRequired: boolean; waterlow?: number; notes: string }
    plans: PlanSeed[]
    assessments: AssessmentSeed[]
  }
> = {
  'SU-GW-01': {
    ia: {
      managerReviewRequired: true,
      waterlow: 16,
      notes: 'Submitted by carer — Waterlow 16 and safeguarding concern. Awaiting RM review.',
    },
    plans: [
      { formName: 'Home Care Plan', dueInDays: -18, lastReviewedDaysAgo: 200 },
      { formName: 'Eating and Drinking', dueInDays: 12, lastReviewedDaysAgo: 170 },
    ],
    assessments: [
      {
        assessmentKey: 'must',
        title: 'MUST',
        completedDaysAgo: 45,
        summary: 'MUST 2 — high risk. Weekly nutrition review overdue.',
        snapshot: consent({ must: { score: 2, riskLevel: 'high' } }),
      },
    ],
  },
  'SU-GW-02': {
    ia: {
      managerReviewRequired: true,
      notes: 'Submitted incomplete for manager sign-off after hospital discharge.',
    },
    plans: [{ formName: 'Physical Health', dueInDays: 8, lastReviewedDaysAgo: 172 }],
    assessments: [
      {
        assessmentKey: 'waterlow',
        title: 'Waterlow',
        completedDaysAgo: 26,
        summary: 'Waterlow 12 — at risk. Monthly review due soon.',
        snapshot: consent({ waterlow: { score: 12 } }),
      },
    ],
  },
  'SU-GW-03': {
    plans: [{ formName: 'Eating and Drinking', dueInDays: -9, lastReviewedDaysAgo: 190 }],
    assessments: [
      {
        assessmentKey: 'falls-screening',
        title: 'Falls screening',
        completedDaysAgo: 40,
        summary: 'Falls screen — monthly review overdue.',
        snapshot: consent({ fallsScreening: { fallOrConcern: true, q6FearOfFalling: true } }),
      },
    ],
  },
  'SU-GW-04': {
    ia: {
      managerReviewRequired: true,
      waterlow: 18,
      notes: 'High Waterlow — manager review required before care activation.',
    },
    plans: [{ formName: 'Physical Health', dueInDays: -32, lastReviewedDaysAgo: 210 }],
    assessments: [
      {
        assessmentKey: 'must',
        title: 'MUST',
        completedDaysAgo: 38,
        summary: 'MUST 1 — medium risk. Weekly nutrition review overdue.',
        snapshot: consent({ must: { score: 1, riskLevel: 'medium' } }),
      },
    ],
  },
  'SU-GW-05': {
    plans: [{ formName: 'Person Centred care plan', dueInDays: 22, lastReviewedDaysAgo: 158 }],
    assessments: [
      {
        assessmentKey: 'waterlow',
        title: 'Waterlow',
        completedDaysAgo: 14,
        summary: 'Waterlow 18 — high risk. Weekly pressure review overdue.',
        snapshot: consent({ waterlow: { score: 18 } }),
      },
    ],
  },
  'SU-GW-06': {
    plans: [{ formName: 'Person Centred care plan', dueInDays: 86, lastReviewedDaysAgo: 90 }],
    assessments: [
      {
        assessmentKey: 'skin-integrity',
        title: 'Skin integrity',
        completedDaysAgo: 5,
        summary: 'Skin integrity check completed recently — next monthly review not yet due.',
        snapshot: consent({
          skinIntegrity: { rows: [{ id: 'sacrum', label: 'Sacrum', right: 'intact', left: 'intact' }] },
        }),
      },
    ],
  },
}

async function resolveRmAndManagers(
  prisma: PrismaClient,
  locationId: string,
): Promise<{ actorId: string; recipientIds: string[] }> {
  const rm = await prisma.user.findFirst({
    where: { email: 'rm.greenwich@careadmin.local', deletedAt: null, isActive: true },
    select: { id: true },
  })
  const managers = await prisma.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      email: { in: ['rm.greenwich@careadmin.local', 'om.greenwich@careadmin.local', 'ops.greenwich@careadmin.local'] },
      OR: [{ userLocations: { some: { locationId } } }, { email: 'rm.greenwich@careadmin.local' }],
    },
    select: { id: true },
  })
  const admin = await prisma.user.findFirst({
    where: { email: { equals: 'admin@careadmin.local', mode: 'insensitive' }, deletedAt: null },
    select: { id: true },
  })
  const actorId = rm?.id ?? admin?.id
  if (!actorId) throw new Error('No Greenwich RM or admin user to attribute manager-attention seed')
  const recipientIds = [...new Set([rm?.id, ...managers.map((m) => m.id)].filter(Boolean))] as string[]
  return { actorId, recipientIds: recipientIds.length ? recipientIds : [actorId] }
}

async function upsertNotification(
  prisma: PrismaClient,
  params: {
    recipientUserIds: string[]
    type: NotificationType
    title: string
    message: string
    module: NotificationModule
    severity: NotificationSeverity
    recordType: string
    recordId: string
    createdById: string
    metadata: Record<string, unknown>
  },
) {
  const existing = await prisma.notification.findFirst({
    where: {
      type: params.type,
      recordType: params.recordType,
      recordId: params.recordId,
    },
    select: { id: true },
  })
  if (existing) return

  await prisma.notification.create({
    data: {
      type: params.type,
      title: params.title,
      message: params.message,
      module: params.module,
      severity: params.severity,
      recordType: params.recordType,
      recordId: params.recordId,
      metadata: params.metadata as Prisma.InputJsonValue,
      createdById: params.createdById,
      recipients: { create: params.recipientUserIds.map((userId) => ({ userId })) },
    },
  })
}

export async function seedGreenwichManagerAttention(prisma: PrismaClient): Promise<void> {
  const users = await prisma.serviceUser.findMany({
    where: { serviceUserNumber: { startsWith: 'SU-GW-' }, deletedAt: null },
    select: {
      id: true,
      serviceUserNumber: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      locationId: true,
    },
  })
  if (!users.length) {
    console.warn('[seed] Greenwich manager attention skipped — no SU-GW-* service users')
    return
  }

  const locationId = users[0].locationId
  if (!locationId) {
    console.warn('[seed] Greenwich manager attention skipped — service users have no locationId')
    return
  }

  const { actorId, recipientIds } = await resolveRmAndManagers(prisma, locationId)
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [{ isDefault: true }, { name: ENTERPRISE_TEMPLATE_NAME }],
    },
    orderBy: { isDefault: 'desc' },
    select: { id: true },
  })

  const created: string[] = []

  for (const su of users) {
    const def = BY_NUMBER[su.serviceUserNumber]
    if (!def) continue
    const display =
      su.preferredName?.trim() || `${su.firstName} ${su.lastName}`.trim() || su.serviceUserNumber

    if (def.ia && template) {
      const existing = await prisma.initialAssessmentSubmission.findFirst({
        where: {
          serviceUserId: su.id,
          deletedAt: null,
          metadata: { path: [META_FLAG], equals: true },
        },
        select: { id: true },
      })
      const metadata = {
        [META_FLAG]: true,
        managerReviewRequired: def.ia.managerReviewRequired,
        ...(def.ia.waterlow != null
          ? { clinical: { waterlow: { score: def.ia.waterlow } } }
          : {}),
      }
      const submission = existing
        ? await prisma.initialAssessmentSubmission.update({
            where: { id: existing.id },
            data: {
              status: InitialAssessmentStatus.SUBMITTED,
              submittedAt: utcNoonPlusDays(-2),
              completedAt: utcNoonPlusDays(-2),
              submittedById: actorId,
              overallNotes: def.ia.notes,
              metadata,
              reviewedAt: null,
              reviewedById: null,
              isActive: true,
              deletedAt: null,
            },
          })
        : await prisma.initialAssessmentSubmission.create({
            data: {
              serviceUserId: su.id,
              templateId: template.id,
              status: InitialAssessmentStatus.SUBMITTED,
              startedAt: utcNoonPlusDays(-5),
              completedAt: utcNoonPlusDays(-2),
              submittedAt: utcNoonPlusDays(-2),
              submittedById: actorId,
              overallNotes: def.ia.notes,
              metadata,
              isActive: true,
              createdById: actorId,
            },
          })

      created.push(`IA SUBMITTED ${display} (${su.serviceUserNumber})`)
      await upsertNotification(prisma, {
        recipientUserIds: recipientIds,
        type: NotificationType.SYSTEM_MESSAGE,
        title: 'Initial assessment — manager review required',
        message: `Initial assessment for ${display} was submitted and requires manager review.`,
        module: NotificationModule.SERVICE_USER,
        severity: NotificationSeverity.WARNING,
        recordType: 'InitialAssessmentSubmission',
        recordId: submission.id,
        createdById: actorId,
        metadata: { serviceUserId: su.id, managerReviewRequired: true },
      })
    }

    for (const plan of def.plans) {
      const form = await prisma.carePathwayForm.findFirst({
        where: { name: plan.formName, formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
        include: {
          versions: {
            where: { status: CarePathwayFormVersionStatus.PUBLISHED },
            orderBy: { versionNumber: 'desc' },
            take: 1,
          },
        },
      })
      if (!form) {
        console.warn(`[seed] Care plan form "${plan.formName}" not found — skip for ${su.serviceUserNumber}`)
        continue
      }
      const nextReviewDueAt = utcNoonPlusDays(plan.dueInDays)
      const lastReviewedAt = utcNoonPlusDays(-plan.lastReviewedDaysAgo)
      const instance = await prisma.serviceUserCarePlanInstance.upsert({
        where: {
          serviceUserId_carePathwayFormId: { serviceUserId: su.id, carePathwayFormId: form.id },
        },
        update: {
          status: 'PUBLISHED',
          carePathwayFormVersionId: form.versions[0]?.id ?? null,
          nextReviewDueAt,
          lastReviewedAt,
          lastReviewedById: actorId,
        },
        create: {
          serviceUserId: su.id,
          carePathwayFormId: form.id,
          carePathwayFormVersionId: form.versions[0]?.id ?? null,
          status: 'PUBLISHED',
          nextReviewDueAt,
          lastReviewedAt,
          lastReviewedById: actorId,
          createdById: actorId,
        },
      })
      const review = computeCarePlanReviewState({
        nextReviewDueAt,
        lastReviewedAt,
        intervalMonths: form.reviewFrequencyMonths,
      })
      created.push(`plan ${review.status} ${plan.formName} · ${display}`)
      if (review.status === 'overdue' || review.status === 'due_soon') {
        await upsertNotification(prisma, {
          recipientUserIds: recipientIds,
          type: NotificationType.CARE_PLAN_REVIEW_DUE,
          title: `Care plan review ${review.status === 'overdue' ? 'overdue' : 'due soon'}: ${plan.formName}`,
          message: `${display} — ${plan.formName} is ${review.status === 'overdue' ? 'overdue' : 'due soon'}. Open the care plan to complete the review.`,
          module: NotificationModule.SERVICE_CARE,
          severity:
            review.status === 'overdue' ? NotificationSeverity.WARNING : NotificationSeverity.INFO,
          recordType: 'ServiceUserCarePlanInstance',
          recordId: instance.id,
          createdById: actorId,
          metadata: { serviceUserId: su.id, reviewStatus: review.status },
        })
      }
    }

    for (const seed of def.assessments) {
      const assessment = await prisma.serviceUserAssessment.upsert({
        where: {
          serviceUserId_assessmentKey: { serviceUserId: su.id, assessmentKey: seed.assessmentKey },
        },
        create: { serviceUserId: su.id, assessmentKey: seed.assessmentKey, title: seed.title },
        update: { title: seed.title },
      })
      const promotionKey = `${PROMOTION_PREFIX}${su.id}:${seed.assessmentKey}`
      const completedAt = utcNoonPlusDays(-seed.completedDaysAgo)
      const existing = await prisma.serviceUserAssessmentCompletion.findFirst({
        where: { promotionKey },
        select: { id: true },
      })
      if (existing) {
        await prisma.serviceUserAssessmentCompletion.update({
          where: { id: existing.id },
          data: {
            completedAt,
            completedById: actorId,
            summary: seed.summary,
            snapshot: seed.snapshot as Prisma.InputJsonValue,
            source: 'MANUAL',
          },
        })
      } else {
        await prisma.serviceUserAssessmentCompletion.create({
          data: {
            assessmentId: assessment.id,
            source: 'MANUAL',
            completedAt,
            completedById: actorId,
            summary: seed.summary,
            snapshot: seed.snapshot as Prisma.InputJsonValue,
            promotionKey,
          },
        })
      }
      const review = computeAssessmentReviewState({
        assessmentKey: seed.assessmentKey,
        lastCompletedAt: completedAt,
        snapshot: seed.snapshot,
      })
      created.push(`assess ${review.status} ${seed.title} · ${display}`)
      if (review.status === 'overdue' || review.status === 'due_soon') {
        await upsertNotification(prisma, {
          recipientUserIds: recipientIds,
          type: NotificationType.ASSESSMENT_DUE_REMINDER,
          title: `Assessment review ${review.status === 'overdue' ? 'overdue' : 'due soon'}: ${seed.title}`,
          message: `${display} — ${seed.title} is ${review.status === 'overdue' ? 'overdue' : 'due soon'}.`,
          module: NotificationModule.SERVICE_CARE,
          severity:
            review.status === 'overdue' ? NotificationSeverity.WARNING : NotificationSeverity.INFO,
          recordType: 'ServiceUserAssessment',
          recordId: assessment.id,
          createdById: actorId,
          metadata: { serviceUserId: su.id, assessmentKey: seed.assessmentKey, reviewStatus: review.status },
        })
      }
    }
  }

  console.log(`[seed] Greenwich manager attention ready (${created.length}):`)
  for (const line of created) console.log(`  - ${line}`)
}
