import { BadRequestException, ConflictException } from '@nestjs/common';
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
  // Current version only; older versions are served by PayCardsService.listVersions.
  rules: { where: { supersededAt: null }, orderBy: { sortOrder: 'asc' as const } },
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

export type PayCardResolveSource = 'EMPLOYEE_FUNDER' | 'EXPLICIT' | 'MATCHED' | 'NONE';

export type EmployeeFunderPayAssignmentRow = {
  id: string;
  employeeId: string;
  funderId: string;
  payCardId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  deletedAt?: Date | null;
};

/** Every active employee+funder pay assignment effective on `at` (UTC date), latest start first. */
export function effectiveEmployeeFunderPayAssignments<
  T extends EmployeeFunderPayAssignmentRow,
>(assignments: T[], at = new Date()): T[] {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  return assignments
    .filter((row) => !row.deletedAt)
    .filter((row) => row.effectiveFrom <= day)
    .filter((row) => !row.effectiveTo || row.effectiveTo >= day)
    .sort((a, b) => {
      const fromDiff = b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
      if (fromDiff !== 0) return fromDiff;
      return b.id.localeCompare(a.id);
    });
}

/** Pick the active employee+funder pay assignment effective on `at` (UTC date). */
export function pickEffectiveEmployeeFunderPayAssignment<
  T extends EmployeeFunderPayAssignmentRow,
>(assignments: T[], at = new Date()): T | null {
  return effectiveEmployeeFunderPayAssignments(assignments, at)[0] ?? null;
}

export async function assertEmployeeDefaultPayCard(
  tx: Tx,
  defaultPayCardId: string | null | undefined,
  employment?: EmploymentPayCardMatchInput | null,
) {
  if (!defaultPayCardId) return;
  const card = await tx.payCard.findFirst({
    where: { id: defaultPayCardId, deletedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      assignmentLevel: true,
      assignmentTargetId: true,
      assignmentTargetKey: true,
    },
  });
  if (!card) throw new BadRequestException('Selected pay card was not found');

  if (!employment) return;

  if (card.assignmentLevel === 'CLIENT_FUNDER') {
    throw new BadRequestException(
      'Client/funder pay cards cannot be assigned as an employee default',
    );
  }

  if (!employmentMatchesPayCard(employment, card)) {
    if (card.assignmentLevel === 'BRANCH') {
      throw new BadRequestException(
        `Pay card "${card.code}" belongs to a different branch than this carer`,
      );
    }
    if (card.assignmentLevel === 'ROLE') {
      throw new BadRequestException(
        `Pay card "${card.code}" is for a different role than this carer`,
      );
    }
    if (card.assignmentLevel === 'EMPLOYMENT_TYPE') {
      throw new BadRequestException(
        `Pay card "${card.code}" is for a different employment type than this carer`,
      );
    }
    if (card.assignmentLevel === 'WORKER_TYPE') {
      throw new BadRequestException(
        `Pay card "${card.code}" is for a different worker type than this carer`,
      );
    }
    if (card.assignmentLevel === 'INDIVIDUAL') {
      throw new BadRequestException(
        `Pay card "${card.code}" is assigned to a different individual worker`,
      );
    }
    throw new BadRequestException(
      `Pay card "${card.code}" does not match this carer's employment details`,
    );
  }
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

/**
 * The card that applies to a carer by matching (individual, role, branch, employment type, worker
 * type, organisation default — the most specific level wins).
 *
 * PC-32: when more than one card matches at the winning level there is no rule that says which
 * one the carer is paid on, so none is chosen: `conflicting` lists them and `card` is null. The
 * most recently edited card used to win silently.
 */
export function matchPayCards<T extends PayCard>(
  employment: EmploymentPayCardMatchInput,
  cards: T[],
  options?: { statuses?: PayCard['status'][]; at?: Date },
): { card: T | null; conflicting: T[] } {
  const statuses = options?.statuses ?? ['ACTIVE'];
  const at = options?.at ?? new Date();
  const eligible = cards
    .filter(card => statuses.includes(card.status))
    .filter(card => isPayCardEffectiveInternal(card, at))
    .filter(card => employmentMatchesPayCard(employment, card));
  if (!eligible.length) return { card: null, conflicting: [] };
  const best = Math.min(
    ...eligible.map(card => PAY_CARD_ASSIGNMENT_LEVEL_PRIORITY[card.assignmentLevel]),
  );
  const winners = eligible
    .filter(card => PAY_CARD_ASSIGNMENT_LEVEL_PRIORITY[card.assignmentLevel] === best)
    .sort((a, b) => a.code.localeCompare(b.code));
  if (winners.length > 1) return { card: null, conflicting: winners };
  return { card: winners[0], conflicting: [] };
}

export type PayCardConflictKind = 'MATCHED_LEVEL' | 'OWN_CARD' | 'FUNDER_OVERRIDE';

export type PayCardConflictCard = {
  id: string;
  code: string;
  name: string;
  version: number;
  assignmentLevel: PayCardAssignmentLevel;
  assignmentLabel: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type PayCardConflictDetail = {
  kind: PayCardConflictKind;
  level: PayCardAssignmentLevel | null;
  /** The day the card was needed for (YYYY-MM-DD). */
  day: string;
  cards: PayCardConflictCard[];
};

const PAY_CARD_LEVEL_WORDS: Record<PayCardAssignmentLevel, string> = {
  INDIVIDUAL: 'individual',
  CLIENT_FUNDER: 'client / funder',
  ROLE: 'role',
  BRANCH: 'branch',
  EMPLOYMENT_TYPE: 'employment type',
  WORKER_TYPE: 'worker type',
  ORGANISATION_DEFAULT: 'organisation default',
};

export function payCardConflictCard(
  card: Pick<
    PayCard,
    | 'id'
    | 'code'
    | 'name'
    | 'version'
    | 'assignmentLevel'
    | 'assignmentLabel'
    | 'effectiveFrom'
    | 'effectiveTo'
  >,
): PayCardConflictCard {
  return {
    id: card.id,
    code: card.code,
    name: card.name,
    version: card.version,
    assignmentLevel: card.assignmentLevel,
    assignmentLabel: card.assignmentLabel,
    effectiveFrom: card.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: card.effectiveTo ? card.effectiveTo.toISOString().slice(0, 10) : null,
  };
}

/** What is wrong and what the office can do about it; shown wherever pay is held for it. */
export function describePayCardConflict(conflict: PayCardConflictDetail): string {
  const names = conflict.cards.map(card => `${card.code} "${card.name}"`);
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  const count = conflict.cards.length === 2 ? 'Two' : String(conflict.cards.length);
  switch (conflict.kind) {
    case 'FUNDER_OVERRIDE':
      return `${count} funder pay card overrides for this carer and funder cover ${conflict.day}: ${list}. End or remove all but one of them; no card is chosen until then.`;
    case 'OWN_CARD':
      return `The carer's own pay card history has overlapping entries covering ${conflict.day} (${list}). Correct the dates in the carer's pay card history; no card is chosen until then.`;
    default:
      return `${count} pay cards apply to this carer on ${conflict.day} at the same level (${PAY_CARD_LEVEL_WORDS[conflict.level ?? 'ORGANISATION_DEFAULT']}): ${list}. No card is chosen until one of them is ended before that date or the carer is given their own pay card.`;
  }
}

/** PC-32: a carer's pay card cannot be decided. 409, with the cards concerned. */
export class PayCardConflictException extends ConflictException {
  constructor(readonly conflict: PayCardConflictDetail) {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: 'PAY_CARD_CONFLICT',
      message: describePayCardConflict(conflict),
      conflict,
    });
  }
}

/** Same level and same target: two such cards in force on the same day cannot both apply. */
export function payCardTargetsEqual(a: PayCardAssignmentTarget, b: PayCardAssignmentTarget) {
  return (
    a.assignmentLevel === b.assignmentLevel &&
    (a.assignmentTargetId ?? null) === (b.assignmentTargetId ?? null) &&
    (a.assignmentTargetKey ?? null) === (b.assignmentTargetKey ?? null)
  );
}

type DateWindow = { effectiveFrom: Date; effectiveTo: Date | null };

/** First day both windows cover, or null when they never overlap. */
export function firstOverlapDay(a: DateWindow, b: DateWindow): Date | null {
  const start = a.effectiveFrom > b.effectiveFrom ? a.effectiveFrom : b.effectiveFrom;
  if (a.effectiveTo && a.effectiveTo < start) return null;
  if (b.effectiveTo && b.effectiveTo < start) return null;
  return start;
}
