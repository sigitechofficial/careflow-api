import { randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { endAllSignInSessions } from '../auth/sign-in-sessions/sign-in-sessions.service';
import { hashPassword } from '../common/utils/password.util';
import { IDENTITY_ROLE } from '../common/org-scope/org-scope.types';
import type { StaffAccess } from '../account-emails/staff-account-emails.content';

/**
 * Staff sign-in access, decided from the staff record.
 *
 * Office RBAC levels (Group Administrator, Administrator, Manager, Privacy Officer, Operation Management, Branch
 * Administrator, Staff Allocation, Master Staff Allocation) suggest an office login (the CareFlow website). Field
 * levels (Senior Carer/Nurse, Carer/Domestic) suggest the Care app. Both are always possible: the office decides.
 */
export const FIELD_RBAC_LEVELS = new Set(['Senior Carer/Nurse', 'Carer/Domestic']);

export type RbacLevelKind = 'office' | 'field' | null;

export function rbacLevelKind(levelName: string | null | undefined): RbacLevelKind {
  const n = levelName?.trim();
  if (!n) return null;
  return FIELD_RBAC_LEVELS.has(n) ? 'field' : 'office';
}

export function suggestedAccess(levelName: string | null | undefined): { website: boolean; app: boolean } {
  const kind = rbacLevelKind(levelName);
  return { website: kind === 'office', app: kind === 'field' };
}

/**
 * Which welcome email to send for what was just given: the access actually given decides, so nobody is sent a
 * website login they don't have, or app steps they don't need. Given on different days, the second email covers
 * only what's new (its link also sets the other account's password: one password for both).
 */
export function welcomeVariant(newly: { website: boolean; app: boolean }): StaffAccess | null {
  if (newly.website && newly.app) return 'both';
  if (newly.website) return 'website';
  if (newly.app) return 'app';
  return null;
}

/** State of one sign-in, as the staff record shows it. */
export type SignInState = 'none' | 'invited' | 'active' | 'off';

export function signInState(account: { enabled: boolean; passwordSetAt: Date | null } | null): SignInState {
  if (!account) return 'none';
  if (!account.enabled) return 'off';
  return account.passwordSetAt ? 'active' : 'invited';
}

/** A password nobody knows, for an account waiting for its owner to choose one. */
export async function unusablePasswordHash(): Promise<string> {
  return hashPassword(`unset:${randomBytes(32).toString('base64url')}`);
}

/**
 * Their last day is over: the end date is before today (UK time). Access stays on through the last working day.
 */
export function leavingDateHasPassed(endDate: Date | null | undefined, now = new Date(), timeZone = 'Europe/London'): boolean {
  if (!endDate) return false;
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return day(endDate) < day(now);
}

export type EndAccessReason = 'LEFT' | 'INACTIVE' | 'DELETED';

const END_REASON_TEXT: Record<EndAccessReason, string> = {
  LEFT: 'their end date has passed',
  INACTIVE: 'they were made inactive',
  DELETED: 'their staff record was deleted',
};

/**
 * A staff member left or was made inactive: switch off their Care app access and office login, and sign them out
 * on every device. The office login is the one linked to their Care app account, or the one using their staff
 * email; a Super Admin login is never switched off this way. Runs inside the caller's transaction.
 * Returns what was switched off.
 */
export async function endStaffSignIns(
  tx: Prisma.TransactionClient,
  employeeId: string,
  reason: EndAccessReason,
  actorUserId: string | null,
): Promise<{ app: boolean; website: boolean; description: string | null }> {
  const employee = await tx.employee.findFirst({
    where: { id: employeeId },
    select: { personalDetail: { select: { email: true } }, portalAccount: { select: { id: true, isEnabled: true, deletedAt: true, userId: true } } },
  });
  if (!employee) return { app: false, website: false, description: null };

  let app = false;
  const portal = employee.portalAccount;
  if (portal && !portal.deletedAt && portal.isEnabled) {
    await tx.employeePortalAccount.update({
      where: { id: portal.id },
      data: { isEnabled: false, refreshTokenHash: null, lastSeenAt: null, ...(actorUserId ? { updatedById: actorUserId } : {}) },
    });
    app = true;
  }
  if (portal) await endAllSignInSessions(tx, 'EMPLOYEE_APP', portal.id, 'ACCOUNT_DISABLED');

  let website = false;
  const email = employee.personalDetail?.email?.trim();
  const user = portal?.userId
    ? await tx.user.findFirst({ where: { id: portal.userId, deletedAt: null }, select: { id: true, isActive: true, userRoles: { select: { role: { select: { name: true } } } } } })
    : email
      ? await tx.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
          select: { id: true, isActive: true, userRoles: { select: { role: { select: { name: true } } } } },
        })
      : null;
  const isSuperAdmin = user?.userRoles.some((r) => r.role.name === IDENTITY_ROLE.SUPER_ADMIN) ?? false;
  if (user && !isSuperAdmin && user.id !== actorUserId) {
    if (user.isActive) {
      await tx.user.update({ where: { id: user.id }, data: { isActive: false, refreshTokenHash: null, ...(actorUserId ? { updatedById: actorUserId } : {}) } });
      website = true;
    }
    await endAllSignInSessions(tx, 'USER', user.id, 'ACCOUNT_DISABLED');
  }

  const off = [website ? 'office login' : null, app ? 'Care app access' : null].filter(Boolean).join(' and ');
  return { app, website, description: off ? `Switched off ${off} because ${END_REASON_TEXT[reason]}` : null };
}
