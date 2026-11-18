import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { INDEPENDENT_REVIEWER_ROLE } from '../common/auth/independent-reviewer';
import {
  ADMIN_LEVEL_IDENTITY_ROLE_NAMES,
  IDENTITY_ROLES_MANAGED_BY_EMPLOYMENT_RBAC,
  RBAC_LEVEL_TO_IDENTITY_ROLE_NAME,
} from './rbac-employment-sync.config';

const SUPER_ADMIN_ROLE_NAME = 'Super Admin';

export type RbacSyncOutcome =
  | { kind: 'skipped'; reason: string; userId?: string }
  | { kind: 'cleared'; userId: string }
  | { kind: 'assigned'; userId: string; roleName: string };

@Injectable()
export class RbacEmploymentSyncService {
  private readonly logger = new Logger(RbacEmploymentSyncService.name);

  constructor(private readonly audit: AuditLogsService) {}

  /**
   * When an employee's personal email matches an active office login, align that login's
   * identity roles with the employment `RBACLevel` using {@link RBAC_LEVEL_TO_IDENTITY_ROLE_NAME}.
   *
   * Safety rules (an email match alone proves nothing about who owns the login):
   * - Only **admin-approved** logins are touched: made by a signed-in office user (`createdById`
   *   set) or already holding at least one role an administrator gave them. A login nobody in the
   *   office made or approved is never given roles from a staff record.
   * - Super Admins and independent-reviewer accounts are never modified.
   * - Admin-level roles ({@link ADMIN_LEVEL_IDENTITY_ROLE_NAMES}) are never granted silently: if the
   *   RBAC level maps to one the login does not already hold, nothing changes and the skip is
   *   audited, so an administrator must give that role on purpose in Office users.
   * Every change or deliberate skip is written to the audit log.
   * Runs inside the caller's transaction for atomicity with employment save.
   */
  async syncUserRolesForEmployee(
    tx: Prisma.TransactionClient,
    employeeId: string,
    actorUserId?: string | null,
  ): Promise<RbacSyncOutcome> {
    const employee = await tx.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: {
        personalDetail: { select: { email: true } },
        employment: { include: { rbacLevel: { select: { name: true } } } },
      },
    });
    if (!employee) return { kind: 'skipped', reason: 'employee_not_found' };
    const email = employee.personalDetail?.email?.trim();
    if (!email) return { kind: 'skipped', reason: 'no_personal_email' };

    const user = await tx.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        createdById: true,
        userRoles: { select: { role: { select: { id: true, name: true } } } },
      },
    });
    if (!user) return { kind: 'skipped', reason: 'no_matching_login' };

    const heldRoleNames = new Set(user.userRoles.map((ur) => ur.role.name));
    const rbacLevelName = employee.employment?.rbacLevel?.name?.trim() ?? null;
    const targetRoleName = this.resolveTargetIdentityRoleName(rbacLevelName);

    const skip = async (reason: string, description: string): Promise<RbacSyncOutcome> => {
      this.logger.warn(`RBAC sync skipped (${reason}) for user ${user.id}, employee ${employeeId}.`);
      await this.audit.logAudit({
        tx,
        userId: actorUserId ?? undefined,
        module: AuditModule.USER,
        action: AuditAction.USER_ROLE_SYNC_SKIPPED,
        recordType: 'User',
        recordId: user.id,
        description,
        metadata: { employeeId, reason, rbacLevel: rbacLevelName, targetRole: targetRoleName },
      });
      return { kind: 'skipped', reason, userId: user.id };
    };

    if (heldRoleNames.has(SUPER_ADMIN_ROLE_NAME)) {
      return { kind: 'skipped', reason: 'super_admin', userId: user.id };
    }
    if (heldRoleNames.has(INDEPENDENT_REVIEWER_ROLE)) {
      return { kind: 'skipped', reason: 'independent_reviewer', userId: user.id };
    }

    const adminApproved = Boolean(user.createdById) || heldRoleNames.size > 0;
    if (!adminApproved) {
      return skip(
        'login_not_admin_approved',
        'Staff record access level not applied: the office login with this email was not made or approved by an administrator.',
      );
    }

    if (
      targetRoleName &&
      ADMIN_LEVEL_IDENTITY_ROLE_NAMES.has(targetRoleName) &&
      !heldRoleNames.has(targetRoleName)
    ) {
      return skip(
        'admin_level_role_needs_manual_grant',
        `Staff record access level "${rbacLevelName}" maps to the admin-level role "${targetRoleName}". It was not given automatically; an administrator must give it in Office users.`,
      );
    }

    const managedRoleNames = Array.from(IDENTITY_ROLES_MANAGED_BY_EMPLOYMENT_RBAC);
    const managedRoles = await tx.role.findMany({
      where: { name: { in: managedRoleNames }, deletedAt: null, isActive: true },
      select: { id: true },
    });
    const managedRoleIds = managedRoles.map((r) => r.id);
    const before = Array.from(heldRoleNames).sort();

    let targetRole: { id: string } | null = null;
    if (targetRoleName) {
      targetRole = await tx.role.findFirst({
        where: { name: targetRoleName, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!targetRole) {
        this.logger.warn(
          `RBAC sync could not assign role "${targetRoleName}" — no active identity Role with that name (employee ${employeeId}).`,
        );
        return { kind: 'skipped', reason: 'target_role_missing', userId: user.id };
      }
    }

    if (managedRoleIds.length > 0) {
      await tx.userRole.deleteMany({
        where: {
          userId: user.id,
          roleId: { in: targetRole ? managedRoleIds.filter((id) => id !== targetRole!.id) : managedRoleIds },
        },
      });
    }
    if (targetRole) {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: targetRole.id } },
        update: {},
        create: { userId: user.id, roleId: targetRole.id },
      });
    }

    const afterRows = await tx.userRole.findMany({
      where: { userId: user.id },
      select: { role: { select: { name: true } } },
    });
    const after = afterRows.map((r) => r.role.name).sort();
    if (before.join('|') !== after.join('|')) {
      await this.audit.logAudit({
        tx,
        userId: actorUserId ?? undefined,
        module: AuditModule.USER,
        action: AuditAction.USER_ROLE_SYNCED_FROM_EMPLOYMENT,
        recordType: 'User',
        recordId: user.id,
        description: targetRoleName
          ? `Office login roles set from staff record access level "${rbacLevelName}".`
          : 'Office login roles from the staff record cleared (no access level set).',
        oldValues: { roles: before },
        newValues: { roles: after },
        metadata: { employeeId, rbacLevel: rbacLevelName, targetRole: targetRoleName },
      });
    }
    this.logger.log(
      targetRoleName
        ? `RBAC sync set identity role "${targetRoleName}" for user ${user.id} from employee ${employeeId}.`
        : `RBAC sync cleared managed identity roles for user ${user.id} (employee ${employeeId}).`,
    );
    return targetRoleName
      ? { kind: 'assigned', userId: user.id, roleName: targetRoleName }
      : { kind: 'cleared', userId: user.id };
  }

  private resolveTargetIdentityRoleName(rbacLevelName: string | null): string | null {
    if (!rbacLevelName) return null;
    const mapped = RBAC_LEVEL_TO_IDENTITY_ROLE_NAME[rbacLevelName];
    if (mapped) return mapped;
    return rbacLevelName;
  }
}
