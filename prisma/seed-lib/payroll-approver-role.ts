/**
 * Seeded role that carries the pay authorisation powers. It is not assigned to any user
 * automatically: an organisation decides who approves pay, and it has to be someone other than
 * the person who prepared the run or batch (maker / checker).
 *
 * `billing.financial_reset` and `audit_logs.delete` are deliberately not part of it.
 */
export const PAYROLL_APPROVER_ROLE = 'Payroll Approver';

export const PAYROLL_APPROVER_PERMISSIONS = [
  // read access needed to review what is being approved
  'billing.payroll_runs.read',
  'billing.employee_payouts.read',
  'billing.visit_reconciliations.read',
  'payroll.runs.read',
  // authorisation
  'billing.payroll_runs.approve',
  'billing.employee_payouts.approve',
  'billing.employee_payouts.settle',
  'payroll.runs.close',
  'payroll.runs.reopen',
  'payroll.pay_agreements.approve',
  'payroll.employees.read',
  // A pay run, a UK run and a payout batch each cover every branch, so approving them does too.
  'payroll.scope.organisation',
] as const;
