/**
 * Gate B sprint, R-17 — a pay calculation that fails is never dropped.
 * Audit ID: VW-03.
 *
 * Before: evaluation errors were caught and written to the server log only. A carer without an
 * employment record was left with an unpriced visit and no reason anywhere a person would look.
 */
import request from 'supertest';
import { PayCardsService } from '../../src/billing/billing-cards.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { resetPayData } from './harness';
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
  useControlledClock,
} from './http-harness';

const READ = ['billing.visit_reconciliations.read'];
const MANAGE = [...READ, 'billing.visit_reconciliations.manage'];
const ORG = 'payroll.scope.organisation';

describe('R-17: pay calculation failures are visible and recoverable', () => {
  let t: TestApp;
  let clock: ReturnType<typeof useControlledClock>;
  let finance: { id: string };
  let reader: { id: string };

  const at = (hm: string) => new Date(`2026-11-03T${hm}:00Z`);
  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const asCarer = (c: { accountId: string }) => bearer(t.carerToken(c.accountId));
  const get = (user: { id: string }, path: string) => request(server()).get(path).set(as(user));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  /** A carer works a one-hour visit through the app. Returns the HTTP status of the completion. */
  const workVisit = async (carer: { employeeId: string; accountId: string }, locationId?: string) => {
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00'), locationId });
    clock.set(at('09:01'));
    await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(asCarer(carer)).send({});
    clock.set(at('10:00'));
    const done = await request(server()).post(`/employee-app/visits/${visit.jobId}/complete`).set(asCarer(carer)).send({ status: 'COMPLETED' });
    return { ...visit, status: done.status };
  };
  const rowOf = (visitId: string) =>
    t.prisma.visitReconciliation.findFirst({ where: { scheduledVisitId: visitId }, include: { exceptions: true } });
  const failures = () => t.prisma.payEvaluationFailure.findMany({ orderBy: { firstOccurredAt: 'asc' } });

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(at('08:00'));
    await resetPayData(t.prisma);
    await t.prisma.payEvaluationFailure.deleteMany();
    await t.prisma.visitAttendanceEvent.deleteMany();
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma);
    finance = await createStaffUser(t.prisma, { permissions: [...MANAGE, ORG] });
    reader = await createStaffUser(t.prisma, { permissions: [...READ, ORG] });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clock.restore();
  });
  afterAll(async () => {
    await t.close();
  });

  it('a carer without an employment record: the visit is held with the reason, and the charge is still priced', async () => {
    const carer = await createCarer(t.prisma);
    await t.prisma.employeeEmployment.deleteMany({ where: { employeeId: carer.employeeId } });

    const visit = await workVisit(carer);
    expect(visit.status).toBe(201); // the carer's completion is not refused

    const row = await rowOf(visit.visitId);
    expect(row).toMatchObject({ status: 'PENDING_REVIEW', payableAmount: null });
    expect(Number(row!.billableAmount)).toBe(24);
    const payCardException = row!.exceptions.find((e) => e.code === 'PAY_CARD_MISSING');
    expect(payCardException?.message).toBe('Carer pay cannot be priced: Employee employment record not found');
    // The office finds it in the list of visits with exceptions.
    const list = await get(finance, '/billing/visit-reconciliations?hasExceptions=true');
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(row!.id);

    // The employment record is added; evaluating again prices the visit and clears the exception.
    await t.prisma.employeeEmployment.create({ data: { employeeId: carer.employeeId } as never });
    expect((await post(finance, `/billing/visit-reconciliations/${row!.id}/evaluate`)).status).toBe(201);
    const fixed = await rowOf(visit.visitId);
    expect(Number(fixed!.payableAmount)).toBe(14);
    expect(fixed!.exceptions.map((e) => e.code)).not.toContain('PAY_CARD_MISSING');
  });

  it('an unexpected error: kept as an open failure without its text, retried, closed and audited', async () => {
    const carer = await createCarer(t.prisma);
    jest
      .spyOn(t.app.get(PayCardsService), 'resolveForEmployee')
      .mockRejectedValueOnce(new Error('connection reset; query: SELECT * FROM employees WHERE ni = QQ123456C'));

    const visit = await workVisit(carer);
    expect(visit.status).toBe(201);
    const row = await rowOf(visit.visitId);
    expect(row!.payableAmount).toBeNull();

    const [failure] = await failures();
    expect(failure).toMatchObject({
      subjectKey: `RECON:${row!.id}`,
      operation: 'EVALUATE',
      kind: 'TECHNICAL',
      category: 'UNEXPECTED',
      status: 'OPEN',
      retryable: true,
      occurrences: 1,
      employeeId: carer.employeeId,
      visitReconciliationId: row!.id,
    });
    expect(JSON.stringify(failure)).not.toContain('QQ123456C');
    expect(JSON.stringify(failure)).not.toContain('SELECT');

    const listed = await get(finance, '/billing/visit-reconciliations/evaluation-failures');
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({ id: failure.id, reference: failure.id.slice(0, 8), visitRef: row!.visitRef });

    // A reader sees it but cannot retry.
    expect((await get(reader, '/billing/visit-reconciliations/evaluation-failures')).body.data).toHaveLength(1);
    expect((await post(reader, `/billing/visit-reconciliations/evaluation-failures/${failure.id}/retry`)).status).toBe(403);

    const retried = await post(finance, `/billing/visit-reconciliations/evaluation-failures/${failure.id}/retry`);
    expect(retried.status).toBe(201);
    expect(retried.body.data).toMatchObject({ status: 'RESOLVED', resolution: 'SUCCEEDED_ON_RETRY', succeeded: true });
    expect(Number((await rowOf(visit.visitId))!.payableAmount)).toBe(14);
    expect((await get(finance, '/billing/visit-reconciliations/evaluation-failures')).body.data).toHaveLength(0);
    expect((await get(finance, '/billing/visit-reconciliations/evaluation-failures?status=ALL')).body.data).toHaveLength(1);

    const after = (await failures())[0];
    expect(after.resolvedById).toBe(finance.id);
    expect((after.history as Array<{ action: string }>).map((h) => h.action)).toEqual(['FAILED', 'RETRIED']);
    const audit = await t.prisma.auditLog.findFirst({ where: { recordType: 'PayEvaluationFailure', recordId: failure.id } });
    expect(audit).toMatchObject({ action: 'pay_evaluation_failure_retried', userId: finance.id });
    // A closed failure cannot be retried again.
    expect((await post(finance, `/billing/visit-reconciliations/evaluation-failures/${failure.id}/retry`)).status).toBe(400);
  });

  it('a retry that fails again stays open on the same record, with the count and the history', async () => {
    const carer = await createCarer(t.prisma);
    const spy = jest.spyOn(t.app.get(PayCardsService), 'resolveForEmployee');
    spy.mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second'));

    const visit = await workVisit(carer);
    const [failure] = await failures();
    const retried = await post(finance, `/billing/visit-reconciliations/evaluation-failures/${failure.id}/retry`);
    expect(retried.status).toBe(201);
    expect(retried.body.data).toMatchObject({ status: 'OPEN', succeeded: false, occurrences: 2 });
    expect(retried.body.message).toMatch(/failed again/);

    const all = await failures();
    expect(all).toHaveLength(1);
    expect((all[0].history as Array<{ action: string; byUserId: string | null }>).map((h) => [h.action, h.byUserId])).toEqual([
      ['FAILED', null],
      ['RETRIED', finance.id],
    ]);
    expect((await rowOf(visit.visitId))!.payableAmount).toBeNull(); // not turned into a zero or a guess
  });

  it('a later successful calculation closes the failure by itself', async () => {
    const carer = await createCarer(t.prisma);
    jest.spyOn(t.app.get(PayCardsService), 'resolveForEmployee').mockRejectedValueOnce(new Error('once'));
    const visit = await workVisit(carer);
    const row = await rowOf(visit.visitId);
    expect((await failures())[0].status).toBe('OPEN');

    // Opening the visit evaluates it again.
    expect((await get(finance, `/billing/visit-reconciliations/${row!.id}`)).status).toBe(200);
    expect((await failures())[0]).toMatchObject({ status: 'RESOLVED', resolution: 'SUCCEEDED_LATER', resolvedById: null });
  });

  it('when the pay record cannot even be created, the job is kept as a failure and retried into existence', async () => {
    const carer = await createCarer(t.prisma);
    const service = t.app.get(VisitReconciliationsService);
    jest.spyOn(service, 'ensureForCompletedJob').mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'id')"));

    const visit = await workVisit(carer);
    expect(visit.status).toBe(201);
    expect(await rowOf(visit.visitId)).toBeNull(); // before R-17 this was the whole story

    const [failure] = await failures();
    expect(failure).toMatchObject({
      subjectKey: `JOB:${visit.jobId}`,
      operation: 'ENSURE_JOB',
      kind: 'TECHNICAL',
      status: 'OPEN',
      scheduledJobId: visit.jobId,
      scheduledVisitId: visit.visitId,
      serviceUserId: visit.serviceUserId,
    });

    const retried = await post(finance, `/billing/visit-reconciliations/evaluation-failures/${failure.id}/retry`);
    expect(retried.body.data).toMatchObject({ status: 'RESOLVED', succeeded: true });
    expect(Number((await rowOf(visit.visitId))!.payableAmount)).toBe(14);
  });

  it('a failure can be dismissed with a reason, once, and that is audited', async () => {
    const carer = await createCarer(t.prisma);
    jest.spyOn(t.app.get(PayCardsService), 'resolveForEmployee').mockRejectedValueOnce(new Error('once'));
    await workVisit(carer);
    const [failure] = await failures();
    const path = `/billing/visit-reconciliations/evaluation-failures/${failure.id}/dismiss`;

    expect((await post(finance, path, {})).status).toBe(400);
    expect((await post(finance, path, { reason: 'no' })).status).toBe(400);
    expect((await post(reader, path, { reason: 'Visit entered in error' })).status).toBe(403);
    const dismissed = await post(finance, path, { reason: 'Visit entered in error' });
    expect(dismissed.status).toBe(201);
    expect(dismissed.body.data).toMatchObject({ status: 'DISMISSED', resolution: 'DISMISSED', resolvedById: finance.id });
    expect((await post(finance, path, { reason: 'Visit entered in error' })).status).toBe(400);
    const audit = await t.prisma.auditLog.findFirst({ where: { recordType: 'PayEvaluationFailure', recordId: failure.id } });
    expect(audit).toMatchObject({ action: 'pay_evaluation_failure_dismissed', description: 'Visit entered in error' });
  });

  it('a branch user sees and retries only failures of their own branch', async () => {
    const branchA = await createBranch(t.prisma, 'TEST Branch A');
    const branchB = await createBranch(t.prisma, 'TEST Branch B');
    const managerA = await createStaffUser(t.prisma, { permissions: MANAGE, locationIds: [branchA] });
    const spy = jest.spyOn(t.app.get(PayCardsService), 'resolveForEmployee');
    spy.mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(new Error('b'));
    const inA = await workVisit(await createCarer(t.prisma, { locationId: branchA }), branchA);
    const inB = await workVisit(await createCarer(t.prisma, { locationId: branchB }), branchB);
    const all = await failures();
    const failureA = all.find((f) => f.scheduledVisitId === inA.visitId)!;
    const failureB = all.find((f) => f.scheduledVisitId === inB.visitId)!;

    const base = '/billing/visit-reconciliations/evaluation-failures';
    expect((await get(managerA, base)).status).toBe(403); // must name a branch
    expect((await get(managerA, `${base}?locationId=${branchB}`)).status).toBe(404);
    const mine = await get(managerA, `${base}?locationId=${branchA}`);
    expect(mine.body.data.map((f: { id: string }) => f.id)).toEqual([failureA.id]);

    expect((await post(managerA, `${base}/${failureB.id}/retry`)).status).toBe(404);
    expect((await post(managerA, `${base}/${failureA.id}/retry`)).status).toBe(201);
    expect((await request(server()).get(base)).status).toBe(401);
  });
});
