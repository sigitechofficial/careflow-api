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

export const EMPLOYEE_PORTAL_SESSION_PERMISSION = 'employee.portal.session' as const;

@Injectable()
export class EmployeePortalAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmailForLogin(email: string) {
    const e = email.trim().toLowerCase();
    if (!e) return null;
    return this.prisma.employeePortalAccount.findFirst({
      where: {
        deletedAt: null,
        isEnabled: true,
        email: { equals: e, mode: 'insensitive' },
      },
      include: {
        employee: {
          select: {
            id: true,
            deletedAt: true,
            isActive: true,
            personalDetail: {
              select: {
                firstName: true,
                lastName: true,
                photoUrl: true,
              },
            },
          },
        },
      },
    });
  }

  async findForRefresh(id: string) {
    return this.prisma.employeePortalAccount.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        refreshTokenHash: true,
        isEnabled: true,
        deletedAt: true,
        employee: {
          select: { id: true, deletedAt: true, isActive: true },
        },
      },
    });
  }

  async verifyPassword(row: { passwordHash: string }, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, row.passwordHash);
  }

  async setRefreshTokenHash(id: string, refreshTokenHash: string) {
    await this.prisma.employeePortalAccount.update({
      where: { id },
      data: { refreshTokenHash },
    });
  }

  async clearRefreshToken(id: string) {
    await this.prisma.employeePortalAccount.update({
      where: { id },
      data: { refreshTokenHash: null },
    });
  }

  async touchLastLogin(id: string) {
    await this.prisma.employeePortalAccount.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  assertLoginable(row: {
    isEnabled: boolean;
    deletedAt: Date | null;
    employee: { deletedAt: Date | null; isActive: boolean };
  }) {
    if (row.deletedAt) throw new UnauthorizedException('Invalid credentials');
    if (!row.isEnabled) throw new UnauthorizedException('Employee app access is not enabled');
    if (row.employee.deletedAt || !row.employee.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  /** Used by JWT strategy on every authenticated employee-app request. */
  async getAuthContextForJwt(accountId: string): Promise<RequestUser | null> {
    const row = await this.prisma.employeePortalAccount.findFirst({
      where: { id: accountId, deletedAt: null, isEnabled: true },
      select: {
        id: true,
        email: true,
        employeeId: true,
        employee: {
          select: {
            id: true,
            deletedAt: true,
            isActive: true,
            personalDetail: {
              select: {
                firstName: true,
                lastName: true,
                photoUrl: true,
              },
            },
          },
        },
      },
    });
    if (!row) return null;
    if (row.employee.deletedAt || !row.employee.isActive) return null;

    return {
      id: row.id,
      email: row.email,
      roles: ['Employee'],
      permissions: [EMPLOYEE_PORTAL_SESSION_PERMISSION],
      accountKind: 'employee',
      employeeId: row.employeeId,
      firstName: row.employee.personalDetail?.firstName,
      lastName: row.employee.personalDetail?.lastName,
      profilePhotoUrl: row.employee.personalDetail?.photoUrl ?? null,
    };
  }

  async getAdminStatus(employeeId: string) {
    await this.ensureEmployeeExists(employeeId);
    const row = await this.prisma.employeePortalAccount.findFirst({
      where: { employeeId, deletedAt: null },
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
      const personal = await this.prisma.employeePersonalDetail.findFirst({
        where: { employeeId, deletedAt: null },
        select: { email: true },
      });
      return {
        configured: false,
        isEnabled: false,
        email: personal?.email ?? null,
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
    employeeId: string,
    dto: { isEnabled?: boolean; email?: string },
  ) {
    await this.ensureEmployeeExists(employeeId);
    const email = dto.email?.trim().toLowerCase();
    if (email !== undefined && !email) throw new BadRequestException('Email is required');

    const existing = await this.prisma.employeePortalAccount.findFirst({
      where: { employeeId, deletedAt: null },
    });

    if (!existing) {
      if (!email) throw new BadRequestException('Email is required when enabling employee app access');
      try {
        await this.prisma.employeePortalAccount.create({
          data: {
            employeeId,
            email,
            passwordHash: await hashPassword(cryptoRandomPlaceholderPassword()),
            isEnabled: dto.isEnabled ?? false,
            createdById: actorUserId,
            updatedById: actorUserId,
          },
        });
        return this.getAdminStatus(employeeId);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Employee app email already in use');
        }
        throw e;
      }
    }

    try {
      await this.prisma.employeePortalAccount.update({
        where: { id: existing.id },
        data: {
          ...(email !== undefined ? { email } : {}),
          ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
          updatedById: actorUserId,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Employee app email already in use');
      }
      throw e;
    }
    return this.getAdminStatus(employeeId);
  }

  async setPassword(actorUserId: string, employeeId: string, password: string) {
    if (password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    await this.ensureEmployeeExists(employeeId);
    const existing = await this.prisma.employeePortalAccount.findFirst({
      where: { employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Employee app account not configured for this employee');

    const passwordHash = await hashPassword(password);
    await this.prisma.employeePortalAccount.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        refreshTokenHash: null,
        updatedById: actorUserId,
      },
    });
    return { message: 'Employee app password updated', data: {} };
  }

  private async ensureEmployeeExists(employeeId: string) {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!emp) throw new NotFoundException('Employee not found');
  }
}

function cryptoRandomPlaceholderPassword(): string {
  return `unset_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
