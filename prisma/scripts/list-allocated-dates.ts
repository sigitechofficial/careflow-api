import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const id = '28699cc0-b6eb-41e2-b806-ca216c34d485';
async function main() {
  const jobs = await prisma.scheduledJob.findMany({
    where: { serviceUserId: id, deletedAt: null },
    orderBy: { scheduledStartDateTime: 'asc' },
    select: { scheduledStartDateTime: true, status: true },
  });
  for (const j of jobs) {
    const d = j.scheduledStartDateTime.toISOString().slice(0, 10);
    const t = j.scheduledStartDateTime.toISOString().slice(11, 16);
    console.log(`${d} ${t} ${j.status}`);
  }
}
main().finally(() => prisma.$disconnect());
