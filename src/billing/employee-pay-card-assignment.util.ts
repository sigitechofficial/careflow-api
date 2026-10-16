import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';

type Tx = Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

export type EmployeePayCardAssignmentWindow = {
  payCardId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  createdAt: Date;
};

/** YYYY-MM-DD of a `@db.Date` value (stored as UTC midnight). */
export function dateOnlyKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function parseDateOnlyKey(key: string): Date {
  return new Date(`${key.slice(0, 10)}T00:00:00.000Z`);
}

export function previousDay(value: Date): Date {
  return new Date(value.getTime() - DAY_MS);
}

/** Latest row first: by effectiveFrom (null = from the start, i.e. earliest), then created time. */
export function sortAssignmentsLatestFirst<T extends EmployeePayCardAssignmentWindow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const af = a.effectiveFrom ? dateOnlyKey(a.effectiveFrom) : '';
    const bf = b.effectiveFrom ? dateOnlyKey(b.effectiveFrom) : '';
    if (af !== bf) return bf.localeCompare(af);
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/** Every row covering a calendar day (YYYY-MM-DD), latest first. More than one is a conflict (PC-32). */
export function assignmentsCoveringDay<T extends EmployeePayCardAssignmentWindow>(
  rows: T[],
  dayKey: string,
): T[] {
  return sortAssignmentsLatestFirst(rows).filter((row) => {
    const fromOk = !row.effectiveFrom || dateOnlyKey(row.effectiveFrom) <= dayKey;
    const toOk = !row.effectiveTo || dateOnlyKey(row.effectiveTo) >= dayKey;
    return fromOk && toOk;
  });
}

/** Row covering a calendar day (YYYY-MM-DD), or null when the carer had no own card that day. */
export function pickAssignmentForDay<T extends EmployeePayCardAssignmentWindow>(
  rows: T[],
  dayKey: string,
): T | null {
  for (const row of sortAssignmentsLatestFirst(rows)) {
    const fromOk = !row.effectiveFrom || dateOnlyKey(row.effectiveFrom) <= dayKey;
    const toOk = !row.effectiveTo || dateOnlyKey(row.effectiveTo) >= dayKey;
    if (fromOk && toOk) return row;
  }
  return null;
}

/**
 * Records a change of the carer's own pay card from `effectiveFrom` (default: today). The previous row
 * is closed the day before, so visits dated earlier keep the old card. Changes cannot be dated before
 * the latest row. Callers keep `EmployeeEmployment.defaultPayCardId` pointing at the latest card.
 */
export async function recordEmployeePayCardChange(
  tx: Tx,
  input: {
    employeeId: string;
    payCardId: string | null;
    effectiveFrom?: Date | null;
    reason?: string | null;
    userId?: string | null;
  },
): Promise<{ changed: boolean }> {
  // PC-32: changes for one carer take turns. Two at once used to both close the same row and both
  // open a new one, leaving two cards in force on the same days.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-pay-card:${input.employeeId}`}))`;
  const rows = await tx.employeePayCardAssignment.findMany({ where: { employeeId: input.employeeId } });
  const latest = sortAssignmentsLatestFirst(rows)[0] ?? null;

  if (!latest) {
    if (!input.payCardId) return { changed: false };
    // First own card: applies from the start unless a date was chosen (same as before history existed).
    await tx.employeePayCardAssignment.create({
      data: {
        employeeId: input.employeeId,
        payCardId: input.payCardId,
        effectiveFrom: input.effectiveFrom ?? null,
        reason: input.reason?.trim() || null,
        createdById: input.userId ?? null,
      },
    });
    return { changed: true };
  }

  if (latest.payCardId === input.payCardId && !latest.effectiveTo) return { changed: false };

  const from = input.effectiveFrom ?? parseDateOnlyKey(dayKeyInTimeZone(new Date()));
  if (latest.effectiveFrom && dateOnlyKey(from) < dateOnlyKey(latest.effectiveFrom)) {
    throw new BadRequestException(
      `The new pay card must apply on or after ${dateOnlyKey(latest.effectiveFrom)}, when the current card started.`,
    );
  }
  await tx.employeePayCardAssignment.update({
    where: { id: latest.id },
    data: { effectiveTo: previousDay(from) },
  });
  await tx.employeePayCardAssignment.create({
    data: {
      employeeId: input.employeeId,
      payCardId: input.payCardId,
      effectiveFrom: from,
      reason: input.reason?.trim() || null,
      createdById: input.userId ?? null,
    },
  });
  return { changed: true };
}
