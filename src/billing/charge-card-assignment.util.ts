import { BadRequestException } from '@nestjs/common';
import { ChargeCard, ChargeCardAssignmentLevel, Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export const CHARGE_CARD_ASSIGNMENT_LEVEL_PRIORITY: Record<ChargeCardAssignmentLevel, number> = {
  FUNDING_CONTRACT: 1,
  SERVICE_USER: 2,
  FUNDER: 3,
  CARE_PACKAGE: 4,
  BRANCH_REGION: 5,
  SERVICE_TYPE: 6,
  GROUP_HOUSEHOLD: 7,
  ORGANISATION_DEFAULT: 8,
};

export const chargeCardListInclude = {
  rules: { orderBy: { sortOrder: 'asc' as const } },
  _count: {
    select: {
      defaultFunders: true,
      defaultServiceUsers: true,
      defaultFundings: true,
    },
  },
} as const;

export type ServiceUserChargeContext = {
  serviceUserId: string;
  locationId: string | null;
  fundingId: string | null;
  funderId: string | null;
  packageName: string | null;
  householdKey: string | null;
  serviceTypeKey: string | null;
};

export type ChargeCardAssignmentTarget = Pick<
  ChargeCard,
  'assignmentLevel' | 'assignmentTargetId' | 'assignmentTargetKey'
>;

export type ChargeCardBulkAssignTarget =
  | { entity: 'funder'; where: Prisma.FunderWhereInput }
  | { entity: 'serviceUser'; where: Prisma.ServiceUserWhereInput }
  | { entity: 'serviceUserFunding'; where: Prisma.ServiceUserFundingWhereInput }
  | { entity: 'none' };

export async function assertDefaultChargeCard(
  tx: Tx,
  defaultChargeCardId: string | null | undefined,
) {
  if (!defaultChargeCardId) return;
  const card = await tx.chargeCard.findFirst({
    where: { id: defaultChargeCardId, deletedAt: null },
    select: { id: true },
  });
  if (!card) throw new BadRequestException('Selected charge card was not found');
}

export function normalizeChargeCardAssignmentInput(input: {
  assignmentLevel?: ChargeCardAssignmentLevel;
  assignmentTargetId?: string | null;
  assignmentTargetKey?: string | null;
}): { assignmentTargetId: string | null; assignmentTargetKey: string | null } {
  const level = input.assignmentLevel ?? 'ORGANISATION_DEFAULT';
  if (level === 'ORGANISATION_DEFAULT') {
    return { assignmentTargetId: null, assignmentTargetKey: null };
  }
  if (level === 'CARE_PACKAGE' || level === 'SERVICE_TYPE' || level === 'GROUP_HOUSEHOLD') {
    const key = input.assignmentTargetKey?.trim() || null;
    if (!key) {
      throw new BadRequestException('A target value is required for this attach-to level');
    }
    return { assignmentTargetId: null, assignmentTargetKey: key };
  }
  const targetId = input.assignmentTargetId?.trim() || null;
  if (!targetId) {
    throw new BadRequestException('Select the funder, service user, branch, or funding contract');
  }
  return { assignmentTargetId: targetId, assignmentTargetKey: null };
}

export async function resolveChargeAssignmentLabel(
  tx: Tx,
  level: ChargeCardAssignmentLevel,
  assignmentTargetId: string | null,
  assignmentTargetKey: string | null,
): Promise<string | null> {
  switch (level) {
    case 'FUNDER': {
      if (!assignmentTargetId) return null;
      const row = await tx.funder.findUnique({ where: { id: assignmentTargetId }, select: { name: true } });
      return row?.name ?? null;
    }
    case 'SERVICE_USER': {
      if (!assignmentTargetId) return null;
      const row = await tx.serviceUser.findUnique({
        where: { id: assignmentTargetId },
        select: { firstName: true, lastName: true, preferredName: true },
      });
      if (!row) return null;
      return row.preferredName?.trim() || `${row.firstName} ${row.lastName}`.trim();
    }
    case 'FUNDING_CONTRACT': {
      if (!assignmentTargetId) return null;
      const row = await tx.serviceUserFunding.findUnique({
        where: { id: assignmentTargetId },
        select: { packageName: true, fundingReference: true },
      });
      return row?.packageName?.trim() || row?.fundingReference?.trim() || null;
    }
    case 'BRANCH_REGION': {
      if (!assignmentTargetId) return null;
      const row = await tx.location.findUnique({ where: { id: assignmentTargetId }, select: { name: true } });
      return row?.name ?? null;
    }
    case 'CARE_PACKAGE':
      return assignmentTargetKey ? `Package: ${assignmentTargetKey}` : null;
    case 'SERVICE_TYPE':
      return assignmentTargetKey ? `Service type: ${assignmentTargetKey}` : null;
    case 'GROUP_HOUSEHOLD':
      return assignmentTargetKey ? `Household: ${assignmentTargetKey}` : null;
    case 'ORGANISATION_DEFAULT':
      return 'Organisation default';
    default:
      return null;
  }
}

export function serviceUserMatchesChargeCard(
  context: ServiceUserChargeContext,
  card: ChargeCardAssignmentTarget,
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

export function buildChargeCardBulkAssignTarget(card: ChargeCardAssignmentTarget): ChargeCardBulkAssignTarget {
  const active = { deletedAt: null, isActive: true };

  switch (card.assignmentLevel) {
    case 'FUNDER':
      return {
        entity: 'funder',
        where: { ...active, id: card.assignmentTargetId ?? undefined },
      };
    case 'SERVICE_USER':
      return {
        entity: 'serviceUser',
        where: { ...active, deletedAt: null, id: card.assignmentTargetId ?? undefined },
      };
    case 'FUNDING_CONTRACT':
      return {
        entity: 'serviceUserFunding',
        where: { deletedAt: null, isActive: true, id: card.assignmentTargetId ?? undefined },
      };
    case 'CARE_PACKAGE':
      return {
        entity: 'serviceUserFunding',
        where: {
          deletedAt: null,
          isActive: true,
          packageName: { equals: card.assignmentTargetKey ?? undefined, mode: 'insensitive' },
        },
      };
    case 'BRANCH_REGION':
      return {
        entity: 'serviceUser',
        where: { deletedAt: null, isActive: true, locationId: card.assignmentTargetId ?? undefined },
      };
    case 'ORGANISATION_DEFAULT':
      return {
        entity: 'serviceUser',
        where: { deletedAt: null, isActive: true },
      };
    case 'SERVICE_TYPE':
    case 'GROUP_HOUSEHOLD':
    default:
      return { entity: 'none' };
  }
}

function isChargeCardEffective(card: Pick<ChargeCard, 'effectiveFrom' | 'effectiveTo'>, at = new Date()) {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (card.effectiveFrom > day) return false;
  if (card.effectiveTo && card.effectiveTo < day) return false;
  return true;
}

export function pickBestMatchingChargeCard<T extends ChargeCard>(
  context: ServiceUserChargeContext,
  cards: T[],
  options?: { statuses?: ChargeCard['status'][]; at?: Date },
): T | null {
  const statuses = options?.statuses ?? ['ACTIVE'];
  const at = options?.at ?? new Date();
  const eligible = cards
    .filter(card => statuses.includes(card.status))
    .filter(card => isChargeCardEffective(card, at))
    .filter(card => serviceUserMatchesChargeCard(context, card))
    .sort((a, b) => {
      const priorityDiff =
        CHARGE_CARD_ASSIGNMENT_LEVEL_PRIORITY[a.assignmentLevel] -
        CHARGE_CARD_ASSIGNMENT_LEVEL_PRIORITY[b.assignmentLevel];
      if (priorityDiff !== 0) return priorityDiff;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  return eligible[0] ?? null;
}
