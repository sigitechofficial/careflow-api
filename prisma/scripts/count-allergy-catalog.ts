import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

prisma.allergyCatalog
  .groupBy({
    by: ['category'],
    where: { isActive: true },
    _count: true,
  })
  .then(rows => {
    console.log(rows);
    const total = rows.reduce((sum, row) => sum + row._count, 0);
    console.log(`Total active: ${total}`);
  })
  .finally(() => prisma.$disconnect());
