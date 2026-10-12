/**
 * Permissions the "Super Admin" shortcut does not grant.
 *
 * Authorising pay, recording a bank settlement, closing or reopening a payroll run, deleting
 * financial test data and clearing the audit log are powers of a named role, not of system
 * administration. A user holds one of these only when a role assigned to them lists it.
 */
export const EXPLICIT_GRANT_PERMISSIONS: readonly string[] = [
  'billing.payroll_runs.approve',
  'billing.employee_payouts.approve',
  'billing.employee_payouts.settle',
  'billing.financial_reset',
  'payroll.runs.close',
  'payroll.runs.reopen',
  'audit_logs.delete',
];

export function requiresExplicitGrant(permissions: readonly string[] | undefined): boolean {
  return Boolean(permissions?.some((p) => EXPLICIT_GRANT_PERMISSIONS.includes(p)));
}
