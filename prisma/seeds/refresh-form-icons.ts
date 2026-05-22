import { PrismaClient } from '@prisma/client';
import { refreshCarePathwayFormPictureUrls } from './care-plan-forms.seed';

async function main() {
  const prisma = new PrismaClient();
  try {
    const n = await refreshCarePathwayFormPictureUrls(prisma);
    console.log(`Updated ${n} care pathway form icon(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
