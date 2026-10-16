/**
 * Sprint B4G — a run that settles visit pay is refused while a visit in it has an open
 * ATTENDANCE_CORRECTION pay calculation failure.
 *
 * Before: B4F holds such a visit for review, but if that hold could not be saved (its audit entry
 * failed) only the failure record remained, and a visit pay run could still lock the visit's pay
 * on the old times. The guard reads the failure records themselves, inside the lock (and inside
 * a UK payroll run's close, which settles visits directly).
 *
 * All data is synthetic.
 */
import request from 'supertest';
import { AuditLogsService } from '../../src/audit-logs/audit-logs.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { createRun, createUkRun, markStatutoryCalculated, resetPayData } from './harness';
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

describe('no run settles a visit whose corrected times have not reached its pay (Sprint B4G)', () => {
  let t: TestApp;
  let audit: AuditLogsService;
  let recons: VisitReconciliationsService;
  let runs: PayrollRunsService;
  let clock: ReturnType<typeof useControlledClock>;
  let office: { id: string };
  let manager: { id: string };
  let maker: { id: string };
  let checker: { id: string };

  const at = (hm: string, day = '2026-11-03') => new Date(`${day}T${hm}:00Z`);
  const server = () => t.app.getHttpServer();
  const as = (u: { id: string }) => bearer(t.staffToken(u.id));
  const workedVisit = async (day = '2026-11-03') => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00', day) });
    const asCarer = () => bearer(t.carerToken(carer.accountId));
    clock.set(at('09:01', day));
    expect((await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(asCarer()).send({})).status).toBe(201);
    clock.set(at('10:00', day));
    expect((await request(server()).post(`/employee-app/visits/${visit.jobId}/complete`).set(asCarer()).send({ status: 'COMPLETED' })).status).toBe(201);
    const row = await t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId, employeeId: carer.employeeId } });
    return { carer, jobId: visit.jobId, visitId: visit.visitId, id: row.id, visitRef: row.visitRef };
  };
  const officeTime = (jobId: string, employeeId: string, when: Date) =>
    request(server())
      .post(`/ecm/visits/${jobId}/manual-attendance`)
      .set(as(office))
      .send({ employeeId, eventType: 'CHECK_OUT', occurredAt: when.toISOString(), reasonCode: 'VERIFIED_WITH_CLIENT', note: 'Synthetic: confirmed by phone' });
  /** The pay step of a correction fails (synthetic); evaluations outside a transaction run as normal. */
  const breakPayStep = () => {
    const real = (recons as unknown as { evaluateInternal: (...a: unknown[]) => Promise<void> }).evaluateInternal.bind(recons);
    jest.spyOn(recons as never, 'evaluateInternal').mockImplementation(((db: unknown, ...rest: unknown[]) =>
      db === t.prisma ? real(db, ...rest) : Promise.reject(new Error('synthetic: pricing unavailable'))) as never);
  };
  const breakAuditTable = () =>
    jest
      .spyOn(audit as unknown as { db: () => unknown }, 'db')
      .mockReturnValue({ auditLog: { create: () => Promise.reject(new Error('synthetic: audit table unavailable')) } });
  /** A visit pay run for the week of 2 November, calculated and approved. */
  const approvedRun = async () => {
    clock.set(at('09:00', '2026-11-09'));
    const run = await createRun(runs, maker.id, '2026-11-02', '2026-11-08');
    await runs.calculate(run);
    await runs.approve(checker.id, run);
    return run;
  };
  const runStatus = async (run: string) => (await t.prisma.payrollRun.findUniqueOrThrow({ where: { id: run } })).status;
  const settledBy = async (id: string) => (await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id } })).includedInPayrollRunId;
  /** An open failure as B4F records it, without the hold on the visit (as when the hold could not be saved). */
  const openFailure = (visitId: string) =>
    t.prisma.payEvaluationFailure.create({
      data: {
        subjectKey: `ATTENDANCE:${visitId}`,
        operation: 'ATTENDANCE_CORRECTION',
        scheduledVisitId: visitId,
        kind: 'TECHNICAL',
        category: 'UNEXPECTED',
        message: 'Something went wrong while working out pay.',
        history: [],
      },
    });

  beforeAll(async () => {
    t = await createTestApp();
    audit = t.app.get(AuditLogsService, { strict: false });
    recons = t.app.get(VisitReconciliationsService, { strict: false });
    runs = t.app.get(PayrollRunsService, { strict: false });
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
    maker = await createStaffUser(t.prisma, { permissions: [] });
    checker = await createStaffUser(t.prisma, { permissions: [] });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clock.restore();
  });
  afterAll(async () => {
    await t.close();
  });

  it('a correction whose pay step failed after the run was approved: locking is refused, nothing is settled', async () => {
    const { carer, jobId, visitId, id, visitRef } = await workedVisit();
    const run = await approvedRun();
    breakPayStep();
    expect((await officeTime(jobId, carer.employeeId, at('09:30'))).body.data.pay).toMatchObject([{ outcome: 'PAY_NOT_RECALCULATED' }]);
    jest.restoreAllMocks();
    const failure = (await t.prisma.payEvaluationFailure.findUnique({ where: { subjectKey: `ATTENDANCE:${visitId}` } }))!;

    await expect(runs.lock(checker.id, run)).rejects.toThrow(
      new RegExp(`Cannot lock this pay run: corrected attendance times of 1 visit\\(s\\) have not reached carer pay yet: ${visitRef} \\(failure ${failure.id.slice(0, 8)}\\)`),
    );
    expect(await runStatus(run)).toBe('APPROVED');
    expect(await settledBy(id)).toBeNull();
  });

  it('the hold could not be saved, only the failure record exists: locking is still refused', async () => {
    const { carer, jobId, id } = await workedVisit();
    const run = await approvedRun();
    breakPayStep();
    breakAuditTable(); // so the hold and its audit entry are not saved
    expect((await officeTime(jobId, carer.employeeId, at('09:30'))).body.data.pay[0].message).toMatch(/could not be flagged/);
    jest.restoreAllMocks();
    // The visit looks approved and unflagged; only the failure record says otherwise.
    const row = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'APPROVED_FOR_BOTH', evidenceChangedReason: null });

    await expect(runs.lock(checker.id, run)).rejects.toThrow(/Cannot lock this pay run: corrected attendance times of 1 visit\(s\)/);
    expect(await runStatus(run)).toBe('APPROVED');
    expect(await settledBy(id)).toBeNull();
  });

  it('a failure recorded after calculation and approval, with nothing else changed, stops the lock', async () => {
    const { visitId, id } = await workedVisit();
    const run = await approvedRun();
    await openFailure(visitId);
    await expect(runs.lock(checker.id, run)).rejects.toThrow(/Cannot lock this pay run/);
    expect(await settledBy(id)).toBeNull();
  });

  it('once the failure is resolved by the existing retry, the run is recalculated and locks', async () => {
    const { carer, jobId, visitId, id } = await workedVisit();
    const run = await approvedRun();
    breakPayStep();
    await officeTime(jobId, carer.employeeId, at('09:30'));
    jest.restoreAllMocks();
    await expect(runs.lock(checker.id, run)).rejects.toThrow(/Cannot lock this pay run/);

    const failure = (await t.prisma.payEvaluationFailure.findUnique({ where: { subjectKey: `ATTENDANCE:${visitId}` } }))!;
    const retried = await request(server()).post(`/billing/visit-reconciliations/evaluation-failures/${failure.id}/retry`).set(as(manager)).send({});
    expect(retried.body.data).toMatchObject({ succeeded: true, status: 'RESOLVED' });
    // The repriced visit is approved again and the run recalculated on it: then it locks.
    expect((await request(server()).post(`/billing/visit-reconciliations/${id}/approve`).set(as(manager)).send({ scope: 'BOTH' })).status).toBe(201);
    await runs.calculate(run);
    await runs.approve(checker.id, run);
    await runs.lock(checker.id, run);
    expect(await runStatus(run)).toBe('LOCKED');
    expect(await settledBy(id)).toBe(run);
    expect((await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id } })).payableMinutes).toBe(29);
  });

  it('a failure on a visit the run does not settle leaves the run alone', async () => {
    const inRun = await workedVisit();
    const elsewhere = await workedVisit('2026-11-10'); // the following week: not in this run
    await openFailure(elsewhere.visitId);
    const run = await approvedRun();
    await runs.lock(checker.id, run);
    expect(await runStatus(run)).toBe('LOCKED');
    expect(await settledBy(inRun.id)).toBe(run);
    expect(await settledBy(elsewhere.id)).toBeNull();
  });

  it('a UK payroll run that settles the visit directly is refused the same way, and closes once it is resolved', async () => {
    const { carer, visitId, id, visitRef } = await workedVisit();
    const ukRuns = t.app.get(UkPayrollRunsService, { strict: false });
    const ukRun = await createUkRun(t.prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [carer.employeeId], createdById: maker.id });
    await ukRuns.calculateGross(maker.id, ukRun);
    await markStatutoryCalculated(t.prisma, ukRun);
    const failure = await openFailure(visitId);

    await expect(ukRuns.close(checker.id, ukRun)).rejects.toThrow(
      new RegExp(`Cannot close this payroll run: corrected attendance times of 1 visit\\(s\\) have not reached carer pay yet: ${visitRef} \\(failure ${failure.id.slice(0, 8)}\\)`),
    );
    expect((await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: ukRun } })).status).toBe('STATUTORY_CALCULATED');
    expect((await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id } })).paidByUkPayrollRunId).toBeNull();

    await t.prisma.payEvaluationFailure.update({ where: { id: failure.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolution: 'SUCCEEDED_ON_RETRY' } });
    await ukRuns.close(checker.id, ukRun);
    expect((await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id } })).paidByUkPayrollRunId).toBe(ukRun);
  });
});
