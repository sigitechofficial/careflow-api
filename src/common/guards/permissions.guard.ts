import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestUser } from '../decorators/current-user.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAll = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest();
    const user = req.user as RequestUser | undefined;
    if (!user) throw new ForbiddenException('Not authenticated');

    const perms = user.permissions ?? [];

    if (requiredAny?.length) {
      const okAny = requiredAny.some((p) => perms.includes(p));
      if (!okAny) throw new ForbiddenException('Insufficient permissions');
    }

    if (requiredAll?.length) {
      const okAll = requiredAll.every((p) => perms.includes(p));
      if (!okAll) throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}

