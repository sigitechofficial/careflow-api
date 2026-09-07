/**
 * Approach A organizational scope (single-tenant company per deployment).
 *
 * Role → WHAT (via Permission keys). Scope → WHERE (locations / branches).
 * Existing display names are preserved; new roles are additive.
 */

export type OrgScopeType = 'platform' | 'company' | 'branch';

export type OrgScope = {
  /** Super Admin: no company/branch restriction. */
  platformWide: boolean;
  /** Company-wide within this deployment (Admin, Master Staff Allocation, legacy roles). */
  companyWide: boolean;
  /**
   * null = all locations in the company (unrestricted within tenant).
   * string[] = must filter to these Location ids (branch scope).
   */
  locationIds: string[] | null;
  scopeType: OrgScopeType;
  roles: string[];
  permissions: string[];
};

/** Identity role names (must match `identity.Role.name`). */
export const IDENTITY_ROLE = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  BRANCH_ADMIN: 'Branch Admin',
  MASTER_STAFF_ALLOCATION: 'Master Staff Allocation',
  STAFF_ALLOCATION: 'Staff Allocation',
  MANAGER: 'Manager',
  CARE_COORDINATOR: 'Care Coordinator',
  HR: 'HR',
} as const;

/**
 * Roles that always see the whole company (ignore UserLocation).
 * All other identity roles are branch-restricted via UserLocation / employment.
 */
export const COMPANY_WIDE_IDENTITY_ROLES = new Set<string>([
  IDENTITY_ROLE.SUPER_ADMIN,
  IDENTITY_ROLE.ADMIN,
  IDENTITY_ROLE.MASTER_STAFF_ALLOCATION,
]);

/**
 * Roles that default to branch ACL (UserLocation / employment).
 * Manager / HR / Care Coordinator also use UserLocation when assigned — see UsersService.
 */
export const BRANCH_SCOPED_IDENTITY_ROLES = new Set<string>([
  IDENTITY_ROLE.BRANCH_ADMIN,
  IDENTITY_ROLE.STAFF_ALLOCATION,
  IDENTITY_ROLE.MANAGER,
  IDENTITY_ROLE.CARE_COORDINATOR,
  IDENTITY_ROLE.HR,
]);

/** Roles an actor may never assign above their own privilege. */
export const ROLE_PRIVILEGE_RANK: Record<string, number> = {
  [IDENTITY_ROLE.SUPER_ADMIN]: 100,
  [IDENTITY_ROLE.ADMIN]: 80,
  [IDENTITY_ROLE.MASTER_STAFF_ALLOCATION]: 60,
  [IDENTITY_ROLE.BRANCH_ADMIN]: 50,
  [IDENTITY_ROLE.MANAGER]: 40,
  [IDENTITY_ROLE.CARE_COORDINATOR]: 30,
  [IDENTITY_ROLE.HR]: 30,
  [IDENTITY_ROLE.STAFF_ALLOCATION]: 20,
};

export function maxRolePrivilege(roles: string[]): number {
  let max = 0;
  for (const role of roles) {
    const rank = ROLE_PRIVILEGE_RANK[role] ?? 10;
    if (rank > max) max = rank;
  }
  return max;
}

export function resolveScopeType(roles: string[]): OrgScopeType {
  if (roles.includes(IDENTITY_ROLE.SUPER_ADMIN)) return 'platform';
  if (
    roles.includes(IDENTITY_ROLE.ADMIN) ||
    roles.includes(IDENTITY_ROLE.MASTER_STAFF_ALLOCATION)
  ) {
    return 'company';
  }
  // Manager / HR / Coordinator / Branch Admin / Staff Allocation → branch ACL.
  if (roles.some((r) => BRANCH_SCOPED_IDENTITY_ROLES.has(r))) {
    return 'branch';
  }
  // Unknown legacy roles: treat as branch-scoped (must assign UserLocation).
  return 'branch';
}

export function isCompanyWideRoles(roles: string[]): boolean {
  return resolveScopeType(roles) === 'platform' || resolveScopeType(roles) === 'company';
}
