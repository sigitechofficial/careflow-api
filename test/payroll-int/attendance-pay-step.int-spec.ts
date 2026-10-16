/**
 * Sprint B4F — an office attendance correction whose pay step fails.
 *
 * Before: the corrected times were saved first, then pay was recalculated in a second step. When
 * the second step failed, the request ended in an error while the times stayed changed and the pay
 * stayed on the old times, and nothing on the visit said so.
 *
 * Now the corrected times still stay (they are evidence). The failure is kept as a pay calculation
 * failure that the office can retry, each carer's pay on the visit gets an EVIDENCE_CHANGED
 * exception saying that pay was not recalculated, and pay that was approved and not yet settled
 * goes back to review so that no pay run pays it on the old times. That flag and its audit entry
 * are one transaction. The answer says what happened. A retry runs the same correction; when it
 * succeeds the flag and the failure are closed.
 *
 * All data is synthetic.
 */
import request from 'supertest';
import { AuditLogsService } from '../../src/audit-logs/audit-logs.service';
import { PayItemsService } from '../../src/billing/pay-items.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { createRun, resetPayData } from './harness';
import {
  bearer,
  createAllocatedVisit,
  createCarer,
  createStaffUser,
  createTestApp,
  resetIdentityData,
  seedDefaultCards,
  TestApp,
  useControlledClock,
} from './http-harness';

const ORG = 'payroll.scope.organisation';
const FLAG = /^Attendance times were corrected but carer pay could not be recalculated: /;

describe('attendance correction whose pay step fails (Sprint B4F)', () => {
  let t: TestApp;
  let audit: AuditLogsService;
  let recons: VisitReconciliationsService;
  let clock: ReturnType<typeof useControlledClock>;
  let office: { id: string };
  let manager: { id: string };

  const at = (hm: string, day = '2026-11-03') => new Date(`${day}T${hm}:00Z`);
  const server = () => t.app.getHttpServer();
  const as = (u: { id: string }) => bearer(t.staffToken(u.id));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const entries = (recordId: string, action: string) =>
    t.prisma.auditLog.findMany({ where: { recordId, action: action as never }, orderBy: { createdAt: 'asc' } });
  const workedVisit = async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
    const asCarer = () => bearer(t.carerToken(carer.accountId));
    clock.set(at('09:01'));
    expect((await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(asCarer()).send({})).status).toBe(201);
    clock.set(at('10:00'));
    expect((await request(server()).post(`/employee-app/visits/${visit.jobId}/complete`).set(asCarer()).send({ status: 'COMPLETED' })).status).toBe(201);
    const row = await t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId, employeeId: carer.employeeId } });
    return { carer, jobId: visit.jobId, visitId: visit.visitId, id: row.id };
  };
  const officeTime = (jobId: string, employeeId: string, when: Date) =>
    request(server())
      .post(`/ecm/visits/${jobId}/manual-attendance`)
      .set(as(office))
      .send({ employeeId, eventType: 'CHECK_OUT', occurredAt: when.toISOString(), reasonCode: 'VERIFIED_WITH_CLIENT', note: 'Synthetic: confirmed by phone' });
  const state = async (id: string) => {
    const r = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id } });
    return {
      status: r.status,
      approvedById: r.approvedById,
      payableAmount: r.payableAmount == null ? null : Number(r.payableAmount),
      payableMinutes: r.payableMinutes,
      approvedPayEnd: r.approvedPayEnd?.toISOString() ?? null,
      evidenceChangedReason: r.evidenceChangedReason,
    };
  };
  const flags = (id: string) => t.prisma.financeException.findMany({ where: { visitReconciliationId: id, code: 'EVIDENCE_CHANGED' } });
  const failureOf = (visitId: string) => t.prisma.payEvaluationFailure.findUnique({ where: { subjectKey: `ATTENDANCE:${visitId}` } });
  const visitEnd = async (visitId: string) => (await t.prisma.scheduledVisit.findUniqueOrThrow({ where: { id: visitId } })).actualEndDateTime?.toISOString();
  const retry = (failureId: string) => post(manager, `/billing/visit-reconciliations/evaluation-failures/${failureId}/retry`);
  /** The pay step fails (synthetic): an evaluation inside a transaction throws; others run as normal. */
  const breakPayStep = () => {
    const real = (recons as unknown as { evaluateInternal: (...a: unknown[]) => Promise<void> }).evaluateInternal.bind(recons);
    jest.spyOn(recons as never, 'evaluateInternal').mockImplementation(((db: unknown, ...rest: unknown[]) =>
      db === t.prisma ? real(db, ...rest) : Promise.reject(new Error('synthetic: pricing unavailable'))) as never);
  };
  const breakAuditTable = () =>
    jest
      .spyOn(audit as unknown as { db: () => unknown }, 'db')
      .mockReturnValue({ auditLog: { create: () => Promise.reject(new Error('synthetic: audit table unavailable')) } });
  const settle = async () => {
    const maker = await createStaffUser(t.prisma, { permissions: [] });
    const checker = await createStaffUser(t.prisma, { permissions: [] });
    const runs = t.app.get(PayrollRunsService);
    clock.set(at('09:00', '2026-11-09'));
    const run = await createRun(runs, maker.id, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    await runs.approve(checker.id, run);
    await runs.lock(checker.id, run);
    return run;
  };

  beforeAll(async () => {
    t = await createTestApp();
    audit = t.app.get(AuditLogsService, { strict: false });
    recons = t.app.get(VisitReconciliationsService, { strict: false });
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(at('08:00'));
    await resetPayData(t.prisma);
    await t.prisma.visitAttendanceEvent.deleteMany();
    await t.prisma.payEvaluationFailure.deleteMany();
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma);
    office = await createStaffUser(t.prisma, { roleName: 'Super Admin' });
    manager = await createStaffUser(t.prisma, { permissions: ['billing.visit_reconciliations.read', 'billing.visit_reconciliations.manage', ORG] });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clock.restore();
  });
  afterAll(async () => {
    await t.close();
  });

  it('a correction whose pay step succeeds is repriced, and leaves no flag or failure behind', async () => {
    const { carer, jobId, visitId, id } = await workedVisit();
    const res = await officeTime(jobId, carer.employeeId, at('09:30'));
    expect(res.status).toBe(201);
    expect(res.body.data.pay).toMatchObject([{ outcome: 'REPRICED', payableBefore: '14' }]);
    expect((await state(id)).payableMinutes).toBe(29);
    expect(await flags(id)).toEqual([]);
    expect(await failureOf(visitId)).toBeNull();
  });

  it('the pay step fails: the times stay, pay is held and flagged, the failure is listed, and the answer says so', async () => {
    const { carer, jobId, visitId, id } = await workedVisit();
    expect((await post(manager, `/billing/visit-reconciliations/${id}/approve`, { scope: 'BOTH' })).status).toBe(201);
    const before = await state(id);

    breakPayStep();
    const res = await officeTime(jobId, carer.employeeId, at('09:30'));
    jest.restoreAllMocks();
    expect(res.status).toBe(201);
    const [pay] = res.body.data.pay;
    expect(pay).toMatchObject({ reconciliationId: id, outcome: 'PAY_NOT_RECALCULATED', payableBefore: '14', payableAfter: '14' });
    expect(pay.message).toMatch(/^Times recorded, but carer pay could not be recalculated: .* The visit is held for review; retry it from Pay calculation failures \(reference [0-9a-f]{8}\)\.$/);

    // Evidence preserved; pay exactly as it was, but held for review and flagged.
    expect(await visitEnd(visitId)).toBe(at('09:30').toISOString());
    const after = await state(id);
    expect(after).toMatchObject({ status: 'PENDING_REVIEW', approvedById: manager.id, payableAmount: before.payableAmount, payableMinutes: before.payableMinutes, approvedPayEnd: before.approvedPayEnd });
    expect(after.evidenceChangedReason).toMatch(FLAG);
    const [flag] = await flags(id);
    expect(flag.message).toMatch(FLAG);
    const [entry] = await entries(id, 'visit_attendance_pay_not_recalculated');
    expect(entry).toMatchObject({ userId: office.id });
    expect(entry.newValues).toMatchObject({ status: 'PENDING_REVIEW', held: true });

    // Visible where the office looks: the visit's exceptions and the pay calculation failures.
    const detail = await request(server()).get(`/billing/visit-reconciliations/${id}`).set(as(manager));
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body.data)).toMatch(/Attendance times were corrected but carer pay could not be recalculated/);
    expect((await state(id)).status).toBe('PENDING_REVIEW'); // opening the visit does not release it
    const failure = await failureOf(visitId);
    expect(failure).toMatchObject({ operation: 'ATTENDANCE_CORRECTION', status: 'OPEN', scheduledVisitId: visitId, retryable: true });
    const listed = await request(server()).get('/billing/visit-reconciliations/evaluation-failures').set(as(manager));
    expect(JSON.stringify(listed.body.data)).toContain(failure!.id);
  });

  it('a retry recalculates pay, clears the flag and closes the failure; a second retry adds nothing', async () => {
    const { carer, jobId, visitId, id } = await workedVisit();
    breakPayStep();
    await officeTime(jobId, carer.employeeId, at('09:30'));
    // It fails again on the first retry: still one failure and one flag.
    const failure = (await failureOf(visitId))!;
    expect((await retry(failure.id)).body.data).toMatchObject({ succeeded: false, status: 'OPEN', occurrences: 2 });
    expect(await flags(id)).toHaveLength(1);
    jest.restoreAllMocks();

    const done = await retry(failure.id);
    expect(done.status).toBe(201);
    expect(done.body.data).toMatchObject({ succeeded: true, status: 'RESOLVED', resolution: 'SUCCEEDED_ON_RETRY' });
    const after = await state(id);
    expect(after.payableMinutes).toBe(29);
    expect(after.payableAmount).toBeLessThan(14);
    expect(after.evidenceChangedReason ?? '').not.toMatch(FLAG);
    expect((await flags(id)).filter((f) => FLAG.test(f.message ?? ''))).toEqual([]);
    expect(await entries(id, 'visit_attendance_times_corrected')).toHaveLength(1);

    // Again: nothing left to retry, nothing recorded twice.
    expect((await retry(failure.id)).status).toBe(400);
    expect(await entries(id, 'visit_attendance_times_corrected')).toHaveLength(1);
    expect(await t.prisma.payEvaluationFailure.count({ where: { scheduledVisitId: visitId, operation: 'ATTENDANCE_CORRECTION' } })).toBe(1);
  });

  it('settled pay is never rewritten: it is flagged, not held; the retry records one correction for approval', async () => {
    const { carer, jobId, visitId, id } = await workedVisit();
    const run = await settle();
    const lines = () => t.prisma.payrollRunLine.findMany({ where: { payrollRunId: run }, orderBy: { id: 'asc' }, select: { id: true, amount: true, claimKey: true } });
    const paid = await lines();
    const before = await state(id);
    const corrections = () => t.prisma.employeePayItem.findMany({ where: { sourceId: id } });

    // For settled pay the pay step is the correction: it fails (synthetic).
    jest.spyOn(t.app.get(PayItemsService, { strict: false }), 'recordVisitCorrection').mockRejectedValue(new Error('synthetic: corrections unavailable'));
    const res = await officeTime(jobId, carer.employeeId, at('09:30'));
    jest.restoreAllMocks();
    expect(res.body.data.pay).toMatchObject([{ outcome: 'PAY_NOT_RECALCULATED' }]);
    expect(await state(id)).toMatchObject({ status: before.status, payableAmount: 14 }); // not held: it is already paid
    expect((await state(id)).evidenceChangedReason).toMatch(FLAG);
    expect(await corrections()).toEqual([]);
    expect(await lines()).toEqual(paid);

    const failure = (await failureOf(visitId))!;
    expect((await retry(failure.id)).body.data.succeeded).toBe(true);
    const [item] = await corrections();
    expect(item).toMatchObject({ sourceType: 'VISIT_CORRECTION', status: 'PENDING_APPROVAL' });
    expect((await retry(failure.id)).status).toBe(400);
    expect((await officeTime(jobId, carer.employeeId, at('09:30'))).body.data.pay).toMatchObject([{ outcome: 'NO_CORRECTION' }]);
    expect(await corrections()).toHaveLength(1);
    expect(await lines()).toEqual(paid);
    expect((await state(id)).payableAmount).toBe(14);
  });

  it('the audit table cannot be written: nothing financial changes without its entry, and the failure is still listed', async () => {
    const { carer, jobId, visitId, id } = await workedVisit();
    const before = await state(id);
    breakAuditTable();
    const res = await officeTime(jobId, carer.employeeId, at('09:30'));
    jest.restoreAllMocks();
    expect(res.status).toBe(201);
    expect(res.body.data.pay[0]).toMatchObject({ outcome: 'PAY_NOT_RECALCULATED' });
    expect(res.body.data.pay[0].message).toMatch(/could not be flagged\. It is listed under Pay calculation failures/);
    // Neither the repricing nor the hold happened: both needed an audit entry.
    expect(await state(id)).toEqual(before);
    expect(await flags(id)).toEqual([]);
    expect(await t.prisma.auditLog.count({ where: { recordId: id, action: { in: ['visit_attendance_times_corrected', 'visit_attendance_pay_not_recalculated'] } as never } })).toBe(0);
    expect(await failureOf(visitId)).toMatchObject({ status: 'OPEN', operation: 'ATTENDANCE_CORRECTION' });
    // Once the audit table is back, the retry does the pay step.
    expect((await retry((await failureOf(visitId))!.id)).body.data.succeeded).toBe(true);
    expect((await state(id)).payableMinutes).toBe(29);
  });
});
