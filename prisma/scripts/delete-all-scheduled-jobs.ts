/**
 * Hard-delete all rota visits (scheduled jobs + related records).
 * Keeps visit plans, service users, employees, and schedule area catalog.
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/delete-all-scheduled-jobs.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const counts = {
    visitAction: await prisma.visitAction.count(),
    jobAllocation: await prisma.jobAllocation.count(),
    callOffVisit: await prisma.callOffVisit.count(),
    scheduledVisit: await prisma.scheduledVisit.count(),
    scheduledJob: await prisma.scheduledJob.count(),
    scheduleRun: await prisma.scheduleRun.count(),
    scheduleAreaStatus: await prisma.scheduleAreaStatus.count(),
    scheduleBatch: await prisma.scheduleBatch.count(),
  };

  console.log('Before delete:');
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key}: ${value}`);
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const visitAction = await tx.visitAction.deleteMany();
      const jobAllocation = await tx.jobAllocation.deleteMany();
      const callOffVisit = await tx.callOffVisit.deleteMany();
      const scheduledVisit = await tx.scheduledVisit.deleteMany();
      const scheduledJob = await tx.scheduledJob.deleteMany();
      const scheduleRun = await tx.scheduleRun.deleteMany();
      const scheduleAreaStatus = await tx.scheduleAreaStatus.deleteMany();
      const scheduleBatch = await tx.scheduleBatch.deleteMany();
      return {
        visitAction: visitAction.count,
        jobAllocation: jobAllocation.count,
        callOffVisit: callOffVisit.count,
        scheduledVisit: scheduledVisit.count,
        scheduledJob: scheduledJob.count,
        scheduleRun: scheduleRun.count,
        scheduleAreaStatus: scheduleAreaStatus.count,
        scheduleBatch: scheduleBatch.count,
      };
    },
    { timeout: 120_000 },
  );

  console.log('\nDeleted:');
  for (const [key, value] of Object.entries(result)) {
    console.log(`  ${key}: ${value}`);
  }

  const remainingJobs = await prisma.scheduledJob.count();
  const remainingVisits = await prisma.scheduledVisit.count();
  console.log(`\nRemaining scheduledJob: ${remainingJobs}`);
  console.log(`Remaining scheduledVisit: ${remainingVisits}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
