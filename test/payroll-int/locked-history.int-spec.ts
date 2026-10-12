/**
 * Phase 0.2 — locked payroll history cannot be silently changed.
 * Audit IDs: SI-05, VW-22, VW-23, PR-13.
 */
import { VisitOverrunDecision } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import {
  buildPayrollRunsService,
  buildReconciliationService,
  createCompletedVisit,
  createRun,
  createTestPrisma,
  resetPayData,
  uuid,
} from './harness';

describe('locked payroll history', () => {
  let prisma: PrismaService;
  let runs: PayrollRunsService;
  let recons: VisitReconciliationsService;
  let payCardId: string;
  const maker = uuid();
  const checker = uuid();

  /** A completed 60-minute visit at £14/hr, approved for pay and locked into a visit pay run. */
  const lockedVisit = async (options: { actualMinutes?: number } = {}) => {
    const fixture = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z', ...options });
    const id = (await recons.ensureForVisit(fixture.visitId))!;
    // managerOverride: an overrun still pending is paid on planned time.
    await recons.approve(checker, id, { scope: 'PAY', managerOverride: true } as never);
    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    await runs.approve(checker, run);
    await runs.lock(checker, run);
    return { ...fixture, id, run };
  };
  const paySnapshot = async (id: string) => {
    const row = await prisma.visitReconciliation.findUniqueOrThrow({ where: { id } });
    return {
      amount: Number(row.payableAmount),
      minutes: row.payableMinutes,
      start: row.approvedPayStart?.toISOString(),
      end: row.approvedPayEnd?.toISOString(),
      employeeId: row.employeeId,
      run: row.includedInPayrollRunId,
    };
  };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    runs = buildPayrollRunsService(prisma).service;
  });
  beforeEach(async () => {
    await resetPayData(prisma);
    const built = await buildReconciliationService(prisma);
    recons = built.service;
    payCardId = built.card.id;
  });
  afterAll(() => prisma.$disconnect());

  it('prices and locks a completed visit (baseline)', async () => {
    const visit = await lockedVisit();
    expect(await paySnapshot(visit.id)).toMatchObject({ amount: 14, minutes: 60, run: visit.run });
  });

  it('SI-05: bulk recalculation leaves a locked visit untouched', async () => {
    const visit = await lockedVisit();
    const before = await paySnapshot(visit.id);
    await prisma.payCardRule.updateMany({ where: { payCardId }, data: { amount: 99 } });

    const result = await recons.recalculateAmounts({ ids: [visit.id], reason: 'test' } as never, checker);

    expect(await paySnapshot(visit.id)).toEqual(before);
    expect(JSON.stringify(result.data)).not.toContain('"changed":true');
  });

  it('VW-23: attendance edited after locking does not rewrite the pay snapshot', async () => {
    const visit = await lockedVisit();
    const before = await paySnapshot(visit.id);

    // Office corrects the visit: it actually ran 90 minutes.
    const laterEnd = new Date('2026-11-03T10:30:00Z');
    await prisma.scheduledVisit.update({ where: { id: visit.visitId }, data: { actualEndDateTime: laterEnd } });
    await prisma.jobAllocation.update({ where: { id: visit.allocationId }, data: { actualEndDateTime: laterEnd } });
    await recons.ensureForVisit(visit.visitId);
    await recons.evaluate(visit.id);

    expect(await paySnapshot(visit.id)).toEqual(before);
    // The corrected fact itself is kept on the record.
    const row = await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visit.id } });
    expect(row.actualEndDateTime?.toISOString()).toBe(laterEnd.toISOString());
  });

  it('VW-22: pay-side actions on a locked visit are refused with a pointer to pay corrections', async () => {
    const visit = await lockedVisit({ actualMinutes: 90 });
    const before = await paySnapshot(visit.id);
    const refused = /pay correction/i;

    await expect(recons.setPayableAmount(checker, visit.id, { payableAmount: 50 } as never)).rejects.toThrow(/payroll run/i);
    await expect(recons.update(visit.id, { approvedPayEnd: '2026-11-03T11:00:00Z' } as never)).rejects.toThrow(refused);
    await expect(recons.update(visit.id, { travelMiles: 12 } as never)).rejects.toThrow(refused);
    await expect(recons.reject(checker, visit.id, { scope: 'PAY' } as never)).rejects.toThrow(refused);
    await expect(recons.approveOverrun(checker, visit.id, { timeBasis: 'ACTUAL', applyTo: 'PAY' } as never)).rejects.toThrow(refused);
    await expect(recons.rejectOverrun(checker, visit.id, {} as never)).rejects.toThrow(refused);

    expect(await paySnapshot(visit.id)).toEqual(before);
    // Charge-side work is still possible.
    await recons.update(visit.id, { approvalNotes: 'charge query' } as never);
  });

  it('VW-23: the database refuses a direct change to a locked visit, a locked line or a locked run', async () => {
    const visit = await lockedVisit();
    const locked = /LOCKED_PAYROLL_HISTORY/;

    await expect(
      prisma.visitReconciliation.update({ where: { id: visit.id }, data: { payableAmount: 99 } }),
    ).rejects.toThrow(locked);
    await expect(
      prisma.visitReconciliation.update({ where: { id: visit.id }, data: { includedInPayrollRunId: null } }),
    ).rejects.toThrow(locked);
    await expect(prisma.visitReconciliation.delete({ where: { id: visit.id } })).rejects.toThrow();
    await expect(prisma.payrollRunLine.updateMany({ where: { payrollRunId: visit.run }, data: { amount: 99 } })).rejects.toThrow(locked);
    await expect(prisma.payrollRunLine.deleteMany({ where: { payrollRunId: visit.run } })).rejects.toThrow(locked);
    await expect(prisma.payrollRun.update({ where: { id: visit.run }, data: { status: 'DRAFT' } })).rejects.toThrow(locked);
    await expect(prisma.payrollRun.delete({ where: { id: visit.run } })).rejects.toThrow(locked);

    // Still allowed: export marks the run EXPORTED, and the charge side of the visit can change.
    await prisma.payrollRun.update({ where: { id: visit.run }, data: { status: 'EXPORTED', exportedAt: new Date() } });
    await prisma.visitReconciliation.update({ where: { id: visit.id }, data: { billableAmount: 30 } });
  });

  it('PR-13: a locked run cannot be recalculated, approved again or discarded', async () => {
    const visit = await lockedVisit();
    await expect(runs.calculate(visit.run)).rejects.toThrow(/Cannot recalculate/);
    await expect(runs.approve(checker, visit.run)).rejects.toThrow();
    await expect(runs.discard(checker, visit.run)).rejects.toThrow(/not been locked/);
  });

  it('an unlocked visit still reprices when its overrun is decided', async () => {
    const fixture = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z', actualMinutes: 90 });
    const id = (await recons.ensureForVisit(fixture.visitId))!;
    expect((await paySnapshot(id)).amount).toBe(14);

    await recons.approveOverrun(checker, id, { timeBasis: 'ACTUAL', applyTo: 'PAY' } as never);

    const row = await prisma.visitReconciliation.findUniqueOrThrow({ where: { id } });
    expect(row.overrunDecision).toBe(VisitOverrunDecision.APPROVED);
    expect(Number(row.payableAmount)).toBe(21);
  });
});
