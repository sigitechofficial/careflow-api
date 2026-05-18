import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
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
import { TemporaryInspectorsService } from '../temporary-inspectors/temporary-inspectors.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditLogs: AuditLogsService,
    private readonly temporaryInspectorsService: TemporaryInspectorsService,
  ) {}

  async login(dto: LoginDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    const user = await this.usersService.findActiveByEmail(dto.email);
    if (!user) {
      await this.auditLogs.logLogin({
        email: dto.email,
        event: 'login_failed',
        status: AuditStatus.FAILED,
        failureReason: 'Unknown user',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      await this.auditLogs.logSecurityEvent({
        eventType: SecurityEventType.FAILED_LOGIN,
        severity: SecuritySeverity.MEDIUM,
        description: 'Failed login — unknown email',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { email: dto.email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.auditLogs.logLogin({
        userId: user.id,
        email: user.email,
        event: 'login_failed',
        status: AuditStatus.FAILED,
        failureReason: 'Invalid password',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      await this.auditLogs.logSecurityEvent({
        userId: user.id,
        eventType: SecurityEventType.FAILED_LOGIN,
        severity: SecuritySeverity.MEDIUM,
        description: 'Failed login — bad password',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { email: user.email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user.id);
    const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 12);
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
      await this.auditLogs.logSecurityEvent({
        eventType: SecurityEventType.FAILED_LOGIN,
        severity: SecuritySeverity.MEDIUM,
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
      await this.auditLogs.logSecurityEvent({
        eventType: SecurityEventType.FAILED_LOGIN,
        severity: SecuritySeverity.MEDIUM,
        description: 'Failed temporary inspector login — outside validity or inactive',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { temporaryInspectorId: row.id },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await this.temporaryInspectorsService.verifyPassword(row, dto.password);
    if (!ok) {
      await this.auditLogs.logSecurityEvent({
        eventType: SecurityEventType.FAILED_LOGIN,
        severity: SecuritySeverity.MEDIUM,
        description: 'Failed temporary inspector login — bad password',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { temporaryInspectorId: row.id },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTemporaryInspectorTokens(row.id);
    const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 12);
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
      const ok = await bcrypt.compare(dto.refreshToken, row.refreshTokenHash);
      if (!ok) throw new UnauthorizedException('Invalid refresh token');
      this.temporaryInspectorsService.assertLoginable(row);

      const tokens = await this.issueTemporaryInspectorTokens(row.id);
      const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 12);
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

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.refreshTokenHash) throw new UnauthorizedException('Invalid refresh token');

    const ok = await bcrypt.compare(dto.refreshToken, user.refreshTokenHash);
    if (!ok) throw new UnauthorizedException('Invalid refresh token');

    const tokens = await this.issueTokens(user.id);
    const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 12);
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
    } as JwtSignOptions;

    const refreshToken = await this.jwtService.signAsync({ sub: userId }, refreshSignOptions);

    return { accessToken, refreshToken };
  }

  private async issueTemporaryInspectorTokens(inspectorId: string) {
    const accessToken = await this.jwtService.signAsync({ sub: inspectorId, typ: 'ti' });

    const refreshSignOptions = {
      secret: this.config.get<string>('JWT_REFRESH_TOKEN_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_TOKEN_EXPIRES_IN', '7d'),
    } as JwtSignOptions;

    const refreshToken = await this.jwtService.signAsync({ sub: inspectorId, typ: 'ti' }, refreshSignOptions);

    return { accessToken, refreshToken };
  }
}
