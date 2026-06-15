/**
 * Delete all visit plans and scheduling rota data for every service user.
 * Keeps service users, employees, schedule areas (catalog), and all other records.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/clear-visit-plans-and-rota.ts --dry-run
 *   npx ts-node --transpile-only prisma/scripts/clear-visit-plans-and-rota.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function count(label: string, fn: () => Promise<number>): Promise<number> {
  const n = await fn();
  console.log(`  ${label}: ${n}`);
  return n;
}

async function main() {
  console.log(DRY_RUN ? 'Dry run — counts only.\n' : 'Clearing visit plans and rota…\n');

  await count('visitAction', () => prisma.visitAction.count());
  await count('jobAllocation', () => prisma.jobAllocation.count());
  await count('callOffVisit', () => prisma.callOffVisit.count());
  await count('scheduledVisit', () => prisma.scheduledVisit.count());
  await count('scheduledJob', () => prisma.scheduledJob.count());
  await count('scheduleRun', () => prisma.scheduleRun.count());
  await count('scheduleAreaStatus', () => prisma.scheduleAreaStatus.count());
  await count('scheduleBatch', () => prisma.scheduleBatch.count());
  await count('visitPlanAmendment', () => prisma.visitPlanAmendment.count());
  await count('visitPlanSlot', () => prisma.visitPlanSlot.count());
  await count('serviceUserVisitPlan', () => prisma.serviceUserVisitPlan.count());

  if (DRY_RUN) {
    console.log('\nRe-run without --dry-run to delete.');
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      const visitAction = await tx.visitAction.deleteMany();
      console.log(`  Deleted visitAction: ${visitAction.count}`);

      const jobAllocation = await tx.jobAllocation.deleteMany();
      console.log(`  Deleted jobAllocation: ${jobAllocation.count}`);

      const callOffVisit = await tx.callOffVisit.deleteMany();
      console.log(`  Deleted callOffVisit: ${callOffVisit.count}`);

      const scheduledVisit = await tx.scheduledVisit.deleteMany();
      console.log(`  Deleted scheduledVisit: ${scheduledVisit.count}`);

      const scheduledJob = await tx.scheduledJob.deleteMany();
      console.log(`  Deleted scheduledJob: ${scheduledJob.count}`);

      const scheduleRun = await tx.scheduleRun.deleteMany();
      console.log(`  Deleted scheduleRun: ${scheduleRun.count}`);

      const scheduleAreaStatus = await tx.scheduleAreaStatus.deleteMany();
      console.log(`  Deleted scheduleAreaStatus: ${scheduleAreaStatus.count}`);

      const scheduleBatch = await tx.scheduleBatch.deleteMany();
      console.log(`  Deleted scheduleBatch: ${scheduleBatch.count}`);

      const visitPlanAmendment = await tx.visitPlanAmendment.deleteMany();
      console.log(`  Deleted visitPlanAmendment: ${visitPlanAmendment.count}`);

      const visitPlanSlot = await tx.visitPlanSlot.deleteMany();
      console.log(`  Deleted visitPlanSlot: ${visitPlanSlot.count}`);

      const visitPlan = await tx.serviceUserVisitPlan.deleteMany();
      console.log(`  Deleted serviceUserVisitPlan: ${visitPlan.count}`);
    },
    { timeout: 120_000 },
  );

  console.log('\nDone — service users and schedule area catalog were kept.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
