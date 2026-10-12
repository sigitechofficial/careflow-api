/**
 * Gate A sprint, R-08 — cancelling a UK payroll run strands no earning and duplicates none.
 * Audit ID: PR-05.
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import {
  buildPayrollRunsService,
  buildUkPayrollRunsService,
  createApprovedVisit,
  createAuditSpy,
  createRun,
  createTestPrisma,
  createUkRun,
  markStatutoryCalculated,
  resetPayData,
  uuid,
} from './harness';

describe('UK payroll run cancellation and replacement', () => {
  let prisma: PrismaService;
  let visitRuns: PayrollRunsService;
  let ukRuns: UkPayrollRunsService;
  const audit = createAuditSpy();
  const maker = uuid();
  const checker = uuid();
  const november = { periodStart: '2026-11-01', periodEnd: '2026-11-30' };

  /** A £28 visit in a locked visit pay run: the normal source of UK payroll gross. */
  const lockedEarning = async (employeeId: string, start = '2026-11-03T09:00:00Z') => {
    const visit = await createApprovedVisit(prisma, { employeeId, start, amount: 28 });
    const run = await createRun(visitRuns, maker, '2026-11-01', '2026-11-30');
    await visitRuns.calculate(run);
    await visitRuns.approve(checker, run);
    await visitRuns.lock(checker, run);
    const line = await prisma.payrollRunLine.findFirstOrThrow({ where: { visitReconciliationId: visit.id } });
    return { visit, run, line };
  };
  const ukRun = (employeeIds: string[]) => createUkRun(prisma, { ...november, employeeIds, createdById: maker });
  const inputsFor = (lineId: string) =>
    prisma.ukPayrollInputLine.findMany({ where: { sourcePayrollRunLineId: lineId }, orderBy: { createdAt: 'asc' } });
  const statusOf = async (runId: string) => (await prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: runId } })).status;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    visitRuns = buildPayrollRunsService(prisma).service;
    ukRuns = buildUkPayrollRunsService(prisma, audit).service;
  });
  beforeEach(async () => {
    audit.calls.length = 0;
    await resetPayData(prisma);
  });
  afterAll(() => prisma.$disconnect());

  it('1. a draft run is cancelled before any calculation', async () => {
    const run = await ukRun([uuid()]);
    await ukRuns.cancel(maker, run, undefined, 'Created for the wrong period');

    expect(await statusOf(run)).toBe('CANCELLED');
    expect(await prisma.ukPayrollInputLine.count({ where: { runId: run } })).toBe(0);
  });

  it('2. a gross-calculated run is cancelled: its lines stay as a snapshot and release their claims', async () => {
    const employeeId = uuid();
    const { line } = await lockedEarning(employeeId);
    const run = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, run);
    expect((await inputsFor(line.id))[0].claimKey).toBe(`LINE:${line.id}`);

    await ukRuns.cancel(maker, run, undefined, 'Wrong employees enrolled');

    const [snapshot] = await inputsFor(line.id);
    expect(snapshot.runId).toBe(run);
    expect(Number(snapshot.amount)).toBe(28);
    expect(snapshot.claimKey).toBeNull();
    expect(snapshot.releasedAt).not.toBeNull();
  });

  it('3. a run cancelled after tax & NI but before closing posts nothing to year-to-date', async () => {
    const employeeId = uuid();
    await lockedEarning(employeeId);
    const run = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, run);
    await markStatutoryCalculated(prisma, run);

    await ukRuns.cancel(maker, run, undefined, 'Tax codes need updating first');

    expect(await statusOf(run)).toBe('CANCELLED');
    expect(await prisma.employeePayrollYtdContribution.count()).toBe(0);
  });

  it('4–5. a replacement run collects the earnings of the cancelled run, exactly once', async () => {
    const employeeId = uuid();
    const { line } = await lockedEarning(employeeId);
    const first = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, first);
    await ukRuns.cancel(maker, first, undefined, 'Replaced');

    const replacement = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, replacement);

    const inputs = await inputsFor(line.id);
    expect(inputs.map((l) => [l.runId, l.claimKey])).toEqual([
      [first, null],
      [replacement, `LINE:${line.id}`],
    ]);
    const row = await prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: replacement } });
    expect(Number(row.totalGross)).toBe(28);

    // Recalculating the replacement does not duplicate the claim either.
    await ukRuns.calculateGross(maker, replacement);
    expect(await prisma.ukPayrollInputLine.count({ where: { claimKey: `LINE:${line.id}` } })).toBe(1);
  });

  it('6. earnings settled by a closed run are not collected again', async () => {
    const employeeId = uuid();
    const { line } = await lockedEarning(employeeId);
    const closed = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, closed);
    await markStatutoryCalculated(prisma, closed);
    await ukRuns.close(checker, closed);

    const later = await ukRun([employeeId]);
    await expect(ukRuns.calculateGross(maker, later)).rejects.toThrow(/No visit-pay or salary inputs/);
    await expect(ukRuns.cancel(maker, closed, undefined, 'Try to cancel a closed run')).rejects.toThrow(/finalised/i);
    expect((await inputsFor(line.id)).map((l) => l.runId)).toEqual([closed]);
  });

  it('7. the locked visit pay run is unchanged by cancellation and replacement', async () => {
    const employeeId = uuid();
    const { run, line, visit } = await lockedEarning(employeeId);
    const before = {
      run: await prisma.payrollRun.findUniqueOrThrow({ where: { id: run } }),
      line: await prisma.payrollRunLine.findUniqueOrThrow({ where: { id: line.id } }),
      visit: await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visit.id } }),
    };
    const first = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, first);
    await ukRuns.cancel(maker, first, undefined, 'Replaced');
    const replacement = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, replacement);

    expect(await prisma.payrollRun.findUniqueOrThrow({ where: { id: run } })).toEqual(before.run);
    expect(await prisma.payrollRunLine.findUniqueOrThrow({ where: { id: line.id } })).toEqual(before.line);
    expect(await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visit.id } })).toEqual(before.visit);
  });

  it('8. two replacement runs calculating at once: one collects the earning, the other does not', async () => {
    const employeeId = uuid();
    const { line } = await lockedEarning(employeeId);
    const first = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, first);
    await ukRuns.cancel(maker, first, undefined, 'Replaced');
    const a = await ukRun([employeeId]);
    const b = await ukRun([employeeId]);

    const results = await Promise.allSettled([ukRuns.calculateGross(maker, a), ukRuns.calculateGross(maker, b)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.ukPayrollInputLine.count({ where: { claimKey: `LINE:${line.id}` } })).toBe(1);
    const live = await prisma.ukPayrollInputLine.findMany({
      where: { sourcePayrollRunLineId: line.id, runId: { in: [a, b] } },
    });
    expect(live).toHaveLength(1);
  });

  it('9. a cancellation that fails part-way changes nothing, and the retry succeeds', async () => {
    const employeeId = uuid();
    const { line } = await lockedEarning(employeeId);
    const run = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, run);

    const spy = jest.spyOn(audit.service, 'logAudit').mockRejectedValueOnce(new Error('simulated failure'));
    await expect(ukRuns.cancel(maker, run, undefined, 'Replaced')).rejects.toThrow('simulated failure');
    spy.mockRestore();

    expect(await statusOf(run)).toBe('GROSS_CALCULATED');
    expect((await inputsFor(line.id))[0].claimKey).toBe(`LINE:${line.id}`);

    await ukRuns.cancel(maker, run, undefined, 'Replaced');
    expect(await statusOf(run)).toBe('CANCELLED');
    expect((await inputsFor(line.id))[0].claimKey).toBeNull();
    // A second cancel is refused the same way every time.
    await expect(ukRuns.cancel(maker, run, undefined, 'Again')).rejects.toThrow(/finalised/i);
  });

  it('10. cancellation is audited with its reason and what it released', async () => {
    const employeeId = uuid();
    await lockedEarning(employeeId);
    const run = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, run);
    audit.calls.length = 0;

    await ukRuns.cancel(maker, run, undefined, 'Wrong period');

    const entry = audit.calls.find((c) => c.action === 'payroll_run_cancelled') as
      | { userId?: string; description?: string; newValues?: { releasedClaims?: number } }
      | undefined;
    expect(entry?.userId).toBe(maker);
    expect(entry?.description).toBe('Wrong period');
    expect(entry?.newValues?.releasedClaims).toBe(1);
  });

  it('a run that money already depends on cannot be cancelled', async () => {
    const employeeId = uuid();
    const { line } = await lockedEarning(employeeId);
    const run = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, run);
    await markStatutoryCalculated(prisma, run);
    const runEmployee = await prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: run } });
    await prisma.employeePayoutBatch.create({
      data: {
        periodKey: '2026-11',
        periodStart: new Date(november.periodStart),
        periodEnd: new Date(november.periodEnd),
        ukPayrollRunId: run,
        status: 'APPROVED',
        totalAmount: 28,
        lines: { create: [{ employeeId, amount: 28, ukPayrollRunEmployeeId: runEmployee.id }] },
      },
    });

    await expect(ukRuns.cancel(maker, run, undefined, 'Replaced')).rejects.toThrow(/payout batch/i);
    expect((await inputsFor(line.id))[0].claimKey).toBe(`LINE:${line.id}`);
  });

  it('a reactivated cancelled run must collect gross again before it can close', async () => {
    const employeeId = uuid();
    const { line } = await lockedEarning(employeeId);
    const first = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, first);
    await markStatutoryCalculated(prisma, first);
    await ukRuns.cancel(maker, first, undefined, 'Replaced');
    const replacement = await ukRun([employeeId]);
    await ukRuns.calculateGross(maker, replacement);

    // Reactivating needs no other open run in the same period: these two are on separate periods.
    await ukRuns.reactivate(maker, first);

    expect(await statusOf(first)).toBe('EMPLOYEES_ENROLLED');
    await expect(ukRuns.close(checker, first)).rejects.toThrow(/Calculate tax & NI/i);
    // Its stale lines hold no claim, and recalculating finds the earning already taken.
    await expect(ukRuns.calculateGross(maker, first)).rejects.toThrow(/No visit-pay or salary inputs/);
    expect(await prisma.ukPayrollInputLine.count({ where: { claimKey: `LINE:${line.id}` } })).toBe(1);
  });

  it('salary for a pay period is taken by one run; cancelling releases it', async () => {
    const employeeId = uuid();
    const agreement = await prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'SALARIED',
        annualSalary: 36525,
        effectiveFrom: new Date('2026-01-01'),
        status: 'ACTIVE',
      } as never,
    });
    const run = await ukRun([employeeId]);
    await prisma.ukPayrollRunEmployee.updateMany({ where: { runId: run }, data: { payAgreementId: agreement.id } });
    const period = (await prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: run } })).periodId;
    // A supplementary run in the same pay period.
    const base = await prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: run } });
    const supplementary = await prisma.ukPayrollRun.create({
      data: {
        periodId: base.periodId,
        taxYearId: base.taxYearId,
        scheduleId: base.scheduleId,
        runNumber: 2,
        label: 'Supplementary',
        status: 'EMPLOYEES_ENROLLED',
        employeeCount: 1,
        createdById: maker,
        employees: { create: [{ employeeId, payAgreementId: agreement.id }] },
      },
    });

    await ukRuns.calculateGross(maker, run);
    await expect(ukRuns.calculateGross(maker, supplementary.id)).rejects.toThrow(/No visit-pay or salary inputs/);
    expect(await prisma.ukPayrollInputLine.count({ where: { claimKey: `SALARY:${employeeId}:${period}` } })).toBe(1);

    await ukRuns.cancel(maker, run, undefined, 'Replaced');
    await ukRuns.calculateGross(maker, supplementary.id);
    const salary = await prisma.ukPayrollInputLine.findFirstOrThrow({
      where: { runId: supplementary.id, lineType: 'SALARY' },
    });
    expect(Number(salary.amount)).toBe(3000); // 30 days × £36,525 ÷ 365.25
  });
});
