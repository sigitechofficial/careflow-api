import {
  BRANCH_SCOPED_IDENTITY_ROLES,
  COMPANY_WIDE_IDENTITY_ROLES,
  IDENTITY_ROLE,
  isCompanyWideRoles,
  maxRolePrivilege,
  resolveScopeType,
  ROLE_PRIVILEGE_RANK,
} from './org-scope.types';

describe('org-scope.types', () => {
  it('maps Super Admin to platform scope', () => {
    expect(resolveScopeType([IDENTITY_ROLE.SUPER_ADMIN])).toBe('platform');
  });

  it('maps Admin and Master Staff Allocation to company scope', () => {
    expect(resolveScopeType([IDENTITY_ROLE.ADMIN])).toBe('company');
    expect(resolveScopeType([IDENTITY_ROLE.MASTER_STAFF_ALLOCATION])).toBe('company');
  });

  it('maps Branch Admin and Staff Allocation to branch scope', () => {
    expect(resolveScopeType([IDENTITY_ROLE.BRANCH_ADMIN])).toBe('branch');
    expect(resolveScopeType([IDENTITY_ROLE.STAFF_ALLOCATION])).toBe('branch');
  });

  it('maps Manager / HR / Care Coordinator to branch scope', () => {
    expect(resolveScopeType([IDENTITY_ROLE.MANAGER])).toBe('branch');
    expect(resolveScopeType([IDENTITY_ROLE.HR])).toBe('branch');
    expect(resolveScopeType([IDENTITY_ROLE.CARE_COORDINATOR])).toBe('branch');
    expect(isCompanyWideRoles([IDENTITY_ROLE.MANAGER])).toBe(false);
  });

  it('company-wide wins when Admin is combined with Staff Allocation', () => {
    expect(
      resolveScopeType([IDENTITY_ROLE.ADMIN, IDENTITY_ROLE.STAFF_ALLOCATION]),
    ).toBe('company');
  });

  it('prevents privilege escalation rank checks', () => {
    expect(maxRolePrivilege([IDENTITY_ROLE.BRANCH_ADMIN])).toBe(
      ROLE_PRIVILEGE_RANK[IDENTITY_ROLE.BRANCH_ADMIN],
    );
    expect(maxRolePrivilege([IDENTITY_ROLE.ADMIN])).toBeGreaterThan(
      maxRolePrivilege([IDENTITY_ROLE.BRANCH_ADMIN]),
    );
    expect(COMPANY_WIDE_IDENTITY_ROLES.has(IDENTITY_ROLE.ADMIN)).toBe(true);
    expect(BRANCH_SCOPED_IDENTITY_ROLES.has(IDENTITY_ROLE.BRANCH_ADMIN)).toBe(true);
    expect(BRANCH_SCOPED_IDENTITY_ROLES.has(IDENTITY_ROLE.MANAGER)).toBe(true);
  });
});
