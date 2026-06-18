import { PrismaClient } from '@prisma/client';
import { seedServiceUserDocumentTypeCatalog } from '../seeds/service-user-document-type-catalog.seed';

const prisma = new PrismaClient();

seedServiceUserDocumentTypeCatalog(prisma)
  .then(() => {
    console.log('Document type catalog seeded');
  })
  .finally(() => prisma.$disconnect());
