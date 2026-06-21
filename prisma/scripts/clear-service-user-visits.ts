/**
 * Dev utility: hard-delete all rota visits and visit-plan history for one service user.
 * Usage: npx ts-node --transpile-only prisma/scripts/clear-service-user-visits.ts <serviceUserId>
 */
import { PrismaClient } from '@prisma/client';

const serviceUserId = process.argv[2]?.trim();
if (!serviceUserId) {
  console.error('Usage: npx ts-node --transpile-only prisma/scripts/clear-service-user-visits.ts <serviceUserId>');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const su = await prisma.serviceUser.findFirst({
    where: { id: serviceUserId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, preferredName: true },
  });
  if (!su) {
    console.error('Service user not found:', serviceUserId);
    process.exit(1);
  }

  const name = su.preferredName?.trim() || `${su.firstName} ${su.lastName}`.trim();
  console.log(`Clearing visits and visit-plan history for ${name} (${serviceUserId})…`);

  const jobIds = (
    await prisma.scheduledJob.findMany({
      where: { serviceUserId },
      select: { id: true },
    })
  ).map((j) => j.id);

  const visitIds = (
    await prisma.scheduledVisit.findMany({
      where: { serviceUserId },
      select: { id: true },
    })
  ).map((v) => v.id);

  const planIds = (
    await prisma.serviceUserVisitPlan.findMany({
      where: { serviceUserId },
      select: { id: true },
    })
  ).map((p) => p.id);

  const counts = await prisma.$transaction(async (tx) => {
    const jobAllocations = await tx.jobAllocation.deleteMany({
      where: {
        OR: [
          { scheduledJobId: { in: jobIds } },
          { scheduledVisitId: { in: visitIds } },
        ],
      },
    });

    const visitActions = await tx.visitAction.deleteMany({
      where: {
        OR: [
          ...(jobIds.length ? [{ scheduledJobId: { in: jobIds } }] : []),
          ...(visitIds.length ? [{ scheduledVisitId: { in: visitIds } }] : []),
        ],
      },
    });

    const callOffs = await tx.callOffVisit.deleteMany({
      where: { scheduledJobId: { in: jobIds } },
    });

    const cancellations = await tx.scheduledJobCancellation.deleteMany({
      where: { scheduledJobId: { in: jobIds } },
    });

    const visits = await tx.scheduledVisit.deleteMany({ where: { serviceUserId } });
    const jobs = await tx.scheduledJob.deleteMany({ where: { serviceUserId } });

    const absences = await tx.serviceUserAbsence.deleteMany({ where: { serviceUserId } });

    let amendments = { count: 0 };
    let statusEvents = { count: 0 };
    let exceptions = { count: 0 };
    let slots = { count: 0 };
    let plansDeleted = { count: 0 };
    if (planIds.length) {
      amendments = await tx.visitPlanAmendment.deleteMany({
        where: { visitPlanId: { in: planIds } },
      });
      statusEvents = await tx.visitPlanStatusEvent.deleteMany({
        where: { visitPlanId: { in: planIds } },
      });
      exceptions = await tx.visitPlanSlotException.deleteMany({
        where: { visitPlanSlot: { visitPlanId: { in: planIds } } },
      });
      slots = await tx.visitPlanSlot.deleteMany({
        where: { visitPlanId: { in: planIds } },
      });
      plansDeleted = await tx.serviceUserVisitPlan.deleteMany({
        where: { serviceUserId },
      });
    }

    return {
      jobAllocations,
      visitActions,
      callOffs,
      cancellations,
      visits,
      jobs,
      absences,
      amendments,
      statusEvents,
      exceptions,
      slots,
      plansDeleted,
    };
  });

  console.log('Deleted:');
  console.log(`  scheduled jobs:        ${counts.jobs.count}`);
  console.log(`  scheduled visits:      ${counts.visits.count}`);
  console.log(`  job allocations:       ${counts.jobAllocations.count}`);
  console.log(`  visit actions:         ${counts.visitActions.count}`);
  console.log(`  call-off visits:       ${counts.callOffs.count}`);
  console.log(`  job cancellations:     ${counts.cancellations.count}`);
  console.log(`  absences:              ${counts.absences.count}`);
  console.log(`  visit plan amendments: ${counts.amendments.count}`);
  console.log(`  status events:         ${counts.statusEvents.count}`);
  console.log(`  slot exceptions:       ${counts.exceptions.count}`);
  console.log(`  visit plan slots:      ${counts.slots.count}`);
  console.log(`  visit plans:           ${counts.plansDeleted.count}`);
  console.log('Done. Create a new visit plan from Set up visits when you are ready.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
