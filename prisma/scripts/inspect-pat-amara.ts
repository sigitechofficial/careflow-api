import { PrismaClient } from '@prisma/client';

const amaraId = '70e5b38b-fd79-4d94-865c-f343b643de85';
const patId = '28699cc0-b6eb-41e2-b806-ca216c34d485';
const prisma = new PrismaClient();

async function main() {
  const patterns = await prisma.employeeWorkingPattern.findMany({
    where: { employeeId: amaraId, deletedAt: null, isActive: true },
    orderBy: { dayOfWeek: 'asc' },
  });
  console.log('Amara server patterns:', patterns.map((p) => ({
    day: p.dayOfWeek,
    start: p.startTime,
    end: p.endTime,
    available: p.isAvailable,
    notes: p.notes,
  })));

  const plan = await prisma.serviceUserVisitPlan.findFirst({
    where: { serviceUserId: patId, deletedAt: null, status: 'ACTIVE' },
    include: {
      slots: { include: { carerAssignments: true } },
    },
  });
  console.log('\nPat plan:', plan?.id, plan?.slots.filter((s) => s.isEnabled).map((s) => ({
    code: s.slotCode,
    days: s.daysOfWeek,
    start: s.plannedStartTime,
    assigned: s.assignedEmployeeIds,
    carers: s.carerAssignments.map((c) => c.employeeId),
  })));

  const job = await prisma.scheduledJob.findFirst({
    where: { serviceUserId: patId, deletedAt: null },
    include: { allocations: { where: { deletedAt: null, isActive: true } } },
  });
  console.log('\nSample job:', job?.id, job?.status, 'allocations:', job?.allocations.length);
}

main().finally(() => prisma.$disconnect());
