import type { PrismaClient } from '@prisma/client';
import { DEFAULT_ALLERGY_CATALOG } from '../seed-data/default-allergy-catalog';

export async function seedAllergyCatalog(prisma: PrismaClient): Promise<number> {
  await prisma.allergyCatalog.updateMany({ data: { isActive: false } });

  const batchSize = 50;
  for (let offset = 0; offset < DEFAULT_ALLERGY_CATALOG.length; offset += batchSize) {
    const slice = DEFAULT_ALLERGY_CATALOG.slice(offset, offset + batchSize);
    await prisma.$transaction(
      slice.map((entry, index) => {
        const sortOrder = offset + index;
        const { name, code, category } = entry;
        return prisma.allergyCatalog.upsert({
          where: { code },
          update: { name, category, sortOrder, isActive: true },
          create: { name, code, category, sortOrder },
        });
      }),
    );
  }

  return DEFAULT_ALLERGY_CATALOG.length;
}
