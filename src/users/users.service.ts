import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
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

    const assignedLocationIds = await this.resolveAssignedLocationIds(
      user.email,
      roles,
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
      /** null = unrestricted (all locations). Array = header picker ACL. */
      assignedLocationIds,
    };
  }

  /**
   * Super Admin: unrestricted (null).
   * Users whose email matches an employee personal detail: employment branch locations.
   * Everyone else: unrestricted (null) until explicit UserLocation assignments exist.
   */
  private async resolveAssignedLocationIds(
    email: string,
    roles: string[],
  ): Promise<string[] | null> {
    if (roles.includes('Super Admin')) return null;

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
}

