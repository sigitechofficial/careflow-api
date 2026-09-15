import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuditStatus, SecuritySeverity } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { SecurityEventType } from '../audit-logs/enums/security-event.enum';
import { EmployeePortalAccountsService } from '../employees/employee-portal-accounts.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { EmployeeAppLoginDto, EmployeeAppRefreshDto } from './dto/employee-app-auth.dto';
import { FcmPushService } from '../notifications/fcm-push.service';
import {
  EMPLOYEE_APP_SESSION_BLOCK_MESSAGE,
  shouldBlockSecondEmployeeAppLogin,
} from './employee-app-single-session.util';

@Injectable()
export class EmployeeAppAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditLogs: AuditLogsService,
    private readonly portalAccounts: EmployeePortalAccountsService,
    private readonly fcm: FcmPushService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async login(dto: EmployeeAppLoginDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    const row = await this.portalAccounts.findByEmailForLogin(dto.email);
    if (!row) {
      await this.auditLogs.logSecurityEvent({
        eventType: SecurityEventType.FAILED_LOGIN,
        severity: SecuritySeverity.MEDIUM,
        description: 'Failed employee app login — unknown email',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { email: dto.email.trim().toLowerCase(), channel: 'employee_app' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    try {
      this.portalAccounts.assertLoginable(row);
    } catch {
      await this.auditLogs.logSecurityEvent({
        eventType: SecurityEventType.FAILED_LOGIN,
        severity: SecuritySeverity.MEDIUM,
        description: 'Failed employee app login — disabled or inactive',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { portalAccountId: row.id, channel: 'employee_app' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await this.portalAccounts.verifyPassword(row, dto.password);
    if (!ok) {
      await this.auditLogs.logSecurityEvent({
        eventType: SecurityEventType.FAILED_LOGIN,
        severity: SecuritySeverity.MEDIUM,
        description: 'Failed employee app login — bad password',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { portalAccountId: row.id, channel: 'employee_app' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const [policyEnabled, pushTokensDead] = await Promise.all([
      this.orgSettings.isSingleDeviceLoginCareApp(),
      this.fcm.areEmployeePushTokensDead(row.employeeId),
    ]);
    if (
      shouldBlockSecondEmployeeAppLogin({
        policyEnabled,
        hasRefreshToken: Boolean(row.refreshTokenHash),
        lastSeenAt: row.lastSeenAt,
        lastLoginAt: row.lastLoginAt,
        pushTokensDead,
      })
    ) {
      await this.auditLogs.logSecurityEvent({
        eventType: SecurityEventType.FAILED_LOGIN,
        severity: SecuritySeverity.LOW,
        description: 'Employee app login blocked — other session active',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { portalAccountId: row.id, employeeId: row.employeeId, channel: 'employee_app' },
      });
      throw new ConflictException(EMPLOYEE_APP_SESSION_BLOCK_MESSAGE);
    }

    const tokens = await this.issueTokens(row.id);
    const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 12);
    await this.portalAccounts.setRefreshTokenHash(row.id, refreshTokenHash);
    await this.portalAccounts.activateSession(row.id, {
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

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
      recordType: 'EmployeePortalAccount',
      recordId: row.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      status: AuditStatus.SUCCESS,
      metadata: { portalAccountId: row.id, employeeId: row.employeeId, channel: 'employee_app' },
    });

    return {
      message: 'Login successful',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        employeeId: row.employeeId,
        email: row.email,
        firstName: row.employee.personalDetail?.firstName ?? null,
        lastName: row.employee.personalDetail?.lastName ?? null,
      },
    };
  }

  async refresh(dto: EmployeeAppRefreshDto, req: Request) {
    const meta = this.auditLogs.getRequestMeta(req);
    let payload: { sub: string; typ?: string };
    try {
      payload = (await this.jwtService.verifyAsync(dto.refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_TOKEN_SECRET'),
      })) as { sub: string; typ?: string };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.typ !== 'emp') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const row = await this.portalAccounts.findForRefresh(payload.sub);
    if (!row?.refreshTokenHash) throw new UnauthorizedException('Invalid refresh token');
    const ok = await bcrypt.compare(dto.refreshToken, row.refreshTokenHash);
    if (!ok) throw new UnauthorizedException('Invalid refresh token');
    this.portalAccounts.assertLoginable(row);

    const tokens = await this.issueTokens(row.id);
    const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 12);
    await this.portalAccounts.setRefreshTokenHash(row.id, refreshTokenHash);
    await this.portalAccounts.touchLastSeen(row.id);

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
      recordType: 'EmployeePortalAccount',
      recordId: row.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { channel: 'employee_app' },
    });

    return {
      message: 'Token refreshed',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    };
  }

  async logout(user: RequestUser, req: Request, deviceToken?: string) {
    const meta = this.auditLogs.getRequestMeta(req);
    if (deviceToken?.trim() && user.employeeId) {
      await this.fcm.deleteToken(user.employeeId, deviceToken);
    }
    await this.portalAccounts.clearRefreshToken(user.id);
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
      recordType: 'EmployeePortalAccount',
      recordId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { employeeId: user.employeeId, channel: 'employee_app' },
    });
    return { message: 'Logout successful', data: {} };
  }

  me(user: RequestUser) {
    return {
      data: {
        accountId: user.id,
        employeeId: user.employeeId,
        email: user.email,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        profilePhotoUrl: user.profilePhotoUrl ?? null,
        accountKind: user.accountKind,
        roles: user.roles,
        permissions: user.permissions,
      },
    };
  }

  private async issueTokens(accountId: string) {
    const accessToken = await this.jwtService.signAsync({ sub: accountId, typ: 'emp' });

    const refreshSignOptions = {
      secret: this.config.get<string>('JWT_REFRESH_TOKEN_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_TOKEN_EXPIRES_IN', '7d'),
    } as JwtSignOptions;

    const refreshToken = await this.jwtService.signAsync(
      { sub: accountId, typ: 'emp' },
      refreshSignOptions,
    );

    return { accessToken, refreshToken };
  }
}
