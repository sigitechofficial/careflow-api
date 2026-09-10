import { NotFoundException } from '@nestjs/common';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { PrismaService } from '../prisma/prisma.service';

/** Ensure SU exists and is within the caller's org/branch scope (IDOR-safe 404). */
export async function assertServiceUserAccessible(
  prisma: PrismaService,
  orgScope: OrgScopeService,
  user: RequestUser,
  serviceUserId: string,
): Promise<{ id: string; locationId: string | null }> {
  const scope = orgScope.fromRequestUser(user);
  await orgScope.assertServiceUserInScope(scope, serviceUserId);
  const su = await prisma.serviceUser.findFirst({
    where: { id: serviceUserId, deletedAt: null },
    select: { id: true, locationId: true },
  });
  if (!su) throw new NotFoundException('Service user not found');
  return su;
}

export function userHasPermission(user: RequestUser, ...keys: string[]): boolean {
  const perms = user.permissions ?? [];
  return keys.some((k) => perms.includes(k));
}
