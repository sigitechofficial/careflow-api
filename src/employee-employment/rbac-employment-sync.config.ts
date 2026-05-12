/**
 * Maps lookup `RBACLevel.name` (employment) → identity `Role.name` (UserRole).
 * Extend when new RBAC levels are seeded; unknown names fall through to exact
 * identity role name match if a role with that name exists.
 */
export const RBAC_LEVEL_TO_IDENTITY_ROLE_NAME: Record<string, string> = {
  'Group Administrator': 'Admin',
  Administrator: 'Admin',
  Manager: 'Manager',
  'Privacy Officer': 'Admin',
  'Operation Management': 'Manager',
  'Staff Allocation': 'Staff Allocation',
  'Senior Carer/Nurse': 'Senior Carer/Nurse',
  'Carer/Domestic': 'Carer/Domestic',
}

/** Identity roles that employment RBAC sync may remove/replace for a linked user. */
export const IDENTITY_ROLES_MANAGED_BY_EMPLOYMENT_RBAC = new Set(
  Array.from(new Set(Object.values(RBAC_LEVEL_TO_IDENTITY_ROLE_NAME))),
)
