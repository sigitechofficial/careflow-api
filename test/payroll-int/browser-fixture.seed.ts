/**
 * Fills the payroll TEST database with a small synthetic scenario for checking the pay screens in
 * a browser (R-11). It is not a test and is not picked up by `npm run test:payroll-int`; run it
 * on its own:
 *
 *   npm run payroll-test-db
 *   PAYROLL_BROWSER_LOGIN_FILE=<a file outside the repository> npm run payroll-test-browser-seed
 *   node scripts/payroll-test-server.mjs        (API on port 3101, test database only)
 *
 * What it leaves, ready for a person to act on in the browser:
 *   - a visit pay run for last week, calculated, waiting for approval and lock;
 *   - a UK payroll run with tax and NI calculated, waiting to be closed (then paid out);
 *   - an approved correction to a paid visit, which can be reversed;
 *   - Gate B2: two visits of one carer 40 minutes apart (travel time to classify), and a cancelled
 *     visit that had a carer allocated and has no pay decision;
 *   - Sprint B4A: a December UK payroll run with a proposed salary recovery (no recovery policy on
 *     record), a salaried employee whose agreement records no contracted hours (minimum wage
 *     exception to review) and one topped up to the minimum wage;
 *   - three synthetic office users: a preparer, an approver and a manager limited to one branch.
 *
 * Passwords are generated here and written only to PAYROLL_BROWSER_LOGIN_FILE. They are never
 * printed. Everything is synthetic; the development database is not touched.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createApprovedVisit, createUkRun, giveTaxCode, markStatutoryCalculated, resetPayData } from './harness';
import {
  bearer,
  createAllocatedVisit,
  createBranch,
  createCarer,
  createTestApp,
  resetIdentityData,
  seedDefaultCards,
  TestApp,
  useControlledClock,
} from './http-harness';

const APPROVER_PERMISSIONS = [
  'billing.payroll_runs.approve',
  'billing.employee_payouts.approve',
  'billing.employee_payouts.settle',
  'payroll.runs.close',
  // Gate B2: the second person for salary agreements and leave terms.
  'payroll.pay_agreements.approve',
  'payroll.scope.organisation',
];
const BRANCH_MANAGER_PERMISSIONS = [
  'billing.payroll_runs.read',
  'billing.visit_reconciliations.read',
  'billing.pay_cards.read',
  'payroll.runs.read',
  'payroll.employees.read',
];

describe('browser fixture (not a test)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  afterAll(async () => {
    await t.close();
  });

  it('fills the payroll test database', async () => {
    const loginFile = process.env.PAYROLL_BROWSER_LOGIN_FILE;
    if (!loginFile) throw new Error('Set PAYROLL_BROWSER_LOGIN_FILE to a file outside the repository');
    const clock = useControlledClock(new Date('2026-09-28T08:00:00Z'));
    try {
      await resetPayData(t.prisma);
      await t.prisma.payEvaluationFailure.deleteMany();
      await t.prisma.visitAttendanceEvent.deleteMany();
      await t.prisma.employeeNonCoreActivity.deleteMany();
      await t.prisma.mileageRate.deleteMany({ where: { label: { startsWith: 'TEST' } } });
      await resetIdentityData(t.prisma);
      await seedDefaultCards(t.prisma, 14);

      const branchA = await createBranch(t.prisma, 'TEST Branch A');
      const branchB = await createBranch(t.prisma, 'TEST Branch B');

      // Office users. Financial approval is never implied by an administrator role: the approver
      // holds it on a role of its own, and the preparer does not hold it at all.
      const role = async (name: string, permissions: string[]) => {
        const row = await t.prisma.role.upsert({ where: { name }, update: {}, create: { name } });
        for (const key of permissions) {
          const permission = await t.prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
          await t.prisma.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: row.id, permissionId: permission.id } },
            update: {},
            create: { roleId: row.id, permissionId: permission.id },
          });
        }
        return row.id;
      };
      const superAdmin = await role('Super Admin', []);
      const approverRole = await role('TEST browser approver', APPROVER_PERMISSIONS);
      const managerRole = await role('TEST browser branch manager', BRANCH_MANAGER_PERMISSIONS);
      const logins: Array<{ who: string; email: string; password: string }> = [];
      const user = async (who: string, first: string, last: string, roleIds: string[], locationIds: string[] = []) => {
        const email = `${first.toLowerCase()}.browser@payroll-test.invalid`;
        const password = `${randomBytes(12).toString('base64url')}aA1!`;
        const created = await t.prisma.user.create({
          data: {
            email,
            passwordHash: await bcrypt.hash(password, 12),
            firstName: first,
            lastName: last,
            userRoles: { create: roleIds.map((roleId) => ({ roleId })) },
            userLocations: { create: locationIds.map((locationId) => ({ locationId })) },
          },
        });
        logins.push({ who, email, password });
        return { id: created.id };
      };
      const olivia = await user('preparer', 'Olivia', 'Office', [superAdmin]);
      const peter = await user('approver', 'Peter', 'Payroll', [superAdmin, approverRole]);
      await user('branch manager (Branch A only)', 'Mia', 'Manager', [managerRole], [branchA]);

      const ann = await createCarer(t.prisma, { locationId: branchA });
      const ben = await createCarer(t.prisma, { locationId: branchB });
      for (const [carer, firstName] of [[ann, 'Ann'], [ben, 'Ben']] as const) {
        await t.prisma.employeePersonalDetail
          .upsert({
            where: { employeeId: carer.employeeId },
            update: { firstName, lastName: 'Carer' },
            create: { employeeId: carer.employeeId, firstName, lastName: 'Carer' } as never,
          })
          .catch(() => undefined);
      }

      const server = () => t.app.getHttpServer();
      const post = async (who: { id: string }, path: string, body: Record<string, unknown> = {}) => {
        const res = await request(server()).post(path).set(bearer(t.staffToken(who.id))).send(body);
        if (res.status >= 300) throw new Error(`${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
        return res.body.data;
      };
      const work = async (carer: { employeeId: string; accountId: string }, day: string, hm: string, hours: number, locationId: string, miles?: number) => {
        const start = new Date(`${day}T${hm}:00Z`);
        const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start, plannedMinutes: hours * 60, locationId });
        // A fresh token for each request: the clock moves between them.
        const asCarer = () => bearer(t.carerToken(carer.accountId));
        clock.set(new Date(start.getTime() + 60_000));
        const checkIn = await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(asCarer()).send({});
        if (checkIn.status >= 300) throw new Error(`check-in → ${checkIn.status} ${JSON.stringify(checkIn.body).slice(0, 200)}`);
        clock.set(new Date(start.getTime() + hours * 60 * 60_000));
        const done = await request(server()).post(`/employee-app/visits/${visit.jobId}/complete`).set(asCarer()).send({ status: 'COMPLETED' });
        if (done.status >= 300) throw new Error(`complete → ${done.status} ${JSON.stringify(done.body).slice(0, 200)}`);
        const row = await t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId } });
        if (miles != null) {
          await request(server()).patch(`/billing/visit-reconciliations/${row.id}`).set(bearer(t.staffToken(olivia.id))).send({ travelMiles: miles });
        }
        return row.id;
      };

      // Week 1 (28 September to 4 October): worked, paid in a locked visit pay run.
      const annTuesday = await work(ann, '2026-09-29', '09:00', 2, branchA);
      await work(ann, '2026-09-30', '09:00', 1, branchA);
      await work(ben, '2026-09-29', '13:00', 1, branchB);
      clock.set(new Date('2026-10-05T09:00:00Z'));
      const week1 = await post(olivia, '/billing/payroll-runs', { periodStart: '2026-09-28', periodEnd: '2026-10-04' });
      await post(olivia, `/billing/payroll-runs/${week1.id}/calculate`);
      await post(peter, `/billing/payroll-runs/${week1.id}/approve`);
      await post(peter, `/billing/payroll-runs/${week1.id}/lock`);

      // The UK payroll run for that week: tax and NI calculated, waiting to be closed.
      const ukRunId = await createUkRun(t.prisma, {
        periodStart: '2026-09-28',
        periodEnd: '2026-10-04',
        employeeIds: [ann.employeeId, ben.employeeId],
        createdById: olivia.id,
      });
      await giveTaxCode(t.prisma, [ann.employeeId, ben.employeeId]); // synthetic 1257L
      await post(olivia, `/payroll/runs/${ukRunId}/calculate-gross`);
      await post(olivia, `/payroll/runs/${ukRunId}/calculate-statutory`);

      // Week 2 (5 to 11 October): worked, in a calculated run waiting for approval and lock.
      await work(ann, '2026-10-06', '09:00', 2, branchA, 6.2);
      // Forty minutes after the visit above: the gap is an estimate until someone classifies it.
      await work(ann, '2026-10-06', '11:40', 1, branchA);
      await work(ann, '2026-10-08', '09:00', 1, branchA);
      await work(ben, '2026-10-07', '13:00', 1, branchB);
      clock.set(new Date('2026-10-12T07:00:00Z'));
      const week2 = await post(olivia, '/billing/payroll-runs', { periodStart: '2026-10-05', periodEnd: '2026-10-11' });
      await post(olivia, `/billing/payroll-runs/${week2.id}/calculate`);

      // A correction to a visit paid in week 1, approved by a second person: it can be reversed.
      const correction = await post(olivia, '/billing/pay-items/visit-corrections', {
        visitReconciliationId: annTuesday,
        correctedAmount: 35,
        reason: 'Synthetic: visit ran 30 minutes longer than paid',
      });
      await post(peter, `/billing/pay-items/${correction.id}/approve`);

      // A visit of that week cancelled an hour before it was due, with Ben allocated: no pay decision yet.
      const cancelled = await createAllocatedVisit(t.prisma, { carers: [ben.employeeId], start: new Date('2026-10-09T10:00:00Z'), plannedMinutes: 60, locationId: branchB });
      await t.prisma.scheduledJob.update({ where: { id: cancelled.jobId }, data: { status: 'CANCELLED', jobName: 'Synthetic cancelled call' } });
      await t.prisma.scheduledJobCancellation.create({
        data: {
          scheduledJobId: cancelled.jobId,
          serviceUserId: cancelled.serviceUserId,
          outcome: 'CANCELLED',
          reasonCode: 'CLIENT_REQUEST',
          chargeDecision: 'NO_CHARGE',
          cancelledAt: new Date('2026-10-09T09:00:00Z'),
        } as never,
      });

      // Sprint B4A: salaried staff. Sam's November salary is lowered after it was paid (a proposed
      // recovery); Erin's agreement records no contracted hours (an exception to review); Lee's salary
      // is below the minimum wage on its basic hours (topped up by the run). Basic hours use the
      // harness's SYNTHETIC annualisation method (weekly hours x 52), which is not an employer policy.
      const salaried = async (firstName: string, annualSalary: number) => {
        const carer = await createCarer(t.prisma, { locationId: branchA });
        await t.prisma.employeePersonalDetail
          .upsert({
            where: { employeeId: carer.employeeId },
            update: { firstName, lastName: 'Salaried' },
            create: { employeeId: carer.employeeId, firstName, lastName: 'Salaried' } as never,
          })
          .catch(() => undefined);
        const agree = (salary: number, over: Record<string, unknown> = {}) =>
          t.prisma.employeePayAgreement.create({
            data: {
              employeeId: carer.employeeId,
              basis: 'SALARIED',
              status: 'ACTIVE',
              effectiveFrom: new Date('2026-01-01'),
              annualSalary: salary,
              contractedHours: 30,
              salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
              salaryCoverage: 'ALL_VISIT_WORK',
              approvedAt: new Date('2026-01-01T09:00:00Z'),
              ...over,
            } as never,
          });
        const agreement = await agree(annualSalary);
        return { employeeId: carer.employeeId, agreement, agree };
      };
      const sam = await salaried('Sam', 24_000);
      const erin = await salaried('Erin', 20_400);
      const lee = await salaried('Lee', 18_000);
      await t.prisma.employeePayAgreement.update({ where: { id: erin.agreement.id }, data: { contractedHours: null } });
      const november = await createUkRun(t.prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [sam.employeeId], createdById: olivia.id });
      await post(olivia, `/payroll/runs/${november}/calculate-gross`);
      await markStatutoryCalculated(t.prisma, november);
      await post(peter, `/payroll/runs/${november}/close`);
      await t.prisma.employeePayAgreement.update({ where: { id: sam.agreement.id }, data: { status: 'SUPERSEDED' } });
      // The salary is changed after November was paid (the clock here is a controlled one).
      clock.set(new Date('2026-12-02T09:00:00Z'));
      const changedAt = new Date();
      await sam.agree(21_600, { effectiveFrom: new Date('2026-11-01'), approvedAt: changedAt, termsChangedAt: changedAt });
      for (const day of ['01', '08', '15', '22', '28']) {
        await createApprovedVisit(t.prisma, { employeeId: erin.employeeId, start: `2026-12-${day}T08:00:00Z`, minutes: 1800, amount: 420 });
      }
      const december = await createUkRun(t.prisma, {
        periodStart: '2026-12-01',
        periodEnd: '2026-12-31',
        employeeIds: [sam.employeeId, erin.employeeId, lee.employeeId],
        createdById: olivia.id,
      });
      await post(olivia, `/payroll/runs/${december}/calculate-gross`);

      writeFileSync(loginFile, JSON.stringify({ logins }, null, 2));
      // Identifiers only; no secret is printed.
      console.log(
        JSON.stringify({
          users: logins.map((l) => [l.who, l.email]),
          branches: { A: branchA, B: branchB },
          carers: { ann: ann.employeeId, ben: ben.employeeId },
          visitPayRuns: { lockedWeek1: week1.id, awaitingApprovalWeek2: week2.id },
          ukPayrollRunAwaitingClose: ukRunId,
          ukPayrollRunDecemberSalaried: december,
          approvedCorrection: correction.id,
          correctedVisit: annTuesday,
        }),
      );
    } finally {
      clock.restore();
    }
  }, 240_000);
});
