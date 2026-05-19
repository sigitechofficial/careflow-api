import type { PrismaClient } from '@prisma/client';
import {
  OBSERVATION_SHARE_TARGETS,
  OBSERVATION_TYPES,
  WELLBEING_DIMENSIONS,
} from '../seed-data/service-user-observations-catalog';

export async function seedServiceUserObservations(prisma: PrismaClient): Promise<void> {
  for (const item of OBSERVATION_TYPES) {
    await prisma.observationType.upsert({
      where: { code: item.code },
      update: {
        name: item.name,
        sortOrder: item.sortOrder,
        valueKind: item.valueKind,
        usesNews2: item.usesNews2,
        unitLabel: item.unitLabel ?? null,
        isActive: true,
      },
      create: {
        code: item.code,
        name: item.name,
        sortOrder: item.sortOrder,
        valueKind: item.valueKind,
        usesNews2: item.usesNews2,
        unitLabel: item.unitLabel ?? null,
        isActive: true,
      },
    });
  }

  for (const item of OBSERVATION_SHARE_TARGETS) {
    await prisma.observationShareTarget.upsert({
      where: { code: item.code },
      update: { name: item.name, sortOrder: item.sortOrder, isActive: true },
      create: {
        code: item.code,
        name: item.name,
        sortOrder: item.sortOrder,
        isActive: true,
      },
    });
  }

  for (const dimension of WELLBEING_DIMENSIONS) {
    const row = await prisma.wellbeingDimension.upsert({
      where: { code: dimension.code },
      update: { name: dimension.name, sortOrder: dimension.sortOrder, isActive: true },
      create: {
        code: dimension.code,
        name: dimension.name,
        sortOrder: dimension.sortOrder,
        isActive: true,
      },
    });

    for (const [levelKey, label] of Object.entries(dimension.levelLabels)) {
      const level = Number(levelKey);
      await prisma.wellbeingLevelLabel.upsert({
        where: {
          dimensionId_level: { dimensionId: row.id, level },
        },
        update: { label },
        create: { dimensionId: row.id, level, label },
      });
    }
  }
}
