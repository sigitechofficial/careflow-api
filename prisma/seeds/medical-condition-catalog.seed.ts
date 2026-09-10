import type { PrismaClient } from '@prisma/client';
import { DEFAULT_MEDICAL_CONDITION_CATALOG } from '../seed-data/medical-condition-catalog';

/** Idempotent catalogue seed — upserts by code; deactivates codes no longer in the seed list. */
export async function seedMedicalConditionCatalog(prisma: PrismaClient): Promise<number> {
  const codes = DEFAULT_MEDICAL_CONDITION_CATALOG.map((e) => e.code);

  for (let i = 0; i < DEFAULT_MEDICAL_CONDITION_CATALOG.length; i++) {
    const entry = DEFAULT_MEDICAL_CONDITION_CATALOG[i]!;
    await prisma.medicalConditionCatalog.upsert({
      where: { code: entry.code },
      update: {
        name: entry.name,
        category: entry.category,
        description: entry.description ?? null,
        sortOrder: i,
        isActive: true,
      },
      create: {
        code: entry.code,
        name: entry.name,
        category: entry.category,
        description: entry.description ?? null,
        sortOrder: i,
      },
    });
  }

  await prisma.medicalConditionCatalog.updateMany({
    where: { code: { notIn: codes } },
    data: { isActive: false },
  });

  return DEFAULT_MEDICAL_CONDITION_CATALOG.length;
}
