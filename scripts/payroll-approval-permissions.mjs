/**
 * Adds the pay authorisation permissions and the "Payroll Approver" role to an existing database
 * (the full seed does the same on a fresh one). Additive and idempotent:
 *
 *   node scripts/payroll-approval-permissions.mjs
 *
 * - creates the permission keys if missing;
 * - creates the role "Payroll Approver" and gives it the approval permissions;
 * - assigns the role to NOBODY. An administrator gives it to the people who approve pay
 *   (Users & access), and they must be different from the people who prepare pay runs.
 *
 * It never removes a permission from any role.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: join(root, '.env') });
const { PrismaClient } = require('@prisma/client');

const NEW_PERMISSIONS = [
  'billing.payroll_runs.approve',
  'billing.employee_payouts.approve',
  'billing.employee_payouts.settle',
  'billing.financial_reset',
  'payroll.runs.close',
  'payroll.runs.reopen',
  'payroll.pay_agreements.approve',
  'payroll.scope.organisation',
];
const ROLE = 'Payroll Approver';
const ROLE_PERMISSIONS = [
  'billing.payroll_runs.read',
  'billing.employee_payouts.read',
  'billing.visit_reconciliations.read',
  'payroll.runs.read',
  'billing.payroll_runs.approve',
  'billing.employee_payouts.approve',
  'billing.employee_payouts.settle',
  'payroll.runs.close',
  'payroll.runs.reopen',
  'payroll.pay_agreements.approve',
  'payroll.employees.read',
  'payroll.scope.organisation',
];

const prisma = new PrismaClient();
try {
  for (const key of NEW_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: { isActive: true, deletedAt: null },
      create: { key, isActive: true },
    });
  }
  const role = await prisma.role.upsert({
    where: { name: ROLE },
    update: { isActive: true, deletedAt: null },
    create: {
      name: ROLE,
      isActive: true,
      description: 'Approves and locks pay runs, closes UK payroll runs, approves payouts and records bank payments',
    },
  });
  const permissions = await prisma.permission.findMany({ where: { key: { in: ROLE_PERMISSIONS }, deletedAt: null } });
  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }
  const holders = await prisma.userRole.count({ where: { roleId: role.id } });
  console.log(
    `permissions ensured: ${NEW_PERMISSIONS.length}; role "${ROLE}" has ${permissions.length} permission(s) and ${holders} user(s)`,
  );
} finally {
  await prisma.$disconnect();
}
