import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const med = await p.serviceUserMedication.findFirst({
    where: { medicationName: { contains: 'Atorvastatin' }, deletedAt: null },
    include: { schedules: { where: { deletedAt: null }, include: { round: true } } },
  });
  const morning = med?.schedules.find((s) => s.round?.code === 'MORNING');
  if (!morning || !med) return;

  const events = await p.medicationAdministrationEvent.findMany({
    where: { medicationScheduleId: morning.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { scheduledDateTime: true, status: true, statusCode: true, createdAt: true },
  });
  const byDay = new Map<number, typeof events>();
  for (const e of events) {
    const day = e.scheduledDateTime?.getUTCDate() ?? 0;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(e);
  }
  for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    if (list.length > 1) {
      console.log(`day ${day}: ${list.length} events (chart uses newest first)`);
      for (const e of list) {
        console.log(`  statusCode=${e.statusCode} status=${e.status} created=${e.createdAt.toISOString()}`);
      }
    }
  }
  console.log('Total events:', events.length);
}

main().finally(() => p.$disconnect());
