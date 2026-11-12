import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { hashRefreshToken, refreshTokenMatches } from '../../common/utils/refresh-token-hash.util';

/** USER: office website (identity.User). EMPLOYEE_APP: Care app (employees.EmployeePortalAccount). */
export type SignInSessionKind = 'USER' | 'EMPLOYEE_APP';

export type SignInEndReason = 'SIGNED_OUT' | 'SIGNED_IN_ELSEWHERE' | 'PASSWORD_CHANGED' | 'ACCOUNT_DISABLED' | 'ENDED_BY_OFFICE';

/** Shown to the person on the device that was signed out (the API's 401 message; the apps show it on sign-in). */
export const SIGNED_OUT_MESSAGES: Record<SignInEndReason, string> = {
  SIGNED_OUT: 'You have been signed out.',
  SIGNED_IN_ELSEWHERE:
    'You were signed out because this account signed in on another device, and your organisation limits how many devices can be signed in at once.',
  PASSWORD_CHANGED: 'You were signed out because the password was changed. Sign in with the new password.',
  ACCOUNT_DISABLED: 'You were signed out because this account was switched off.',
  ENDED_BY_OFFICE: 'You were signed out by the office.',
};

const ACTIVE_CHECK_CACHE_MS = 10_000;

/**
 * Sign out every device of an account, with whichever Prisma client the caller holds (also inside a transaction).
 * Requests from those devices are refused within ACTIVE_CHECK_CACHE_MS.
 */
export async function endAllSignInSessions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any Prisma client or transaction (and test fakes)
  db: { authSession: { updateMany: (args: any) => Promise<unknown> } },
  kind: SignInSessionKind,
  accountId: string,
  reason: SignInEndReason,
): Promise<void> {
  await db.authSession.updateMany({ where: { kind, accountId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
}

/**
 * Signed-in devices. Each browser or phone has its own session and refresh token, so signing in on one device
 * never silently invalidates another. The organisation decides how many devices may be signed in at once
 * (office website and Care app separately); over the limit, the oldest sign-in is signed out and told why.
 */
@Injectable()
export class SignInSessionsService {
  /** Access tokens carry the session id: a short cache so every request does not read the table. */
  private readonly activeCache = new Map<string, { at: number; reason: SignInEndReason | null }>();

  constructor(private readonly prisma: PrismaService) {}

  newSessionId(): string {
    return randomUUID();
  }

  /** How many devices at once (0 = no limit), from the organisation's settings. */
  async deviceLimit(kind: SignInSessionKind): Promise<number> {
    const s = await this.prisma.organisationGeneralSettings.findFirst({
      select: { officeMultipleDeviceLogin: true, officeMaxDevices: true, appSettingSingleDeviceLoginCareApp: true, appSettingMaxDevicesCareApp: true },
    });
    if (!s) return 0;
    if (kind === 'USER') return s.officeMultipleDeviceLogin ? Math.max(0, s.officeMaxDevices) : 1;
    return s.appSettingSingleDeviceLoginCareApp ? 1 : Math.max(0, s.appSettingMaxDevicesCareApp);
  }

  /**
   * A new sign-in on this device. Over the organisation's limit, the oldest sign-ins are signed out
   * (the newest always wins). Returns how many were signed out.
   */
  async start(
    kind: SignInSessionKind,
    accountId: string,
    sessionId: string,
    refreshToken: string,
    expiresAt: Date,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<{ signedOut: number }> {
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        kind,
        accountId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt,
        ipAddress: meta.ipAddress?.slice(0, 100) ?? null,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
    });
    const limit = await this.deviceLimit(kind);
    if (!limit) return { signedOut: 0 };
    const active = await this.prisma.authSession.findMany({
      where: { kind, accountId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    // Never the sign-in just made, however the clock orders them.
    const older = active.filter((a) => a.id !== sessionId).slice(Math.max(0, limit - 1));
    if (!older.length) return { signedOut: 0 };
    await this.endMany(older.map((o) => o.id), 'SIGNED_IN_ELSEWHERE');
    return { signedOut: older.length };
  }

  /**
   * Renewal on one device: the presented refresh token must be that session's current one. Two renewals racing
   * with the same token: only the first wins (the other is refused, never both).
   */
  async rotate(
    kind: SignInSessionKind,
    accountId: string,
    sessionId: string,
    presentedToken: string,
    nextToken: string,
    nextExpiresAt: Date,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<void> {
    const row = await this.prisma.authSession.findUnique({ where: { id: sessionId } });
    if (!row || row.kind !== kind || row.accountId !== accountId) throw new UnauthorizedException('Invalid refresh token');
    if (row.revokedAt) throw new UnauthorizedException(SIGNED_OUT_MESSAGES[(row.revokedReason as SignInEndReason) ?? 'SIGNED_OUT'] ?? 'Invalid refresh token');
    if (row.expiresAt <= new Date()) throw new UnauthorizedException('Your sign-in has expired. Please sign in again.');
    if (!refreshTokenMatches(presentedToken, row.refreshTokenHash)) throw new UnauthorizedException('Invalid refresh token');
    const updated = await this.prisma.authSession.updateMany({
      where: { id: sessionId, refreshTokenHash: row.refreshTokenHash, revokedAt: null },
      data: {
        refreshTokenHash: hashRefreshToken(nextToken),
        lastUsedAt: new Date(),
        expiresAt: nextExpiresAt,
        ...(meta.ipAddress ? { ipAddress: meta.ipAddress.slice(0, 100) } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent.slice(0, 500) } : {}),
      },
    });
    if (updated.count !== 1) throw new UnauthorizedException('Invalid refresh token');
  }

  /** For each request with a session-bound access token: null when still signed in, else why it ended. */
  async endedReason(sessionId: string): Promise<SignInEndReason | null> {
    const hit = this.activeCache.get(sessionId);
    if (hit && Date.now() - hit.at < ACTIVE_CHECK_CACHE_MS) return hit.reason;
    const row = await this.prisma.authSession.findUnique({ where: { id: sessionId }, select: { revokedAt: true, revokedReason: true, expiresAt: true } });
    const reason: SignInEndReason | null = !row
      ? 'SIGNED_OUT'
      : row.revokedAt
        ? ((row.revokedReason as SignInEndReason) ?? 'SIGNED_OUT')
        : row.expiresAt <= new Date()
          ? 'SIGNED_OUT'
          : null;
    if (this.activeCache.size > 5000) this.activeCache.clear();
    this.activeCache.set(sessionId, { at: Date.now(), reason });
    return reason;
  }

  /** Sign out one device. */
  async end(sessionId: string | undefined | null, reason: SignInEndReason = 'SIGNED_OUT'): Promise<void> {
    if (!sessionId) return;
    await this.endMany([sessionId], reason);
  }

  /** Sign out every device of this account (password changed, account switched off, office ends sessions). */
  async endAll(kind: SignInSessionKind, accountId: string, reason: SignInEndReason): Promise<number> {
    const rows = await this.prisma.authSession.findMany({ where: { kind, accountId, revokedAt: null }, select: { id: true } });
    await this.endMany(rows.map((r) => r.id), reason);
    return rows.length;
  }

  /** Devices signed in now. */
  async activeCount(kind: SignInSessionKind, accountId: string): Promise<number> {
    return this.prisma.authSession.count({ where: { kind, accountId, revokedAt: null, expiresAt: { gt: new Date() } } });
  }

  private async endMany(ids: string[], reason: SignInEndReason) {
    if (!ids.length) return;
    await this.prisma.authSession.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    for (const id of ids) this.activeCache.set(id, { at: Date.now(), reason });
  }
}
