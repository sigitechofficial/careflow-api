/**
 * Local demo data for /care-plans/reviews and /assessments/review-queue.
 *
 * Updates nextReviewDueAt on existing published care-plan instances (never deletes
 * or unpublishes). Upserts completed ServiceUserAssessment rows for the same SUs.
 *
 *   ./node_modules/.bin/ts-node --transpile-only prisma/scripts/seed-review-demo-data.ts
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { computeCarePlanReviewState } from '../../src/service-user-care-plans/care-plan-review-schedule';
import { computeAssessmentReviewState } from '../../src/service-user-assessments/assessment-review-schedule';
import { filterReviewQueueItems } from '../../src/service-user-assessments/assessment-review-queue.util';

const prisma = new PrismaClient();

const DEMO_PROMOTION_PREFIX = 'demo-review-seed:';

const TARGET_USERS = [
  { firstName: 'Betty', lastName: 'Henderson' },
  { firstName: 'Fatima', lastName: 'Al-Rashid' },
  { firstName: 'Doris', lastName: 'Clarke' },
  { firstName: 'James', lastName: 'Okafor' },
  { firstName: 'Eleanor', lastName: 'Davies' },
  { firstName: 'Michael', lastName: 'Patel' },
] as const;

function utcNoonPlusDays(days: number, now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0, 0));
  d.setUTCDate(d.getUTCDate() + days);
  return d;
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
  };
}

type AssessmentSeed = {
  assessmentKey: string;
  title: string;
  completedDaysAgo: number;
  summary: string;
  snapshot: Record<string, unknown>;
};

type PlanSeed = {
  formName: string;
  dueInDays: number;
  lastReviewedDaysAgo: number;
};

const PLAN_SEEDS: Record<string, PlanSeed[]> = {
  'Betty Henderson': [
    { formName: 'Dementia Care plan', dueInDays: -22, lastReviewedDaysAgo: 200 },
    { formName: 'Cognition and Behaviour', dueInDays: 12, lastReviewedDaysAgo: 170 },
    { formName: 'Eating and Drinking', dueInDays: 86, lastReviewedDaysAgo: 90 },
    { formName: 'Sleeping and Night', dueInDays: 25, lastReviewedDaysAgo: 155 },
  ],
  'Fatima Al-Rashid': [
    { formName: 'Home Support Plan', dueInDays: -48, lastReviewedDaysAgo: 230 },
    { formName: 'Pressure Ulcer', dueInDays: 6, lastReviewedDaysAgo: 175 },
    { formName: 'Skin Integrity', dueInDays: 131, lastReviewedDaysAgo: 50 },
    { formName: 'Culture/Religion/Spirituality', dueInDays: 75, lastReviewedDaysAgo: 105 },
  ],
  'Doris Clarke': [
    { formName: 'Home Care Plan', dueInDays: -9, lastReviewedDaysAgo: 190 },
    { formName: 'Eating and Drinking', dueInDays: 19, lastReviewedDaysAgo: 160 },
    { formName: 'Washing and dressing', dueInDays: 95, lastReviewedDaysAgo: 85 },
    { formName: 'Physical Health', dueInDays: 28, lastReviewedDaysAgo: 152 },
  ],
  'James Okafor': [
    { formName: 'Home Care Plan - needs/goals/support', dueInDays: -32, lastReviewedDaysAgo: 210 },
    { formName: 'Physical Health', dueInDays: 8, lastReviewedDaysAgo: 172 },
    { formName: 'Person Centred care plan', dueInDays: 85, lastReviewedDaysAgo: 95 },
  ],
  'Eleanor Davies': [
    { formName: 'Advance', dueInDays: -67, lastReviewedDaysAgo: 250 },
    { formName: 'Final Days', dueInDays: 2, lastReviewedDaysAgo: 178 },
    { formName: 'Pain Management', dueInDays: 148, lastReviewedDaysAgo: 30 },
    { formName: 'Sleeping and Night', dueInDays: 61, lastReviewedDaysAgo: 120 },
  ],
  'Michael Patel': [
    { formName: 'Dementia Care plan', dueInDays: -5, lastReviewedDaysAgo: 185 },
    { formName: 'Eating and Drinking', dueInDays: 105, lastReviewedDaysAgo: 75 },
    { formName: 'Pain Management', dueInDays: 24, lastReviewedDaysAgo: 156 },
    { formName: 'Physical Health', dueInDays: 122, lastReviewedDaysAgo: 58 },
  ],
};

const ASSESSMENT_SEEDS: Record<string, AssessmentSeed[]> = {
  'Betty Henderson': [
    {
      assessmentKey: 'must',
      title: 'MUST',
      completedDaysAgo: 45,
      summary: 'MUST 2 — high risk. Weight loss and low BMI; weekly nutrition review.',
      snapshot: consent({ must: { score: 2, riskLevel: 'high' } }),
    },
    {
      assessmentKey: 'waterlow',
      title: 'Waterlow',
      completedDaysAgo: 26,
      summary: 'Waterlow 12 — at risk. Monthly community review approaching.',
      snapshot: consent({ waterlow: { score: 12 } }),
    },
    {
      assessmentKey: 'mca-screening',
      title: 'MCA screening',
      completedDaysAgo: 10,
      summary: 'MCA screening completed — repeat when a specific decision arises.',
      snapshot: consent({ mcaScreening: { outcome: 'capacity_intact' } }),
    },
    {
      assessmentKey: 'pain-tool',
      title: 'Pain assessment',
      completedDaysAgo: 12,
      summary: 'Abbey 11 — moderate pain. Elevated weekly review overdue.',
      snapshot: consent({
        painAssessment: {
          scaleUsed: 'abbey',
          abbey: {
            vocalisation: 2,
            facialExpression: 2,
            bodyLanguage: 2,
            behaviouralChange: 2,
            physiologicalChange: 2,
            physicalChanges: 1,
            total: 11,
            severityBand: 'moderate',
          },
        },
      }),
    },
  ],
  'Fatima Al-Rashid': [
    {
      assessmentKey: 'waterlow',
      title: 'Waterlow',
      completedDaysAgo: 14,
      summary: 'Waterlow 18 — high risk. Weekly pressure review overdue.',
      snapshot: consent({ waterlow: { score: 18 } }),
    },
    {
      assessmentKey: 'must',
      title: 'MUST',
      completedDaysAgo: 26,
      summary: 'MUST 0 — low risk. Monthly screen due soon.',
      snapshot: consent({ must: { score: 0, riskLevel: 'low' } }),
    },
    {
      assessmentKey: 'falls-screening',
      title: 'Falls screening',
      completedDaysAgo: 40,
      summary: 'Falls screen completed 40 days ago — monthly review overdue.',
      snapshot: consent({
        fallsScreening: { fallOrConcern: true, q6FearOfFalling: true },
      }),
    },
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
  'Doris Clarke': [
    {
      assessmentKey: 'falls-screening',
      title: 'Falls screening',
      completedDaysAgo: 26,
      summary: 'Falls screen — monthly review due soon.',
      snapshot: consent({ fallsScreening: { fallOrConcern: false } }),
    },
    {
      assessmentKey: 'must',
      title: 'MUST',
      completedDaysAgo: 38,
      summary: 'MUST 1 — medium risk. Weekly nutrition review overdue.',
      snapshot: consent({ must: { score: 1, riskLevel: 'medium' } }),
    },
    {
      assessmentKey: 'pain-tool',
      title: 'Pain assessment',
      completedDaysAgo: 15,
      summary: 'NRS 6 — elevated pain. Weekly review overdue.',
      snapshot: consent({ painAssessment: { scaleUsed: 'nrs', nrsScore: 6 } }),
    },
  ],
  'James Okafor': [
    {
      assessmentKey: 'must',
      title: 'MUST',
      completedDaysAgo: 27,
      summary: 'MUST 0 — low risk. Monthly screen due soon.',
      snapshot: consent({ must: { score: 0, riskLevel: 'low' } }),
    },
    {
      assessmentKey: 'moving-handling',
      title: 'Moving and handling',
      completedDaysAgo: 400,
      summary: 'Moving and handling — annual review overdue.',
      snapshot: consent({
        movingHandlingOperations: { riskFilter: { totallyIndependentLowRisk: true } },
      }),
    },
    {
      assessmentKey: 'pain-tool',
      title: 'Pain assessment',
      completedDaysAgo: 26,
      summary: 'NRS 2 — stable pain. Monthly review due soon.',
      snapshot: consent({ painAssessment: { scaleUsed: 'nrs', nrsScore: 2 } }),
    },
    {
      assessmentKey: 'mental-capacity-checklist',
      title: 'Mental capacity checklist',
      completedDaysAgo: 20,
      summary: 'Formal MCA checklist completed for a recent finance decision.',
      snapshot: consent({ mentalCapacityChecklist: { decision: 'finances', outcome: 'lacks_capacity' } }),
    },
  ],
  'Eleanor Davies': [
    {
      assessmentKey: 'advance-care-planning',
      title: 'Advance care planning',
      completedDaysAgo: 350,
      summary: 'Advance care plan last reviewed ~11.5 months ago — annual review due soon.',
      snapshot: consent({ advanceCarePlanning: { wishesRecorded: true } }),
    },
    {
      assessmentKey: 'pain-tool',
      title: 'Pain assessment',
      completedDaysAgo: 40,
      summary: 'NRS 3 — monthly pain review overdue.',
      snapshot: consent({ painAssessment: { scaleUsed: 'nrs', nrsScore: 3 } }),
    },
    {
      assessmentKey: 'end-of-life-assessment',
      title: 'End of life assessment',
      completedDaysAgo: 18,
      summary: 'End of life assessment completed — review when preferences or symptoms change.',
      snapshot: consent({ endOfLife: { recognised: true } }),
    },
  ],
  'Michael Patel': [
    {
      assessmentKey: 'waterlow',
      title: 'Waterlow',
      completedDaysAgo: 25,
      summary: 'Waterlow 10 — at risk. Monthly review due soon.',
      snapshot: consent({ waterlow: { score: 10 } }),
    },
    {
      assessmentKey: 'therapy-memoire',
      title: 'Therapy aide memoire',
      completedDaysAgo: 200,
      summary: 'Therapy aide memoire — 180-day review overdue.',
      snapshot: consent({ therapyMemoire: { needsReview: true } }),
    },
    {
      assessmentKey: 'photography-consent',
      title: 'Photography consent',
      completedDaysAgo: 40,
      summary: 'Photography consent renewed — next annual review not yet due.',
      snapshot: { photographyConsent: { granted: true, scope: 'care_records' } },
    },
  ],
};

async function requireServiceUser(firstName: string, lastName: string) {
  const su = await prisma.serviceUser.findFirst({
    where: { firstName, lastName, deletedAt: null, isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      locationId: true,
      location: { select: { id: true, name: true } },
    },
  });
  if (!su) {
    throw new Error(`Service user not found: ${firstName} ${lastName}`);
  }
  return su;
}

async function seedCarePlanReviews(
  su: Awaited<ReturnType<typeof requireServiceUser>>,
  adminUserId: string,
) {
  const displayName = `${su.firstName} ${su.lastName}`;
  const seeds = PLAN_SEEDS[displayName] ?? [];
  const updated: Array<{ formName: string; status: string; nextReviewDueAt: string }> = [];

  for (const seed of seeds) {
    const instance = await prisma.serviceUserCarePlanInstance.findFirst({
      where: {
        serviceUserId: su.id,
        status: 'PUBLISHED',
        carePathwayForm: { name: seed.formName },
      },
      select: {
        id: true,
        carePathwayForm: { select: { name: true, reviewFrequencyMonths: true } },
      },
    });
    if (!instance) {
      throw new Error(`Published care plan "${seed.formName}" not found for ${displayName}`);
    }

    const nextReviewDueAt = utcNoonPlusDays(seed.dueInDays);
    const lastReviewedAt = utcNoonPlusDays(-seed.lastReviewedDaysAgo);

    await prisma.serviceUserCarePlanInstance.update({
      where: { id: instance.id },
      data: {
        nextReviewDueAt,
        lastReviewedAt,
        lastReviewedById: adminUserId,
      },
    });

    const review = computeCarePlanReviewState({
      nextReviewDueAt,
      lastReviewedAt,
      intervalMonths: instance.carePathwayForm.reviewFrequencyMonths,
    });
    updated.push({
      formName: instance.carePathwayForm.name,
      status: review.status,
      nextReviewDueAt: nextReviewDueAt.toISOString(),
    });
  }

  return updated;
}

async function seedAssessments(
  su: Awaited<ReturnType<typeof requireServiceUser>>,
  adminUserId: string,
) {
  const displayName = `${su.firstName} ${su.lastName}`;
  const seeds = ASSESSMENT_SEEDS[displayName] ?? [];
  const created: Array<{
    assessmentKey: string;
    title: string;
    status: string;
    nextReviewDueAt: string | null;
  }> = [];

  for (const seed of seeds) {
    const assessment = await prisma.serviceUserAssessment.upsert({
      where: {
        serviceUserId_assessmentKey: {
          serviceUserId: su.id,
          assessmentKey: seed.assessmentKey,
        },
      },
      create: {
        serviceUserId: su.id,
        assessmentKey: seed.assessmentKey,
        title: seed.title,
      },
      update: {
        title: seed.title,
      },
    });

    const promotionKey = `${DEMO_PROMOTION_PREFIX}${su.id}:${seed.assessmentKey}`;
    const completedAt = utcNoonPlusDays(-seed.completedDaysAgo);
    const snapshot = seed.snapshot as Prisma.InputJsonValue;

    const existing = await prisma.serviceUserAssessmentCompletion.findFirst({
      where: { promotionKey },
      select: { id: true },
    });

    if (existing) {
      await prisma.serviceUserAssessmentCompletion.update({
        where: { id: existing.id },
        data: {
          completedAt,
          completedById: adminUserId,
          summary: seed.summary,
          snapshot,
          source: 'MANUAL',
        },
      });
    } else {
      await prisma.serviceUserAssessmentCompletion.create({
        data: {
          assessmentId: assessment.id,
          source: 'MANUAL',
          completedAt,
          completedById: adminUserId,
          summary: seed.summary,
          snapshot,
          promotionKey,
        },
      });
    }

    const review = computeAssessmentReviewState({
      assessmentKey: seed.assessmentKey,
      lastCompletedAt: completedAt,
      snapshot: seed.snapshot,
    });
    created.push({
      assessmentKey: seed.assessmentKey,
      title: seed.title,
      status: review.status,
      nextReviewDueAt: review.nextReviewDueAt,
    });
  }

  return created;
}

async function main() {
  const admin = await prisma.user.findFirst({
    where: { email: { equals: 'admin@careadmin.local', mode: 'insensitive' }, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error('admin@careadmin.local not found');

  console.log('══ Seed review demo data ══');
  console.log('Admin:', admin.email, admin.id);
  console.log('Now (UTC day):', utcNoonPlusDays(0).toISOString().slice(0, 10));

  for (const target of TARGET_USERS) {
    const su = await requireServiceUser(target.firstName, target.lastName);
    const name = `${su.firstName} ${su.lastName}`;
    const location = su.location?.name ?? 'NO LOCATION';
    console.log(`\n── ${name} (${location}) ──`);

    const plans = await seedCarePlanReviews(su, admin.id);
    for (const p of plans) {
      console.log(`  plan  ${p.status.padEnd(10)} ${p.formName}  due ${p.nextReviewDueAt.slice(0, 10)}`);
    }
    const assessments = await seedAssessments(su, admin.id);
    for (const a of assessments) {
      const due = a.nextReviewDueAt ? a.nextReviewDueAt.slice(0, 10) : '—';
      console.log(`  assess ${a.status.padEnd(13)} ${a.title}  due ${due}`);
    }

  }

  const planRows = await prisma.serviceUserCarePlanInstance.findMany({
    where: {
      status: 'PUBLISHED',
      nextReviewDueAt: { not: null },
      serviceUser: { deletedAt: null, isActive: true },
    },
    select: {
      nextReviewDueAt: true,
      lastReviewedAt: true,
      serviceUser: { select: { locationId: true, location: { select: { name: true } } } },
      carePathwayForm: { select: { reviewFrequencyMonths: true } },
    },
  });
  const planItems = planRows.map((row) => ({
    ...computeCarePlanReviewState({
      nextReviewDueAt: row.nextReviewDueAt,
      lastReviewedAt: row.lastReviewedAt,
      intervalMonths: row.carePathwayForm.reviewFrequencyMonths,
    }),
    locationId: row.serviceUser.locationId,
    locationName: row.serviceUser.location?.name ?? null,
  }));

  const countBy = (status: string, locationId?: string) =>
    planItems.filter((i) => i.status === status && (!locationId || i.locationId === locationId)).length;

  console.log('\n══ Care plan review-queue (all published with a due date) ══');
  console.log(
    `all: overdue=${countBy('overdue')} due_soon=${countBy('due_soon')} ok=${countBy('ok')} total=${planItems.length}`,
  );
  const locIds = [...new Set(planItems.map((i) => i.locationId).filter(Boolean))] as string[];
  for (const locId of locIds) {
    const name = planItems.find((i) => i.locationId === locId)?.locationName;
    console.log(
      `  ${name}: overdue=${countBy('overdue', locId)} due_soon=${countBy('due_soon', locId)} ok=${countBy('ok', locId)}`,
    );
  }

  const assessmentRows = await prisma.serviceUserAssessment.findMany({
    include: {
      serviceUser: {
        select: { firstName: true, lastName: true, locationId: true, location: { select: { name: true } } },
      },
      completions: {
        orderBy: { completedAt: 'desc' },
        take: 1,
        select: { completedAt: true, snapshot: true },
      },
    },
  });
  const queueItems = assessmentRows.map((row) => {
    const latest = row.completions[0];
    const snapshot =
      latest?.snapshot && typeof latest.snapshot === 'object' && !Array.isArray(latest.snapshot)
        ? (latest.snapshot as Record<string, unknown>)
        : null;
    const review = computeAssessmentReviewState({
      assessmentKey: row.assessmentKey,
      lastCompletedAt: latest?.completedAt ?? null,
      snapshot,
    });
    return {
      name: `${row.serviceUser.firstName} ${row.serviceUser.lastName}`,
      locationId: row.serviceUser.locationId,
      locationName: row.serviceUser.location?.name ?? null,
      assessmentKey: row.assessmentKey,
      title: row.title,
      review,
      queueReasons: [] as string[],
    };
  });
  const defaultQueue = filterReviewQueueItems(
    queueItems.map((i) => ({
      serviceUserId: '',
      serviceUserName: i.name,
      assessmentId: '',
      assessmentKey: i.assessmentKey,
      assessmentTitle: i.title,
      latestCompletionId: null,
      latestCompletedAt: null,
      review: i.review,
      queueReasons: [],
    })),
    { alertsOnly: true },
  );

  console.log('\n══ Assessment review-queue (alerts only: overdue + due_soon) ══');
  console.log(
    `queue=${defaultQueue.length} overdue=${defaultQueue.filter((i) => i.review.status === 'overdue').length} due_soon=${defaultQueue.filter((i) => i.review.status === 'due_soon').length}`,
  );
  const seededStatuses = queueItems.reduce<Record<string, number>>((acc, i) => {
    acc[i.review.status] = (acc[i.review.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log('all seeded statuses (including those hidden from default queue):', seededStatuses);

  console.log('\nDone. Re-run is idempotent (updates same demo completions / due dates).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
