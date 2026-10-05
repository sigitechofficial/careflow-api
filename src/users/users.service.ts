import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import {
  BRANCH_SCOPED_IDENTITY_ROLES,
  IDENTITY_ROLE,
  maxRolePrivilege,
  resolveScopeType,
} from '../common/org-scope/org-scope.types';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  create(data: {
    email: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    passwordHash: string;
  }) {
    return this.prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        passwordHash: data.passwordHash,
      },
    });
  }

  findById(id: string) {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        userRoles: { include: { role: true } },
        userLocations: { select: { locationId: true, location: { select: { id: true, name: true } } } },
      },
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  findActiveByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null, isActive: true },
    });
  }

  async setRefreshTokenHash(userId: string, refreshTokenHash: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });
  }

  async clearRefreshToken(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });
  }

  async updatePassword(userId: string, passwordHash: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, refreshTokenHash: null },
    });
  }

  async updateProfile(userId: string, data: { firstName?: string; lastName?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.firstName !== undefined ? { firstName: data.firstName.trim() || null } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName.trim() || null } : {}),
        updatedAt: new Date(),
      },
    });
  }

  async getAuthContext(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: { include: { permission: true } },
              },
            },
          },
        },
        userLocations: {
          select: {
            locationId: true,
            location: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!user) return null;

    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.key),
        ),
      ),
    );

    const explicitLocationIds = user.userLocations.map((ul) => ul.locationId);
    const assignedLocationIds = await this.resolveAssignedLocationIds({
      email: user.email,
      roles,
      explicitLocationIds,
    });
    // If locations are restricted, expose branch scope even for legacy roles (e.g. HR).
    const scopeType =
      assignedLocationIds !== null ? 'branch' : resolveScopeType(roles);

    const assignedLocations =
      assignedLocationIds === null
        ? null
        : await this.resolveAssignedLocationLabels(
            assignedLocationIds,
            user.userLocations.map((ul) => ul.location),
          );

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      username: user.username ?? undefined,
      roles,
      permissions,
      accountKind: 'user' as const,
      /** null = unrestricted (all locations). Array = header picker + API ACL. */
      assignedLocationIds,
      /** Same as assignedLocationIds with display names for the header (null when unrestricted). */
      assignedLocations,
      scopeType,
    };
  }

  private async resolveAssignedLocationLabels(
    locationIds: string[],
    alreadyLoaded: Array<{ id: string; name: string }>,
  ): Promise<Array<{ id: string; name: string }>> {
    if (!locationIds.length) return [];
    const byId = new Map(alreadyLoaded.map((l) => [l.id, l.name]));
    const missing = locationIds.filter((id) => !byId.has(id));
    if (missing.length) {
      const rows = await this.prisma.location.findMany({
        where: { id: { in: missing }, deletedAt: null },
        select: { id: true, name: true },
      });
      for (const row of rows) byId.set(row.id, row.name);
    }
    return locationIds.map((id) => ({
      id,
      name: byId.get(id)?.trim() || 'Location',
    }));
  }

  /**
   * Super Admin / Admin / Master Staff Allocation: always unrestricted (null).
   * Everyone else:
   *   1) explicit UserLocation rows
   *   2) else employment locations via email match
   *   3) else [] — header shows no branches (never company-wide by default)
   */
  private async resolveAssignedLocationIds(params: {
    email: string;
    roles: string[];
    explicitLocationIds: string[];
  }): Promise<string[] | null> {
    // Privileged company/platform roles ignore UserLocation (branch picker stays "all").
    if (
      params.roles.includes(IDENTITY_ROLE.SUPER_ADMIN) ||
      params.roles.includes(IDENTITY_ROLE.ADMIN) ||
      params.roles.includes(IDENTITY_ROLE.MASTER_STAFF_ALLOCATION)
    ) {
      return null;
    }

    if (params.explicitLocationIds.length) {
      return [...new Set(params.explicitLocationIds)];
    }

    const employmentIds = await this.employmentLocationIdsForEmail(params.email);
    if (employmentIds?.length) return employmentIds;

    // Manager / HR / Care Coordinator / Branch Admin / Staff Allocation, etc.:
    // no assignment ⇒ no branch access (do not fall back to "all locations").
    return [];
  }

  private async employmentLocationIdsForEmail(email: string): Promise<string[] | null> {
    const personal = await this.prisma.employeePersonalDetail.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        employee: { deletedAt: null },
      },
      select: {
        employee: {
          select: {
            employment: {
              select: {
                locationId: true,
                baseLocationId: true,
                floorLocations: { select: { locationId: true } },
              },
            },
          },
        },
      },
    });

    const employment = personal?.employee?.employment;
    if (!employment) return null;

    const ids = new Set<string>();
    if (employment.locationId) ids.add(employment.locationId);
    if (employment.baseLocationId) ids.add(employment.baseLocationId);
    for (const floor of employment.floorLocations) {
      ids.add(floor.locationId);
    }
    return ids.size ? [...ids] : null;
  }

  private assertCanManageTarget(
    actor: { roles: string[]; assignedLocationIds?: string[] | null },
    target: {
      userRoles: Array<{ role: { name: string } }>;
      userLocations: Array<{ locationId: string }>;
    },
  ) {
    const actorRank = maxRolePrivilege(actor.roles);
    const targetRank = maxRolePrivilege(target.userRoles.map((ur) => ur.role.name));
    if (targetRank > actorRank) {
      throw new ForbiddenException('Cannot modify a user with higher privilege');
    }

    if (actor.assignedLocationIds?.length) {
      const allowed = new Set(actor.assignedLocationIds);
      const targetLocs = target.userLocations.map((ul) => ul.locationId);
      // Unassigned users (e.g. just created) may be claimed into the actor's branches.
      if (targetLocs.length > 0 && !targetLocs.some((id) => allowed.has(id))) {
        throw new ForbiddenException('User is outside your branch scope');
      }
    }
  }

  async listUsers(actor?: { roles: string[]; assignedLocationIds?: string[] | null }) {
    const rows = await this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        isActive: true,
        createdAt: true,
        employeeId: true,
        userRoles: { select: { role: { select: { id: true, name: true } } } },
        userLocations: {
          select: { locationId: true, location: { select: { id: true, name: true } } },
        },
      },
    });

    const employeeRefs = await this.resolveEmployeeRefs(rows);

    let mapped = rows.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      isActive: u.isActive,
      createdAt: u.createdAt,
      /** Linked HR employee record (for payroll), if any. */
      employee: u.employeeId ? (employeeRefs.linked.get(u.employeeId) ?? null) : null,
      /** Unlinked users: an employee with the same email, offered as a one-click link. */
      suggestedEmployee: u.employeeId ? null : (employeeRefs.suggested.get(u.email.toLowerCase()) ?? null),
      roles: u.userRoles.map((ur) => ur.role),
      locations: u.userLocations.map((ul) => ul.location),
      scopeType: resolveScopeType(u.userRoles.map((ur) => ur.role.name)),
    }));

    if (actor?.assignedLocationIds?.length) {
      const allowed = new Set(actor.assignedLocationIds);
      const actorRank = maxRolePrivilege(actor.roles);
      mapped = mapped.filter((u) => {
        const rank = maxRolePrivilege(u.roles.map((r) => r.name));
        if (rank > actorRank) return false;
        // Show users in actor branches, or not yet assigned (so Branch Admin can finish setup).
        if (u.locations.length === 0) return rank <= actorRank;
        return u.locations.some((l) => allowed.has(l.id));
      });
    }

    return { data: mapped };
  }

  /** Names for linked employees, and same-email employees not yet linked to anyone. */
  private async resolveEmployeeRefs(rows: Array<{ email: string; employeeId: string | null }>) {
    const linkedIds = rows.map((r) => r.employeeId).filter((id): id is string => Boolean(id));
    const unlinkedEmails = rows.filter((r) => !r.employeeId).map((r) => r.email);
    const [linkedDetails, emailMatches] = await Promise.all([
      linkedIds.length
        ? this.prisma.employeePersonalDetail.findMany({
            where: { employeeId: { in: linkedIds } },
            select: { employeeId: true, firstName: true, lastName: true },
          })
        : [],
      unlinkedEmails.length
        ? this.prisma.employeePersonalDetail.findMany({
            where: {
              OR: unlinkedEmails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })),
              employee: { deletedAt: null },
            },
            select: { employeeId: true, firstName: true, lastName: true, email: true },
          })
        : Promise.resolve(
            [] as { employeeId: string; firstName: string; lastName: string; email: string | null }[],
          ),
    ]);
    const name = (d: { firstName: string; lastName: string }) =>
      `${d.firstName} ${d.lastName}`.trim() || 'Employee';
    const taken = new Set(linkedIds);
    return {
      linked: new Map(linkedDetails.map((d) => [d.employeeId, { id: d.employeeId, name: name(d) }])),
      suggested: new Map(
        emailMatches
          .filter((d) => d.email && !taken.has(d.employeeId))
          .map((d) => [d.email!.toLowerCase(), { id: d.employeeId, name: name(d) }]),
      ),
    };
  }

  /**
   * Link an office user to their HR employee record so they can be paid through Payroll
   * (or unlink with null). One office login per employee; branch scope applies to both.
   */
  async setUserEmployee(actor: RequestUser, userId: string, employeeId: string | null) {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { userRoles: { include: { role: true } }, userLocations: true },
    });
    if (!target) throw new NotFoundException('User not found');
    this.assertCanManageTarget(actor, target);

    if (employeeId) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: employeeId, deletedAt: null },
        select: { id: true },
      });
      if (!employee) throw new BadRequestException('Employee not found');
      await this.orgScope.assertEmployeeInScope(this.orgScope.fromRequestUser(actor), employeeId);
      const other = await this.prisma.user.findFirst({
        where: { employeeId, id: { not: userId }, deletedAt: null },
        select: { email: true },
      });
      if (other) {
        throw new BadRequestException(`This employee is already linked to ${other.email}`);
      }
      // A deleted login may still hold the link; release it.
      await this.prisma.user.updateMany({
        where: { employeeId, id: { not: userId }, deletedAt: { not: null } },
        data: { employeeId: null },
      });
    }

    await this.prisma.user.update({ where: { id: userId }, data: { employeeId } });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.USER,
      action: AuditAction.USER_PROFILE_UPDATED,
      recordType: 'User',
      recordId: userId,
      description: employeeId ? 'Office user linked to employee record' : 'Office user unlinked from employee record',
      oldValues: { employeeId: target.employeeId },
      newValues: { employeeId },
    });
    return {
      message: employeeId ? 'Employee record linked' : 'Employee record unlinked',
      data: { id: userId, employeeId },
    };
  }

  /**
   * Replace identity roles for a user. Enforces privilege escalation rules.
   */
  async setUserRoles(actor: { id: string; roles: string[]; assignedLocationIds?: string[] | null }, userId: string, roleNames: string[]) {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { userRoles: { include: { role: true } }, userLocations: true },
    });
    if (!target) throw new NotFoundException('User not found');

    this.assertCanManageTarget(actor, target);

    const uniqueNames = [...new Set(roleNames.map((n) => n.trim()).filter(Boolean))];
    const roles = await this.prisma.role.findMany({
      where: { name: { in: uniqueNames }, deletedAt: null, isActive: true },
    });
    if (roles.length !== uniqueNames.length) {
      const found = new Set(roles.map((r) => r.name));
      const missing = uniqueNames.filter((n) => !found.has(n));
      throw new BadRequestException(`Unknown role(s): ${missing.join(', ')}`);
    }

    const actorRank = maxRolePrivilege(actor.roles);
    const targetNewRank = maxRolePrivilege(uniqueNames);
    if (targetNewRank > actorRank) {
      throw new ForbiddenException('Cannot assign a role above your privilege level');
    }
    if (
      uniqueNames.includes(IDENTITY_ROLE.SUPER_ADMIN) &&
      !actor.roles.includes(IDENTITY_ROLE.SUPER_ADMIN)
    ) {
      throw new ForbiddenException('Only Super Admin can assign Super Admin');
    }

    const oldRoles = target.userRoles.map((ur) => ur.role.name);

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      if (roles.length) {
        await tx.userRole.createMany({
          data: roles.map((r) => ({ userId, roleId: r.id })),
        });
      }
    });

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.USER,
      action: AuditAction.USER_ROLE_CHANGED,
      recordType: 'User',
      recordId: userId,
      oldValues: { roles: oldRoles },
      newValues: { roles: uniqueNames },
      metadata: { route: 'users.setRoles' },
    });

    // Branch-scoped roles without locations: warn via empty ACL (Branch Admin).
    const needsBranch =
      uniqueNames.some((n) => BRANCH_SCOPED_IDENTITY_ROLES.has(n)) &&
      !uniqueNames.some((n) =>
        n === IDENTITY_ROLE.ADMIN ||
        n === IDENTITY_ROLE.SUPER_ADMIN ||
        n === IDENTITY_ROLE.MASTER_STAFF_ALLOCATION,
      );

    return {
      message: 'Roles updated',
      data: {
        userId,
        roles: uniqueNames,
        requiresBranchAssignment: needsBranch,
      },
    };
  }

  /** Replace UserLocation rows for branch-scoped authorization. */
  async setUserLocations(
    actor: { id: string; roles: string[]; assignedLocationIds?: string[] | null },
    userId: string,
    locationIds: string[],
  ) {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        userRoles: { include: { role: true } },
        userLocations: true,
      },
    });
    if (!target) throw new NotFoundException('User not found');

    this.assertCanManageTarget(actor, target);

    const uniqueIds = [...new Set(locationIds.filter(Boolean))];
    if (uniqueIds.length) {
      const locations = await this.prisma.location.findMany({
        where: { id: { in: uniqueIds }, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (locations.length !== uniqueIds.length) {
        throw new BadRequestException('One or more location ids are invalid');
      }
    }

    // Branch-scoped actors may only assign branches they themselves can access.
    if (actor.assignedLocationIds?.length) {
      const allowed = new Set(actor.assignedLocationIds);
      if (uniqueIds.some((id) => !allowed.has(id))) {
        throw new ForbiddenException('Cannot assign a branch outside your scope');
      }
      // Branch actors must assign at least one of their branches (no company-wide empty ACL via this path).
      if (uniqueIds.length === 0) {
        throw new BadRequestException('Select at least one branch in your scope');
      }
    }

    const oldIds = target.userLocations.map((ul) => ul.locationId);

    await this.prisma.$transaction(async (tx) => {
      await tx.userLocation.deleteMany({ where: { userId } });
      if (uniqueIds.length) {
        await tx.userLocation.createMany({
          data: uniqueIds.map((locationId) => ({ userId, locationId })),
        });
      }
    });

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.USER,
      action:
        uniqueIds.length >= oldIds.length
          ? AuditAction.USER_LOCATION_ASSIGNED
          : AuditAction.USER_LOCATION_REMOVED,
      recordType: 'UserLocation',
      recordId: userId,
      oldValues: { locationIds: oldIds },
      newValues: { locationIds: uniqueIds },
      metadata: { route: 'users.setLocations' },
    });

    return {
      message: 'Branch assignments updated',
      data: { userId, locationIds: uniqueIds },
    };
  }
}
