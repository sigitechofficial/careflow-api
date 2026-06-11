import type { PrismaClient } from '@prisma/client';
import { DEFAULT_SERVICE_USER_ETHNICITIES } from '../seed-data/service-user-ethnicity-language.defaults';

export async function seedServiceUserEthnicities(prisma: PrismaClient): Promise<number> {
  for (const row of DEFAULT_SERVICE_USER_ETHNICITIES) {
    await prisma.serviceUserEthnicity.upsert({
      where: { code: row.code },
      update: { name: row.name, isActive: true },
      create: { name: row.name, code: row.code },
    });
  }
  return DEFAULT_SERVICE_USER_ETHNICITIES.length;
}
