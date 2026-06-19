/**
 * Soft-delete all schedule runs and unlink jobs (jobs become run-less / unassigned on board).
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/delete-all-schedule-runs.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const activeRuns = await prisma.scheduleRun.count({ where: { deletedAt: null } });
  const jobsOnRuns = await prisma.scheduledJob.count({
    where: { scheduleRunId: { not: null }, deletedAt: null },
  });

  console.log(`Active runs: ${activeRuns}`);
  console.log(`Jobs linked to runs: ${jobsOnRuns}`);

  const result = await prisma.$transaction(async (tx) => {
    const unlinked = await tx.scheduledJob.updateMany({
      where: { scheduleRunId: { not: null }, deletedAt: null },
      data: { scheduleRunId: null },
    });
    const softDeleted = await tx.scheduleRun.updateMany({
      where: { deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { unlinked: unlinked.count, softDeleted: softDeleted.count };
  });

  console.log(`Unlinked jobs: ${result.unlinked}`);
  console.log(`Soft-deleted runs: ${result.softDeleted}`);
  console.log(
    `Remaining active runs: ${await prisma.scheduleRun.count({ where: { deletedAt: null } })}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
