import { PrismaClient } from '@prisma/client';
import { seedTaskCatalogue } from '../prisma/seeds/task-catalogue.seed';

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedTaskCatalogue(prisma);
    console.log('Task catalogue seeded');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
