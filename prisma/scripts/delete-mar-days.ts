/**
 * Soft-delete MAR administration events for specific calendar days (UTC).
 * Usage: npx ts-node --transpile-only prisma/scripts/delete-mar-days.ts 29 30 [serviceUserId]
 */
import { PrismaClient } from '@prisma/client';

const cliArgs = process.argv.slice(2);
const dayNums = cliArgs.filter((a) => /^\d+$/.test(a)).map(Number);
const SERVICE_USER_ID =
  cliArgs.find((a) => !/^\d+$/.test(a)) ?? 'ea274b6c-9a8a-4bc1-b6c5-27e7c4bd5fdd';

if (dayNums.length === 0) {
  console.error('Usage: delete-mar-days.ts <day> [day2 ...] [serviceUserId]');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  const ranges = dayNums.map((day) => ({
    day,
    gte: new Date(Date.UTC(y, m, day, 0, 0, 0)),
    lt: new Date(Date.UTC(y, m, day + 1, 0, 0, 0)),
  }));

  const or = ranges.map((r) => ({
    scheduledDateTime: { gte: r.gte, lt: r.lt },
  }));

  const events = await prisma.medicationAdministrationEvent.findMany({
    where: { serviceUserId: SERVICE_USER_ID, deletedAt: null, OR: or },
    select: {
      id: true,
      scheduledDateTime: true,
      statusCode: true,
      medicationNameSnapshot: true,
    },
    orderBy: { scheduledDateTime: 'asc' },
  });

  console.log(`Service user: ${SERVICE_USER_ID}`);
  console.log(`Days to remove: ${dayNums.join(', ')} (${y}-${String(m + 1).padStart(2, '0')})`);
  console.log(`Found ${events.length} event(s):`);
  for (const e of events) {
    const d = e.scheduledDateTime?.toISOString().slice(0, 10) ?? '?';
    console.log(`  ${d} ${e.statusCode ?? '—'} ${e.medicationNameSnapshot ?? ''} ${e.id}`);
  }

  if (events.length === 0) return;

  const result = await prisma.medicationAdministrationEvent.updateMany({
    where: { id: { in: events.map((e) => e.id) } },
    data: { deletedAt: new Date(), isActive: false },
  });
  console.log(`Soft-deleted: ${result.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
