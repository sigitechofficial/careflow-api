/**
 * Phase 0.2 — corrections to settled earnings go through an authorised, traceable ledger.
 * Audit IDs: VW-22, PR-22, SI-15.
 */
import { PayrollRunLineType } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { PayItemsService } from '../../src/billing/pay-items.service';
import {
  buildPayItemsService,
  buildPayrollRunsService,
  createApprovedVisit,
  createAuditSpy,
  createRun,
  createTestPrisma,
  resetPayData,
  uuid,
} from './harness';

describe('pay corrections for settled visits', () => {
  let prisma: PrismaService;
  let runs: PayrollRunsService;
  let payItems: PayItemsService;
  const audit = createAuditSpy();
  const maker = uuid();
  const checker = uuid();

  /** A £14 visit paid by a locked run. */
  const paidVisit = async () => {
    const employeeId = uuid();
    const visit = await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 14 });
    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    await runs.approve(checker, run);
    await runs.lock(checker, run);
    return { visit, employeeId, run };
  };
  const correct = (visitReconciliationId: string, correctedAmount: number, by = maker) =>
    payItems.recordVisitCorrection(by, { visitReconciliationId, correctedAmount, reason: 'Visit ran longer than paid' });
  /** Next week's run: calculate, approve, lock. Returns the adjustment lines it paid. */
  const nextRun = async (from: string, to: string) => {
    const run = await createRun(runs, maker, from, to);
    await runs.calculate(run);
    const lines = await prisma.payrollRunLine.findMany({
      where: { payrollRunId: run, lineType: 'ADJUSTMENT' as PayrollRunLineType },
    });
    if (lines.length) {
      await runs.approve(checker, run);
      await runs.lock(checker, run);
    }
    return { run, lines };
  };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    runs = buildPayrollRunsService(prisma).service;
    payItems = buildPayItemsService(prisma, audit).service;
  });
  beforeEach(async () => {
    audit.calls.length = 0;
    await resetPayData(prisma);
  });
  afterAll(() => prisma.$disconnect());

  it('VW-22: positive backpay is a separate, approved adjustment paid in the next run', async () => {
    const { visit, run } = await paidVisit();

    const { data: item } = await correct(visit.id, 21);
    expect(Number(item.amount)).toBe(7);
    expect(item).toMatchObject({ sourceType: 'VISIT_CORRECTION', sourceId: visit.id, status: 'PENDING_APPROVAL' });
    expect(Number(item.originalAmount)).toBe(14);
    expect(Number(item.correctedAmount)).toBe(21);
    expect(item.originalPayrollRunLineId).toBeTruthy();

    // Not paid until a second person approves it.
    expect((await nextRun('2026-11-08', '2026-11-14')).lines).toHaveLength(0);
    await expect(payItems.approve(maker, item.id)).rejects.toThrow(/different user/i);
    await payItems.approve(checker, item.id);

    const { lines } = await nextRun('2026-11-08', '2026-11-14');
    expect(lines.map((l) => Number(l.amount))).toEqual([7]);

    // The original record is untouched.
    const original = await prisma.payrollRunLine.findFirstOrThrow({
      where: { payrollRunId: run, visitReconciliationId: visit.id, lineType: PayrollRunLineType.VISIT_PAY },
    });
    expect(Number(original.amount)).toBe(14);
    const row = await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visit.id } });
    expect(Number(row.payableAmount)).toBe(14);
    expect(audit.calls.map((c) => c.action)).toEqual(
      expect.arrayContaining(['visit_pay_correction_recorded', 'pay_item_approved']),
    );
  });

  it('VW-22: a negative correction recovers the overpayment', async () => {
    const { visit } = await paidVisit();
    const { data: item } = await correct(visit.id, 10.5);
    expect(Number(item.amount)).toBe(-3.5);
    await payItems.approve(checker, item.id);
    expect((await nextRun('2026-11-08', '2026-11-14')).lines.map((l) => Number(l.amount))).toEqual([-3.5]);
  });

  it('VW-22: running the same correction twice pays the difference once', async () => {
    const { visit } = await paidVisit();
    const first = await correct(visit.id, 21);

    await expect(correct(visit.id, 21)).rejects.toThrow(/awaiting approval/i);
    await payItems.approve(checker, first.data.id);
    await expect(correct(visit.id, 21)).rejects.toThrow(/nothing to correct/i);

    // A further change is measured against everything settled so far.
    const second = await correct(visit.id, 25);
    expect(Number(second.data.amount)).toBe(4);
  });

  it('VW-22: two people submitting the same correction together create one item', async () => {
    const { visit } = await paidVisit();
    const results = await Promise.allSettled([correct(visit.id, 21, maker), correct(visit.id, 21, checker)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.employeePayItem.count({ where: { sourceId: visit.id } })).toBe(1);
  });

  it('a visit that is not settled is changed directly, not through a correction', async () => {
    const visit = await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
    await expect(correct(visit.id, 21)).rejects.toThrow(/not in a locked payroll run/i);
  });

  it('VW-22: a paid adjustment is reversed once, by an equal and opposite approved item', async () => {
    const { visit } = await paidVisit();
    const { data: item } = await correct(visit.id, 21);
    await expect(payItems.reverse(maker, item.id, 'Entered in error')).rejects.toThrow(/has been paid/i);
    await payItems.approve(checker, item.id);
    await nextRun('2026-11-08', '2026-11-14');

    const { data: reversal } = await payItems.reverse(maker, item.id, 'Entered in error');
    expect(Number(reversal.amount)).toBe(-7);
    expect(reversal).toMatchObject({ sourceType: 'REVERSAL', reversesPayItemId: item.id, status: 'PENDING_APPROVAL' });
    await expect(payItems.reverse(maker, item.id, 'Entered in error')).rejects.toThrow(/already been reversed/i);

    await payItems.approve(checker, reversal.id);
    expect((await nextRun('2026-11-15', '2026-11-21')).lines.map((l) => Number(l.amount))).toEqual([-7]);

    const history = await payItems.visitCorrectionHistory(visit.id);
    expect(history.data.netAmount).toBe('14.00');
    expect(history.data.items).toHaveLength(2);
  });
});
