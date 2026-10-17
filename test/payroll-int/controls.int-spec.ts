/**
 * Phase 0.4 and 0.6 — destructive operations, maker / checker and audit of money decisions.
 * Audit IDs: SI-06, SI-07, SI-15, PR-12.
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import {
  buildPayoutsService,
  buildPayrollRunsService,
  buildReconciliationService,
  buildUkPayrollRunsService,
  createApprovedVisit,
  createAuditSpy,
  createCompletedVisit,
  createRun,
  createTestPrisma,
  createUkRun,
  markStatutoryCalculated,
  resetPayData,
  uuid,
} from './harness';

describe('financial controls', () => {
  let prisma: PrismaService;
  let runs: PayrollRunsService;
  let ukRuns: UkPayrollRunsService;
  let recons: VisitReconciliationsService;
  const audit = createAuditSpy();
  const maker = uuid();
  const checker = uuid();
  const savedEnv = { NODE_ENV: process.env.NODE_ENV, ALLOW_FINANCIAL_TEST_RESET: process.env.ALLOW_FINANCIAL_TEST_RESET };
  const setEnv = (nodeEnv: string | undefined, allow: string | undefined) => {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    if (allow === undefined) delete process.env.ALLOW_FINANCIAL_TEST_RESET;
    else process.env.ALLOW_FINANCIAL_TEST_RESET = allow;
  };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    runs = buildPayrollRunsService(prisma, audit).service;
    ukRuns = buildUkPayrollRunsService(prisma, audit).service;
  });
  beforeEach(async () => {
    audit.calls.length = 0;
    await resetPayData(prisma);
    recons = (await buildReconciliationService(prisma, { audit })).service;
  });
  afterEach(() => setEnv(savedEnv.NODE_ENV, savedEnv.ALLOW_FINANCIAL_TEST_RESET));
  afterAll(() => prisma.$disconnect());

  describe('SI-06: bulk deletion of financial records', () => {
    const lockedRunWithVisit = async () => {
      const visit = await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
      const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
      await runs.calculate(run);
      await runs.approve(checker, run);
      await runs.lock(checker, run);
      return { visit, run };
    };
    const destructiveCalls = () => {
      const payouts = buildPayoutsService(prisma, audit).service;
      return {
        'clear-all reconciliations': () => recons.clearAll(undefined, maker),
        'reset employee earnings': () => runs.resetEmployeeEarnings(maker, uuid()),
        'delete all UK payroll runs': () => ukRuns.deleteAll(maker),
        'delete all payout batches': () => payouts.deleteAll(maker),
      };
    };

    it.each([
      ['production, flag on', 'production', 'true'],
      ['production, flag off', 'production', undefined],
      ['development, flag off', 'development', undefined],
      ['test, flag off', 'test', 'false'],
    ])('is refused in %s', async (_label, nodeEnv, allow) => {
      const { visit, run } = await lockedRunWithVisit();
      setEnv(nodeEnv, allow);

      for (const [name, call] of Object.entries(destructiveCalls())) {
        await expect(call()).rejects.toThrow(/disabled/i);
        expect(name).toBeTruthy();
      }
      expect(await prisma.visitReconciliation.count({ where: { id: visit.id } })).toBe(1);
      expect(await prisma.payrollRunLine.count({ where: { payrollRunId: run } })).toBe(1);
    });

    it('runs outside production only when the server opts in, and is audited', async () => {
      await lockedRunWithVisit();
      setEnv('development', 'true');

      await recons.clearAll(undefined, maker);

      expect(await prisma.visitReconciliation.count()).toBe(0);
      expect(audit.calls.some((c) => c.action === 'financial_test_data_reset' && c.userId === maker)).toBe(true);
    });
  });

  describe('SI-15 / PR-12: maker and checker', () => {
    it('the creator of a visit pay run cannot approve it; another user can', async () => {
      await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
      const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
      await runs.calculate(run, maker);

      await expect(runs.approve(maker, run)).rejects.toThrow(/different user/i);
      await runs.approve(checker, run);
    });

    it('recalculating an approved run withdraws the approval', async () => {
      await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
      const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
      await runs.calculate(run, maker);
      await runs.approve(checker, run);

      await runs.calculate(run, maker);

      const row = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run } });
      expect(row).toMatchObject({ status: 'READY_FOR_REVIEW', approvedAt: null, approvedById: null });
      await expect(runs.lock(checker, run)).rejects.toThrow(/approve/i);
    });

    it('the creator of a UK payroll run cannot close it; another user can', async () => {
      const employeeId = uuid();
      await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28 });
      const uk = await createUkRun(prisma, { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [employeeId], createdById: maker });
      await ukRuns.calculateGross(maker, uk);
      await markStatutoryCalculated(prisma, uk);

      await expect(ukRuns.close(maker, uk)).rejects.toThrow(/different user/i);
      await ukRuns.close(checker, uk);
    });
  });

  describe('SI-07: money decisions leave an audit entry', () => {
    it('visit pay run: create, calculate, approve, lock, discard', async () => {
      await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
      const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
      await runs.calculate(run, maker);
      await runs.approve(checker, run);
      await runs.lock(checker, run);
      const spare = await createRun(runs, maker, '2026-11-08', '2026-11-14');
      await runs.discard(maker, spare);

      expect(audit.calls.filter((c) => c.recordType === 'PayrollRun').map((c) => [c.action, c.userId])).toEqual([
        ['visit_pay_run_created', maker],
        ['visit_pay_run_calculated', maker],
        ['visit_pay_run_approved', checker],
        ['visit_pay_run_locked', checker],
        ['visit_pay_run_created', maker],
        ['visit_pay_run_discarded', maker],
      ]);
    });

    it('visit decisions: approve, reject, overrun, manual amount, payable time edit', async () => {
      const a = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z', actualMinutes: 90 });
      const id = (await recons.ensureForVisit(a.visitId))!;
      await recons.approveOverrun(checker, id, { timeBasis: 'ACTUAL', applyTo: 'PAY', notes: 'Agreed with coordinator' } as never);
      await recons.approve(checker, id, { scope: 'PAY' } as never);
      await recons.setPayableAmount(checker, id, { payableAmount: 25, notes: 'Agreed flat amount' } as never);
      await recons.update(id, { travelMiles: 3.2 } as never, checker);
      await recons.reject(checker, id, { scope: 'PAY', approvalNotes: 'Duplicate of another visit' } as never);

      expect(audit.calls.filter((c) => c.recordType === 'VisitReconciliation').map((c) => [c.action, c.userId])).toEqual([
        ['visit_reconciliation_overrun_decided', checker],
        ['visit_reconciliation_approved', checker],
        ['visit_reconciliation_payable_amount_set', checker],
        ['visit_reconciliation_updated', checker],
        ['visit_reconciliation_rejected', checker],
      ]);
    });
  });
});
