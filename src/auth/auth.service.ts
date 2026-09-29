import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
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

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditLogs: AuditLogsService,
    private readonly temporaryInspectorsService: TemporaryInspectorsService,
    private readonly serviceUserPortalAccountsService: ServiceUserPortalAccountsService,
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
    await this.auditLogs.logSecurityEvent({
      eventType: SecurityEventType.PASSWORD_RESET_REQUESTED,
      severity: SecuritySeverity.LOW,
      description: 'Password reset requested',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { email: dto.email },
    });
    return { message: 'If the email exists, a reset link will be sent', data: {} };
  }

  async resetPassword(dto: ResetPasswordDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    await this.auditLogs.logSecurityEvent({
      eventType: SecurityEventType.PASSWORD_RESET_COMPLETED,
      severity: SecuritySeverity.MEDIUM,
      description: 'Password reset completed (placeholder flow)',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { flow: 'reset_password_placeholder' },
    });
    return { message: 'Password reset placeholder', data: {} };
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
