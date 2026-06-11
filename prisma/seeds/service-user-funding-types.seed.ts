import type { PrismaClient } from '@prisma/client';
import { DEFAULT_SERVICE_USER_FUNDING_TYPES } from '../seed-data/service-user-funding-type.defaults';

export async function seedServiceUserFundingTypes(prisma: PrismaClient): Promise<number> {
  for (const row of DEFAULT_SERVICE_USER_FUNDING_TYPES) {
    await prisma.serviceUserFundingType.upsert({
      where: { code: row.code },
      update: { name: row.name, isActive: true },
      create: { name: row.name, code: row.code },
    });
  }
  return DEFAULT_SERVICE_USER_FUNDING_TYPES.length;
}
