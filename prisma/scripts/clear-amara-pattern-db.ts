import { PrismaClient } from '@prisma/client';

const AMARA_ID = '70e5b38b-fd79-4d94-865c-f343b643de85';
const prisma = new PrismaClient();

async function main() {
  await prisma.employeeWorkingPattern.deleteMany({ where: { employeeId: AMARA_ID } });
  await prisma.employeeEmployment.updateMany({
    where: { employeeId: AMARA_ID },
    data: { workingPatternCycleWeeks: 1, workingPatternCycleAnchorDate: null },
  });
  console.log('Amara patterns and cycle anchor cleared');
}

main()
  .finally(() => prisma.$disconnect());
