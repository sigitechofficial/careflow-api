import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';

function runGuard(required: string[], user: Partial<RequestUser> | undefined) {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === PERMISSIONS_KEY) return required;
      if (key === ANY_PERMISSIONS_KEY) return undefined;
      return undefined;
    },
  } as unknown as Reflector;
  const guard = new PermissionsGuard(reflector);
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return guard.canActivate(context);
}

const staffUser = (permissions: string[], roles: string[] = ['Manager']): RequestUser => ({
  id: 'user-1',
  email: 'user@test',
  roles,
  permissions,
  accountKind: 'user',
});

describe('Policy permissions', () => {
  it('allows Super Admin regardless of permission keys', () => {
    expect(
      runGuard(
        ['policies.create'],
        staffUser([], ['Super Admin']),
      ),
    ).toBe(true);
  });

  it('allows a manager with policies.create', () => {
    expect(runGuard(['policies.create'], staffUser(['policies.create']))).toBe(true);
  });

  it('denies a carer without policies.create', () => {
    expect(() => runGuard(['policies.create'], staffUser(['policies.read'], ['Carer/Domestic']))).toThrow(
      ForbiddenException,
    );
  });

  it('denies category management without policies.categories.manage', () => {
    expect(() =>
      runGuard(['policies.categories.manage'], staffUser(['policies.read', 'policies.create'])),
    ).toThrow(ForbiddenException);
  });

  it('allows category management with policies.categories.manage', () => {
    expect(runGuard(['policies.categories.manage'], staffUser(['policies.categories.manage']))).toBe(true);
  });

  it.each([
    'policies.read',
    'policies.update',
    'policies.submit',
    'policies.review',
    'policies.approve',
    'policies.publish',
    'policies.archive',
  ])('enforces %s', (key) => {
    expect(runGuard([key], staffUser([key]))).toBe(true);
    expect(() => runGuard([key], staffUser(['policies.read'].filter((k) => k !== key)))).toThrow(
      ForbiddenException,
    );
  });

  it('blocks employee and service_user account kinds', () => {
    expect(() =>
      runGuard(['policies.read'], { ...staffUser(['policies.read']), accountKind: 'employee' }),
    ).toThrow(ForbiddenException);
    expect(() =>
      runGuard(['policies.read'], { ...staffUser(['policies.read']), accountKind: 'service_user' }),
    ).toThrow(ForbiddenException);
  });

  it('requires authentication', () => {
    expect(() => runGuard(['policies.read'], undefined)).toThrow(ForbiddenException);
  });
});
