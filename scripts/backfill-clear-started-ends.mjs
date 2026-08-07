/**
 * One-time repair: IN_PROGRESS / STARTED visits must not keep actual end times.
 * Also reset ECM evaluation checkout + lifecycle so live tiles match workspace.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const jobs = await prisma.scheduledJob.findMany({
  where: {
    deletedAt: null,
    isActive: true,
    OR: [
      { status: 'IN_PROGRESS' },
      {
        visits: {
          some: {
            deletedAt: null,
            isActive: true,
            status: 'STARTED',
          },
        },
      },
    ],
  },
  select: {
    id: true,
    status: true,
    jobName: true,
    visits: {
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        status: true,
        actualStartDateTime: true,
        actualEndDateTime: true,
      },
    },
    allocations: {
      where: { deletedAt: null, unallocatedAt: null },
      select: {
        id: true,
        actualStartDateTime: true,
        actualEndDateTime: true,
      },
    },
    ecmEvaluation: {
      select: {
        id: true,
        lifecycleStatus: true,
        actualCheckOutAt: true,
      },
    },
  },
});

let clearedVisits = 0;
let clearedAllocs = 0;
let clearedEvals = 0;

for (const job of jobs) {
  const visitIdsWithEnd = job.visits
    .filter((v) => v.actualEndDateTime != null)
    .map((v) => v.id);
  if (visitIdsWithEnd.length) {
    const r = await prisma.scheduledVisit.updateMany({
      where: { id: { in: visitIdsWithEnd } },
      data: { actualEndDateTime: null },
    });
    clearedVisits += r.count;
  }

  const allocIdsWithEnd = job.allocations
    .filter((a) => a.actualEndDateTime != null)
    .map((a) => a.id);
  if (allocIdsWithEnd.length) {
    const r = await prisma.jobAllocation.updateMany({
      where: { id: { in: allocIdsWithEnd } },
      data: { actualEndDateTime: null },
    });
    clearedAllocs += r.count;
  }

  if (job.ecmEvaluation) {
    await prisma.ecmVisitEvaluation.update({
      where: { id: job.ecmEvaluation.id },
      data: {
        actualCheckOutAt: null,
        actualDurationMinutes: null,
        endVarianceMinutes: null,
        durationVarianceMinutes: null,
        departureClassification: 'NOT_ASSESSED',
        durationClassification: 'NOT_ASSESSED',
        lifecycleStatus: 'IN_PROGRESS',
      },
    });
    clearedEvals += 1;
  }
}

console.log(
  JSON.stringify(
    {
      jobsScanned: jobs.length,
      clearedVisits,
      clearedAllocs,
      clearedEvals,
      sample: jobs.slice(0, 5).map((j) => ({
        id: j.id,
        status: j.status,
        jobName: j.jobName,
        visitStatuses: j.visits.map((v) => v.status),
        hadVisitEnd: j.visits.some((v) => v.actualEndDateTime != null),
        hadAllocEnd: j.allocations.some((a) => a.actualEndDateTime != null),
        ecmWas: j.ecmEvaluation?.lifecycleStatus ?? null,
      })),
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
