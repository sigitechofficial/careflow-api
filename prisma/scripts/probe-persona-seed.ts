import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const personas = await prisma.serviceUser.findMany({
    where: { serviceUserNumber: { startsWith: 'SU-TEST-' }, deletedAt: null },
    select: {
      serviceUserNumber: true,
      firstName: true,
      lastName: true,
      status: { select: { code: true } },
      visitPlans: {
        where: { status: 'ACTIVE', deletedAt: null },
        select: { id: true, _count: { select: { slots: true } } },
      },
    },
    orderBy: { serviceUserNumber: 'asc' },
  });

  console.log(`Personas: ${personas.length}`);
  for (const p of personas) {
    const vp = p.visitPlans[0];
    console.log(
      `  ${p.serviceUserNumber} ${p.firstName} ${p.lastName} [${p.status?.code}] visitPlan=${vp ? `ACTIVE (${vp._count.slots} slots)` : 'none'}`,
    );
  }
}

main()
  .finally(() => prisma.$disconnect());
