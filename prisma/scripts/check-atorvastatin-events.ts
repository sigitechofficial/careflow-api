import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const med = await p.serviceUserMedication.findFirst({
    where: { medicationName: { contains: 'Atorvastatin' }, deletedAt: null },
    include: {
      schedules: { where: { deletedAt: null }, include: { round: true } },
    },
  });
  if (!med) {
    console.log('Atorvastatin not found');
    return;
  }
  const morning = med.schedules.find((s) => s.round?.code === 'MORNING');
  console.log('Med:', med.id, med.medicationName);
  console.log('Morning schedule:', morning?.id);

  const events = await p.medicationAdministrationEvent.findMany({
    where: {
      serviceUserMedicationId: med.id,
      medicationScheduleId: morning?.id,
      deletedAt: null,
    },
    orderBy: { scheduledDateTime: 'asc' },
    select: { id: true, scheduledDateTime: true, status: true, statusCode: true },
  });
  console.log('Events:', events.length);
  for (const e of events) {
    const day = e.scheduledDateTime?.getUTCDate() ?? '?';
    console.log(`  day ${day}: status=${e.status} statusCode=${e.statusCode ?? 'NULL'}`);
  }
}

main()
  .finally(() => p.$disconnect());
