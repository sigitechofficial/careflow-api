/**
 * App re-export of the seeded Payroll Approver role.
 * Implementation lives in prisma/seed-lib so `prisma db seed` can run without `src/`.
 */
export { PAYROLL_APPROVER_ROLE, PAYROLL_APPROVER_PERMISSIONS } from '../../../prisma/seed-lib/payroll-approver-role';
