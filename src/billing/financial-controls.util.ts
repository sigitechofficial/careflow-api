import { ForbiddenException } from '@nestjs/common';

/**
 * Maker / checker: the person who prepared a financial record cannot be the one who authorises it.
 * A record with no recorded maker (legacy rows, scheduled proposals) can be authorised by anyone
 * who holds the permission.
 */
export function assertDifferentUser(makerId: string | null | undefined, checkerId: string, message: string) {
  if (makerId && makerId === checkerId) throw new ForbiddenException(message);
}

/**
 * Bulk deletion of financial test data is a development / test tool only.
 * NODE_ENV=production always refuses, whatever permission the caller holds.
 */
export function isFinancialResetEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV ?? '').toLowerCase() !== 'production' && env.ALLOW_FINANCIAL_TEST_RESET === 'true';
}

export function assertFinancialResetEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (!isFinancialResetEnvironment(env)) {
    throw new ForbiddenException(
      'Deleting financial records in bulk is disabled. It is available only outside production when ALLOW_FINANCIAL_TEST_RESET=true is set on the server.',
    );
  }
}

/** Permissions that are never granted by the Super Admin shortcut: they must be assigned to a role. */
export const EXPLICIT_GRANT_PERMISSIONS = [
  'billing.payroll_runs.approve',
  'billing.employee_payouts.approve',
  'billing.employee_payouts.settle',
  'billing.financial_reset',
  'payroll.runs.close',
  'payroll.runs.reopen',
] as const;
