import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuditStatus, SecuritySeverity } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { SecurityEventType } from '../audit-logs/enums/security-event.enum';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { TemporaryInspectorLoginDto } from './dto/temporary-inspector-login.dto';
import { ServiceUserPortalLoginDto } from './dto/service-user-portal-login.dto';
import { TemporaryInspectorsService } from '../temporary-inspectors/temporary-inspectors.service';
import { ServiceUserPortalAccountsService } from '../service-user-portal/service-user-portal-accounts.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import {
  hashRefreshToken,
  refreshTokenMatches,
} from '../common/utils/refresh-token-hash.util';
import { burnPasswordCompare } from '../common/utils/password.util';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

export const PASSWORD_RESET_REQUESTED_MESSAGE =
  'If the email exists, a reset link will be sent';
export const PASSWORD_RESET_INVALID_MESSAGE =
  'This reset link is invalid or has expired.';
export const PASSWORD_RESET_COMPLETED_MESSAGE =
  'Your password has been reset. You can now sign in with your new password.';
export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 60;
/** Max reset tokens created per user in a rolling hour; further requests are silently skipped. */
export const PASSWORD_RESET_MAX_TOKENS_PER_HOUR = 3;
const PASSWORD_RESET_DEV_URL_BASE = 'http://localhost:5173';

type PasswordResetUser = {
  id: string;
  email: string;
  firstName: string | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditLogs: AuditLogsService,
    private readonly temporaryInspectorsService: TemporaryInspectorsService,
    private readonly serviceUserPortalAccountsService: ServiceUserPortalAccountsService,
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async login(dto: LoginDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    const user = await this.usersService.findActiveByEmail(dto.email);
    if (!user) {
      await burnPasswordCompare(dto.password);
      const inactive = await this.usersService
        .findByEmail(dto.email)
        .catch(() => null);
      await this.auditLogs.logFailedLogin({
        channel: 'staff',
        reason: inactive ? 'inactive' : 'unknown_user',
        identifier: dto.email,
        userId: inactive?.id,
        recordType: 'User',
        recordId: inactive?.id,
        description: inactive
          ? 'Failed login — inactive account'
          : 'Failed login — unknown email',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { email: dto.email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.auditLogs.logFailedLogin({
        channel: 'staff',
        reason: 'bad_password',
        identifier: dto.email,
        userId: user.id,
        recordType: 'User',
        recordId: user.id,
        description: 'Failed login — bad password',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { email: user.email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user.id);
    const refreshTokenHash = hashRefreshToken(tokens.refreshToken);
    await this.usersService.setRefreshTokenHash(user.id, refreshTokenHash);

    await this.auditLogs.logLogin({
      userId: user.id,
      email: user.email,
      event: 'login_success',
      status: AuditStatus.SUCCESS,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await this.auditLogs.logAudit({
      userId: user.id,
      module: AuditModule.AUTH,
      action: AuditAction.LOGIN_SUCCESS,
      recordType: 'User',
      recordId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      status: AuditStatus.SUCCESS,
    });

    return {
      message: 'Login successful',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    };
  }

  async temporaryInspectorLogin(dto: TemporaryInspectorLoginDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    const row = await this.temporaryInspectorsService.findByUsernameForLogin(dto.username);
    if (!row) {
      await burnPasswordCompare(dto.password);
      await this.auditLogs.logFailedLogin({
        channel: 'temporary_inspector',
        reason: 'unknown_user',
        identifier: dto.username.trim(),
        identifierType: 'username',
        recordType: 'TemporaryInspector',
        description: 'Failed temporary inspector login — unknown username',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { username: dto.username.trim() },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    try {
      this.temporaryInspectorsService.assertLoginable(row);
    } catch {
      await burnPasswordCompare(dto.password);
      await this.auditLogs.logFailedLogin({
        channel: 'temporary_inspector',
        reason: 'inactive',
        identifier: dto.username.trim(),
        identifierType: 'username',
        recordType: 'TemporaryInspector',
        recordId: row.id,
        description: 'Failed temporary inspector login — outside validity or inactive',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { temporaryInspectorId: row.id },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await this.temporaryInspectorsService.verifyPassword(row, dto.password);
    if (!ok) {
      await this.auditLogs.logFailedLogin({
        channel: 'temporary_inspector',
        reason: 'bad_password',
        identifier: dto.username.trim(),
        identifierType: 'username',
        recordType: 'TemporaryInspector',
        recordId: row.id,
        description: 'Failed temporary inspector login — bad password',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { temporaryInspectorId: row.id },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTemporaryInspectorTokens(row.id);
    const refreshTokenHash = hashRefreshToken(tokens.refreshToken);
    await this.temporaryInspectorsService.setRefreshTokenHash(row.id, refreshTokenHash);

    await this.auditLogs.logLogin({
      userId: undefined,
      email: row.username,
      event: 'login_success',
      status: AuditStatus.SUCCESS,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await this.auditLogs.logAudit({
      userId: undefined,
      module: AuditModule.AUTH,
      action: AuditAction.LOGIN_SUCCESS,
      recordType: 'TemporaryInspector',
      recordId: row.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      status: AuditStatus.SUCCESS,
      metadata: { temporaryInspectorId: row.id, username: row.username },
    });

    return {
      message: 'Login successful',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    };
  }

  async serviceUserPortalLogin(dto: ServiceUserPortalLoginDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    const row = await this.serviceUserPortalAccountsService.findByEmailForLogin(dto.email);
    if (!row) {
      await burnPasswordCompare(dto.password);
      await this.auditLogs.logFailedLogin({
        channel: 'service_user_portal',
        reason: 'unknown_user',
        identifier: dto.email.trim().toLowerCase(),
        recordType: 'ServiceUserPortalAccount',
        description: 'Failed service user portal login — unknown email',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { email: dto.email.trim().toLowerCase() },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    try {
      this.serviceUserPortalAccountsService.assertLoginable(row);
    } catch {
      await burnPasswordCompare(dto.password);
      await this.auditLogs.logFailedLogin({
        channel: 'service_user_portal',
        reason: 'inactive',
        identifier: dto.email.trim().toLowerCase(),
        recordType: 'ServiceUserPortalAccount',
        recordId: row.id,
        description: 'Failed service user portal login — disabled or inactive',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { portalAccountId: row.id },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await this.serviceUserPortalAccountsService.verifyPassword(row, dto.password);
    if (!ok) {
      await this.auditLogs.logFailedLogin({
        channel: 'service_user_portal',
        reason: 'bad_password',
        identifier: dto.email.trim().toLowerCase(),
        recordType: 'ServiceUserPortalAccount',
        recordId: row.id,
        description: 'Failed service user portal login — bad password',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { portalAccountId: row.id },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueServiceUserPortalTokens(row.id);
    const refreshTokenHash = hashRefreshToken(tokens.refreshToken);
    await this.serviceUserPortalAccountsService.setRefreshTokenHash(row.id, refreshTokenHash);
    await this.serviceUserPortalAccountsService.touchLastLogin(row.id);

    await this.auditLogs.logLogin({
      userId: undefined,
      email: row.email,
      event: 'login_success',
      status: AuditStatus.SUCCESS,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await this.auditLogs.logAudit({
      userId: undefined,
      module: AuditModule.AUTH,
      action: AuditAction.LOGIN_SUCCESS,
      recordType: 'ServiceUserPortalAccount',
      recordId: row.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      status: AuditStatus.SUCCESS,
      metadata: { portalAccountId: row.id, serviceUserId: row.serviceUserId },
    });

    return {
      message: 'Login successful',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    };
  }

  async register(dto: RegisterDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new BadRequestException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.usersService.create({
      email: dto.email,
      username: dto.username,
      firstName: dto.firstName,
      lastName: dto.lastName,
      passwordHash,
    });

    await this.auditLogs.logAudit({
      userId: user.id,
      module: AuditModule.USER,
      action: AuditAction.USER_REGISTERED,
      recordType: 'User',
      recordId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { message: 'User registered', data: { id: user.id, email: user.email } };
  }

  async refresh(dto: RefreshTokenDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    const payload = (await this.jwtService.verifyAsync(dto.refreshToken, {
      secret: this.config.get<string>('JWT_REFRESH_TOKEN_SECRET'),
    })) as { sub: string; typ?: string };

    if (payload.typ === 'ti') {
      const row = await this.temporaryInspectorsService.findForRefresh(payload.sub);
      if (!row?.refreshTokenHash) throw new UnauthorizedException('Invalid refresh token');
      const ok = refreshTokenMatches(dto.refreshToken, row.refreshTokenHash);
      if (!ok) throw new UnauthorizedException('Invalid refresh token');
      this.temporaryInspectorsService.assertLoginable(row);

      const tokens = await this.issueTemporaryInspectorTokens(row.id);
      const refreshTokenHash = hashRefreshToken(tokens.refreshToken);
      await this.temporaryInspectorsService.setRefreshTokenHash(row.id, refreshTokenHash);

      await this.auditLogs.logLogin({
        userId: undefined,
        email: row.username,
        event: 'refresh_token_used',
        status: AuditStatus.SUCCESS,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      await this.auditLogs.logAudit({
        userId: undefined,
        module: AuditModule.AUTH,
        action: AuditAction.REFRESH_TOKEN_USED,
        recordType: 'TemporaryInspector',
        recordId: row.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return {
        message: 'Token refreshed',
        data: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      };
    }

    if (payload.typ === 'su') {
      const row = await this.serviceUserPortalAccountsService.findForRefresh(payload.sub);
      if (!row?.refreshTokenHash) throw new UnauthorizedException('Invalid refresh token');
      const ok = refreshTokenMatches(dto.refreshToken, row.refreshTokenHash);
      if (!ok) throw new UnauthorizedException('Invalid refresh token');
      this.serviceUserPortalAccountsService.assertLoginable(row);

      const tokens = await this.issueServiceUserPortalTokens(row.id);
      const refreshTokenHash = hashRefreshToken(tokens.refreshToken);
      await this.serviceUserPortalAccountsService.setRefreshTokenHash(row.id, refreshTokenHash);

      await this.auditLogs.logLogin({
        userId: undefined,
        email: row.email,
        event: 'refresh_token_used',
        status: AuditStatus.SUCCESS,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      await this.auditLogs.logAudit({
        userId: undefined,
        module: AuditModule.AUTH,
        action: AuditAction.REFRESH_TOKEN_USED,
        recordType: 'ServiceUserPortalAccount',
        recordId: row.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return {
        message: 'Token refreshed',
        data: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      };
    }

    if (payload.typ === 'emp') {
      throw new UnauthorizedException('Use /employee-app/auth/refresh for employee app tokens');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.refreshTokenHash) throw new UnauthorizedException('Invalid refresh token');

    const ok = refreshTokenMatches(dto.refreshToken, user.refreshTokenHash);
    if (!ok) throw new UnauthorizedException('Invalid refresh token');

    const tokens = await this.issueTokens(user.id);
    const refreshTokenHash = hashRefreshToken(tokens.refreshToken);
    await this.usersService.setRefreshTokenHash(user.id, refreshTokenHash);

    await this.auditLogs.logLogin({
      userId: user.id,
      email: user.email,
      event: 'refresh_token_used',
      status: AuditStatus.SUCCESS,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await this.auditLogs.logAudit({
      userId: user.id,
      module: AuditModule.AUTH,
      action: AuditAction.REFRESH_TOKEN_USED,
      recordType: 'User',
      recordId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      message: 'Token refreshed',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.usersService.updatePassword(userId, passwordHash);

    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.AUTH,
      action: AuditAction.PASSWORD_CHANGED,
      recordType: 'User',
      recordId: userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await this.auditLogs.logSecurityEvent({
      userId,
      eventType: SecurityEventType.PASSWORD_CHANGED,
      severity: SecuritySeverity.MEDIUM,
      description: 'User changed password',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { message: 'Password changed', data: {} };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    const existing = await this.usersService.findById(userId);
    if (!existing) throw new UnauthorizedException('User not found');

    const updated = await this.usersService.updateProfile(userId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.USER,
      action: AuditAction.USER_PROFILE_UPDATED,
      recordType: 'User',
      recordId: userId,
      oldValues: { firstName: existing.firstName, lastName: existing.lastName },
      newValues: { firstName: updated.firstName, lastName: updated.lastName },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const ctx = await this.usersService.getAuthContext(userId);
    return { message: 'Profile updated', data: ctx };
  }

  async getMyLoginHistory(userId: string, limit = 50) {
    return this.auditLogs.findLoginHistory({
      userId,
      limit,
      page: 1,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  }

  async forgotPassword(dto: ForgotPasswordDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    const email = dto.email.trim();
    let userId: string | undefined;
    try {
      const user = await this.findUserForPasswordReset(email);
      userId = user?.id;
      if (user) await this.issuePasswordReset(user, meta.ipAddress);
    } catch (err) {
      // Never let a failure reveal whether the account exists.
      this.logger.error(
        `Password reset request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await this.auditLogs.logSecurityEvent({
      userId,
      eventType: SecurityEventType.PASSWORD_RESET_REQUESTED,
      severity: SecuritySeverity.LOW,
      description: 'Password reset requested',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { email },
    });
    return { message: PASSWORD_RESET_REQUESTED_MESSAGE, data: {} };
  }

  async resetPassword(dto: ResetPasswordDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    const tokenHash = hashPasswordResetToken(dto.token);
    const now = new Date();
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { isActive: true, deletedAt: true } },
      },
    });
    if (
      !row ||
      row.usedAt ||
      row.expiresAt <= now ||
      !row.user.isActive ||
      row.user.deletedAt
    ) {
      throw new BadRequestException(PASSWORD_RESET_INVALID_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.$transaction(async (tx) => {
      // Conditional claim so two concurrent requests cannot both use the same token.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(PASSWORD_RESET_INVALID_MESSAGE);
      }

      // Same effect as UsersService.updatePassword: new hash + refresh token revoked (logs out all sessions).
      const updated = await tx.user.updateMany({
        where: { id: row.userId, isActive: true, deletedAt: null },
        data: { passwordHash, refreshTokenHash: null },
      });
      if (updated.count !== 1) {
        throw new BadRequestException(PASSWORD_RESET_INVALID_MESSAGE);
      }

      await tx.passwordResetToken.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: now },
      });

      await this.auditLogs.logAudit({
        tx,
        userId: row.userId,
        module: AuditModule.AUTH,
        action: AuditAction.PASSWORD_RESET_COMPLETED,
        recordType: 'User',
        recordId: row.userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      await this.auditLogs.logSecurityEvent({
        tx,
        userId: row.userId,
        eventType: SecurityEventType.PASSWORD_RESET_COMPLETED,
        severity: SecuritySeverity.MEDIUM,
        description: 'Password reset completed via emailed link',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    });

    return { message: PASSWORD_RESET_COMPLETED_MESSAGE, data: {} };
  }

  /** Active, non-deleted user by email (case-insensitive; an exact-case match wins if several exist). */
  private async findUserForPasswordReset(
    email: string,
  ): Promise<PasswordResetUser | null> {
    const matches = await this.prisma.user.findMany({
      where: {
        email: { equals: email, mode: 'insensitive' },
        deletedAt: null,
        isActive: true,
      },
      select: { id: true, email: true, firstName: true },
      take: 5,
    });
    if (matches.length <= 1) return matches[0] ?? null;
    return matches.find((u) => u.email === email) ?? null;
  }

  private async issuePasswordReset(
    user: PasswordResetUser,
    requestedIp: string | null,
  ) {
    const now = new Date();
    const recentCount = await this.prisma.passwordResetToken.count({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) },
      },
    });
    if (recentCount >= PASSWORD_RESET_MAX_TOKENS_PER_HOUR) {
      this.logger.warn(
        `Password reset per-user limit reached for user ${user.id}; not sending another link`,
      );
      return;
    }

    const urlBase = this.getPasswordResetUrlBase();
    if (!urlBase) {
      this.logger.error(
        'PASSWORD_RESET_URL_BASE is not configured; password reset email not sent',
      );
      return;
    }

    const rawToken = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashPasswordResetToken(rawToken),
          expiresAt: new Date(
            now.getTime() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000,
          ),
          requestedIp,
        },
      }),
    ]);

    const link = `${urlBase}/auth/reset-password?token=${encodeURIComponent(rawToken)}`;
    // Not awaited: a slow or failing mail provider must not change the response (timing or status).
    void this.mailService
      .send({
        to: user.email,
        ...buildPasswordResetEmail(user.firstName, link),
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Password reset email could not be sent for user ${user.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private getPasswordResetUrlBase(): string | null {
    const configured = (
      this.config.get<string>('PASSWORD_RESET_URL_BASE') ?? ''
    )
      .trim()
      .replace(/\/+$/, '');
    if (configured) return configured;
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
    return nodeEnv === 'production' ? null : PASSWORD_RESET_DEV_URL_BASE;
  }

  async logout(user: RequestUser, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    if (user.accountKind === 'temporary_inspector') {
      await this.temporaryInspectorsService.clearRefreshToken(user.id);
      await this.auditLogs.logLogin({
        userId: undefined,
        email: user.username ?? user.email,
        event: 'logout',
        status: AuditStatus.SUCCESS,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      await this.auditLogs.logAudit({
        userId: undefined,
        module: AuditModule.AUTH,
        action: AuditAction.LOGOUT,
        recordType: 'TemporaryInspector',
        recordId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return { message: 'Logout successful', data: {} };
    }

    if (user.accountKind === 'service_user') {
      await this.serviceUserPortalAccountsService.clearRefreshToken(user.id);
      await this.auditLogs.logLogin({
        userId: undefined,
        email: user.email,
        event: 'logout',
        status: AuditStatus.SUCCESS,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      await this.auditLogs.logAudit({
        userId: undefined,
        module: AuditModule.AUTH,
        action: AuditAction.LOGOUT,
        recordType: 'ServiceUserPortalAccount',
        recordId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { serviceUserId: user.serviceUserId },
      });
      return { message: 'Logout successful', data: {} };
    }

    if (user.accountKind === 'employee') {
      throw new UnauthorizedException('Use /employee-app/auth/logout for employee app sessions');
    }

    const dbUser = await this.usersService.findById(user.id);
    await this.usersService.clearRefreshToken(user.id);
    await this.auditLogs.logLogin({
      userId: user.id,
      email: dbUser?.email ?? user.email,
      event: 'logout',
      status: AuditStatus.SUCCESS,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await this.auditLogs.logAudit({
      userId: user.id,
      module: AuditModule.AUTH,
      action: AuditAction.LOGOUT,
      recordType: 'User',
      recordId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { message: 'Logout successful', data: {} };
  }

  private async issueTokens(userId: string) {
    const accessToken = await this.jwtService.signAsync({ sub: userId });

    const refreshSignOptions = {
      secret: this.config.get<string>('JWT_REFRESH_TOKEN_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_TOKEN_EXPIRES_IN', '7d'),
      // Unique per issue so two tokens minted in the same second never share a hash.
      jwtid: randomUUID(),
    } as JwtSignOptions;

    const refreshToken = await this.jwtService.signAsync({ sub: userId }, refreshSignOptions);

    return { accessToken, refreshToken };
  }

  private async issueTemporaryInspectorTokens(inspectorId: string) {
    const accessToken = await this.jwtService.signAsync({ sub: inspectorId, typ: 'ti' });

    const refreshSignOptions = {
      secret: this.config.get<string>('JWT_REFRESH_TOKEN_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_TOKEN_EXPIRES_IN', '7d'),
      // Unique per issue so two tokens minted in the same second never share a hash.
      jwtid: randomUUID(),
    } as JwtSignOptions;

    const refreshToken = await this.jwtService.signAsync({ sub: inspectorId, typ: 'ti' }, refreshSignOptions);

    return { accessToken, refreshToken };
  }

  private async issueServiceUserPortalTokens(accountId: string) {
    const accessToken = await this.jwtService.signAsync({ sub: accountId, typ: 'su' });

    const refreshSignOptions = {
      secret: this.config.get<string>('JWT_REFRESH_TOKEN_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_TOKEN_EXPIRES_IN', '7d'),
      // Unique per issue so two tokens minted in the same second never share a hash.
      jwtid: randomUUID(),
    } as JwtSignOptions;

    const refreshToken = await this.jwtService.signAsync({ sub: accountId, typ: 'su' }, refreshSignOptions);

    return { accessToken, refreshToken };
  }
}

export function hashPasswordResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPasswordResetEmail(firstName: string | null, link: string) {
  const name = firstName?.trim();
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const intro =
    'We received a request to reset the password for your Careflow account. Use the link below to choose a new password:';
  const expiry = `This link expires in ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes and can be used once.`;
  const ignore =
    "If you didn't request this, you can ignore this email — your password won't change.";
  const text = [greeting, '', intro, '', link, '', expiry, '', ignore].join(
    '\n',
  );
  const href = escapeHtml(link);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p><a href="${href}">Reset your password</a></p>`,
    `<p style="word-break:break-all;font-size:12px;color:#555">${href}</p>`,
    `<p>${escapeHtml(expiry)}</p>`,
    `<p>${escapeHtml(ignore)}</p>`,
  ].join('\n');
  return { subject: 'Reset your Careflow password', text, html };
}
