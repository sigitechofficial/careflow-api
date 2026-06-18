/**
 * Summary of persona scheduled jobs / visits for a date.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/probe-persona-schedule.ts
 *   npx ts-node --transpile-only prisma/scripts/probe-persona-schedule.ts --date=2026-06-23
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseDateArg(): string {
  const arg = process.argv.find((a) => a.startsWith('--date='));
  if (arg) return arg.slice('--date='.length);
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

async function main() {
  const dateStr = parseDateArg();
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 86400000 - 1);

  const jobs = await prisma.scheduledJob.findMany({
    where: {
      deletedAt: null,
      scheduledStartDateTime: { gte: dayStart, lte: dayEnd },
      serviceUser: { serviceUserNumber: { startsWith: 'SU-TEST-' } },
    },
    orderBy: { scheduledStartDateTime: 'asc' },
    include: {
      serviceUser: { select: { serviceUserNumber: true, firstName: true, lastName: true } },
      allocations: { where: { deletedAt: null }, select: { id: true, employeeId: true, status: true } },
    },
  });

  const byStatus: Record<string, number> = {};
  const byCarers: Record<string, number> = {};
  for (const j of jobs) {
    byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
    const key = String(j.requiredCarers);
    byCarers[key] = (byCarers[key] ?? 0) + 1;
  }

  console.log(`Persona schedule probe — ${dateStr}`);
  console.log(`  Jobs: ${jobs.length}`);
  console.log(`  By status:`, byStatus);
  console.log(`  By required carers:`, byCarers);
  console.log('');
  for (const j of jobs.slice(0, 25)) {
    const su = j.serviceUser;
    const time = j.scheduledStartDateTime.toISOString().slice(11, 16);
    console.log(
      `  ${time} ${su?.serviceUserNumber} ${j.jobName} [${j.status}] carers=${j.requiredCarers} alloc=${j.allocations.length}`,
    );
  }
  if (jobs.length > 25) {
    console.log(`  … and ${jobs.length - 25} more`);
  }
}

main().finally(() => prisma.$disconnect());
