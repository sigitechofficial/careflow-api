/**
 * Verify care-plan + assessment review queues after seed-review-demo-data.
 * Mirrors GET /service-user-care-plans/review-queue and
 * GET /service-user-assessments/review-queue (including locationId).
 */
import { PrismaClient } from '@prisma/client';
import { computeCarePlanReviewState } from '../../src/service-user-care-plans/care-plan-review-schedule';
import { buildAssessmentReviewQueueItem, filterReviewQueueItems } from '../../src/service-user-assessments/assessment-review-queue.util';

const prisma = new PrismaClient();

const LOCATIONS = [
  { name: 'Haringey - Haringey', id: 'a85a02d6-801a-40a6-a243-6b06edd76cc0' },
  { name: 'Merton - Merton', id: 'c0966ab9-03c2-4549-8560-24b28cf548c1' },
  { name: 'Transport - Croydon Transport', id: '6a0c016d-ba09-4bed-9f56-4df7fb711cf1' },
] as const;

async function carePlanQueue(locationId?: string) {
  const rows = await prisma.serviceUserCarePlanInstance.findMany({
    where: {
      status: 'PUBLISHED',
      nextReviewDueAt: { not: null },
      serviceUser: {
        deletedAt: null,
        isActive: true,
        ...(locationId ? { locationId } : {}),
      },
    },
    select: {
      id: true,
      nextReviewDueAt: true,
      lastReviewedAt: true,
      serviceUser: { select: { firstName: true, lastName: true, location: { select: { name: true } } } },
      carePathwayForm: { select: { name: true, reviewFrequencyMonths: true } },
    },
    orderBy: { nextReviewDueAt: 'asc' },
  });
  const items = rows.map((row) => {
    const review = computeCarePlanReviewState({
      nextReviewDueAt: row.nextReviewDueAt,
      lastReviewedAt: row.lastReviewedAt,
      intervalMonths: row.carePathwayForm.reviewFrequencyMonths,
    });
    return {
      name: `${row.serviceUser.firstName} ${row.serviceUser.lastName}`,
      location: row.serviceUser.location?.name,
      carePlanName: row.carePathwayForm.name,
      status: review.status,
    };
  });
  return {
    total: items.length,
    overdueCount: items.filter((i) => i.status === 'overdue').length,
    dueSoonCount: items.filter((i) => i.status === 'due_soon').length,
    upToDateCount: items.filter((i) => i.status === 'ok').length,
    people: [...new Set(items.map((i) => i.name))],
    items,
  };
}

async function assessmentQueue(locationId?: string) {
  const rows = await prisma.serviceUserAssessment.findMany({
    where: {
      serviceUser: {
        deletedAt: null,
        ...(locationId ? { locationId } : {}),
      },
    },
    include: {
      serviceUser: { select: { firstName: true, lastName: true, preferredName: true } },
      completions: {
        orderBy: { completedAt: 'desc' },
        take: 1,
        select: { id: true, completedAt: true, snapshot: true },
      },
    },
  });
  const items = rows.map((row) => {
    const latest = row.completions[0];
    const snapshot =
      latest?.snapshot && typeof latest.snapshot === 'object' && !Array.isArray(latest.snapshot)
        ? (latest.snapshot as Record<string, unknown>)
        : null;
    return buildAssessmentReviewQueueItem({
      serviceUserId: row.serviceUserId,
      serviceUserName: `${row.serviceUser.firstName} ${row.serviceUser.lastName}`,
      assessmentId: row.id,
      assessmentKey: row.assessmentKey,
      assessmentTitle: row.title,
      latestCompletionId: latest?.id ?? null,
      latestCompletedAt: latest?.completedAt ?? null,
      snapshot,
    });
  });
  const filtered = filterReviewQueueItems(items, { alertsOnly: true });
  return {
    total: filtered.length,
    overdueCount: filtered.filter((i) => i.review.status === 'overdue').length,
    dueSoonCount: filtered.filter((i) => i.review.status === 'due_soon').length,
    people: [...new Set(filtered.map((i) => i.serviceUserName))],
    items: filtered.map((i) => ({
      name: i.serviceUserName,
      title: i.assessmentTitle,
      status: i.review.status,
    })),
  };
}

async function main() {
  const [published, dueNull, assessments, completions, submittedIas] = await Promise.all([
    prisma.serviceUserCarePlanInstance.count({ where: { status: 'PUBLISHED' } }),
    prisma.serviceUserCarePlanInstance.count({
      where: { status: 'PUBLISHED', nextReviewDueAt: null },
    }),
    prisma.serviceUserAssessment.count(),
    prisma.serviceUserAssessmentCompletion.count(),
    prisma.initialAssessmentSubmission.count({ where: { status: 'SUBMITTED' } }),
  ]);

  console.log('=== Integrity ===');
  console.log({ published, publishedStillNullDue: dueNull, assessments, completions, submittedIas });

  const allPlans = await carePlanQueue();
  console.log('\n=== GET /service-user-care-plans/review-queue (all) ===');
  console.log({
    total: allPlans.total,
    overdueCount: allPlans.overdueCount,
    dueSoonCount: allPlans.dueSoonCount,
    upToDateCount: allPlans.upToDateCount,
    people: allPlans.people,
  });

  const allAssess = await assessmentQueue();
  console.log('\n=== GET /service-user-assessments/review-queue (alerts only) ===');
  console.log({
    total: allAssess.total,
    overdueCount: allAssess.overdueCount,
    dueSoonCount: allAssess.dueSoonCount,
    people: allAssess.people,
  });

  console.log('\n=== Header locationId filter ===');
  for (const loc of LOCATIONS) {
    const plans = await carePlanQueue(loc.id);
    const assess = await assessmentQueue(loc.id);
    console.log(loc.name, {
      locationId: loc.id,
      carePlans: {
        total: plans.total,
        overdue: plans.overdueCount,
        dueSoon: plans.dueSoonCount,
        ok: plans.upToDateCount,
        people: plans.people,
      },
      assessments: {
        total: assess.total,
        overdue: assess.overdueCount,
        dueSoon: assess.dueSoonCount,
        people: assess.people,
      },
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
