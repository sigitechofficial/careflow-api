import {
  ChargeCard,
  ChargeCardAssignmentLevel,
  PayCard,
  PayCardAssignmentLevel,
} from '@prisma/client';

const PAY_CARD_ASSIGNMENT_LEVEL_PRIORITY: Record<PayCardAssignmentLevel, number> = {
  ROLE: 1,
  BRANCH: 2,
  EMPLOYMENT_TYPE: 3,
  WORKER_TYPE: 4,
  ORGANISATION_DEFAULT: 5,
};

const CHARGE_CARD_ASSIGNMENT_LEVEL_PRIORITY: Record<ChargeCardAssignmentLevel, number> = {
  FUNDING_CONTRACT: 1,
  SERVICE_USER: 2,
  FUNDER: 3,
  CARE_PACKAGE: 4,
  BRANCH_REGION: 5,
  SERVICE_TYPE: 6,
  GROUP_HOUSEHOLD: 7,
  ORGANISATION_DEFAULT: 8,
};

export type EmploymentPayCardMatchInput = {
  roleId: string | null;
  locationId: string | null;
  baseLocationId: string | null;
  contractTypeId: string | null;
  isAgencyStaff: boolean;
  isBankStaff: boolean;
};

export type ServiceUserChargeContext = {
  serviceUserId: string;
  locationId: string | null;
  fundingId: string | null;
  funderId: string | null;
  packageName: string | null;
  householdKey: string | null;
  serviceTypeKey: string | null;
};

function isPayCardEffective(
  card: Pick<PayCard, 'effectiveFrom' | 'effectiveTo'>,
  at = new Date(),
) {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (card.effectiveFrom > day) return false;
  if (card.effectiveTo && card.effectiveTo < day) return false;
  return true;
}

function isChargeCardEffective(
  card: Pick<ChargeCard, 'effectiveFrom' | 'effectiveTo'>,
  at = new Date(),
) {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (card.effectiveFrom > day) return false;
  if (card.effectiveTo && card.effectiveTo < day) return false;
  return true;
}

function employmentMatchesPayCard(
  employment: EmploymentPayCardMatchInput,
  card: Pick<PayCard, 'assignmentLevel' | 'assignmentTargetId' | 'assignmentTargetKey'>,
): boolean {
  switch (card.assignmentLevel) {
    case 'ROLE':
      return !!card.assignmentTargetId && employment.roleId === card.assignmentTargetId;
    case 'BRANCH':
      return (
        !!card.assignmentTargetId &&
        (employment.locationId === card.assignmentTargetId ||
          employment.baseLocationId === card.assignmentTargetId)
      );
    case 'EMPLOYMENT_TYPE':
      return !!card.assignmentTargetId && employment.contractTypeId === card.assignmentTargetId;
    case 'WORKER_TYPE':
      if (!card.assignmentTargetKey) return false;
      if (card.assignmentTargetKey === 'AGENCY') return employment.isAgencyStaff;
      if (card.assignmentTargetKey === 'BANK') return employment.isBankStaff;
      return !employment.isAgencyStaff && !employment.isBankStaff;
    case 'ORGANISATION_DEFAULT':
      return true;
    default:
      return false;
  }
}

function serviceUserMatchesChargeCard(
  context: ServiceUserChargeContext,
  card: Pick<ChargeCard, 'assignmentLevel' | 'assignmentTargetId' | 'assignmentTargetKey'>,
): boolean {
  switch (card.assignmentLevel) {
    case 'FUNDING_CONTRACT':
      return !!card.assignmentTargetId && context.fundingId === card.assignmentTargetId;
    case 'SERVICE_USER':
      return !!card.assignmentTargetId && context.serviceUserId === card.assignmentTargetId;
    case 'FUNDER':
      return !!card.assignmentTargetId && context.funderId === card.assignmentTargetId;
    case 'CARE_PACKAGE':
      return (
        !!card.assignmentTargetKey &&
        !!context.packageName &&
        context.packageName.toLowerCase() === card.assignmentTargetKey.toLowerCase()
      );
    case 'BRANCH_REGION':
      return !!card.assignmentTargetId && context.locationId === card.assignmentTargetId;
    case 'SERVICE_TYPE':
      return (
        !!card.assignmentTargetKey &&
        !!context.serviceTypeKey &&
        context.serviceTypeKey.toLowerCase() === card.assignmentTargetKey.toLowerCase()
      );
    case 'GROUP_HOUSEHOLD':
      return (
        !!card.assignmentTargetKey &&
        !!context.householdKey &&
        context.householdKey.toLowerCase() === card.assignmentTargetKey.toLowerCase()
      );
    case 'ORGANISATION_DEFAULT':
      return true;
    default:
      return false;
  }
}

export function pickBestMatchingPayCard<T extends PayCard>(
  employment: EmploymentPayCardMatchInput,
  cards: T[],
  options?: { statuses?: PayCard['status'][]; at?: Date },
): T | null {
  const statuses = options?.statuses ?? ['ACTIVE'];
  const at = options?.at ?? new Date();
  const eligible = cards
    .filter((card) => statuses.includes(card.status))
    .filter((card) => isPayCardEffective(card, at))
    .filter((card) => employmentMatchesPayCard(employment, card))
    .sort((a, b) => {
      const priorityDiff =
        PAY_CARD_ASSIGNMENT_LEVEL_PRIORITY[a.assignmentLevel] -
        PAY_CARD_ASSIGNMENT_LEVEL_PRIORITY[b.assignmentLevel];
      if (priorityDiff !== 0) return priorityDiff;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  return eligible[0] ?? null;
}

export function pickBestMatchingChargeCard<T extends ChargeCard>(
  context: ServiceUserChargeContext,
  cards: T[],
  options?: { statuses?: ChargeCard['status'][]; at?: Date },
): T | null {
  const statuses = options?.statuses ?? ['ACTIVE'];
  const at = options?.at ?? new Date();
  const eligible = cards
    .filter((card) => statuses.includes(card.status))
    .filter((card) => isChargeCardEffective(card, at))
    .filter((card) => serviceUserMatchesChargeCard(context, card))
    .sort((a, b) => {
      const priorityDiff =
        CHARGE_CARD_ASSIGNMENT_LEVEL_PRIORITY[a.assignmentLevel] -
        CHARGE_CARD_ASSIGNMENT_LEVEL_PRIORITY[b.assignmentLevel];
      if (priorityDiff !== 0) return priorityDiff;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  return eligible[0] ?? null;
}
