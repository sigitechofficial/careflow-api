import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../common/utils/password.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';

export const SU_PORTAL_SESSION_PERMISSION = 'service_user.portal.session' as const;

@Injectable()
export class ServiceUserPortalAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmailForLogin(email: string) {
    const e = email.trim().toLowerCase();
    if (!e) return null;
    return this.prisma.serviceUserPortalAccount.findFirst({
      where: {
        deletedAt: null,
        isEnabled: true,
        email: { equals: e, mode: 'insensitive' },
      },
      include: {
        serviceUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            profilePhotoUrl: true,
            deletedAt: true,
            isActive: true,
          },
        },
      },
    });
  }

  async findForRefresh(id: string) {
    return this.prisma.serviceUserPortalAccount.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        refreshTokenHash: true,
        isEnabled: true,
        deletedAt: true,
        serviceUser: {
          select: { id: true, deletedAt: true, isActive: true },
        },
      },
    });
  }

  async verifyPassword(row: { passwordHash: string }, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, row.passwordHash);
  }

  async setRefreshTokenHash(id: string, refreshTokenHash: string) {
    await this.prisma.serviceUserPortalAccount.update({
      where: { id },
      data: { refreshTokenHash },
    });
  }

  async clearRefreshToken(id: string) {
    await this.prisma.serviceUserPortalAccount.update({
      where: { id },
      data: { refreshTokenHash: null },
    });
  }

  async touchLastLogin(id: string) {
    await this.prisma.serviceUserPortalAccount.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  assertLoginable(row: {
    isEnabled: boolean;
    deletedAt: Date | null;
    serviceUser: { deletedAt: Date | null; isActive: boolean };
  }) {
    if (row.deletedAt) throw new UnauthorizedException('Invalid credentials');
    if (!row.isEnabled) throw new UnauthorizedException('Portal access is not enabled');
    if (row.serviceUser.deletedAt || !row.serviceUser.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  /** Used by JWT strategy on every authenticated portal request. */
  async getAuthContextForJwt(accountId: string): Promise<RequestUser | null> {
    const row = await this.prisma.serviceUserPortalAccount.findFirst({
      where: { id: accountId, deletedAt: null, isEnabled: true },
      select: {
        id: true,
        email: true,
        serviceUserId: true,
        serviceUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            profilePhotoUrl: true,
            deletedAt: true,
            isActive: true,
          },
        },
      },
    });
    if (!row) return null;
    if (row.serviceUser.deletedAt || !row.serviceUser.isActive) return null;

    return {
      id: row.id,
      email: row.email,
      roles: ['Service User'],
      permissions: [SU_PORTAL_SESSION_PERMISSION],
      accountKind: 'service_user',
      serviceUserId: row.serviceUserId,
      firstName: row.serviceUser.firstName,
      lastName: row.serviceUser.lastName,
      preferredName: row.serviceUser.preferredName,
      profilePhotoUrl: row.serviceUser.profilePhotoUrl,
    };
  }

  async getAdminStatus(serviceUserId: string) {
    await this.ensureServiceUserExists(serviceUserId);
    const row = await this.prisma.serviceUserPortalAccount.findFirst({
      where: { serviceUserId, deletedAt: null },
      select: {
        id: true,
        email: true,
        isEnabled: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!row) {
      const su = await this.prisma.serviceUser.findFirst({
        where: { id: serviceUserId, deletedAt: null },
        select: { email: true },
      });
      return {
        configured: false,
        isEnabled: false,
        email: su?.email ?? null,
        lastLoginAt: null as string | null,
      };
    }
    return {
      configured: true,
      isEnabled: row.isEnabled,
      email: row.email,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    };
  }

  async upsertAdmin(
    actorUserId: string,
    serviceUserId: string,
    dto: { isEnabled?: boolean; email?: string },
  ) {
    await this.ensureServiceUserExists(serviceUserId);
    const email = dto.email?.trim().toLowerCase();
    if (email !== undefined && !email) throw new BadRequestException('Email is required');

    const existing = await this.prisma.serviceUserPortalAccount.findFirst({
      where: { serviceUserId, deletedAt: null },
    });

    if (!existing) {
      if (!email) throw new BadRequestException('Email is required when enabling portal access');
      try {
        await this.prisma.serviceUserPortalAccount.create({
          data: {
            serviceUserId,
            email,
            passwordHash: await hashPassword(cryptoRandomPlaceholderPassword()),
            isEnabled: dto.isEnabled ?? false,
            createdById: actorUserId,
            updatedById: actorUserId,
          },
        });
        return this.getAdminStatus(serviceUserId);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Portal email already in use');
        }
        throw e;
      }
    }

    try {
      await this.prisma.serviceUserPortalAccount.update({
        where: { id: existing.id },
        data: {
          ...(email !== undefined ? { email } : {}),
          ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
          updatedById: actorUserId,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Portal email already in use');
      }
      throw e;
    }
    return this.getAdminStatus(serviceUserId);
  }

  async setPassword(actorUserId: string, serviceUserId: string, password: string) {
    if (password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    await this.ensureServiceUserExists(serviceUserId);
    const existing = await this.prisma.serviceUserPortalAccount.findFirst({
      where: { serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Portal account not configured for this service user');

    const passwordHash = await hashPassword(password);
    await this.prisma.serviceUserPortalAccount.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        refreshTokenHash: null,
        updatedById: actorUserId,
      },
    });
    return { message: 'Portal password updated', data: {} };
  }

  private async ensureServiceUserExists(serviceUserId: string) {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true },
    });
    if (!su) throw new NotFoundException('Service user not found');
  }
}

function cryptoRandomPlaceholderPassword(): string {
  return `unset_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
