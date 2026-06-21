import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const planId = '9a2c9463-7be6-48cf-9950-793dbc507895';

async function main() {
  const slots = await prisma.visitPlanSlot.findMany({
    where: { visitPlanId: planId },
    include: { carerAssignments: true },
  });
  console.log('Slots:', JSON.stringify(slots, null, 2));

  const patterns = await prisma.employeeWorkingPattern.findMany({
    where: { deletedAt: null, isActive: true },
    include: { employee: { include: { personalDetail: true } } },
  });
  const early = patterns.filter((p) => p.startTime && p.startTime <= '08:00');
  console.log(
    'Employees with start <= 08:00:',
    [...new Set(early.map((p) => p.employeeId))].length,
  );

  // Pick Amara Okonkwo for assignment
  const amara = await prisma.employee.findFirst({
    where: { personalDetail: { firstName: 'Amara', lastName: 'Okonkwo' } },
    include: { workingPatterns: { where: { deletedAt: null, isActive: true } }, personalDetail: true },
  });
  console.log('Amara:', amara?.id, amara?.workingPatterns);
}

main().finally(() => prisma.$disconnect());
