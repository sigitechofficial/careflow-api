import { BadRequestException } from '@nestjs/common';
import { PayCard, PayCardAssignmentLevel, Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export const PAY_CARD_WORKER_TYPE_KEYS = ['AGENCY', 'BANK', 'INTERNAL'] as const;
export type PayCardWorkerTypeKey = (typeof PAY_CARD_WORKER_TYPE_KEYS)[number];

export const PAY_CARD_ASSIGNMENT_LEVEL_PRIORITY: Record<PayCardAssignmentLevel, number> = {
  INDIVIDUAL: 0,
  CLIENT_FUNDER: 1,
  ROLE: 2,
  BRANCH: 3,
  EMPLOYMENT_TYPE: 4,
  WORKER_TYPE: 5,
  ORGANISATION_DEFAULT: 6,
};

const activeAssignedEmploymentWhere = {
  deletedAt: null,
  isActive: true,
  employee: { deletedAt: null, isActive: true },
} as const

export const payCardListInclude = {
  rules: { orderBy: { sortOrder: 'asc' as const } },
  _count: {
    select: {
      defaultEmployments: { where: activeAssignedEmploymentWhere },
    },
  },
  defaultEmployments: {
    where: activeAssignedEmploymentWhere,
    orderBy: { updatedAt: 'desc' as const },
    take: 200,
    select: {
      employeeId: true,
      employeeNumber: true,
      employee: {
        select: {
          id: true,
          personalDetail: {
            select: { firstName: true, lastName: true },
          },
        },
      },
    },
  },
} as const;

export type EmploymentPayCardMatchInput = {
  employeeId?: string | null;
  roleId: string | null;
  locationId: string | null;
  baseLocationId: string | null;
  contractTypeId: string | null;
  isAgencyStaff: boolean;
  isBankStaff: boolean;
};

export type PayCardAssignmentTarget = Pick<
  PayCard,
  'assignmentLevel' | 'assignmentTargetId' | 'assignmentTargetKey'
>;

export type PayCardResolveSource = 'EXPLICIT' | 'MATCHED' | 'NONE';

export async function assertEmployeeDefaultPayCard(
  tx: Tx,
  defaultPayCardId: string | null | undefined,
) {
  if (!defaultPayCardId) return;
  const card = await tx.payCard.findFirst({
    where: { id: defaultPayCardId, deletedAt: null },
    select: { id: true },
  });
  if (!card) throw new BadRequestException('Selected pay card was not found');
}

export function isPayCardWorkerTypeKey(value: string): value is PayCardWorkerTypeKey {
  return PAY_CARD_WORKER_TYPE_KEYS.includes(value as PayCardWorkerTypeKey);
}

export function normalizePayCardAssignmentInput(input: {
  assignmentLevel?: PayCardAssignmentLevel;
  assignmentTargetId?: string | null;
  assignmentTargetKey?: string | null;
}): { assignmentTargetId: string | null; assignmentTargetKey: string | null } {
  const level = input.assignmentLevel ?? 'ORGANISATION_DEFAULT';
  if (level === 'ORGANISATION_DEFAULT') {
    return { assignmentTargetId: null, assignmentTargetKey: null };
  }
  if (level === 'WORKER_TYPE') {
    const key = input.assignmentTargetKey?.trim().toUpperCase() ?? null;
    if (!key || !isPayCardWorkerTypeKey(key)) {
      throw new BadRequestException('Worker type is required for worker-type pay cards');
    }
    return { assignmentTargetId: null, assignmentTargetKey: key };
  }
  // INDIVIDUAL / CLIENT_FUNDER / ROLE / BRANCH / EMPLOYMENT_TYPE all need a target id
  const targetId = input.assignmentTargetId?.trim() || null;
  if (!targetId) {
    throw new BadRequestException('Assignment target is required for this pay card type');
  }
  return { assignmentTargetId: targetId, assignmentTargetKey: null };
}

export async function resolveAssignmentLabel(
  tx: Tx,
  level: PayCardAssignmentLevel,
  assignmentTargetId: string | null,
  assignmentTargetKey: string | null,
): Promise<string | null> {
  switch (level) {
    case 'ROLE': {
      if (!assignmentTargetId) return null;
      const row = await tx.employeeRoleLookup.findUnique({
        where: { id: assignmentTargetId },
        select: { name: true },
      });
      return row?.name ?? null;
    }
    case 'BRANCH': {
      if (!assignmentTargetId) return null;
      const row = await tx.location.findUnique({
        where: { id: assignmentTargetId },
        select: { name: true },
      });
      return row?.name ?? null;
    }
    case 'EMPLOYMENT_TYPE': {
      if (!assignmentTargetId) return null;
      const row = await tx.contractType.findUnique({
        where: { id: assignmentTargetId },
        select: { name: true },
      });
      return row?.name ?? null;
    }
    case 'WORKER_TYPE': {
      if (!assignmentTargetKey) return null;
      if (assignmentTargetKey === 'AGENCY') return 'Agency workers';
      if (assignmentTargetKey === 'BANK') return 'Bank staff';
      return 'Internal staff';
    }
    case 'INDIVIDUAL':
      return assignmentTargetId ? `Individual worker` : 'Individual worker';
    case 'CLIENT_FUNDER':
      return assignmentTargetId ? 'Client / funder pay rate' : 'Client / funder';
    case 'ORGANISATION_DEFAULT':
      return 'Organisation default';
    default:
      return null;
  }
}

export function employmentMatchesPayCard(
  employment: EmploymentPayCardMatchInput,
  card: PayCardAssignmentTarget,
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
    case 'INDIVIDUAL':
      return !!card.assignmentTargetId && employment.employeeId === card.assignmentTargetId;
    case 'CLIENT_FUNDER':
      // Resolved at visit/funding level, not employment match alone.
      return false;
    case 'ORGANISATION_DEFAULT':
      return true;
    default:
      return false;
  }
}

export function buildEmploymentWhereForPayCard(
  card: PayCardAssignmentTarget,
): Prisma.EmployeeEmploymentWhereInput {
  const base: Prisma.EmployeeEmploymentWhereInput = {
    deletedAt: null,
    employee: { deletedAt: null, isActive: true },
  };

  switch (card.assignmentLevel) {
    case 'ROLE':
      return { ...base, roleId: card.assignmentTargetId ?? undefined };
    case 'BRANCH':
      return {
        ...base,
        OR: [
          { locationId: card.assignmentTargetId ?? undefined },
          { baseLocationId: card.assignmentTargetId ?? undefined },
        ],
      };
    case 'EMPLOYMENT_TYPE':
      return { ...base, contractTypeId: card.assignmentTargetId ?? undefined };
    case 'WORKER_TYPE':
      if (card.assignmentTargetKey === 'AGENCY') return { ...base, isAgencyStaff: true };
      if (card.assignmentTargetKey === 'BANK') return { ...base, isBankStaff: true };
      return { ...base, isAgencyStaff: false, isBankStaff: false };
    case 'ORGANISATION_DEFAULT':
      return base;
    default:
      return { id: '__no_match__' };
  }
}

export function isPayCardEffective(
  card: Pick<{ effectiveFrom: Date; effectiveTo: Date | null }, 'effectiveFrom' | 'effectiveTo'>,
  at = new Date(),
) {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (card.effectiveFrom > day) return false;
  if (card.effectiveTo && card.effectiveTo < day) return false;
  return true;
}

function isPayCardEffectiveInternal(
  card: Pick<PayCard, 'effectiveFrom' | 'effectiveTo'>,
  at = new Date(),
) {
  return isPayCardEffective(card, at);
}

export function pickBestMatchingPayCard<T extends PayCard>(
  employment: EmploymentPayCardMatchInput,
  cards: T[],
  options?: { statuses?: PayCard['status'][]; at?: Date },
): T | null {
  const statuses = options?.statuses ?? ['ACTIVE'];
  const at = options?.at ?? new Date();
  const eligible = cards
    .filter(card => statuses.includes(card.status))
    .filter(card => isPayCardEffectiveInternal(card, at))
    .filter(card => employmentMatchesPayCard(employment, card))
    .sort((a, b) => {
      const priorityDiff =
        PAY_CARD_ASSIGNMENT_LEVEL_PRIORITY[a.assignmentLevel] -
        PAY_CARD_ASSIGNMENT_LEVEL_PRIORITY[b.assignmentLevel];
      if (priorityDiff !== 0) return priorityDiff;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  return eligible[0] ?? null;
}
