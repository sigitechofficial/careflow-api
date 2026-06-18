/**
 * Create carer ScheduleRuns for existing persona scheduled jobs (idempotent).
 *
 * Usage:
 *   npm run seed:persona-runs
 *   npx ts-node --transpile-only prisma/scripts/seed-persona-schedule-runs.ts --from=2026-06-18 --to=2026-06-24
 */
import { PrismaClient } from '@prisma/client';
import { seedPersonaScheduleRuns } from '../seeds/persona-schedule.seed';

const DAY_MS = 86400000;

function parseDateOnly(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Invalid date: ${value}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function defaultRange() {
  const today = new Date();
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const to = new Date(from.getTime() + 6 * DAY_MS);
  return { from, to };
}

const prisma = new PrismaClient();

async function main() {
  const fromArg = process.argv.find((a) => a.startsWith('--from='));
  const toArg = process.argv.find((a) => a.startsWith('--to='));
  const { from: defFrom, to: defTo } = defaultRange();
  const from = parseDateOnly(fromArg?.slice('--from='.length) ?? process.env.SCHEDULE_FROM_DATE ?? defFrom.toISOString().slice(0, 10));
  const to = parseDateOnly(toArg?.slice('--to='.length) ?? process.env.SCHEDULE_TO_DATE ?? defTo.toISOString().slice(0, 10));

  const user =
    (await prisma.user.findFirst({ where: { email: 'admin@careadmin.local', isActive: true } })) ??
    (await prisma.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }));

  console.log(`[seed] Persona carer runs: ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`);
  const result = await seedPersonaScheduleRuns(prisma, from, to, user?.id ?? null);
  console.log(`[seed] Done — ${result.runsCreated} run(s) created/updated, ${result.jobsLinked} job(s) linked`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
