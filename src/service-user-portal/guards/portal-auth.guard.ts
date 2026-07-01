import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class PortalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user as RequestUser | undefined;
    if (!user) throw new ForbiddenException('Not authenticated');
    if (user.accountKind !== 'service_user' || !user.serviceUserId) {
      throw new ForbiddenException('Portal access required');
    }
    return true;
  }
}
