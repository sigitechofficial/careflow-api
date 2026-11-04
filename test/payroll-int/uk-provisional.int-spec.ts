/**
 * Phase 0.1 — a visit that reaches UK payroll is settled once, whichever route it takes.
 * Audit ID: PR-05 (provisional visits in the UK run), with SI-01.
 */
import { PayrollRunLineType } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import {
  buildPayrollRunsService,
  buildUkPayrollRunsService,
  createApprovedVisit,
  createRun,
  createTestPrisma,
  createUkRun,
  markStatutoryCalculated,
  resetPayData,
  uuid,
} from './harness';

describe('UK payroll gross collection: one settlement per visit', () => {
  let prisma: PrismaService;
  let visitRuns: PayrollRunsService;
  let ukRuns: UkPayrollRunsService;
  const maker = uuid();
  const checker = uuid();

  const visitInputs = (runId: string, reconciliationId: string) =>
    prisma.ukPayrollInputLine.findMany({
      where: { runId, sourceVisitReconciliationId: reconciliationId, lineType: 'VISIT_PAY' },
    });
  const grossAndClose = async (runId: string) => {
    await ukRuns.calculateGross(maker, runId);
    await markStatutoryCalculated(prisma, runId);
    await ukRuns.close(checker, runId);
  };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    visitRuns = buildPayrollRunsService(prisma).service;
    ukRuns = buildUkPayrollRunsService(prisma).service;
  });
  beforeEach(() => resetPayData(prisma));
  afterAll(() => prisma.$disconnect());

  it('PR-05: a visit paid provisionally by a closed UK run is not collected by a later UK run', async () => {
    const employeeId = uuid();
    const visit = await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28 });
    const first = await createUkRun(prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker });
    await grossAndClose(first);

    expect(await visitInputs(first, visit.id)).toHaveLength(1);
    const settled = await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visit.id } });
    expect(settled.paidByUkPayrollRunId).toBe(first);

    // Off-cycle run over the same dates: the visit must not come in again.
    const later = await createApprovedVisit(prisma, { employeeId, start: '2026-11-20T09:00:00Z', amount: 14 });
    const second = await createUkRun(prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker });
    await ukRuns.calculateGross(maker, second);

    expect(await visitInputs(second, visit.id)).toHaveLength(0);
    expect(await visitInputs(second, later.id)).toHaveLength(1);
  });

  it('PR-05: a visit paid provisionally by a closed UK run cannot enter a visit pay run afterwards', async () => {
    const employeeId = uuid();
    const visit = await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28 });
    const uk = await createUkRun(prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker });
    await grossAndClose(uk);

    const visitRun = await createRun(visitRuns, maker, '2026-11-01', '2026-11-30');
    await visitRuns.calculate(visitRun);

    expect(
      await prisma.payrollRunLine.count({
        where: { visitReconciliationId: visit.id, lineType: PayrollRunLineType.VISIT_PAY },
      }),
    ).toBe(0);
  });

  it('PR-05: a visit pay run that was open when the UK run closed cannot lock the same visit', async () => {
    const employeeId = uuid();
    await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28 });
    const visitRun = await createRun(visitRuns, maker, '2026-11-01', '2026-11-30');
    await visitRuns.calculate(visitRun);
    await visitRuns.approve(checker, visitRun);

    const uk = await createUkRun(prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker });
    await grossAndClose(uk);

    await expect(visitRuns.lock(checker, visitRun)).rejects.toThrow(/changed since this run was calculated/i);
  });

  it('PR-05: two UK runs holding the same provisional visit cannot both close', async () => {
    const employeeId = uuid();
    await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28 });
    const a = await createUkRun(prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker });
    const b = await createUkRun(prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker });
    await ukRuns.calculateGross(maker, a);
    await ukRuns.calculateGross(maker, b);
    await markStatutoryCalculated(prisma, a);
    await markStatutoryCalculated(prisma, b);

    const results = await Promise.allSettled([ukRuns.close(checker, a), ukRuns.close(checker, b)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await prisma.ukPayrollRun.count({ where: { status: 'CLOSED' } })).toBe(1);
  });

  it('a locked visit pay line is collected by one UK run only', async () => {
    const employeeId = uuid();
    const visit = await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28 });
    const visitRun = await createRun(visitRuns, maker, '2026-11-01', '2026-11-30');
    await visitRuns.calculate(visitRun);
    await visitRuns.approve(checker, visitRun);
    await visitRuns.lock(checker, visitRun);

    const a = await createUkRun(prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker });
    const b = await createUkRun(prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker });
    await ukRuns.calculateGross(maker, a);
    await expect(ukRuns.calculateGross(maker, b)).rejects.toThrow(/No visit-pay or salary inputs/);

    const lines = await prisma.ukPayrollInputLine.findMany({ where: { sourceVisitReconciliationId: visit.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0].isProvisional).toBe(false);
  });

  it('back pay: a visit approved after its period closed is paid once by the next run of the schedule', async () => {
    const employeeId = uuid();
    const november = await createUkRun(prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker });
    await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28 });
    await grossAndClose(november);
    const novemberRun = await prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: november }, include: { period: true } });
    expect(novemberRun.period.status).toBe('CLOSED');

    // Approved only now, after November closed.
    const late = await createApprovedVisit(prisma, { employeeId, start: '2026-11-25T09:00:00Z', amount: 14 });
    // A visit of a period that is still open is not back pay: it stays with its own period.
    const otherSchedule = await createUkRun(prisma, { periodStart: '2026-10-01', periodEnd: '2026-10-31', employeeIds: [], createdById: maker });
    const october = await prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: otherSchedule } });
    const notMine = await createApprovedVisit(prisma, { employeeId, start: '2026-10-20T09:00:00Z', amount: 7 });

    const decemberPeriod = await prisma.payrollPeriod.create({
      data: {
        scheduleId: novemberRun.scheduleId,
        taxYearId: novemberRun.taxYearId,
        sequence: 2,
        label: 'December',
        periodStart: new Date('2026-12-01'),
        periodEnd: new Date('2026-12-31'),
        paymentDate: new Date('2026-12-31'),
      },
    });
    const december = (
      await prisma.ukPayrollRun.create({
        data: {
          periodId: decemberPeriod.id,
          taxYearId: novemberRun.taxYearId,
          scheduleId: novemberRun.scheduleId,
          runNumber: 1,
          label: 'December run',
          status: 'EMPLOYEES_ENROLLED',
          employeeCount: 1,
          createdById: maker,
          employees: { create: [{ employeeId }] },
        },
      })
    ).id;
    await ukRuns.calculateGross(maker, december);

    const [line] = await visitInputs(december, late.id);
    expect(line.description).toMatch(/^Back pay: visit on 2026-11-25 \(its period was already closed\)/);
    expect(Number(line.amount)).toBe(14);
    expect(await visitInputs(december, notMine.id)).toHaveLength(0);
    expect(october.status).toBe('EMPLOYEES_ENROLLED');

    await markStatutoryCalculated(prisma, december);
    await ukRuns.close(checker, december);
    expect((await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: late.id } })).paidByUkPayrollRunId).toBe(december);
  });

  it('PR-13: reopening a closed UK run releases its visits; it is refused once a payout is approved', async () => {
    const employeeId = uuid();
    const visit = await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28 });
    const uk = await createUkRun(prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker });
    await grossAndClose(uk);

    await expect(ukRuns.reactivate(checker, uk)).rejects.toThrow(/payroll\.runs\.reopen/);
    await ukRuns.reactivate(checker, uk, undefined, { mayReopenClosed: true });
    const released = await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visit.id } });
    expect(released.paidByUkPayrollRunId).toBeNull();

    await markStatutoryCalculated(prisma, uk);
    await ukRuns.close(checker, uk);
    const runEmployee = await prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: uk } });
    await prisma.employeePayoutBatch.create({
      data: {
        periodKey: '2026-11',
        periodStart: new Date('2026-11-01'),
        periodEnd: new Date('2026-11-30'),
        ukPayrollRunId: uk,
        status: 'APPROVED',
        totalAmount: 28,
        lines: { create: [{ employeeId, amount: 28, ukPayrollRunEmployeeId: runEmployee.id }] },
      },
    });

    await expect(ukRuns.reactivate(checker, uk, undefined, { mayReopenClosed: true })).rejects.toThrow(
      /approved or paid payout batch/i,
    );
    const still = await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visit.id } });
    expect(still.paidByUkPayrollRunId).toBe(uk);
  });
});
