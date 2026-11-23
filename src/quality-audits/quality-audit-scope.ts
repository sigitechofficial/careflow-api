import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrgScope } from '../common/org-scope/org-scope.types';

/**
 * Branch scope for audits and schedules, as for mock inspections: branch-restricted users see their
 * branches' records and whole-organisation ones (locationId null), and can only make or change
 * records for their own branches.
 */
export function locationVisibleWhere(scope: OrgScope): {
  OR?: Array<{ locationId: { in: string[] } | null }>;
} {
  if (scope.locationIds === null) return {};
  return {
    OR: [{ locationId: { in: scope.locationIds } }, { locationId: null }],
  };
}

export const auditVisibleWhere = (scope: OrgScope) =>
  locationVisibleWhere(scope) as Prisma.QualityAuditWhereInput;
export const scheduleVisibleWhere = (scope: OrgScope) =>
  locationVisibleWhere(scope) as Prisma.QualityAuditScheduleWhereInput;

export async function assertWritableLocation(
  prisma: PrismaService,
  scope: OrgScope,
  locationId: string | null,
  what = 'An audit',
): Promise<void> {
  if (scope.locationIds !== null) {
    if (!locationId)
      throw new ForbiddenException(
        `${what} of the whole organisation needs access to all branches. Choose your branch.`,
      );
    if (!scope.locationIds.includes(locationId))
      throw new ForbiddenException('You can only choose your own branches.');
  }
  if (locationId) {
    const found = await prisma.location.count({
      where: { id: locationId, deletedAt: null },
    });
    if (!found) throw new BadRequestException('Branch not found');
  }
}

export async function assertActiveUser(
  prisma: PrismaService,
  id: string | null | undefined,
  what: string,
): Promise<void> {
  if (!id) return;
  const found = await prisma.user.count({
    where: { id, deletedAt: null, isActive: true },
  });
  if (!found) throw new BadRequestException(`${what} was not found`);
}

/** User id → "First Last" (or email). */
export async function userNames(
  prisma: PrismaService,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  return new Map(
    users.map((u) => [
      u.id,
      [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
        u.email ||
        'User',
    ]),
  );
}

export async function locationNames(
  prisma: PrismaService,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (!unique.length) return new Map();
  const rows = await prisma.location.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((l) => [l.id, l.name]));
}

/** "Infection prevention and control, November 2026". */
export function defaultAuditTitle(templateTitle: string, day: string) {
  const month = new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${templateTitle}, ${month}`;
}
