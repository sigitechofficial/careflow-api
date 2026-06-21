/**
 * Delete all rota visits (and visit plans) for one service user.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/delete-service-user-visits.ts SU-TEST-P05
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const serviceUserNumber = process.argv[2];

if (!serviceUserNumber) {
  console.error('Usage: delete-service-user-visits.ts <serviceUserNumber>');
  process.exit(1);
}

async function main() {
  const su = await prisma.serviceUser.findFirst({
    where: { serviceUserNumber, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, serviceUserNumber: true },
  });
  if (!su) {
    console.error(`Service user ${serviceUserNumber} not found`);
    process.exit(1);
  }
  console.log(`Found: ${su.firstName} ${su.lastName} (${su.serviceUserNumber})`);

  const jobs = await prisma.scheduledJob.findMany({
    where: { serviceUserId: su.id },
    select: { id: true, scheduleRunId: true },
  });
  const jobIds = jobs.map((j) => j.id);
  const visitIds = (
    await prisma.scheduledVisit.findMany({
      where: { serviceUserId: su.id },
      select: { id: true },
    })
  ).map((v) => v.id);
  const runIds = [...new Set(jobs.map((j) => j.scheduleRunId).filter(Boolean))] as string[];

  console.log('Before:', {
    scheduledJob: jobIds.length,
    scheduledVisit: visitIds.length,
    visitPlan: await prisma.serviceUserVisitPlan.count({ where: { serviceUserId: su.id } }),
    callOff: await prisma.callOffVisit.count({ where: { serviceUserId: su.id } }),
  });

  const result = await prisma.$transaction(
    async (tx) => {
      const visitAction = await tx.visitAction.deleteMany({
        where: {
          OR: [
            ...(jobIds.length ? [{ scheduledJobId: { in: jobIds } }] : []),
            ...(visitIds.length ? [{ scheduledVisitId: { in: visitIds } }] : []),
          ],
        },
      });
      const jobAllocation = jobIds.length
        ? await tx.jobAllocation.deleteMany({ where: { scheduledJobId: { in: jobIds } } })
        : { count: 0 };
      const cancellation = await tx.scheduledJobCancellation.deleteMany({
        where: { serviceUserId: su.id },
      });
      const callOff = await tx.callOffVisit.deleteMany({ where: { serviceUserId: su.id } });
      const scheduledVisit = await tx.scheduledVisit.deleteMany({ where: { serviceUserId: su.id } });
      const scheduledJob = await tx.scheduledJob.deleteMany({ where: { serviceUserId: su.id } });

      let emptyRuns = 0;
      for (const runId of runIds) {
        const remaining = await tx.scheduledJob.count({ where: { scheduleRunId: runId } });
        if (remaining === 0) {
          await tx.scheduleRun.delete({ where: { id: runId } });
          emptyRuns += 1;
        }
      }

      const visitPlanAmendment = await tx.visitPlanAmendment.deleteMany({
        where: { visitPlan: { serviceUserId: su.id } },
      });
      const visitPlanSlots = await tx.visitPlanSlot.findMany({
        where: { visitPlan: { serviceUserId: su.id } },
        select: { id: true },
      });
      const slotIds = visitPlanSlots.map((s) => s.id);
      const slotCarers = slotIds.length
        ? await tx.visitPlanSlotCarerAssignment.deleteMany({ where: { visitPlanSlotId: { in: slotIds } } })
        : { count: 0 };
      const slotExceptions = slotIds.length
        ? await tx.visitPlanSlotException.deleteMany({ where: { visitPlanSlotId: { in: slotIds } } })
        : { count: 0 };
      const visitPlanSlot = await tx.visitPlanSlot.deleteMany({
        where: { visitPlan: { serviceUserId: su.id } },
      });
      const visitPlan = await tx.serviceUserVisitPlan.deleteMany({ where: { serviceUserId: su.id } });

      return {
        visitAction: visitAction.count,
        jobAllocation: jobAllocation.count,
        cancellation: cancellation.count,
        callOff: callOff.count,
        scheduledVisit: scheduledVisit.count,
        scheduledJob: scheduledJob.count,
        emptyRuns,
        visitPlanAmendment: visitPlanAmendment.count,
        slotCarers: slotCarers.count,
        slotExceptions: slotExceptions.count,
        visitPlanSlot: visitPlanSlot.count,
        visitPlan: visitPlan.count,
      };
    },
    { timeout: 120_000 },
  );

  console.log('Deleted:', result);
  console.log('After:', {
    scheduledJob: await prisma.scheduledJob.count({ where: { serviceUserId: su.id } }),
    scheduledVisit: await prisma.scheduledVisit.count({ where: { serviceUserId: su.id } }),
    visitPlan: await prisma.serviceUserVisitPlan.count({ where: { serviceUserId: su.id } }),
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
