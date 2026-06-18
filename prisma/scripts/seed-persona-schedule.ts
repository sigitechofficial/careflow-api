/**
 * Generate scheduled jobs from persona visit plans for scheduling UI testing.
 *
 * Usage:
 *   npm run seed:persona-schedule
 *   SCHEDULE_FROM_DATE=2026-06-23 SCHEDULE_TO_DATE=2026-06-29 npm run seed:persona-schedule
 */
import { PrismaClient } from '@prisma/client';
import { seedPersonaSchedule } from '../seeds/persona-schedule.seed';

const prisma = new PrismaClient();

async function main() {
  const fromArg = process.argv.find((a) => a.startsWith('--from='));
  const toArg = process.argv.find((a) => a.startsWith('--to='));
  const noAlloc = process.argv.includes('--no-allocations');
  const noRuns = process.argv.includes('--no-runs');
  const runsOnly = process.argv.includes('--runs-only');

  if (runsOnly) {
    const { seedPersonaScheduleRuns } = await import('../seeds/persona-schedule.seed');
    const fromDate = fromArg?.slice('--from='.length) ?? process.env.SCHEDULE_FROM_DATE;
    const toDate = toArg?.slice('--to='.length) ?? process.env.SCHEDULE_TO_DATE;
    const DAY_MS = 86400000;
    const today = new Date();
    const from = fromDate
      ? new Date(`${fromDate}T00:00:00.000Z`)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const to = toDate
      ? new Date(`${toDate}T00:00:00.000Z`)
      : new Date(from.getTime() + 6 * DAY_MS);
    const user = await prisma.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    await seedPersonaScheduleRuns(prisma, from, to, user?.id ?? null);
    return;
  }

  await seedPersonaSchedule(prisma, {
    fromDate: fromArg?.slice('--from='.length),
    toDate: toArg?.slice('--to='.length),
    sampleAllocations: !noAlloc,
    scheduleRuns: !noRuns,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
