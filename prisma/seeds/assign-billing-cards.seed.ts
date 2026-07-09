import { PrismaClient } from '@prisma/client';
import {
  pickBestMatchingChargeCard,
  pickBestMatchingPayCard,
} from './billing-card-assignment.util';
import { seedBillingCards } from './billing-cards.seed';

const FALLBACK_PAY_CARD_CODE = 'PAY-LON-2026';
const FALLBACK_AGENCY_PAY_CARD_CODE = 'PAY-AGY-2026';
const FALLBACK_CHARGE_CARD_CODE = 'CHG-PVT-DEF';

export type AssignMissingBillingCardsResult = {
  payAssigned: number;
  paySkipped: number;
  chargeAssigned: number;
  chargeSkipped: number;
  employeesWithoutEmployment: number;
};

async function ensureBillingCardsActive(prisma: PrismaClient) {
  await prisma.payCard.updateMany({
    where: {
      deletedAt: null,
      code: { in: [FALLBACK_PAY_CARD_CODE, FALLBACK_AGENCY_PAY_CARD_CODE] },
    },
    data: { status: 'ACTIVE' },
  });
  await prisma.chargeCard.updateMany({
    where: {
      deletedAt: null,
      code: { in: [FALLBACK_CHARGE_CARD_CODE, 'CHG-LA-LON-26'] },
    },
    data: { status: 'ACTIVE' },
  });
}

export async function assignMissingBillingCards(
  prisma: PrismaClient,
): Promise<AssignMissingBillingCardsResult> {
  await seedBillingCards(prisma);
  await ensureBillingCardsActive(prisma);

  const [payCards, chargeCards] = await Promise.all([
    prisma.payCard.findMany({ where: { deletedAt: null } }),
    prisma.chargeCard.findMany({ where: { deletedAt: null } }),
  ]);

  const orgDefaultPay =
    payCards.find((c) => c.code === FALLBACK_PAY_CARD_CODE && c.status === 'ACTIVE') ??
    payCards.find(
      (c) => c.assignmentLevel === 'ORGANISATION_DEFAULT' && c.status === 'ACTIVE',
    ) ??
    payCards.find((c) => c.status === 'ACTIVE') ??
    null;

  const agencyPay =
    payCards.find((c) => c.code === FALLBACK_AGENCY_PAY_CARD_CODE && c.status === 'ACTIVE') ??
    null;

  const orgDefaultCharge =
    chargeCards.find((c) => c.code === FALLBACK_CHARGE_CARD_CODE && c.status === 'ACTIVE') ??
    chargeCards.find(
      (c) => c.assignmentLevel === 'ORGANISATION_DEFAULT' && c.status === 'ACTIVE',
    ) ??
    chargeCards.find((c) => c.status === 'ACTIVE') ??
    null;

  const employments = await prisma.employeeEmployment.findMany({
    where: {
      deletedAt: null,
      defaultPayCardId: null,
      employee: { deletedAt: null, isActive: true },
    },
    select: {
      id: true,
      employeeId: true,
      roleId: true,
      locationId: true,
      baseLocationId: true,
      contractTypeId: true,
      isAgencyStaff: true,
      isBankStaff: true,
      employee: {
        select: {
          personalDetail: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  let payAssigned = 0;
  let paySkipped = 0;

  for (const employment of employments) {
    const matched = pickBestMatchingPayCard(
      {
        roleId: employment.roleId,
        locationId: employment.locationId,
        baseLocationId: employment.baseLocationId,
        contractTypeId: employment.contractTypeId,
        isAgencyStaff: employment.isAgencyStaff,
        isBankStaff: employment.isBankStaff,
      },
      payCards,
    );

    const card =
      matched ??
      (employment.isAgencyStaff ? agencyPay : null) ??
      orgDefaultPay;

    if (!card) {
      paySkipped += 1;
      continue;
    }

    await prisma.employeeEmployment.update({
      where: { id: employment.id },
      data: { defaultPayCardId: card.id },
    });
    payAssigned += 1;
  }

  const serviceUsers = await prisma.serviceUser.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      defaultChargeCardId: null,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      locationId: true,
      currentFunding: {
        select: {
          id: true,
          funderId: true,
          packageName: true,
        },
      },
    },
  });

  let chargeAssigned = 0;
  let chargeSkipped = 0;

  for (const serviceUser of serviceUsers) {
    const matched = pickBestMatchingChargeCard(
      {
        serviceUserId: serviceUser.id,
        locationId: serviceUser.locationId,
        fundingId: serviceUser.currentFunding?.id ?? null,
        funderId: serviceUser.currentFunding?.funderId ?? null,
        packageName: serviceUser.currentFunding?.packageName ?? null,
        householdKey: null,
        serviceTypeKey: null,
      },
      chargeCards,
    );

    const card = matched ?? orgDefaultCharge;
    if (!card) {
      chargeSkipped += 1;
      continue;
    }

    await prisma.serviceUser.update({
      where: { id: serviceUser.id },
      data: { defaultChargeCardId: card.id },
    });
    chargeAssigned += 1;
  }

  const employeesWithoutEmployment = await prisma.employee.count({
    where: {
      deletedAt: null,
      isActive: true,
      employment: null,
    },
  });

  return {
    payAssigned,
    paySkipped,
    chargeAssigned,
    chargeSkipped,
    employeesWithoutEmployment,
  };
}
