import { PrismaClient } from '@prisma/client';

const id = '28699cc0-b6eb-41e2-b806-ca216c34d485';
const prisma = new PrismaClient();

async function main() {
  const su = await prisma.serviceUser.findFirst({
    where: { id },
    select: { firstName: true, lastName: true, preferredName: true },
  });
  console.log('Service user:', su);

  const jobs = await prisma.scheduledJob.count({ where: { serviceUserId: id } });
  const visits = await prisma.scheduledVisit.count({ where: { serviceUserId: id } });
  const plans = await prisma.serviceUserVisitPlan.findMany({
    where: { serviceUserId: id },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      slots: { select: { id: true, slotCode: true, isEnabled: true, daysOfWeek: true } },
    },
  });
  const amendments = await prisma.visitPlanAmendment.count({
    where: { visitPlan: { serviceUserId: id } },
  });
  console.log({ jobs, visits, planCount: plans.length, amendments });
  for (const p of plans) {
    console.log(
      `  plan ${p.id} status=${p.status} deleted=${p.deletedAt ?? 'null'} enabledSlots=${p.slots.filter((s) => s.isEnabled).length}`,
    );
  }
}

main().finally(() => prisma.$disconnect());
