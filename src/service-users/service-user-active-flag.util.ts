import type { Prisma } from '@prisma/client';

/**
 * Statuses that mean the person no longer receives care. Their record stays (it is not deleted), but it is
 * marked not active so dashboards, rotas and the default list stop counting them. Every other status —
 * Active, On hold, Pending, Pre-admission — keeps the person active.
 */
export const NOT_ACTIVE_SERVICE_USER_STATUS_CODES: ReadonlySet<string> = new Set(['DISCHARGED', 'DECEASED', 'INACTIVE']);

/** Whether a service user with this status should be marked active. No status counts as active. */
export function isActiveForStatus(statusCode: string | null | undefined): boolean {
  return !statusCode || !NOT_ACTIVE_SERVICE_USER_STATUS_CODES.has(statusCode);
}

/** Bring `ServiceUser.isActive` in step with the person's status. Call after any status change. */
export async function syncServiceUserActiveFlag(tx: Prisma.TransactionClient, serviceUserId: string): Promise<void> {
  const su = await tx.serviceUser.findFirst({
    where: { id: serviceUserId, deletedAt: null },
    select: { isActive: true, status: { select: { code: true } } },
  });
  if (!su) return;
  const shouldBe = isActiveForStatus(su.status?.code);
  if (su.isActive !== shouldBe) {
    await tx.serviceUser.update({ where: { id: serviceUserId }, data: { isActive: shouldBe } });
  }
}
