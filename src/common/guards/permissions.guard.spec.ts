import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { EXPLICIT_GRANT_PERMISSIONS } from './explicit-grant-permissions';
import { PermissionsGuard } from './permissions.guard';

type User = { roles?: string[]; permissions?: string[]; accountKind?: string };

function run(required: { all?: string[]; any?: string[] }, user?: User): boolean {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === PERMISSIONS_KEY ? required.all : key === ANY_PERMISSIONS_KEY ? required.any : key === IS_PUBLIC_KEY ? false : undefined,
  } as unknown as Reflector;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return new PermissionsGuard(reflector).canActivate(context);
}

const superAdmin: User = { roles: ['Super Admin'], permissions: [] };
const payrollOfficer: User = { roles: ['Payroll Officer'], permissions: ['billing.payroll_runs.manage'] };
const payrollApprover: User = {
  roles: ['Finance Manager'],
  permissions: ['billing.payroll_runs.manage', 'billing.payroll_runs.approve'],
};

describe('PermissionsGuard', () => {
  it('lets Super Admin through ordinary permissions', () => {
    expect(run({ all: ['billing.payroll_runs.manage'] }, superAdmin)).toBe(true);
    expect(run({ any: ['employees.update', 'billing.pay_cards.manage'] }, superAdmin)).toBe(true);
  });

  it('lets Super Admin approve pay, settle payouts, close or reopen payroll, reset data and clear the audit log', () => {
    for (const permission of EXPLICIT_GRANT_PERMISSIONS) {
      expect(run({ all: [permission] }, superAdmin)).toBe(true);
    }
  });

  it('SI-11: refuses a user without the permission, and a user without the approval permission', () => {
    expect(() => run({ all: ['billing.payroll_runs.manage'] }, { roles: ['Carer coordinator'], permissions: [] })).toThrow(
      ForbiddenException,
    );
    expect(() => run({ all: ['billing.payroll_runs.approve'] }, payrollOfficer)).toThrow(ForbiddenException);
    expect(run({ all: ['billing.payroll_runs.approve'] }, payrollApprover)).toBe(true);
  });

  it('SI-10: refuses carer and service user accounts on staff routes', () => {
    expect(() => run({ all: ['billing.payroll_runs.read'] }, { accountKind: 'employee', permissions: ['billing.payroll_runs.read'] })).toThrow(
      'Staff access required',
    );
    expect(() => run({ all: ['billing.payroll_runs.read'] }, { accountKind: 'service_user' })).toThrow(ForbiddenException);
  });

  it('refuses an unauthenticated request on a protected route', () => {
    expect(() => run({ all: ['billing.payroll_runs.read'] }, undefined)).toThrow('Not authenticated');
  });
});
