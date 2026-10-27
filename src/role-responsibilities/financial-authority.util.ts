import { COMPANY_WIDE_IDENTITY_ROLES, IDENTITY_ROLE } from '../common/org-scope/org-scope.types';

/**
 * Who can do what with carer pay. Read-only: it reports what the roles already grant, so an
 * administrator can see who holds each power and where nobody does. It never assigns anyone.
 */
export type FinancialPower = {
  key: string;
  label: string;
  /** Every one of these is needed. */
  permissions: string[];
  /** The records cover every branch, so the user also needs organisation-wide pay access. */
  organisationWide: boolean;
  /** Payroll cannot be completed while nobody holds this. */
  requiredForPayroll: boolean;
  /** The preparing power this one checks: the same person cannot do both on one record. */
  checks?: string;
};

export const PAYROLL_ORGANISATION_SCOPE = 'payroll.scope.organisation';

export const FINANCIAL_POWERS: FinancialPower[] = [
  {
    key: 'prepare-pay-runs',
    label: 'Prepare visit pay runs and enter pay corrections',
    permissions: ['billing.payroll_runs.manage'],
    organisationWide: true,
    requiredForPayroll: true,
  },
  {
    key: 'approve-pay-runs',
    label: 'Approve and lock visit pay runs',
    permissions: ['billing.payroll_runs.approve'],
    organisationWide: true,
    requiredForPayroll: true,
    checks: 'prepare-pay-runs',
  },
  {
    key: 'approve-corrections',
    label: 'Approve pay corrections',
    permissions: ['billing.payroll_runs.manage'],
    organisationWide: true,
    requiredForPayroll: false,
    checks: 'prepare-pay-runs',
  },
  {
    key: 'prepare-uk-payroll',
    label: 'Prepare UK payroll runs',
    permissions: ['payroll.runs.manage'],
    organisationWide: true,
    requiredForPayroll: true,
  },
  {
    key: 'close-uk-payroll',
    label: 'Close UK payroll runs',
    permissions: ['payroll.runs.close'],
    organisationWide: true,
    requiredForPayroll: true,
    checks: 'prepare-uk-payroll',
  },
  {
    key: 'reopen-uk-payroll',
    label: 'Reopen closed UK payroll runs',
    permissions: ['payroll.runs.reopen'],
    organisationWide: true,
    requiredForPayroll: false,
  },
  {
    key: 'prepare-payouts',
    label: 'Prepare payout batches',
    permissions: ['billing.employee_payouts.manage'],
    organisationWide: true,
    requiredForPayroll: true,
  },
  {
    key: 'approve-payouts',
    label: 'Approve payout batches',
    permissions: ['billing.employee_payouts.approve'],
    organisationWide: true,
    requiredForPayroll: true,
    checks: 'prepare-payouts',
  },
  {
    key: 'record-settlement',
    label: 'Record that a payout has been paid',
    permissions: ['billing.employee_payouts.settle'],
    organisationWide: true,
    requiredForPayroll: true,
  },
  {
    key: 'view-payroll-audit',
    label: 'View the payroll audit trail',
    permissions: ['audit_logs.read'],
    organisationWide: true,
    requiredForPayroll: false,
  },
];

export type AuthorityUser = {
  id: string;
  name: string;
  roles: Array<{ name: string; permissions: string[] }>;
};

export type FinancialAuthorityWarning = {
  powerKey: string;
  kind: 'NO_HOLDER' | 'SAME_PERSON';
  message: string;
};

/** Same rules as PermissionsGuard and PayrollScopeGuard, applied to a user's roles. */
export function userHoldsPower(user: AuthorityUser, power: FinancialPower): boolean {
  const granted = new Set(user.roles.flatMap((r) => r.permissions));
  const roleNames = user.roles.map((r) => r.name);
  const superAdmin = roleNames.includes(IDENTITY_ROLE.SUPER_ADMIN);
  const holdsAll = power.permissions.every(
    (p) => granted.has(p) || superAdmin,
  );
  if (!holdsAll) return false;
  if (!power.organisationWide) return true;
  return roleNames.some((n) => COMPANY_WIDE_IDENTITY_ROLES.has(n)) || granted.has(PAYROLL_ORGANISATION_SCOPE);
}

export function summariseFinancialAuthority(users: AuthorityUser[]) {
  const holders = new Map(
    FINANCIAL_POWERS.map((power) => [power.key, users.filter((u) => userHoldsPower(u, power))]),
  );
  const warnings: FinancialAuthorityWarning[] = [];
  for (const power of FINANCIAL_POWERS) {
    const held = holders.get(power.key) ?? [];
    if (held.length === 0) {
      if (power.requiredForPayroll) {
        warnings.push({
          powerKey: power.key,
          kind: 'NO_HOLDER',
          message: `No active user can ${lowerFirst(power.label)}. Payroll cannot be completed until a role with this power is given to someone.`,
        });
      }
      continue;
    }
    // Maker / checker: one record needs two different people.
    const makers = power.checks ? (holders.get(power.checks) ?? []) : [];
    if (power.checks && held.length === 1 && makers.length === 1 && makers[0].id === held[0].id) {
      warnings.push({
        powerKey: power.key,
        kind: 'SAME_PERSON',
        message: `Only ${held[0].name} can ${lowerFirst(power.label)}, and is also the only person who prepares them. The person who prepares a record cannot approve it, so a second person is needed.`,
      });
    }
  }
  return {
    powers: FINANCIAL_POWERS.map((power) => {
      const held = holders.get(power.key) ?? [];
      return {
        key: power.key,
        label: power.label,
        permissions: power.permissions,
        requiredForPayroll: power.requiredForPayroll,
        users: held.map((u) => ({ id: u.id, name: u.name, roles: u.roles.map((r) => r.name) })),
      };
    }),
    warnings,
  };
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
