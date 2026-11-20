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
import { OrgScopeService } from '../common/org-scope/org-scope.service';

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InspectorServiceUserOption = { id: string; name: string };

/** "First Last" (the number too, so two people with the same name can be told apart). */
export function serviceUserOptionName(su: {
  firstName: string;
  lastName: string;
  serviceUserNumber: string | null;
}): string {
  const name = `${su.firstName} ${su.lastName}`.replace(/\s+/g, ' ').trim();
  return su.serviceUserNumber ? `${name} (${su.serviceUserNumber})` : name;
}

/**
 * The Resident scope column. Scopes saved before the picker listed real service users hold keys from the old
 * placeholder list ("1"…"13"), which name nobody: they are shown as such rather than as made-up names.
 */
export function residentScopeLabel(keys: string[], names: Map<string, string>): string {
  if (!keys.length) return 'All service users';
  const known = keys.map((k) => names.get(k)).filter((n): n is string => Boolean(n));
  const unknown = keys.length - known.length;
  if (!known.length) return 'Old sample list (no real service users)';
  return unknown ? `${known.join(', ')} (+${unknown} no longer found)` : known.join(', ');
}

@Injectable()
export class TemporaryInspectorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
  ) {}

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
    // Independent survey reviewers are never Temporary Inspector logins (these can open care
    // records): they have their own user accounts (src/common/auth/independent-reviewer.ts).
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

  /** Active service users the signed-in office user can see (their branches), for the Select residents picker. */
  async serviceUserOptions(actor: RequestUser): Promise<InspectorServiceUserOption[]> {
    const scopeWhere = this.orgScope.serviceUserScopeWhere(this.orgScope.fromRequestUser(actor));
    const rows = await this.prisma.serviceUser.findMany({
      where: { deletedAt: null, isActive: true, ...(scopeWhere ? { AND: [scopeWhere] } : {}) },
      select: { id: true, firstName: true, lastName: true, serviceUserNumber: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return rows.map((r) => ({ id: r.id, name: serviceUserOptionName(r) }));
  }

  /** Names for saved scope keys (real service user ids; old placeholder keys find nothing). */
  private async scopeNames(keys: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(keys.filter((k) => UUID.test(k)))];
    if (!ids.length) return new Map();
    const rows = await this.prisma.serviceUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, serviceUserNumber: true },
    });
    return new Map(rows.map((r) => [r.id, serviceUserOptionName(r)]));
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
  }, names: Map<string, string>): TemporaryInspectorListRow {
    const now = new Date();
    const expired = r.validTo.getTime() < now.getTime();
    return {
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      username: r.username,
      reason: r.reason,
      serviceUserKeys: r.serviceUserKeys,
      residentScopeLabel: residentScopeLabel(r.serviceUserKeys, names),
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
    const names = await this.scopeNames(rows.flatMap((r) => r.serviceUserKeys));
    return rows.map((r) => this.toRow(r, names));
  }

  async create(actor: RequestUser, dto: CreateTemporaryInspectorDto): Promise<{ id: string }> {
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
    // Only service users the office user can see themselves (active, in their branches).
    if (keys.length) {
      if (keys.some((k) => !UUID.test(k))) throw new BadRequestException('Unknown service user selection');
      const allowed = new Set((await this.serviceUserOptions(actor)).map((o) => o.id));
      if (keys.some((k) => !allowed.has(k))) {
        throw new BadRequestException('One or more chosen service users were not found, or are not in your branches.');
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
          createdById: actor.id,
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
