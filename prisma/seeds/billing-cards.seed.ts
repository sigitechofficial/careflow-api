import { PrismaClient } from '@prisma/client';
import { seedChargeCards } from './charge-cards.seed';
import { seedPayCards } from './pay-cards.seed';

export async function seedBillingCards(prisma: PrismaClient) {
  await seedPayCards(prisma);
  await seedChargeCards(prisma);
}
