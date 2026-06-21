/**
 * Re-sync visit-plan carer assignments onto existing scheduled visits.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/sync-su-visit-plan-carers.ts SU-TEST-P05
 */
import { PrismaClient } from '@prisma/client';
import {
  syncVisitPlanSlotCarersToScheduledJobs,
  visitPlanCarerSyncFromDateTime,
} from '../../src/service-user-visit-plans/visit-plan-slot-carer-sync.util';

const prisma = new PrismaClient();
const serviceUserNumber = process.argv[2];

if (!serviceUserNumber) {
  console.error('Usage: sync-su-visit-plan-carers.ts <serviceUserNumber>');
  process.exit(1);
}

async function main() {
  const su = await prisma.serviceUser.findFirst({
    where: { serviceUserNumber, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!su) {
    console.error('Service user not found');
    process.exit(1);
  }

  const plan = await prisma.serviceUserVisitPlan.findFirst({
    where: { serviceUserId: su.id, deletedAt: null, status: 'ACTIVE' },
    include: {
      slots: {
        where: { isEnabled: true },
        include: { carerAssignments: true },
      },
    },
  });
  if (!plan) {
    console.error('No active visit plan');
    process.exit(1);
  }

  const fromDateTime = visitPlanCarerSyncFromDateTime();
  let jobsUpdated = 0;
  const user = await prisma.user.findFirst({ where: { deletedAt: null }, select: { id: true } });
  const userId = user?.id ?? null;

  await prisma.$transaction(async (tx) => {
    for (const slot of plan.slots) {
      const assignedEmployeeIds =
        slot.carerAssignments.length > 0
          ? [...new Set(slot.carerAssignments.map((a) => a.employeeId))]
          : slot.assignedEmployeeIds;
      if (!assignedEmployeeIds.length) continue;

      const result = await syncVisitPlanSlotCarersToScheduledJobs(tx, {
        visitPlanSlotId: slot.id,
        assignedEmployeeIds,
        requiredCarers: slot.requiredCarers,
        userId: null,
        fromDateTime,
      });
      jobsUpdated += result.jobsUpdated;
      console.log(`Slot ${slot.slotCode}: updated ${result.jobsUpdated} job(s)`);
    }
  });

  console.log(`Done for ${su.firstName} ${su.lastName} — ${jobsUpdated} job(s) updated`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
