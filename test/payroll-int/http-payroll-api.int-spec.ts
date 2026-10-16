/**
 * Gate A sprint, R-10 and R-05 — the payroll API itself: authentication, permissions, maker /
 * checker, status transitions, validation, branch scope. Real controllers, guards and tokens.
 * Audit IDs: SI-10, SI-11, SI-15, PR-12, SI-06.
 */
import request from 'supertest';
import { createApprovedVisit, createUkRunWithNetPay, resetPayData, uuid } from './harness';
import {
  bearer,
  createAllocatedVisit,
  createBranch,
  createCarer,
  createStaffUser,
  createTestApp,
  resetIdentityData,
  seedDefaultCards,
  TestApp,
} from './http-harness';

const PREPARE = [
  'billing.payroll_runs.read',
  'billing.payroll_runs.manage',
  'billing.employee_payouts.read',
  'billing.employee_payouts.manage',
  'billing.visit_reconciliations.read',
  'billing.visit_reconciliations.manage',
  'payroll.runs.read',
  'payroll.runs.manage',
  'payroll.employees.read',
  'audit_logs.read',
];
const APPROVE = [
  'billing.payroll_runs.read',
  'billing.payroll_runs.approve',
  'billing.employee_payouts.read',
  'billing.employee_payouts.approve',
  'billing.employee_payouts.settle',
  'payroll.runs.read',
  'payroll.runs.close',
  'payroll.runs.reopen',
];
const ORG = 'payroll.scope.organisation';

describe('payroll API (HTTP)', () => {
  let t: TestApp;
  let superAdmin: { id: string };
  let preparer: { id: string };
  let preparer2: { id: string };
  let approver: { id: string };
  let nobody: { id: string };
  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const get = (user: { id: string }, path: string) => request(server()).get(path).set(as(user));

  const newRun = async (by = preparer) => (await post(by, '/billing/payroll-runs', { periodStart: '2026-11-01', periodEnd: '2026-11-07' })).body.data.id as string;
  const lockedRunWithVisit = async () => {
    const employeeId = uuid();
    const visit = await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-03T09:00:00Z' });
    const run = await newRun();
    await post(preparer, `/billing/payroll-runs/${run}/calculate`);
    await post(approver, `/billing/payroll-runs/${run}/approve`);
    await post(approver, `/billing/payroll-runs/${run}/lock`);
    return { run, visit, employeeId };
  };

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    superAdmin = await createStaffUser(t.prisma, { roleName: 'Super Admin' });
    // Company-wide by an explicit grant, not by an admin role.
    preparer = await createStaffUser(t.prisma, { permissions: [...PREPARE, ORG] });
    preparer2 = await createStaffUser(t.prisma, { permissions: [...PREPARE, ORG] });
    approver = await createStaffUser(t.prisma, { permissions: [...APPROVE, ORG] });
    nobody = await createStaffUser(t.prisma, { permissions: [] });
  });
  afterAll(async () => {
    await t.close();
  });

  describe('authentication and permission', () => {
    const routes: Array<['get' | 'post' | 'delete', string]> = [
      ['get', '/billing/payroll-runs'],
      ['post', '/billing/payroll-runs'],
      ['post', `/billing/payroll-runs/${uuid()}/approve`],
      ['post', `/billing/payroll-runs/${uuid()}/lock`],
      ['delete', `/billing/payroll-runs/${uuid()}`],
      ['get', `/billing/payroll-runs/${uuid()}/export`],
      ['get', '/billing/employee-payouts'],
      ['post', `/billing/employee-payouts/${uuid()}/approve`],
      ['post', `/billing/employee-payouts/${uuid()}/mark-paid`],
      ['post', '/billing/pay-items/visit-corrections'],
      ['post', `/billing/pay-items/${uuid()}/approve`],
      ['post', `/billing/pay-items/${uuid()}/reverse`],
      ['get', '/payroll/runs'],
      ['post', `/payroll/runs/${uuid()}/close`],
      ['post', `/payroll/runs/${uuid()}/cancel`],
      ['post', `/payroll/runs/${uuid()}/reactivate`],
      ['post', `/ecm/visits/${uuid()}/manual-attendance`],
      ['post', '/billing/visit-reconciliations/clear-all'],
      ['delete', '/payroll/runs'],
      ['post', '/payroll/purge-all'],
      ['delete', '/audit-logs'],
    ];

    it.each(routes)('%s %s refuses a request with no token (401)', async (method, path) => {
      const res = await request(server())[method](path).send({});
      expect(res.status).toBe(401);
    });

    it.each(routes)('%s %s refuses a signed-in user without the permission (403)', async (method, path) => {
      const res = await request(server())[method](path).set(as(nobody)).send({});
      expect(res.status).toBe(403);
    });

    it('refuses a carer token on staff payroll routes', async () => {
      const carer = await createCarer(t.prisma);
      const res = await request(server()).get('/billing/payroll-runs').set(bearer(t.carerToken(carer.accountId)));
      expect(res.status).toBe(403);
    });

    it('SI-15: Super Admin is not given the financial powers', async () => {
      const run = await newRun();
      await post(preparer, `/billing/payroll-runs/${run}/calculate`);
      expect((await post(superAdmin, `/billing/payroll-runs/${run}/approve`)).status).toBe(403);
      expect((await post(superAdmin, `/billing/payroll-runs/${run}/lock`)).status).toBe(403);
      expect((await post(superAdmin, `/billing/employee-payouts/${uuid()}/approve`)).status).toBe(403);
      expect((await post(superAdmin, `/billing/employee-payouts/${uuid()}/mark-paid`, {})).status).toBe(403);
      expect((await post(superAdmin, `/payroll/runs/${uuid()}/close`)).status).toBe(403);
      expect((await post(superAdmin, '/billing/visit-reconciliations/clear-all')).status).toBe(403);
      expect((await request(server()).delete('/audit-logs').set(as(superAdmin))).status).toBe(403);
      // Ordinary management is still open to Super Admin.
      expect((await get(superAdmin, '/billing/payroll-runs')).status).toBe(200);
    });

    it('SI-06: holding the reset permission is not enough: the server must be opted in', async () => {
      const resetter = await createStaffUser(t.prisma, { permissions: ['billing.financial_reset', ORG] });
      const saved = process.env.ALLOW_FINANCIAL_TEST_RESET;
      delete process.env.ALLOW_FINANCIAL_TEST_RESET;
      try {
        const { visit } = await lockedRunWithVisit();
        const clear = await post(resetter, '/billing/visit-reconciliations/clear-all');
        expect(clear.status).toBe(403);
        expect(clear.body.message).toMatch(/disabled/i);
        expect((await request(server()).delete('/payroll/runs').set(as(resetter))).status).toBe(403);
        expect(await t.prisma.visitReconciliation.count({ where: { id: visit.id } })).toBe(1);
      } finally {
        if (saved !== undefined) process.env.ALLOW_FINANCIAL_TEST_RESET = saved;
      }
    });
  });

  describe('visit pay run lifecycle', () => {
    it('create → calculate → approve → lock, with maker / checker and transition rules', async () => {
      await createApprovedVisit(t.prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
      const run = await newRun();

      expect((await post(approver, `/billing/payroll-runs/${run}/lock`)).status).toBe(400); // not approved yet
      expect((await post(preparer, `/billing/payroll-runs/${run}/calculate`)).status).toBe(201);
      // The preparer lacks the approval power; a user who has it but created the run is refused too.
      expect((await post(preparer, `/billing/payroll-runs/${run}/approve`)).status).toBe(403);

      const approved = await post(approver, `/billing/payroll-runs/${run}/approve`);
      expect(approved.status).toBe(201);
      expect(approved.body.data.status).toBe('APPROVED');
      expect((await post(approver, `/billing/payroll-runs/${run}/approve`)).status).toBe(400); // already approved

      expect((await post(approver, `/billing/payroll-runs/${run}/lock`)).status).toBe(201);
      expect((await post(approver, `/billing/payroll-runs/${run}/lock`)).status).toBe(400); // already locked
      expect((await post(preparer, `/billing/payroll-runs/${run}/calculate`)).status).toBe(400);
      expect((await request(server()).delete(`/billing/payroll-runs/${run}`).set(as(preparer))).status).toBe(400);
    });

    it('E2E-10: a user who holds both powers still cannot approve a run they created', async () => {
      const both = await createStaffUser(t.prisma, { permissions: [...PREPARE, ...APPROVE, ORG] });
      await createApprovedVisit(t.prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
      const run = await newRun(both);
      await post(both, `/billing/payroll-runs/${run}/calculate`);

      const res = await post(both, `/billing/payroll-runs/${run}/approve`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/different user/i);
    });

    it('two approvals sent at once: one succeeds, the other is refused', async () => {
      await createApprovedVisit(t.prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
      const run = await newRun();
      await post(preparer, `/billing/payroll-runs/${run}/calculate`);

      const results = await Promise.all([
        post(approver, `/billing/payroll-runs/${run}/approve`),
        post(approver, `/billing/payroll-runs/${run}/approve`),
      ]);

      expect(results.map((r) => r.status).sort()).not.toEqual([201, 201]);
      expect(results.some((r) => r.status === 201)).toBe(true);
    });

    it('rejects invalid input', async () => {
      expect((await post(preparer, '/billing/payroll-runs', { periodStart: 'yesterday', periodEnd: '2026-11-07' })).status).toBe(400);
      expect((await post(preparer, '/billing/payroll-runs', { periodStart: '2026-11-07', periodEnd: '2026-11-01' })).status).toBe(400);
      expect((await post(preparer, '/billing/payroll-runs', { periodStart: '2026-11-01', periodEnd: '2026-11-07', grossPay: 1 })).status).toBe(400);
      expect((await post(preparer, `/billing/payroll-runs/${uuid()}/calculate`)).status).toBe(404);
    });

    it('a locked visit cannot be changed through the reconciliation API', async () => {
      const { visit } = await lockedRunWithVisit();
      const payable = await post(preparer, `/billing/visit-reconciliations/${visit.id}/payable-amount`, { payableAmount: 99 });
      expect(payable.status).toBe(400);
      expect(payable.body.message).toMatch(/pay correction/i);
      const patch = await request(server())
        .patch(`/billing/visit-reconciliations/${visit.id}`)
        .set(as(preparer))
        .send({ approvedPayEnd: '2026-11-03T12:00:00.000Z' });
      expect(patch.status).toBe(400);
      expect(Number((await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visit.id } })).payableAmount)).toBe(14);
    });
  });

  describe('pay corrections', () => {
    it('record → approve by another user → reverse, with validation and duplicate handling', async () => {
      const { visit } = await lockedRunWithVisit();
      const body = { visitReconciliationId: visit.id, correctedAmount: 21, reason: 'Visit ran longer than paid' };

      expect((await post(preparer, '/billing/pay-items/visit-corrections', { ...body, correctedAmount: -5 })).status).toBe(400);
      expect((await post(preparer, '/billing/pay-items/visit-corrections', { ...body, reason: 'x' })).status).toBe(400);
      expect((await post(preparer, '/billing/pay-items/visit-corrections', { ...body, visitReconciliationId: 'not-a-uuid' })).status).toBe(400);

      const created = await post(preparer, '/billing/pay-items/visit-corrections', body);
      expect(created.status).toBe(201);
      const itemId = created.body.data.id as string;
      expect((await post(preparer, '/billing/pay-items/visit-corrections', body)).status).toBe(400); // one pending at a time

      expect((await post(preparer, `/billing/pay-items/${itemId}/approve`)).status).toBe(403); // own entry
      expect((await post(preparer2, `/billing/pay-items/${itemId}/approve`)).status).toBe(201);
      expect((await post(preparer2, `/billing/pay-items/${itemId}/approve`)).status).toBe(400); // already approved
      expect((await post(preparer, `/billing/pay-items/${itemId}/reverse`, { reason: 'Entered in error' })).status).toBe(400); // not paid yet

      const history = await get(preparer, `/billing/pay-items/visit-corrections/${visit.id}`);
      expect(history.status).toBe(200);
      expect(history.body.data).toMatchObject({
        originalAmount: '14.00',
        netAmount: '21.00',
        differenceAmount: '7.00',
        canRecordCorrection: true,
        visit: { paySettled: true, settledBy: 'VISIT_PAY_RUN' },
      });
      expect(history.body.data.items[0]).toMatchObject({ displayStatus: 'APPROVED_FOR_PAYROLL', canReverse: false });
      expect(history.body.data.items[0].createdByName).toBeTruthy();
      expect((await get(preparer, `/billing/pay-items/visit-corrections/${uuid()}`)).status).toBe(404);
      expect((await get(nobody, `/billing/pay-items/visit-corrections/${visit.id}`)).status).toBe(403);
    });
  });

  describe('payout batches', () => {
    it('create → approve by another user → record settlement with evidence', async () => {
      const run = await createUkRunWithNetPay(t.prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', netPay: { [uuid()]: 812.4 }, status: 'CLOSED' });
      const created = await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: run });
      expect(created.status).toBe(201);
      const batch = created.body.data.id as string;
      expect((await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: run })).status).toBe(409); // open batch exists

      expect((await post(preparer, `/billing/employee-payouts/${batch}/approve`)).status).toBe(403);
      expect((await post(approver, `/billing/employee-payouts/${batch}/mark-paid`, { paymentReference: 'BACS-1', settledOn: '2026-10-01' })).status).toBe(400); // not approved
      expect((await post(approver, `/billing/employee-payouts/${batch}/approve`)).status).toBe(201);

      expect((await post(approver, `/billing/employee-payouts/${batch}/mark-paid`, {})).status).toBe(400);
      expect((await post(approver, `/billing/employee-payouts/${batch}/mark-paid`, { paymentReference: 'BACS-1', settledOn: '01/10/2026' })).status).toBe(400);
      expect((await post(approver, `/billing/employee-payouts/${batch}/mark-paid`, { paymentReference: 'BACS-1', settledOn: '2999-01-01' })).status).toBe(400);
      expect((await post(approver, `/billing/employee-payouts/${batch}/mark-paid`, { paymentReference: 'BACS-1', settledOn: '2026-10-01', settlementSource: 'BANK_CONFIRMED' })).status).toBe(400);
      const paid = await post(approver, `/billing/employee-payouts/${batch}/mark-paid`, { paymentReference: 'BACS-1', settledOn: '2026-10-01', settlementEvidence: 'Statement line 3' });
      expect(paid.status).toBe(201);
      expect(paid.body.data).toMatchObject({ status: 'PAID', paymentReference: 'BACS-1', settledOn: '2026-10-01' });
      // R-09: recorded by a person, not confirmed by a bank; the caller cannot claim otherwise.
      expect(paid.body.data).toMatchObject({ paymentState: 'MANUALLY_RECORDED', settlementSource: 'MANUAL_ENTRY', settlementConfirmed: false });
      expect((await post(approver, `/billing/employee-payouts/${batch}/mark-paid`, { paymentReference: 'BACS-2', settledOn: '2026-10-01' })).status).toBe(400);
    });

    it('PR-18: a run that is not closed cannot be paid out', async () => {
      const run = await createUkRunWithNetPay(t.prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', netPay: { [uuid()]: 812.4 }, status: 'STATUTORY_CALCULATED' });
      expect((await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: run })).status).toBe(400);
    });
  });

  describe('UK payroll run', () => {
    it('close and reopen are separate powers; cancel takes a reason', async () => {
      const run = await createUkRunWithNetPay(t.prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', netPay: { [uuid()]: 100 }, status: 'STATUTORY_CALCULATED' });
      await t.prisma.ukPayrollRun.update({ where: { id: run }, data: { createdById: preparer.id } });

      expect((await post(preparer, `/payroll/runs/${run}/close`)).status).toBe(403); // no close power
      expect((await post(approver, `/payroll/runs/${run}/close`)).status).toBe(201);
      expect((await post(approver, `/payroll/runs/${run}/close`)).status).toBe(400); // already closed
      expect((await post(preparer, `/payroll/runs/${run}/cancel`, { reason: 'Too late' })).status).toBe(400); // closed
      expect((await post(preparer, `/payroll/runs/${run}/reactivate`)).status).toBe(403); // no reopen power
      expect((await post(preparer, `/payroll/runs/${run}/cancel`, { reason: 5 })).status).toBe(400);
    });
  });

  describe('R-05: branch scope', () => {
    let branchA: string;
    let branchB: string;
    let carerA: { employeeId: string; accountId: string };
    let carerB: { employeeId: string; accountId: string };
    let managerA: { id: string };

    beforeEach(async () => {
      branchA = await createBranch(t.prisma, 'TEST Branch A');
      branchB = await createBranch(t.prisma, 'TEST Branch B');
      carerA = await createCarer(t.prisma, { locationId: branchA });
      carerB = await createCarer(t.prisma, { locationId: branchB });
      // Same permissions as the preparer, but limited to branch A and without the organisation grant.
      managerA = await createStaffUser(t.prisma, { permissions: PREPARE, locationIds: [branchA] });
    });

    it('E2E-09: a branch user reads pay for their own branch only', async () => {
      expect((await get(managerA, `/billing/payroll-runs/employee/${carerA.employeeId}/earnings`)).status).toBe(200);
      expect((await get(managerA, `/billing/payroll-runs/employee/${carerB.employeeId}/earnings`)).status).toBe(404);
      expect((await get(managerA, `/payroll/employees/${carerB.employeeId}/profile`)).status).toBe(404);
      expect((await get(managerA, `/billing/pay-cards/employee-history/${carerB.employeeId}`)).status).toBe(403); // no pay card permission at all
    });

    it('R-13: branch lists hold only that branch; organisation-only screens stay closed by URL', async () => {
      // One approved visit with an open exception in each branch.
      const visitIn = async (locationId: string, employeeId: string, tag: string) => {
        const su = await t.prisma.serviceUser.create({ data: { firstName: 'Test', lastName: `Client-${tag}`, locationId } as never });
        const visit = await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-03T09:00:00Z' });
        await t.prisma.visitReconciliation.update({ where: { id: visit.id }, data: { serviceUserId: su.id } });
        await t.prisma.financeException.create({ data: { visitReconciliationId: visit.id, code: 'UNDERRUN', message: `Short visit ${tag}` } });
        return visit;
      };
      const visitA = await visitIn(branchA, carerA.employeeId, 'A');
      const visitB = await visitIn(branchB, carerB.employeeId, 'B');
      const both = await createStaffUser(t.prisma, { permissions: PREPARE, locationIds: [branchA, branchB] });
      const ids = (res: { body: { data: unknown } }, key = 'id') =>
        ((Array.isArray(res.body.data) ? res.body.data : (res.body.data as { rows: unknown[] }).rows) as Array<Record<string, string>>).map((r) => r[key]);

      // Reconciliation list and exception queue: branch A sees A, never B.
      const listA = await get(managerA, `/billing/visit-reconciliations?locationId=${branchA}`);
      expect(listA.status).toBe(200);
      expect(ids(listA)).toEqual([visitA.id]);
      expect((await get(managerA, '/billing/visit-reconciliations/exception-queue')).status).toBe(403);
      expect((await get(managerA, `/billing/visit-reconciliations/exception-queue?locationId=${branchB}`)).status).toBe(404);
      const queueA = await get(managerA, `/billing/visit-reconciliations/exception-queue?locationId=${branchA}`);
      expect(queueA.status).toBe(200);
      expect(queueA.body.data.map((e: { message: string }) => e.message)).toEqual(['Short visit A']);

      // Salary list: only employees of the branch.
      const salariesA = await get(managerA, `/billing/payroll-runs/employee-salaries?locationId=${branchA}`);
      expect(ids(salariesA, 'employeeId')).toEqual([carerA.employeeId]);

      // A user granted both branches chooses either, one at a time, and nothing else.
      expect(ids(await get(both, `/billing/visit-reconciliations?locationId=${branchB}`))).toEqual([visitB.id]);
      expect(ids(await get(both, `/billing/payroll-runs/employee-salaries?locationId=${branchB}`), 'employeeId')).toEqual([carerB.employeeId]);
      expect((await get(both, '/billing/visit-reconciliations')).status).toBe(403);

      // Organisation-wide pay access sees everything without naming a branch.
      expect(ids(await get(preparer, '/billing/visit-reconciliations')).sort()).toEqual([visitA.id, visitB.id].sort());
      expect((await get(preparer, '/billing/visit-reconciliations/exception-queue')).body.data).toHaveLength(2);

      // Screens the menu hides for a branch user are refused by the server whatever the URL.
      for (const path of ['/billing/payroll-runs', '/billing/employee-payouts', '/billing/pay-items', '/payroll/runs']) {
        expect([path, (await get(managerA, path)).status]).toEqual([path, 403]);
      }
      // A single visit of the other branch by id.
      expect((await get(managerA, `/billing/visit-reconciliations/${visitB.id}`)).status).toBe(404);
      expect((await get(managerA, `/billing/visit-reconciliations/${visitA.id}`)).status).toBe(200);
    });

    it('lists must name one of the user’s branches', async () => {
      expect((await get(managerA, '/billing/payroll-runs/employee-salaries')).status).toBe(403);
      expect((await get(managerA, `/billing/payroll-runs/employee-salaries?locationId=${branchA}`)).status).toBe(200);
      expect((await get(managerA, `/billing/payroll-runs/employee-salaries?locationId=${branchB}`)).status).toBe(404);
      expect((await get(managerA, `/payroll/employees?locationId=${branchB}`)).status).toBe(404);
    });

    it('records that span the organisation are closed to a branch user, including exports', async () => {
      const { run } = await lockedRunWithVisit();
      for (const path of [
        '/billing/payroll-runs',
        `/billing/payroll-runs/${run}`,
        `/billing/payroll-runs/${run}/export`,
        '/billing/employee-payouts',
        '/billing/pay-items',
        '/payroll/runs',
      ]) {
        const res = await get(managerA, path);
        expect([path, res.status]).toEqual([path, 403]);
      }
      expect((await post(managerA, '/billing/payroll-runs', { periodStart: '2026-11-01', periodEnd: '2026-11-07' })).status).toBe(403);
      expect((await post(managerA, `/billing/payroll-runs/${run}/export`)).status).toBe(403);
      // The same routes work for a user with the organisation grant.
      expect((await get(preparer, `/billing/payroll-runs/${run}`)).status).toBe(200);
    });

    it('visit reconciliations are scoped through the service user’s branch', async () => {
      await seedDefaultCards(t.prisma);
      const start = new Date('2026-11-03T09:00:00Z');
      const inA = await createAllocatedVisit(t.prisma, { carers: [carerA.employeeId], start, locationId: branchA });
      const inB = await createAllocatedVisit(t.prisma, { carers: [carerB.employeeId], start, locationId: branchB });
      const rows = await Promise.all(
        [inA, inB].map((v, i) =>
          createApprovedVisit(t.prisma, { employeeId: [carerA, carerB][i].employeeId, start: '2026-11-03T09:00:00Z', scheduledVisitId: v.visitId }),
        ),
      );
      await t.prisma.visitReconciliation.update({ where: { id: rows[0].id }, data: { serviceUserId: inA.serviceUserId } });
      await t.prisma.visitReconciliation.update({ where: { id: rows[1].id }, data: { serviceUserId: inB.serviceUserId } });

      expect((await get(managerA, `/billing/visit-reconciliations/${rows[0].id}`)).status).toBe(200);
      expect((await get(managerA, `/billing/visit-reconciliations/${rows[1].id}`)).status).toBe(404);
      expect((await post(managerA, `/billing/visit-reconciliations/${rows[1].id}/payable-amount`, { payableAmount: 50 })).status).toBe(404);
      expect((await get(managerA, '/billing/visit-reconciliations')).status).toBe(403);
      expect((await get(managerA, `/billing/visit-reconciliations?locationId=${branchA}`)).status).toBe(200);
      expect((await post(managerA, '/billing/visit-reconciliations/bulk-approve', { ids: [rows[1].id], scope: 'PAY' })).status).toBe(403);
    });

    it('a user assigned to several branches works across exactly those', async () => {
      const branchC = await createBranch(t.prisma, 'TEST Branch C');
      const carerC = await createCarer(t.prisma, { locationId: branchC });
      const multi = await createStaffUser(t.prisma, { permissions: PREPARE, locationIds: [branchA, branchB] });

      expect((await get(multi, `/billing/payroll-runs/employee/${carerA.employeeId}/earnings`)).status).toBe(200);
      expect((await get(multi, `/billing/payroll-runs/employee/${carerB.employeeId}/earnings`)).status).toBe(200);
      expect((await get(multi, `/billing/payroll-runs/employee/${carerC.employeeId}/earnings`)).status).toBe(404);
      expect((await get(multi, '/billing/payroll-runs')).status).toBe(403);
    });

    it('a user with no branch and no organisation grant sees no pay data', async () => {
      const unassigned = await createStaffUser(t.prisma, { permissions: PREPARE });
      expect((await get(unassigned, `/billing/payroll-runs/employee/${carerA.employeeId}/earnings`)).status).toBe(404);
      expect((await get(unassigned, '/billing/payroll-runs')).status).toBe(403);
    });

    it('pay audit entries are hidden from a branch user', async () => {
      await newRun(); // writes a BILLING audit entry
      const org = await get(preparer, '/audit-logs?module=BILLING');
      expect(org.status).toBe(200);
      expect(org.body.data.length).toBeGreaterThan(0);
      const branch = await get(managerA, '/audit-logs?module=BILLING');
      expect(branch.status).toBe(200);
      expect(branch.body.data).toHaveLength(0);
      expect((await get(managerA, `/audit-logs/${org.body.data[0].id}`)).status).toBe(404);
    });

    it('a carer sees only their own pay, whatever the request asks for', async () => {
      const mine = await request(server())
        .get(`/employee-app/me/salary?employeeId=${carerB.employeeId}`)
        .set(bearer(t.carerToken(carerA.accountId)));
      // An unknown query field is refused outright; without it the carer gets their own figures.
      expect(mine.status).toBe(400);
      const own = await request(server()).get('/employee-app/me/salary').set(bearer(t.carerToken(carerA.accountId)));
      expect(own.status).toBe(200);
      expect((await request(server()).get(`/billing/payroll-runs/employee/${carerB.employeeId}/earnings`).set(bearer(t.carerToken(carerA.accountId)))).status).toBe(403);
    });
  });

  describe('R-12: who holds the pay authorisation powers', () => {
    const authority = async (by = superAdmin) => {
      const res = await get(by, '/role-responsibilities/financial-authority');
      expect(res.status).toBe(200);
      const holders = (key: string) =>
        (res.body.data.powers.find((p: { key: string }) => p.key === key).users as Array<{ id: string }>).map((u) => u.id);
      return { holders, warnings: res.body.data.warnings as Array<{ powerKey: string; kind: string; message: string }> };
    };

    it('needs the permission to manage roles', async () => {
      expect((await request(server()).get('/role-responsibilities/financial-authority')).status).toBe(401);
      expect((await get(nobody, '/role-responsibilities/financial-authority')).status).toBe(403);
      expect((await get(preparer, '/role-responsibilities/financial-authority')).status).toBe(403);
    });

    it('lists the users behind each power; a Super Admin approves nothing by default', async () => {
      const { holders, warnings } = await authority();
      expect(holders('approve-pay-runs')).toEqual([approver.id]);
      expect(holders('close-uk-payroll')).toEqual([approver.id]);
      expect(holders('record-settlement')).toEqual([approver.id]);
      expect(holders('prepare-pay-runs').sort()).toEqual([superAdmin.id, preparer.id, preparer2.id].sort());
      expect(holders('prepare-pay-runs')).not.toContain(nobody.id);
      expect(warnings).toEqual([]);
    });

    it('warns when nobody can approve, and when the only approver is the only preparer', async () => {
      await t.prisma.userRole.deleteMany({ where: { userId: approver.id } });
      const none = await authority();
      expect(none.warnings.filter((w) => w.kind === 'NO_HOLDER').map((w) => w.powerKey)).toEqual([
        'approve-pay-runs',
        'close-uk-payroll',
        'approve-payouts',
        'record-settlement',
      ]);
      expect(none.warnings[0].message).toMatch(/No active user can approve and lock visit pay runs/);

      // One person who both prepares and approves, and nobody else: maker / checker cannot be met.
      await t.prisma.userRole.deleteMany({ where: { userId: { in: [preparer.id, preparer2.id, superAdmin.id] } } });
      const solo = await createStaffUser(t.prisma, { permissions: [...PREPARE, ...APPROVE, ORG, 'permissions.manage'] });
      const alone = await authority(solo);
      expect(alone.warnings.filter((w) => w.kind === 'NO_HOLDER')).toEqual([]);
      expect(alone.warnings.filter((w) => w.kind === 'SAME_PERSON').map((w) => w.powerKey)).toContain('approve-pay-runs');
    });

    it('an inactive user is not counted as an approver', async () => {
      await t.prisma.user.update({ where: { id: approver.id }, data: { isActive: false } });
      const { holders, warnings } = await authority();
      expect(holders('approve-pay-runs')).toEqual([]);
      expect(warnings.some((w) => w.powerKey === 'approve-pay-runs' && w.kind === 'NO_HOLDER')).toBe(true);
    });

    it('an admin role can be chosen for the approval job, and only then approves', async () => {
      const list = await get(superAdmin, '/role-responsibilities');
      expect(list.status).toBe(200);
      const superAdminRole = list.body.data.adminRoleOptions.find((r: { name: string }) => r.name === 'Super Admin');
      expect(superAdminRole).toBeTruthy();
      const job = list.body.data.responsibilities.find((r: { key: string }) => r.key === 'approve-pay');
      expect(job).toMatchObject({ explicitOnly: true });
      expect(job.roleIds).not.toContain(superAdminRole.id);

      const granted = [...APPROVE, ORG];
      try {
        const saved = await request(server())
          .put('/role-responsibilities/approve-pay')
          .set(as(superAdmin))
          .send({ roleIds: [...job.roleIds, superAdminRole.id] });
        expect(saved.status).toBe(200);
        expect(saved.body.data.roleIds).toContain(superAdminRole.id);
        // Saving the approval job leaves the people who prepare pay able to reach it.
        expect((await get(preparer, '/billing/payroll-runs')).status).toBe(200);
        expect((await get(approver, '/billing/payroll-runs')).status).toBe(200);
        expect((await authority()).holders('approve-pay-runs').sort()).toEqual([approver.id, superAdmin.id].sort());

        // Unticking it takes the power away again; nothing is left behind.
        const removed = await request(server())
          .put('/role-responsibilities/approve-pay')
          .set(as(superAdmin))
          .send({ roleIds: job.roleIds });
        expect(removed.status).toBe(200);
        expect((await authority()).holders('approve-pay-runs')).toEqual([approver.id]);
      } finally {
        // The built-in role outlives this test: make sure it never keeps an approval power.
        await t.prisma.rolePermission.deleteMany({
          where: { roleId: superAdminRole.id, permission: { key: { in: granted } } },
        });
      }
    });
  });
});
