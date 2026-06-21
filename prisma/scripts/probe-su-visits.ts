import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const serviceUserNumber = process.argv[2] ?? 'SU-TEST-P05';

async function main() {
  const su = await prisma.serviceUser.findFirst({
    where: { serviceUserNumber, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!su) {
    console.log('SU not found');
    return;
  }
  console.log('SU:', su);

  const plan = await prisma.serviceUserVisitPlan.findFirst({
    where: { serviceUserId: su.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      slots: {
        include: { carerAssignments: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  if (!plan) {
    console.log('No plan');
    return;
  }
  console.log('Plan:', plan.id, plan.status);
  for (const slot of plan.slots) {
    console.log(
      `Slot ${slot.slotCode} ${slot.plannedStartTime}-${slot.plannedEndTime} enabled=${slot.isEnabled}`,
    );
    console.log('  daysOfWeek:', slot.daysOfWeek);
    console.log('  assignedEmployeeIds:', slot.assignedEmployeeIds);
    console.log(
      '  carerAssignments:',
      slot.carerAssignments.map((a) => ({
        emp: a.employeeId,
        day: a.dayOfWeek,
        role: a.role,
      })),
    );
  }

  const jobCount = await prisma.scheduledJob.count({
    where: { serviceUserId: su.id, deletedAt: null },
  });
  console.log('Jobs count:', jobCount);

  const jobs = await prisma.scheduledJob.findMany({
    where: { serviceUserId: su.id, deletedAt: null },
    include: {
      allocations: { where: { deletedAt: null, isActive: true } },
    },
    orderBy: { scheduledStartDateTime: 'asc' },
    take: 15,
  });
  for (const j of jobs) {
    console.log(
      'Job',
      j.jobName,
      j.status,
      j.scheduledStartDateTime.toISOString(),
      'allocs:',
      j.allocations.map((a) => `${a.employeeId.slice(0, 8)}:${a.status}`).join(', ') || 'none',
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
