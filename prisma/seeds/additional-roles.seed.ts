import type { PrismaClient } from '@prisma/client';

/**
 * Roles requested by the client that the original hierarchy did not have.
 *
 * Create-once: permissions are granted only when the role is first created. After that the
 * role is owned by the office (Settings → Roles & Permissions) and later seed runs never add
 * or remove anything — unlike the hierarchy roles, which are topped up on every run.
 */

export const REGISTERED_MANAGER_ROLE = 'Registered Manager';
export const ACCOUNTANT_ROLE = 'Accountant';

/** Manager keys a Registered Manager does NOT inherit: system setup, payroll/billing control, hard deletes. */
export function isExcludedFromRegisteredManager(key: string): boolean {
  if (key === 'roles.manage' || key === 'permissions.manage') return true;
  if (key === 'settings.company.update') return true;
  if (key.startsWith('payroll.')) return true;
  if (key.startsWith('billing.') && key.endsWith('.manage')) return true;
  // Un-allocating a carer is day-to-day rota work, not a record delete.
  if (key.endsWith('.delete') && key !== 'job_allocations.delete') return true;
  return false;
}

/** Added on top of the (filtered) Manager permissions. */
export const REGISTERED_MANAGER_EXTRA_KEYS = [
  // Training for branch staff (Manager has none)
  'learning.dashboard.read',
  'learning.me.read',
  'learning.me.progress',
  'learning.assignments.read',
  'learning.assignments.manage',
  'learning.categories.read',
  'learning.courses.read',
  'learning.certificates.read',
  'learning.certificates.manage',
  'learning.competencies.read',
  'learning.compliance.read',
  'learning.compliance.export',
  'learning.external_training.read',
  'learning.external_training.manage',
  'learning.training_events.read',
  'learning.training_events.manage',
  'learning.reports.read',
  'learning.reports.export',
  // Policies: approve and audit
  'policies.read',
  'policies.review',
  'policies.approve',
  'policies.publish',
  'policies.audit.read',
  'policies.acknowledgements.me',
  'policies.acknowledgements.manage',
  // Safeguarding
  'incidents.view_confidential',
  'incidents.view_highly_confidential',
  // Staff compliance (DBS, right to work, training evidence)
  'employees.read',
  'employees.documents.read',
  'employees.reports.read',
  'employees.compliance.read',
  'employees.compliance.create',
  'employees.compliance.update',
  'employees.compliance.verify',
  'employees.compliance.reject',
  'employees.compliance.documents.upload',
  'employees.compliance.documents.download',
  'employees.compliance.reports.read',
  'employees.compliance.reports.export',
  // Alerts, approvals, surveys, oversight
  'alerts.read',
  'alerts.acknowledge',
  'alerts.assign',
  'alerts.resolve',
  'alerts.dismiss',
  'alerts.update',
  'hours_approvals.read',
  'hours_approvals.manage',
  'surveys.read',
  'surveys.manage',
  'surveys.respond',
  'audit_logs.read',
];

/** Read-only finance. Widen to *.manage in Settings once the client confirms the accountant runs invoices/payroll. */
export const ACCOUNTANT_KEYS = [
  'billing.invoice_runs.read',
  'billing.invoice_templates.read',
  'billing.payments.read',
  'billing.pay_cards.read',
  'billing.charge_cards.read',
  'billing.visit_reconciliations.read',
  'billing.employee_payouts.read',
  'billing.payroll_runs.read',
  'billing.funding_contracts.read',
  'payroll.runs.read',
  'payroll.periods.read',
  'payroll.employees.read',
  'payroll.settings.read',
  'funders.read',
  'funding_types.read',
  'hours_approvals.read',
  'schedule_reports.read',
  'schedule_reports.export',
  'employees.read',
  'service_users.read',
  'service_users.funding.read',
  'lookups.read',
  'notifications.read',
  'notifications.update',
  'notifications.dismiss',
  'notifications.preferences.read',
  'notifications.preferences.update',
  'policies.read',
  'policies.acknowledgements.me',
  'learning.me.read',
  'learning.me.progress',
];

export function registeredManagerKeys(managerKeys: string[]): string[] {
  return [
    ...new Set([
      ...managerKeys.filter((k) => !isExcludedFromRegisteredManager(k)),
      ...REGISTERED_MANAGER_EXTRA_KEYS,
    ]),
  ].sort();
}

async function createRoleOnce(
  prisma: PrismaClient,
  name: string,
  description: string,
  keys: string[],
): Promise<void> {
  // Any existing row (even soft-deleted) means the office already owns this role — leave it.
  const existing = await prisma.role.findFirst({
    where: { name },
    select: { id: true },
  });
  if (existing) {
    console.log(`[seed] Role "${name}": exists — left unchanged.`);
    return;
  }

  const permissions = await prisma.permission.findMany({
    where: { key: { in: keys }, deletedAt: null, isActive: true },
    select: { id: true, key: true },
  });
  const found = new Set(permissions.map((p) => p.key));
  const missing = keys.filter((k) => !found.has(k));
  if (missing.length) {
    console.warn(
      `[seed] Role "${name}": ${missing.length} permission key(s) not found: ${missing.join(', ')}`,
    );
  }

  await prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: { name, description, isActive: true },
    });
    await tx.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  });
  console.log(
    `[seed] Role "${name}": created with ${permissions.length} permissions.`,
  );
}

export async function ensureAdditionalRoles(
  prisma: PrismaClient,
): Promise<void> {
  const managerKeys = (
    await prisma.rolePermission.findMany({
      where: { role: { name: 'Manager', deletedAt: null } },
      select: { permission: { select: { key: true } } },
    })
  ).map((rp) => rp.permission.key);

  await createRoleOnce(
    prisma,
    REGISTERED_MANAGER_ROLE,
    'CQC Registered Manager for assigned branches: Manager access plus training, policy approval, staff compliance and safeguarding incidents. No system setup, payroll or record deletion.',
    registeredManagerKeys(managerKeys),
  );

  await createRoleOnce(
    prisma,
    ACCOUNTANT_ROLE,
    'Finance, read-only: invoices, payments, rate cards, visit reconciliation, payroll and funding. No care plans or clinical data.',
    ACCOUNTANT_KEYS,
  );
}
