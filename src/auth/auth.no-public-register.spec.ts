import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

/**
 * Security: nobody may make their own office login. Self-registration let a stranger create an
 * active login with any email (e.g. a manager's), which the staff-record RBAC sync could then
 * promote. Office logins are made only by administrators (POST /users, guarded by users.create).
 */
describe('Auth: no public self-registration', () => {
  const proto = AuthController.prototype as unknown as Record<string, unknown>;
  const routes = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .map((name) => {
      const handler = proto[name] as object;
      return {
        name,
        path: Reflect.getMetadata(PATH_METADATA, handler) as string | undefined,
        method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined,
        isPublic: Boolean(Reflect.getMetadata(IS_PUBLIC_KEY, handler)),
      };
    })
    .filter((r) => r.path !== undefined);

  it('has no register / sign-up route on /auth', () => {
    const paths = routes.map((r) => String(r.path).replace(/^\//, '').toLowerCase());
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(p).not.toMatch(/register|sign-?up/);
    }
  });

  it('AuthService has no register method', () => {
    expect((AuthService.prototype as unknown as Record<string, unknown>).register).toBeUndefined();
  });

  it('no public POST route creates users (only login, refresh and password-reset style routes are public)', () => {
    const publicPosts = routes
      .filter((r) => r.isPublic && r.method === RequestMethod.POST)
      .map((r) => String(r.path).replace(/^\//, ''));
    const allowed = /^(login(\/.*)?|service-user\/login|refresh|forgot-password|reset-password|.*password.*|.*reset.*|.*invite.*\/accept|.*set-password.*)$/;
    for (const p of publicPosts) {
      expect(p).toMatch(allowed);
    }
  });
});
