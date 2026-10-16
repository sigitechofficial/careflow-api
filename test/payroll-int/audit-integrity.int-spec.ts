/**
 * Sprint B4B, Task 1 — an audit entry that cannot be written must not stop the API, and must
 * not leave a financial change behind without its entry.
 *
 * Before: closing a browser session of a user who had since been deleted wrote a "socket
 * disconnected" audit entry that nobody awaited. Its foreign key error was an unhandled promise
 * rejection, and Node ends the process on one: the API stopped for everyone. Separately, a UK
 * payroll run changed state in one transaction and wrote its audit entry afterwards, so a failed
 * entry left the change in place with no record of it.
 *
 * Now the failure is logged and answered with a controlled error, and the state changes of a UK
 * payroll run are saved together with their audit entry or not at all.
 */
import request from 'supertest';
import { AuditLogsService } from '../../src/audit-logs/audit-logs.service';
import { NotificationsGateway } from '../../src/notifications/notifications.gateway';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { createUkRun, markStatutoryCalculated, resetPayData, uuid } from './harness';
import { bearer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

describe('audit entries and financial changes (Sprint B4B)', () => {
  let t: TestApp;
  let audit: AuditLogsService;
  let ukRuns: UkPayrollRunsService;
  let maker: { id: string };
  let checker: { id: string };
  let employeeId: string;
  let run: string;

  const server = () => t.app.getHttpServer();
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(bearer(t.staffToken(user.id))).send(body);
  const runRow = () => t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: run } });
  const entries = (action: string) => t.prisma.auditLog.findMany({ where: { recordId: run, action: action as never } });
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    t = await createTestApp();
    audit = t.app.get(AuditLogsService, { strict: false });
    ukRuns = t.app.get(UkPayrollRunsService, { strict: false });
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    maker = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.manage', 'payroll.scope.organisation'] });
    checker = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.close', 'payroll.scope.organisation'] });
    employeeId = uuid();
    await t.prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'SALARIED',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'),
        annualSalary: 24_000, // synthetic
        contractedHours: 30,
        salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
        salaryCoverage: 'ALL_VISIT_WORK',
        approvedAt: new Date('2026-01-01T09:00:00Z'),
      } as never,
    });
    run = await createUkRun(t.prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker.id });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await t.close();
  });

  it('a valid change is saved with its audit entry, naming the user', async () => {
    expect((await post(maker, `/payroll/runs/${run}/calculate-gross`)).status).toBe(201);
    expect((await runRow()).status).toBe('GROSS_CALCULATED');
    const [entry] = await entries('payroll_run_gross_calculated');
    expect(entry).toMatchObject({ userId: maker.id, recordType: 'UkPayrollRun', status: 'SUCCESS' });
  });

  it('the session of a deleted user is refused before anything is changed', async () => {
    const gone = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.manage', 'payroll.scope.organisation'] });
    const token = t.staffToken(gone.id);
    await t.prisma.userRole.deleteMany({ where: { userId: gone.id } });
    await t.prisma.user.delete({ where: { id: gone.id } });
    const res = await request(server()).post(`/payroll/runs/${run}/calculate-gross`).set(bearer(token)).send({});
    expect(res.status).toBe(401);
    expect((await runRow()).status).toBe('EMPLOYEES_ENROLLED');
    expect(await t.prisma.ukPayrollInputLine.count({ where: { runId: run } })).toBe(0);
    expect(await entries('payroll_run_gross_calculated')).toEqual([]);
  });

  it('a user deleted between sign-in and the change: a controlled error, and the change is rolled back', async () => {
    // The service is reached with a user id that no longer exists (the request had been admitted).
    const ghost = uuid();
    await expect(ukRuns.calculateGross(ghost, run)).rejects.toMatchObject({
      status: 401,
      message: 'Your account is no longer active. Sign in again.',
    });
    expect((await runRow()).status).toBe('EMPLOYEES_ENROLLED');
    expect((await runRow()).grossCalculatedAt).toBeNull();
    expect(await t.prisma.ukPayrollInputLine.count({ where: { runId: run } })).toBe(0);
    expect(await t.prisma.nmwPeriodAssessment.count({ where: { ukPayrollRunId: run } })).toBe(0);
    // No audit entry is made up for a user who does not exist.
    expect(await t.prisma.auditLog.count({ where: { recordId: run } })).toBe(0);
  });

  it('the audit table cannot be written: the close is rolled back, the answer is a controlled error, and the next request works', async () => {
    expect((await post(maker, `/payroll/runs/${run}/calculate-gross`)).status).toBe(201);
    await markStatutoryCalculated(t.prisma, run);
    const periodBefore = await t.prisma.payrollPeriod.findUniqueOrThrow({ where: { id: (await runRow()).periodId } });
    const ledgersBefore = await t.prisma.employeePayrollYtdContribution.count();

    // The real audit service, with a database client whose audit table fails.
    const failing = { auditLog: { create: () => Promise.reject(new Error('synthetic: connection to the audit table lost')) } };
    jest.spyOn(audit as unknown as { db: () => unknown }, 'db').mockReturnValue(failing);
    const refused = await post(checker, `/payroll/runs/${run}/close`);
    expect(refused.status).toBe(500);
    expect(refused.body.message).toBe('The change was not saved because its audit entry could not be written. Try again.');

    // Nothing of the close remains: status, period, year-to-date figures, claims.
    expect(await runRow()).toMatchObject({ status: 'STATUTORY_CALCULATED', closedAt: null, closedById: null });
    expect((await t.prisma.payrollPeriod.findUniqueOrThrow({ where: { id: periodBefore.id } })).status).toBe(periodBefore.status);
    expect(await t.prisma.employeePayrollYtdContribution.count()).toBe(ledgersBefore);
    expect(await entries('payroll_run_closed')).toEqual([]);

    // The API is still up, and the same request succeeds once the audit table can be written.
    jest.restoreAllMocks();
    expect((await request(server()).get(`/payroll/runs/${run}`).set(bearer(t.staffToken(checker.id)))).status).toBe(200);
    expect((await post(checker, `/payroll/runs/${run}/close`)).status).toBe(201);
    expect((await runRow()).status).toBe('CLOSED');
    expect(await entries('payroll_run_closed')).toEqual([expect.objectContaining({ userId: checker.id })]);
  });

  it('a minimum wage review is not saved without its audit entry', async () => {
    await t.prisma.employeePayAgreement.updateMany({ where: { employeeId }, data: { contractedHours: null } });
    expect((await post(maker, `/payroll/runs/${run}/calculate-gross`)).status).toBe(201);
    const assessment = await t.prisma.nmwPeriodAssessment.findFirstOrThrow({ where: { ukPayrollRunId: run } });
    const failing = { auditLog: { create: () => Promise.reject(new Error('synthetic: audit table unavailable')) } };
    jest.spyOn(audit as unknown as { db: () => unknown }, 'db').mockReturnValue(failing);
    const refused = await post(checker, `/payroll/runs/${run}/nmw-assessments/${assessment.id}/review`, {
      note: 'Synthetic: contract of 2026-01-05 states 30 hours a week',
      outcome: 'EVIDENCE_SUPPORTS_COMPLIANCE',
    });
    expect(refused.status).toBe(500);
    expect(await t.prisma.nmwPeriodAssessment.findUniqueOrThrow({ where: { id: assessment.id } })).toMatchObject({
      reviewOutcome: null,
      resolvedById: null,
      resolvedAt: null,
    });
  });

  it('the socket of a deleted user closing does not raise an unhandled rejection (the crash found in B4A)', async () => {
    const gateway = t.app.get(NotificationsGateway, { strict: false });
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      gateway.handleDisconnect({ id: 'synthetic-socket', data: { userId: uuid() } } as never);
      await wait(500);
    } finally {
      process.off('unhandledRejection', listener);
    }
    expect(unhandled).toEqual([]);
    // The API answers the next request.
    expect((await request(server()).get(`/payroll/runs/${run}`).set(bearer(t.staffToken(maker.id)))).status).toBe(200);
  });
});
