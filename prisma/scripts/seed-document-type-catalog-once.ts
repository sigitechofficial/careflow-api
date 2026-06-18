import { PrismaClient } from '@prisma/client';
import { seedServiceUserDocumentTypeCatalog } from '../seeds/service-user-document-type-catalog.seed';

const prisma = new PrismaClient();

seedServiceUserDocumentTypeCatalog(prisma)
  .then(async () => {
    console.log('Document type catalog seeded.');
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
