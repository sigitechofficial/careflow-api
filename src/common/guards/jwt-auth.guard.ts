import { ExecutionContext, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestUser } from '../decorators/current-user.decorator';
import { REVIEWER_ALLOWED_KEY, isReviewerOnly } from '../auth/independent-reviewer';
import { inspectorDecision } from '../../temporary-inspectors/inspector-access';
import { rememberInspectorId } from '../../temporary-inspectors/inspector-ids';

const inspectorLog = new Logger('InspectorAccess');

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
    const req = context.switchToHttp().getRequest();
    const user = req?.user as RequestUser | undefined;
    // A temporary inspector reads their chosen service users' records and nothing else (read-only).
    if (user?.accountKind === 'temporary_inspector') {
      const decision = inspectorDecision({
        method: String(req.method ?? 'GET'),
        routePath: String(req.route?.path ?? ''),
        params: (req.params ?? {}) as Record<string, string | undefined>,
        serviceUserIds: user.inspectorAccess?.serviceUserIds ?? [],
      });
      if (!decision.allowed) {
        inspectorLog.log(`Refused for inspector ${user.username ?? user.id}: ${req.method} ${req.route?.path ?? req.url}`);
        if (decision.status === 404) throw new NotFoundException(decision.message);
        throw new ForbiddenException(decision.message);
      }
      req.inspectorView = decision;
      rememberInspectorId(user.id);
    }
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
