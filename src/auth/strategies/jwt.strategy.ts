import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { TemporaryInspectorsService } from '../../temporary-inspectors/temporary-inspectors.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly temporaryInspectorsService: TemporaryInspectorsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_TOKEN_SECRET') as string,
    });
  }

  async validate(payload: { sub: string; typ?: string }) {
    if (payload.typ === 'ti') {
      const ctx = await this.temporaryInspectorsService.getAuthContextForJwt(payload.sub);
      if (!ctx) throw new UnauthorizedException('Invalid token');
      return ctx;
    }
    const user = await this.usersService.getAuthContext(payload.sub);
    if (!user) throw new UnauthorizedException('Invalid token');
    return user;
  }
}

