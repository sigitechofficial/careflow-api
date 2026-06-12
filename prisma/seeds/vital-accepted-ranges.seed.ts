import type { PrismaClient } from '@prisma/client';
import { VITAL_ACCEPTED_RANGE_DEFAULTS } from '../../src/lookups/vital-accepted-ranges.defaults';

export async function seedVitalAcceptedRanges(prisma: PrismaClient): Promise<number> {
  let count = 0;
  for (const row of VITAL_ACCEPTED_RANGE_DEFAULTS) {
    await prisma.vitalAcceptedRangeCatalog.upsert({
      where: { fieldKey: row.fieldKey },
      update: {
        label: row.label,
        unit: row.unit,
        min: row.min,
        max: row.max,
        sortOrder: row.sortOrder,
        column: row.column,
        isActive: true,
      },
      create: { ...row },
    });
    count += 1;
  }
  return count;
}
