import type { PrismaClient } from '@prisma/client';
import { DEFAULT_SERVICE_USER_FUNDING_TYPES } from '../seed-data/service-user-funding-type.defaults';
import { billingCodeForFundingRoute } from '../seed-data/funding-route-billing-type';

export async function seedServiceUserFundingTypes(prisma: PrismaClient): Promise<number> {
  const billing = new Map(
    (await prisma.fundingType.findMany({ where: { deletedAt: null }, select: { id: true, code: true } })).map((b) => [
      b.code,
      b.id,
    ]),
  );
  for (const row of DEFAULT_SERVICE_USER_FUNDING_TYPES) {
    const code = billingCodeForFundingRoute(row.code);
    const billingFundingTypeId = code ? (billing.get(code) ?? null) : null;
    const saved = await prisma.serviceUserFundingType.upsert({
      where: { code: row.code },
      update: { name: row.name, isActive: true },
      create: { name: row.name, code: row.code, billingFundingTypeId },
      select: { id: true, billingFundingTypeId: true },
    });
    // Never overwrite a billing type a manager has chosen; only fill an empty one.
    if (!saved.billingFundingTypeId && billingFundingTypeId) {
      await prisma.serviceUserFundingType.update({ where: { id: saved.id }, data: { billingFundingTypeId } });
    }
  }
  return DEFAULT_SERVICE_USER_FUNDING_TYPES.length;
}
