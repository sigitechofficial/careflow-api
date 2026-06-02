/**
 * Direct DB check for MAR demo supply data.
 * Usage: npx ts-node --transpile-only prisma/scripts/check-mar-supply-db.ts [serviceUserId]
 */
import { PrismaClient } from '@prisma/client';

const SERVICE_USER_ID =
  process.argv[2] ?? 'ea274b6c-9a8a-4bc1-b6c5-27e7c4bd5fdd';

const prisma = new PrismaClient();

async function main() {
  console.log('Service user:', SERVICE_USER_ID);

  const su = await prisma.serviceUser.findFirst({
    where: { id: SERVICE_USER_ID, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!su) {
    console.error('Service user NOT FOUND');
    process.exit(1);
  }
  console.log('Name:', [su.firstName, su.lastName].filter(Boolean).join(' '));

  const meds = await prisma.serviceUserMedication.findMany({
    where: { serviceUserId: SERVICE_USER_ID, deletedAt: null, isActive: true },
    select: {
      id: true,
      medicationName: true,
      medicationKind: true,
      status: true,
      dose: true,
    },
    orderBy: { medicationName: 'asc' },
  });
  console.log('\n--- Medications ---');
  console.log('Count:', meds.length);
  for (const m of meds) {
    console.log(`  ${m.id.slice(0, 8)}… ${m.medicationName} (${m.medicationKind}, ${m.status})`);
  }

  const profiles = await prisma.medicationSupplyProfile.findMany({
    where: {
      serviceUserMedication: { serviceUserId: SERVICE_USER_ID, deletedAt: null },
      deletedAt: null,
    },
    include: {
      serviceUserMedication: { select: { medicationName: true } },
    },
  });
  console.log('\n--- Supply profiles ---');
  console.log('Count:', profiles.length);
  for (const p of profiles) {
    console.log(
      `  ${p.serviceUserMedication.medicationName}: model=${p.supplyModel} defaultQty=${p.defaultQty} qtyUnit=${p.qtyUnit ?? 'null'}`,
    );
  }

  const deliveries = await prisma.medicationSupplyDelivery.findMany({
    where: { serviceUserId: SERVICE_USER_ID, deletedAt: null },
    include: {
      serviceUserMedication: { select: { medicationName: true } },
    },
    orderBy: [{ serviceUserMedicationId: 'asc' }, { deliveredAt: 'desc' }],
  });
  console.log('\n--- Supply deliveries ---');
  console.log('Count:', deliveries.length);
  for (const d of deliveries) {
    console.log(
      `  ${d.serviceUserMedication.medicationName}`,
      `| qty=${d.quantity ?? 'null'}`,
      `| delivered=${d.deliveredAt.toISOString().slice(0, 10)}`,
      `| cycleEnd=${d.cycleEndDate?.toISOString().slice(0, 10) ?? 'null'}`,
      `| runsOut=${d.runsOutDate?.toISOString().slice(0, 10) ?? 'null'}`,
      `| active=${d.isActive}`,
    );
  }

  const ator = meds.find((m) => m.medicationName.includes('Atorvastatin'));
  if (ator) {
    const events = await prisma.medicationAdministrationEvent.count({
      where: {
        serviceUserMedicationId: ator.id,
        deletedAt: null,
        statusCode: { in: ['G', 'F', 'I', 'S', 'T'] },
      },
    });
    const latestDelivery = deliveries.find((d) => d.serviceUserMedicationId === ator.id);
    console.log('\n--- Atorvastatin detail ---');
    console.log('medicationId:', ator.id);
    console.log('consuming events (G/F/I/S/T):', events);
    console.log(
      'latest delivery:',
      latestDelivery
        ? {
            quantity: latestDelivery.quantity,
            deliveredAt: latestDelivery.deliveredAt.toISOString().slice(0, 10),
            runsOutDate: latestDelivery.runsOutDate?.toISOString().slice(0, 10) ?? null,
          }
        : 'NONE',
    );
    if (latestDelivery?.quantity != null) {
      const since = latestDelivery.deliveredAt;
      const consumedSince = await prisma.medicationAdministrationEvent.count({
        where: {
          serviceUserMedicationId: ator.id,
          deletedAt: null,
          statusCode: { in: ['G', 'F', 'I', 'S', 'T'] },
          OR: [{ scheduledDateTime: { gte: since } }, { actualDateTime: { gte: since } }],
        },
      });
      console.log('consumed since delivery:', consumedSince);
      console.log('quantity remaining (calc):', latestDelivery.quantity - consumedSince);
    }
  } else {
    console.log('\nAtorvastatin medication NOT FOUND in DB');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
