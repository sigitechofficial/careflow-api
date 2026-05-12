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
import { CreateTemporaryInspectorDto } from './dto/create-temporary-inspector.dto';
import { TEMPORARY_INSPECTOR_SERVICE_USER_OPTIONS } from './service-user-options.seed';

const TI_PERMISSIONS = ['temporary_inspector.session'] as const;

function isWithinValidity(validFrom: Date, validTo: Date, now = new Date()): boolean {
  return validFrom.getTime() <= now.getTime() && now.getTime() <= validTo.getTime();
}

export type TemporaryInspectorListRow = {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  reason: string;
  serviceUserKeys: string[];
  /** Human-readable scope for tables ("All service users" or comma-separated names). */
  residentScopeLabel: string;
  validFrom: string;
  validTo: string;
  status: 'Active' | 'Expired';
  expireOnLabel: string;
};

function formatExpireLabel(d: Date): string {
  return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

function resolveResidentScopeLabel(keys: string[]): string {
  if (!keys.length) return 'All service users';
  const names = keys.map(
    (id) => TEMPORARY_INSPECTOR_SERVICE_USER_OPTIONS.find((o) => o.id === id)?.name ?? id,
  );
  return names.join(', ');
}

@Injectable()
export class TemporaryInspectorsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUsernameForLogin(username: string) {
    const u = username.trim();
    if (!u) return null;
    return this.prisma.temporaryInspector.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        username: { equals: u, mode: 'insensitive' },
      },
    });
  }

  async findForRefresh(id: string) {
    return this.prisma.temporaryInspector.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        username: true,
        refreshTokenHash: true,
        validFrom: true,
        validTo: true,
        deletedAt: true,
        isActive: true,
      },
    });
  }

  async verifyPassword(row: { passwordHash: string }, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, row.passwordHash);
  }

  async setRefreshTokenHash(id: string, refreshTokenHash: string) {
    await this.prisma.temporaryInspector.update({
      where: { id },
      data: { refreshTokenHash },
    });
  }

  async clearRefreshToken(id: string) {
    await this.prisma.temporaryInspector.update({
      where: { id },
      data: { refreshTokenHash: null },
    });
  }

  /** Used by JWT strategy on every authenticated request. */
  async getAuthContextForJwt(id: string): Promise<RequestUser | null> {
    const row = await this.prisma.temporaryInspector.findFirst({
      where: { id, deletedAt: null, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        validFrom: true,
        validTo: true,
      },
    });
    if (!row) return null;
    const now = new Date();
    if (!isWithinValidity(row.validFrom, row.validTo, now)) return null;

    const email = `ti+${row.username}@inspector.care.local`;
    return {
      id: row.id,
      email,
      roles: ['Temporary Inspector'],
      permissions: [...TI_PERMISSIONS],
      accountKind: 'temporary_inspector',
      firstName: row.firstName,
      lastName: row.lastName,
      username: row.username,
    };
  }

  assertLoginable(row: {
    validFrom: Date;
    validTo: Date;
    deletedAt: Date | null;
    isActive: boolean;
  }) {
    if (row.deletedAt) throw new UnauthorizedException('Invalid credentials');
    if (!row.isActive) throw new UnauthorizedException('Invalid credentials');
    const now = new Date();
    if (!isWithinValidity(row.validFrom, row.validTo, now)) {
      throw new UnauthorizedException('This temporary access is not valid at this time');
    }
  }

  serviceUserOptions() {
    return TEMPORARY_INSPECTOR_SERVICE_USER_OPTIONS;
  }

  private toRow(r: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
    reason: string;
    serviceUserKeys: string[];
    validFrom: Date;
    validTo: Date;
  }): TemporaryInspectorListRow {
    const now = new Date();
    const expired = r.validTo.getTime() < now.getTime();
    return {
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      username: r.username,
      reason: r.reason,
      serviceUserKeys: r.serviceUserKeys,
      residentScopeLabel: resolveResidentScopeLabel(r.serviceUserKeys),
      validFrom: r.validFrom.toISOString(),
      validTo: r.validTo.toISOString(),
      status: expired ? 'Expired' : 'Active',
      expireOnLabel: formatExpireLabel(r.validTo),
    };
  }

  async list(): Promise<TemporaryInspectorListRow[]> {
    const rows = await this.prisma.temporaryInspector.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        reason: true,
        serviceUserKeys: true,
        validFrom: true,
        validTo: true,
      },
    });
    return rows.map((r) => this.toRow(r));
  }

  async create(actorUserId: string, dto: CreateTemporaryInspectorDto): Promise<{ id: string }> {
    const validFrom = new Date(dto.validFrom);
    const validTo = new Date(dto.validTo);
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
      throw new BadRequestException('Invalid validFrom or validTo');
    }
    if (validTo.getTime() <= validFrom.getTime()) {
      throw new BadRequestException('validTo must be after validFrom');
    }

    const raw = dto.serviceUserKeys ?? [];
    const keys = [...new Set(raw.map((k) => String(k).trim()).filter(Boolean))];
    for (const k of keys) {
      if (!TEMPORARY_INSPECTOR_SERVICE_USER_OPTIONS.some((o) => o.id === k)) {
        throw new BadRequestException('Unknown service user selection');
      }
    }

    const passwordHash = await hashPassword(dto.password);
    try {
      const row = await this.prisma.temporaryInspector.create({
        data: {
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          username: dto.username.trim(),
          passwordHash,
          reason: dto.reason.trim(),
          serviceUserKeys: keys,
          validFrom,
          validTo,
          createdById: actorUserId,
        },
        select: { id: true },
      });
      return { id: row.id };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Username already in use');
      }
      throw e;
    }
  }

  async softDelete(id: string): Promise<void> {
    const row = await this.prisma.temporaryInspector.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Temporary inspector not found');
    await this.prisma.temporaryInspector.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
