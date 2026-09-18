/**
 * Targeted seed: incident categories & subtypes only (idempotent).
 * Mirrors the block in prisma/seed.ts so we can populate them without running the full seed.
 * Run: npx ts-node --transpile-only prisma/scripts/seed-incident-categories.ts
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_INCIDENT_CATEGORIES } from '../seed-data/incident-categories';

const prisma = new PrismaClient();

async function main() {
  let categories = 0;
  let subtypes = 0;
  for (let ci = 0; ci < DEFAULT_INCIDENT_CATEGORIES.length; ci++) {
    const cat = DEFAULT_INCIDENT_CATEGORIES[ci];
    const category = await prisma.incidentCategory.upsert({
      where: { key: cat.key },
      update: { label: cat.label, description: cat.description ?? null, isSystem: true },
      create: {
        key: cat.key,
        label: cat.label,
        description: cat.description ?? null,
        isSystem: true,
        sortOrder: ci,
      },
    });
    categories += 1;
    for (let si = 0; si < cat.subtypes.length; si++) {
      const sub = cat.subtypes[si];
      await prisma.incidentSubtype.upsert({
        where: { categoryId_key: { categoryId: category.id, key: sub.key } },
        update: { label: sub.label },
        create: { categoryId: category.id, key: sub.key, label: sub.label, sortOrder: si },
      });
      subtypes += 1;
    }
  }
  console.log(`Seeded ${categories} incident categories and ${subtypes} subtypes.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
