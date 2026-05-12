import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  IDENTITY_ROLES_MANAGED_BY_EMPLOYMENT_RBAC,
  RBAC_LEVEL_TO_IDENTITY_ROLE_NAME,
} from './rbac-employment-sync.config';

const SUPER_ADMIN_ROLE_NAME = 'Super Admin';

@Injectable()
export class RbacEmploymentSyncService {
  private readonly logger = new Logger(RbacEmploymentSyncService.name);

  /**
   * When an employee's personal email matches an active User, align that user's
   * identity roles with employment `RBACLevel` using {@link RBAC_LEVEL_TO_IDENTITY_ROLE_NAME}.
   * Skips users who have the Super Admin role (never modified).
   * Runs inside the caller's transaction for atomicity with employment save.
   */
  async syncUserRolesForEmployee(tx: Prisma.TransactionClient, employeeId: string): Promise<void> {
    const employee = await tx.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: {
        personalDetail: { select: { email: true } },
        employment: { include: { rbacLevel: { select: { name: true } } } },
      },
    });
    if (!employee) {
      this.logger.debug(`RBAC sync skipped (employee not found) for ${employeeId}`);
      return;
    }
    const email = employee.personalDetail?.email?.trim();
    if (!email) {
      this.logger.debug(`RBAC sync skipped (no personal email) for employee ${employeeId}`);
      return;
    }

    const user = await tx.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    if (!user) {
      this.logger.debug(`RBAC sync skipped (no user with matching email) for employee ${employeeId}`);
      return;
    }

    const superAdminRole = await tx.role.findFirst({
      where: { name: SUPER_ADMIN_ROLE_NAME, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (superAdminRole) {
      const hasSuperAdmin = await tx.userRole.findFirst({
        where: { userId: user.id, roleId: superAdminRole.id },
        select: { id: true },
      });
      if (hasSuperAdmin) {
        this.logger.debug(`RBAC sync skipped (user is Super Admin) for user ${user.id}`);
        return;
      }
    }

    const rbacLevelName = employee.employment?.rbacLevel?.name?.trim() ?? null;
    const targetRoleName = this.resolveTargetIdentityRoleName(rbacLevelName);

    const managedRoleNames = Array.from(IDENTITY_ROLES_MANAGED_BY_EMPLOYMENT_RBAC);
    const managedRoles = await tx.role.findMany({
      where: { name: { in: managedRoleNames }, deletedAt: null, isActive: true },
      select: { id: true },
    });
    const managedRoleIds = managedRoles.map(r => r.id);
    if (managedRoleIds.length > 0) {
      await tx.userRole.deleteMany({
        where: { userId: user.id, roleId: { in: managedRoleIds } },
      });
    }

    if (!targetRoleName) {
      this.logger.log(
        `RBAC sync cleared managed identity roles for user ${user.id} (employee ${employeeId}, no mapped RBAC level).`,
      );
      return;
    }

    const targetRole = await tx.role.findFirst({
      where: { name: targetRoleName, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!targetRole) {
      this.logger.warn(
        `RBAC sync could not assign role "${targetRoleName}" — no active identity Role with that name (employee ${employeeId}).`,
      );
      return;
    }

    await tx.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: targetRole.id } },
      update: {},
      create: { userId: user.id, roleId: targetRole.id },
    });
    this.logger.log(
      `RBAC sync set identity role "${targetRoleName}" for user ${user.id} from employee ${employeeId}.`,
    );
  }

  private resolveTargetIdentityRoleName(rbacLevelName: string | null): string | null {
    if (!rbacLevelName) return null;
    const mapped = RBAC_LEVEL_TO_IDENTITY_ROLE_NAME[rbacLevelName];
    if (mapped) return mapped;
    return rbacLevelName;
  }
}
