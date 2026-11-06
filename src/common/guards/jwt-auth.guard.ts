import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestUser } from '../decorators/current-user.decorator';
import { REVIEWER_ALLOWED_KEY, isReviewerOnly } from '../auth/independent-reviewer';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;
    // An independent reviewer's account (only role "Independent reviewer") reaches its account,
    // signing out and "Surveys to record" only; every other route is refused, permissions or not.
    const user = context.switchToHttp().getRequest()?.user as RequestUser | undefined;
    if (user?.accountKind === 'user' && isReviewerOnly(user.roles)) {
      const allowed = this.reflector.getAllAndOverride<boolean>(REVIEWER_ALLOWED_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) throw new ForbiddenException('This account can only record answers on the surveys it has been given.');
    }
    return true;
  }
}
