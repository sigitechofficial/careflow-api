import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PREFIX = 'SU-TEST-';

async function main() {
  const suFilter = { serviceUserNumber: { startsWith: PREFIX }, deletedAt: null };

  const [
    activeVisitPlans,
    enabledSlots,
    scheduledJobs,
    scheduledVisits,
    personaBatches,
    scheduleRuns,
    jobAllocations,
    jobsOnRun,
  ] = await Promise.all([
    prisma.serviceUserVisitPlan.count({
      where: { status: 'ACTIVE', deletedAt: null, serviceUser: suFilter },
    }),
    prisma.visitPlanSlot.count({
      where: { isEnabled: true, visitPlan: { status: 'ACTIVE', serviceUser: suFilter } },
    }),
    prisma.scheduledJob.count({ where: { deletedAt: null, serviceUser: suFilter } }),
    prisma.scheduledVisit.count({ where: { deletedAt: null, serviceUser: suFilter } }),
    prisma.scheduleBatch.count({
      where: {
        deletedAt: null,
        jobs: { some: { deletedAt: null, serviceUser: suFilter } },
      },
    }),
    prisma.scheduleRun.count({
      where: { deletedAt: null, description: { startsWith: 'PERSONA_RUN:' } },
    }),
    prisma.jobAllocation.count({
      where: { deletedAt: null, scheduledJob: { serviceUser: suFilter } },
    }),
    prisma.scheduledJob.count({
      where: { deletedAt: null, serviceUser: suFilter, scheduleRunId: { not: null } },
    }),
  ]);

  const runs = await prisma.scheduleRun.findMany({
    where: { deletedAt: null, description: { startsWith: 'PERSONA_RUN:' } },
    orderBy: [{ runDate: 'asc' }, { sortOrder: 'asc' }],
    take: 12,
    select: { runDate: true, name: true, _count: { select: { jobs: true } } },
  });

  const batches = await prisma.scheduleBatch.findMany({
    where: {
      deletedAt: null,
      jobs: { some: { deletedAt: null, serviceUser: suFilter } },
    },
    orderBy: { scheduleDate: 'asc' },
    select: { scheduleDate: true, status: true, _count: { select: { jobs: true } } },
  });

  console.log('Persona scheduling summary');
  console.log('  Active visit plans:', activeVisitPlans);
  console.log('  Enabled visit plan slots:', enabledSlots);
  console.log('  Scheduled jobs (rota):', scheduledJobs);
  console.log('  Scheduled visits:', scheduledVisits);
  console.log('  Schedule batches:', personaBatches);
  console.log('  Schedule runs (carer rota routes):', scheduleRuns);
  console.log('  Jobs linked to a carer run:', jobsOnRun);
  console.log('  Job allocations:', jobAllocations);
  console.log('');
  if (runs.length) {
    console.log('Sample carer runs:');
    for (const r of runs) {
      console.log(`  ${r.runDate.toISOString().slice(0, 10)} ${r.name} — ${r._count.jobs} job(s)`);
    }
    console.log('');
  }
  console.log('Jobs by day:');
  for (const b of batches) {
    const d = b.scheduleDate.toISOString().slice(0, 10);
    console.log(`  ${d} — batch ${b.status}, ${b._count.jobs} persona job(s)`);
  }
}

main().finally(() => prisma.$disconnect());
