import type { PrismaClient } from '@prisma/client';
import { ECM_THRESHOLD_LOOKUP_DEFAULTS } from '../seed-data/ecm-threshold-lookups.defaults';

export async function seedEcmThresholdLookups(prisma: PrismaClient): Promise<number> {
  let count = 0;
  for (const row of ECM_THRESHOLD_LOOKUP_DEFAULTS) {
    await prisma.ecmThresholdLookup.upsert({
      where: { code: row.code },
      update: {
        label: row.label,
        description: row.description,
        groupCode: row.groupCode,
        relatedTile: row.relatedTile,
        // Do not overwrite admin-edited valueInt on re-seed.
        unit: row.unit,
        sortOrder: row.sortOrder,
        isActive: true,
      },
      create: {
        code: row.code,
        label: row.label,
        description: row.description,
        groupCode: row.groupCode,
        relatedTile: row.relatedTile,
        valueInt: row.valueInt,
        unit: row.unit,
        sortOrder: row.sortOrder,
        isActive: true,
      },
    });
    count += 1;
  }
  return count;
}
