import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { IDENTITY_ROLE } from '../common/org-scope/org-scope.types';
import {
  planResponsibilityChange,
  ROLE_RESPONSIBILITIES,
  type RoleResponsibility,
} from './role-responsibilities.catalog';

/** Always hold every responsibility; never shown as a choice and never lose access. */
const ADMIN_ROLE_NAMES: string[] = [
  IDENTITY_ROLE.SUPER_ADMIN,
  IDENTITY_ROLE.ADMIN,
];

type RoleRow = { id: string; name: string; keys: Set<string> };

/**
 * Role responsibilities — give a plain-language job (e.g. "Create payroll") to roles.
 * Writes the underlying RolePermission rows, so the Roles & permissions page stays in sync.
 */
@Injectable()
export class RoleResponsibilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async loadRoles(): Promise<RoleRow[]> {
    const roles = await this.prisma.role.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        rolePermissions: { select: { permission: { select: { key: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      keys: new Set(r.rolePermissions.map((rp) => rp.permission.key)),
    }));
  }

  private summarise(
    responsibility: RoleResponsibility,
    roles: RoleRow[],
    existingKeys: Set<string>,
  ) {
    const act = responsibility.act.filter((k) => existingKeys.has(k));
    const choosable = roles.filter((r) => !ADMIN_ROLE_NAMES.includes(r.name));
    const held = (r: RoleRow) => act.filter((k) => r.keys.has(k)).length;
    return {
      key: responsibility.key,
      label: responsibility.label,
      description: responsibility.description,
      /** Roles that can do the whole job today. */
      roleIds: choosable
        .filter((r) => act.length > 0 && held(r) === act.length)
        .map((r) => r.id),
      /** Roles that can do part of it (saving will give them all of it, or remove it). */
      partialRoleIds: choosable
        .filter((r) => held(r) > 0 && held(r) < act.length)
        .map((r) => r.id),
    };
  }

  private async existingPermissionKeys() {
    const rows = await this.prisma.permission.findMany({
      where: { deletedAt: null },
      select: { id: true, key: true },
    });
    return new Map(rows.map((p) => [p.key, p.id]));
  }

  async list() {
    const [roles, permissionIds] = await Promise.all([
      this.loadRoles(),
      this.existingPermissionKeys(),
    ]);
    const existing = new Set(permissionIds.keys());
    return {
      message: 'Role responsibilities',
      data: {
        adminRoles: roles
          .filter((r) => ADMIN_ROLE_NAMES.includes(r.name))
          .map((r) => r.name),
        roles: roles
          .filter((r) => !ADMIN_ROLE_NAMES.includes(r.name))
          .map((r) => ({ id: r.id, name: r.name })),
        responsibilities: ROLE_RESPONSIBILITIES.map((x) =>
          this.summarise(x, roles, existing),
        ),
      },
    };
  }

  async assign(actorId: string, key: string, roleIds: string[]) {
    const responsibility = ROLE_RESPONSIBILITIES.find((x) => x.key === key);
    if (!responsibility)
      throw new NotFoundException('Responsibility not found');

    const [roles, permissionIds] = await Promise.all([
      this.loadRoles(),
      this.existingPermissionKeys(),
    ]);
    const existing = new Set(permissionIds.keys());
    const before = this.summarise(responsibility, roles, existing);

    const adminIds = roles
      .filter((r) => ADMIN_ROLE_NAMES.includes(r.name))
      .map((r) => r.id);
    const known = new Set(roles.map((r) => r.id));
    const selected = [...new Set(roleIds)].filter(
      (id) => known.has(id) && !adminIds.includes(id),
    );
    const plan = planResponsibilityChange(
      responsibility,
      roles.map((r) => r.id),
      selected,
      adminIds,
    );
    const idsFor = (keys: string[]) =>
      keys
        .map((k) => permissionIds.get(k))
        .filter((id): id is string => Boolean(id));

    await this.prisma.$transaction(async (tx) => {
      for (const g of plan.grant) {
        const ids = idsFor(g.keys);
        if (ids.length) {
          await tx.rolePermission.createMany({
            data: ids.map((permissionId) => ({
              roleId: g.roleId,
              permissionId,
            })),
            skipDuplicates: true,
          });
        }
      }
      for (const r of plan.revoke) {
        const ids = idsFor(r.keys);
        if (ids.length) {
          await tx.rolePermission.deleteMany({
            where: { roleId: r.roleId, permissionId: { in: ids } },
          });
        }
      }
    });

    const nameById = new Map(roles.map((r) => [r.id, r.name]));
    await this.audit.logAudit({
      userId: actorId,
      module: AuditModule.ROLE,
      action: AuditAction.ROLE_RESPONSIBILITY_UPDATED,
      recordType: 'RoleResponsibility',
      recordId: key,
      description: `"${responsibility.label}" given to ${
        selected.map((id) => nameById.get(id)).join(', ') || 'admins only'
      }`,
      oldValues: { roles: before.roleIds.map((id) => nameById.get(id)) },
      newValues: { roles: selected.map((id) => nameById.get(id)) },
    });

    const after = this.summarise(
      responsibility,
      await this.loadRoles(),
      existing,
    );
    return { message: 'Responsibility saved', data: after };
  }
}
