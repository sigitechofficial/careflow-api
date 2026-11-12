import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { TemporaryInspectorsService } from '../../temporary-inspectors/temporary-inspectors.service';
import { ServiceUserPortalAccountsService } from '../../service-user-portal/service-user-portal-accounts.service';
import { EmployeePortalAccountsService } from '../../employees/employee-portal-accounts.service';
import { SIGNED_OUT_MESSAGES, SignInSessionsService } from '../sign-in-sessions/sign-in-sessions.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly temporaryInspectorsService: TemporaryInspectorsService,
    private readonly serviceUserPortalAccountsService: ServiceUserPortalAccountsService,
    private readonly employeePortalAccountsService: EmployeePortalAccountsService,
    private readonly sessions: SignInSessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_TOKEN_SECRET') as string,
    });
  }

  /** A token bound to a device that has been signed out (another sign-in over the limit, password changed...). */
  private async assertSignedIn(sid?: string) {
    if (!sid) return;
    const ended = await this.sessions.endedReason(sid);
    if (ended) throw new UnauthorizedException(SIGNED_OUT_MESSAGES[ended]);
  }

  async validate(payload: { sub: string; typ?: string; sid?: string }) {
    if (payload.typ === 'ti') {
      const ctx = await this.temporaryInspectorsService.getAuthContextForJwt(payload.sub);
      if (!ctx) throw new UnauthorizedException('Invalid token');
      return ctx;
    }
    if (payload.typ === 'su') {
      const ctx = await this.serviceUserPortalAccountsService.getAuthContextForJwt(payload.sub);
      if (!ctx) throw new UnauthorizedException('Invalid token');
      return ctx;
    }
    if (payload.typ === 'emp') {
      await this.assertSignedIn(payload.sid);
      const ctx = await this.employeePortalAccountsService.getAuthContextForJwt(payload.sub);
      if (!ctx) throw new UnauthorizedException('Invalid token');
      return payload.sid ? { ...ctx, sessionId: payload.sid } : ctx;
    }
    await this.assertSignedIn(payload.sid);
    const user = await this.usersService.getAuthContext(payload.sub);
    if (!user) throw new UnauthorizedException('Invalid token');
    return payload.sid ? { ...user, sessionId: payload.sid } : user;
  }
}

