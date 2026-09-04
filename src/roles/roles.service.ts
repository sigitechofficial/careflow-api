import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IDENTITY_ROLE } from '../common/org-scope/org-scope.types';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.role.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        rolePermissions: {
          where: { permission: { deletedAt: null } },
          include: { permission: { select: { id: true, key: true, description: true } } },
        },
        _count: { select: { userRoles: true } },
      },
    });
  }

  async listMapped() {
    const rows = await this.list();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isActive: r.isActive,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      userCount: r._count.userRoles,
      permissions: r.rolePermissions.map((rp) => ({
        id: rp.permission.id,
        key: rp.permission.key,
        description: rp.permission.description,
      })),
    }));
  }

  create(data: { name: string; description?: string }) {
    return this.prisma.role.create({ data });
  }

  update(id: string, data: { name?: string; description?: string; isActive?: boolean }) {
    return this.prisma.role.update({ where: { id }, data });
  }

  async setPermissions(
    actor: { id: string; roles: string[] },
    roleId: string,
    permissionKeys: string[],
  ) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, deletedAt: null },
    });
    if (!role) throw new NotFoundException('Role not found');

    if (
      role.name === IDENTITY_ROLE.SUPER_ADMIN &&
      !actor.roles.includes(IDENTITY_ROLE.SUPER_ADMIN)
    ) {
      throw new ForbiddenException('Only Super Admin can change Super Admin permissions');
    }

    const uniqueKeys = [...new Set(permissionKeys.map((k) => k.trim()).filter(Boolean))];
    const permissions = uniqueKeys.length
      ? await this.prisma.permission.findMany({
          where: { key: { in: uniqueKeys }, deletedAt: null },
          select: { id: true, key: true },
        })
      : [];

    if (permissions.length !== uniqueKeys.length) {
      const found = new Set(permissions.map((p) => p.key));
      const missing = uniqueKeys.filter((k) => !found.has(k));
      throw new BadRequestException(`Unknown permission keys: ${missing.join(', ')}`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ roleId, permissionId: p.id })),
        });
      }
    });

    return this.listMapped().then((rows) => rows.find((r) => r.id === roleId)!);
  }
}
