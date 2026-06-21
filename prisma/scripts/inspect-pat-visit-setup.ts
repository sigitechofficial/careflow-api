import { PrismaClient } from '@prisma/client';

const serviceUserId = '28699cc0-b6eb-41e2-b806-ca216c34d485';
const prisma = new PrismaClient();

async function main() {
  const su = await prisma.serviceUser.findFirst({
    where: { id: serviceUserId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      domCare: { select: { weeklyContractedHours: true, numberOfCarers: true } },
    },
  });
  console.log('Service user:', su);

  const plan = await prisma.serviceUserVisitPlan.findFirst({
    where: { serviceUserId, deletedAt: null, status: 'ACTIVE' },
    include: {
      slots: {
        include: {
          carerAssignments: true,
          exceptions: true,
        },
      },
      amendments: { take: 3, orderBy: { amendedAt: 'desc' } },
    },
  });
  console.log('\nActive plan:', plan
    ? {
        id: plan.id,
        status: plan.status,
        weeklyHours: plan.weeklyContractedHours,
        effectiveFrom: plan.effectiveFrom,
        effectiveTo: plan.effectiveTo,
        slots: plan.slots.map((s) => ({
          slotCode: s.slotCode,
          label: s.label,
          isEnabled: s.isEnabled,
          daysOfWeek: s.daysOfWeek,
          start: s.plannedStartTime,
          end: s.plannedEndTime,
          requiredCarers: s.requiredCarers,
          carerAssignments: s.carerAssignments,
        })),
      }
    : null);

  const jobs = await prisma.scheduledJob.findMany({
    where: { serviceUserId },
    orderBy: { scheduledStartDateTime: 'asc' },
    take: 20,
    include: {
      allocations: { include: { employee: { include: { personalDetail: true } } } },
    },
  });
  console.log('\nScheduled jobs (first 20):');
  for (const j of jobs) {
    const carers = j.allocations.map(
      (a) =>
        `${a.employee?.personalDetail?.firstName ?? ''} ${a.employee?.personalDetail?.lastName ?? ''}`.trim(),
    );
    console.log(
      `  ${j.scheduledStartDateTime.toISOString().slice(0, 10)} ${j.scheduledStartDateTime.toISOString().slice(11, 16)}-${j.scheduledEndDateTime?.toISOString().slice(11, 16) ?? '?'} status=${j.status} carers=[${carers.join(', ')}]`,
    );
  }

  const employees = await prisma.employee.findMany({
    where: { deletedAt: null, isActive: true },
    take: 10,
    include: {
      personalDetail: true,
      workingPatterns: { where: { deletedAt: null, isActive: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log('\nActive employees (first 10):');
  for (const e of employees) {
    const name = `${e.personalDetail?.firstName ?? ''} ${e.personalDetail?.lastName ?? ''}`.trim();
    const patterns = e.workingPatterns.map(
      (p) => `${p.dayOfWeek}:${p.isAvailable ? p.startTime + '-' + p.endTime : 'off'}${p.notes === 'partial' ? '(partial)' : ''}`,
    );
    console.log(`  ${e.id} ${name} patterns=[${patterns.join(', ')}]`);
  }

  const preferred = await prisma.serviceUserDomCarePreferredCarer.findMany({
    where: { domCare: { serviceUserId } },
    include: { employee: { include: { personalDetail: true } } },
  });
  console.log('\nPreferred carers:', preferred.map((p) => ({
    name: `${p.employee?.personalDetail?.firstName} ${p.employee?.personalDetail?.lastName}`,
    employeeId: p.employeeId,
  })));
}

main().finally(() => prisma.$disconnect());
